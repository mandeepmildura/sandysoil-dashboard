// Handles outbound fault alerts (triggered by device_alerts DB webhook)
// and inbound commands (Twilio webhook POST /inbound).
// Secrets required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TWILIO_ACCOUNT_SID   = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TWILIO_AUTH_TOKEN    = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''
const TWILIO_FROM_NUMBER   = Deno.env.get('TWILIO_FROM_NUMBER') ?? ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function getSettings(): Promise<Record<string, string>> {
  const { data } = await supabase.from('admin_settings').select('key, value')
  return Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
}

async function sendTwilio(to: string, body: string, channel: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error('Twilio credentials not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER secrets')
  }
  const from = channel === 'sms'
    ? TWILIO_FROM_NUMBER.replace('whatsapp:', '')
    : TWILIO_FROM_NUMBER.startsWith('whatsapp:') ? TWILIO_FROM_NUMBER : `whatsapp:${TWILIO_FROM_NUMBER}`
  const toFormatted = channel === 'sms' ? to : `whatsapp:${to.replace('whatsapp:', '')}`

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: toFormatted, From: from, Body: body }).toString(),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio error ${res.status}: ${text}`)
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Inbound Twilio webhook: POST /whatsapp-gateway/inbound
  if (req.method === 'POST' && url.pathname.endsWith('/inbound')) {
    const formData = await req.formData()
    const from = formData.get('From')?.toString() ?? ''
    const body = formData.get('Body')?.toString().trim().toUpperCase() ?? ''

    const settings = await getSettings()
    const alertPhone = (settings.alert_phone ?? '').replace(/\s/g, '')
    const authorised = alertPhone && (
      from.replace('whatsapp:', '') === alertPhone ||
      from === alertPhone ||
      from === `whatsapp:${alertPhone}`
    )

    if (!authorised) {
      console.warn(`[whatsapp-gateway] unauthorised sender: ${from}`)
      await supabase.from('device_alerts').insert({
        severity: 'info', title: 'Unauthorised WhatsApp command',
        description: `From: ${from}, Body: ${body}`,
        device: 'whatsapp', device_id: '', acknowledged: false,
      })
      return new Response(
        '<?xml version="1.0"?><Response><Message>Not authorised.</Message></Response>',
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    let reply = 'Unknown command. Try: STOP, STOP 2, STATUS, OK'

    if (body === 'STOP') {
      await supabase.from('program_queue').insert({
        group_id: null, step_type: 'all_off', device: 'irrigation1',
        zone_num: 0, duration_min: null, fire_at: new Date().toISOString(),
      })
      reply = 'Stopping all zones. Command queued — will fire immediately or on reconnect.'
    } else if (/^STOP \d+$/.test(body)) {
      const zoneNum = parseInt(body.split(' ')[1])
      await supabase.from('program_queue').insert({
        group_id: null, step_type: 'off', device: 'irrigation1',
        zone_num: zoneNum, duration_min: null, fire_at: new Date().toISOString(),
      })
      reply = `Zone ${zoneNum} stop queued.`
    } else if (body === 'STATUS') {
      const { data: open } = await supabase
        .from('zone_history').select('zone_num, started_at')
        .eq('device', 'irrigation1').is('ended_at', null)
      if (!open?.length) {
        reply = 'No zones currently running.'
      } else {
        reply = open.map(r => {
          const min = Math.round((Date.now() - new Date(r.started_at).getTime()) / 60_000)
          return `Zone ${r.zone_num}: running ${min} min`
        }).join('\n')
      }
    } else if (body === 'OK') {
      await supabase.from('device_alerts')
        .update({ acknowledged: true })
        .eq('acknowledged', false)
        .eq('device', 'irrigation1')
      reply = 'Alerts acknowledged.'
    }

    return new Response(
      `<?xml version="1.0"?><Response><Message>${reply}</Message></Response>`,
      { headers: { 'Content-Type': 'text/xml' } }
    )
  }

  // Outbound alert: POST /whatsapp-gateway with JSON body { alert_id }
  if (req.method === 'POST') {
    let alert_id: string | undefined
    try {
      const body = await req.json()
      alert_id = body?.record?.id ?? body?.alert_id
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    if (!alert_id) {
      return new Response(JSON.stringify({ ok: false, error: 'missing alert_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const { data: alert } = await supabase
      .from('device_alerts').select('*').eq('id', alert_id).single()
    if (!alert || alert.severity !== 'fault') {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { 'Content-Type': 'application/json' } })
    }

    const settings = await getSettings()
    const phone   = (settings.alert_phone ?? '').replace(/\s/g, '')
    const channel = settings.alert_channel ?? 'whatsapp'

    if (!phone) {
      console.warn('[whatsapp-gateway] no alert_phone configured in admin_settings')
      return new Response(JSON.stringify({ ok: false, error: 'no_phone' }), { headers: { 'Content-Type': 'application/json' } })
    }

    const msg = `[Sandy Soil Alert]\n${alert.title}\n${alert.description}\n\nReply STOP to stop all, STOP N to stop zone N, STATUS to check, OK to acknowledge.`

    try {
      await sendTwilio(phone, msg, channel === 'both' ? 'whatsapp' : channel)
      if (channel === 'both') await sendTwilio(phone, msg, 'sms')
    } catch (err) {
      console.error('[whatsapp-gateway] send failed:', err)
      return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  }

  return new Response('Not found', { status: 404 })
})

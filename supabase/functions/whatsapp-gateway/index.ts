// Handles outbound fault alerts (triggered by device_alerts DB webhook)
// and inbound commands (Twilio webhook POST /inbound).
// Secrets required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
// Optional: TWILIO_WHATSAPP_FROM — WhatsApp sender (e.g. sandbox +14155238886).
//           Falls back to TWILIO_FROM_NUMBER if not set.
//           TWILIO_WEBHOOK_URL — exact public URL Twilio is configured to
//           call. Only needed if signature validation rejects every request
//           because the runtime req.url differs from what Twilio signed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TWILIO_ACCOUNT_SID   = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TWILIO_AUTH_TOKEN    = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''
const TWILIO_FROM_NUMBER   = Deno.env.get('TWILIO_FROM_NUMBER') ?? ''
const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? TWILIO_FROM_NUMBER

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function getSettings(): Promise<Record<string, string>> {
  const { data } = await supabase.from('admin_settings').select('key, value')
  return Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
}

function normalizePhone(s: string): string {
  return s.replace(/^whatsapp:/i, '').replace(/\s/g, '').trim()
}

/**
 * Validate a Twilio webhook signature.
 * Twilio signs (request URL + each POST param appended as key+value, sorted
 * by key) with HMAC-SHA1 keyed by the account auth token, base64-encoded.
 * See https://www.twilio.com/docs/usage/security#validating-requests
 */
async function isValidTwilioSignature(
  authToken: string,
  signature: string,
  webhookUrl: string,
  params: Record<string, string>,
): Promise<boolean> {
  const data = webhookUrl + Object.keys(params).sort()
    .map(k => k + params[k])
    .join('')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
  // Constant-time compare to avoid leaking the signature via timing.
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}

async function sendTwilio(to: string, body: string, channel: string, fromOverride?: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error('Twilio credentials not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER secrets')
  }
  const defaultFrom = channel === 'sms' ? TWILIO_FROM_NUMBER : TWILIO_WHATSAPP_FROM
  const baseFrom = normalizePhone(fromOverride ?? defaultFrom)
  const from = channel === 'sms'
    ? baseFrom
    : `whatsapp:${baseFrom}`
  const toFormatted = channel === 'sms' ? normalizePhone(to) : `whatsapp:${normalizePhone(to)}`

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

    // Verify the request genuinely came from Twilio before trusting any field.
    // Without this the `From` field is attacker-controlled — anyone could POST
    // From=<admin number>&Body=STOP and shut off every irrigation zone.
    const params: Record<string, string> = {}
    for (const [k, v] of formData.entries()) {
      if (typeof v === 'string') params[k] = v
    }
    const signature  = req.headers.get('X-Twilio-Signature') ?? ''
    const webhookUrl = Deno.env.get('TWILIO_WEBHOOK_URL') ?? req.url
    const signed = TWILIO_AUTH_TOKEN.length > 0 && signature.length > 0 &&
      await isValidTwilioSignature(TWILIO_AUTH_TOKEN, signature, webhookUrl, params)
    if (!signed) {
      console.warn('[whatsapp-gateway] inbound rejected — missing/invalid Twilio signature')
      return new Response('Forbidden', { status: 403 })
    }

    const from      = formData.get('From')?.toString() ?? ''
    const inboundTo = formData.get('To')?.toString() ?? ''
    const body      = formData.get('Body')?.toString().trim().toUpperCase() ?? ''
    console.log('[inbound] From:', from, 'To:', inboundTo, 'Body:', body)

    const settings = await getSettings()
    const alertPhone = normalizePhone(settings.alert_phone ?? '')
    const authorised = alertPhone && normalizePhone(from) === alertPhone

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
      const since24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
      const { data: open } = await supabase
        .from('zone_history').select('zone_num, started_at')
        .eq('device', 'irrigation1').is('ended_at', null)
        .gte('started_at', since24h)
        .order('started_at', { ascending: false })
        .limit(8)
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

    try {
      // Mirror the channel: if Twilio delivered via WhatsApp, reply via WhatsApp.
      const replyChannel = inboundTo.toLowerCase().startsWith('whatsapp:') ? 'whatsapp' : 'sms'
      await sendTwilio(from, reply, replyChannel, inboundTo || undefined)
    } catch (err) {
      console.error('[whatsapp-gateway] inbound reply failed:', String(err))
    }
    return new Response('<?xml version="1.0"?><Response/>', { headers: { 'Content-Type': 'text/xml' } })
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

/**
 * Sandy Soil Automations — Program Queue Executor
 * Supabase Edge Function — invoked every minute via pg_cron
 *
 * Publishes MQTT commands via a raw WebSocket + hand-rolled MQTT 3.1.1 packets.
 * This avoids any npm/Node.js compat issues — Deno's native WebSocket handles it.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildConnect, buildPublish, buildDisconnect } from './lib/mqttPacket.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MQTT_HOST = Deno.env.get('MQTT_HOST') ?? 'eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud'
const MQTT_USER = Deno.env.get('MQTT_USER') ?? 'farmcontrol-web'
const MQTT_PASS = Deno.env.get('MQTT_PASS') ?? 'Zayan@09022022'

const A6V3_SET_TOPIC = 'A6v3/8CBFEA03002C/SET'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function raiseAlert(title: string, description: string, severity: string): Promise<void> {
  try {
    await supabase.from('device_alerts').insert({
      severity, title, description,
      device: 'scheduler', device_id: '', acknowledged: false,
    })
  } catch (_) { /* non-critical */ }
}

// ── Minimal MQTT 3.1.1 over WebSocket ────────────────────────────────────────
// Packet encoders live in ./lib/mqttPacket.ts for unit testability.

async function mqttPublishAll(messages: { topic: string; payload: string }[]): Promise<void> {
  if (messages.length === 0) return
  const brokerUrl = `wss://${MQTT_HOST}:8884/mqtt`
  console.log(`[mqtt] connecting to ${brokerUrl}, ${messages.length} message(s)`)

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(brokerUrl, ['mqtt'])
    ws.binaryType = 'arraybuffer'
    let done = false

    const fail = (msg: string) => {
      if (done) return; done = true
      clearTimeout(timer)
      try { ws.close() } catch (_) {}
      reject(new Error(msg))
    }
    const succeed = () => {
      if (done) return; done = true
      clearTimeout(timer)
      try { ws.send(buildDisconnect()); ws.close() } catch (_) {}
      resolve()
    }

    const timer = setTimeout(() => fail('MQTT connect timeout (15s)'), 15_000)

    ws.onopen = () => { ws.send(buildConnect(MQTT_USER, MQTT_PASS, `edge-${Date.now()}`)) }

    ws.onerror = (e) => fail(`WebSocket error: ${JSON.stringify(e)}`)

    ws.onclose = (e) => { if (!done) fail(`WebSocket closed unexpectedly: code=${e.code} reason=${e.reason}`) }

    let pendingPubacks = 0
    let pid = 1
    let connacked = false

    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer)
      const type = (data[0] >> 4)

      if (type === 2) {
        // CONNACK
        if (connacked) return
        connacked = true
        const rc = data[3]
        if (rc !== 0) { fail(`MQTT CONNACK rejected: code=${rc}`); return }
        console.log('[mqtt] connected OK, publishing...')
        pendingPubacks = messages.length
        for (const msg of messages) {
          ws.send(buildPublish(msg.topic, msg.payload, pid++))
        }
      } else if (type === 4) {
        // PUBACK
        pendingPubacks--
        console.log(`[mqtt] PUBACK received, remaining=${pendingPubacks}`)
        if (pendingPubacks === 0) succeed()
      }
    }
  })
}

// ── Queue executor ────────────────────────────────────────────────────────────

type QueueRow = {
  id:           string
  group_id:     string | null
  step_type:    string
  device:       string
  zone_num:     number
  duration_min: number | null
  fire_at:      string
}

Deno.serve(async (_req) => {
  try {
    const now = new Date().toISOString()
    console.log(`[run-program-queue] checking at ${now}`)

    const { data: due, error: fetchErr } = await supabase
      .from('program_queue')
      .select('*')
      .lte('fire_at', now)
      .is('fired_at', null)

    if (fetchErr) throw fetchErr

    const rows = (due ?? []) as QueueRow[]
    console.log(`[run-program-queue] ${rows.length} step(s) due`)

    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, fired: [], errors: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Build MQTT messages
    const messages: { topic: string; payload: string; label: string }[] = []
    const historyRows: object[] = []
    const a6v3OffSteps: QueueRow[] = []

    for (const step of rows) {
      if (step.device === 'a6v3') {
        messages.push({
          topic:   A6V3_SET_TOPIC,
          payload: JSON.stringify({ [`output${step.zone_num}`]: { value: step.step_type === 'on' } }),
          label:   `a6v3 relay ${step.zone_num} → ${step.step_type}`,
        })
        if (step.step_type === 'on') {
          historyRows.push({
            device:     'a6v3',
            zone_num:   step.zone_num,
            started_at: now,
            source:     'schedule',
          })
        } else {
          a6v3OffSteps.push(step)
        }
      } else {
        if (step.step_type === 'on') {
          messages.push({
            topic:   `farm/irrigation1/zone/${step.zone_num}/cmd`,
            payload: JSON.stringify({ cmd: 'on', duration: step.duration_min, source: 'schedule' }),
            label:   `irrigation1 zone ${step.zone_num} → on`,
          })
          historyRows.push({ zone_num: step.zone_num, started_at: now, source: 'schedule' })
        } else {
          messages.push({
            topic:   `farm/irrigation1/zone/${step.zone_num}/cmd`,
            payload: JSON.stringify({ cmd: 'off' }),
            label:   `irrigation1 zone ${step.zone_num} → off`,
          })
        }
      }
    }

    await mqttPublishAll(messages.map(m => ({ topic: m.topic, payload: m.payload })))

    // Mark all rows fired
    const firedAt = new Date().toISOString()
    await Promise.all(rows.map(r =>
      supabase.from('program_queue').update({ fired_at: firedAt }).eq('id', r.id)
    ))

    if (historyRows.length > 0) {
      await supabase.from('zone_history').insert(historyRows)
    }

    // Close the most recent open zone_history row for each A6v3 off step.
    // A6v3 firmware doesn't report completion, so the queue executor is the
    // only thing that knows when the relay actually turned off.
    for (const step of a6v3OffSteps) {
      const { data: open } = await supabase
        .from('zone_history')
        .select('id')
        .eq('zone_num', step.zone_num)
        .eq('device', 'a6v3')
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
      if (open?.length) {
        await supabase.from('zone_history')
          .update({ ended_at: firedAt })
          .eq('id', open[0].id)
      }
    }

    const fired = messages.map(m => m.label)
    await raiseAlert('Schedule fired', `Fired: ${fired.join(', ')}`, 'info')

    console.log(`[run-program-queue] done — ${fired.length} step(s) fired`)
    return new Response(JSON.stringify({ ok: true, fired, errors: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = String(err)
    console.error('[run-program-queue] fatal:', msg)
    await raiseAlert('Queue executor error', msg, 'fault')
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

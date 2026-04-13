/**
 * Sandy Soil Automations — Program Queue Executor
 * Supabase Edge Function — invoked every minute via pg_cron
 *
 * Publishes MQTT commands via a raw WebSocket + hand-rolled MQTT 3.1.1 packets.
 * This avoids any npm/Node.js compat issues — Deno's native WebSocket handles it.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

function encodeLen(n: number): number[] {
  const out: number[] = []
  do {
    let b = n % 128; n = Math.floor(n / 128)
    if (n > 0) b |= 128
    out.push(b)
  } while (n > 0)
  return out
}

function utf8Prefixed(s: string): number[] {
  const b = [...new TextEncoder().encode(s)]
  return [(b.length >> 8) & 0xff, b.length & 0xff, ...b]
}

function buildConnect(user: string, pass: string): Uint8Array {
  const clientId = `edge-${Date.now()}`
  const payload = [
    ...utf8Prefixed(clientId),
    ...utf8Prefixed(user),
    ...utf8Prefixed(pass),
  ]
  // protocol name 'MQTT', level 4, flags: user+pass+clean, keepAlive 30s
  const varHdr = [0x00,0x04,0x4d,0x51,0x54,0x54, 0x04, 0b11000010, 0x00,0x1e]
  const rem = [...varHdr, ...payload]
  return new Uint8Array([0x10, ...encodeLen(rem.length), ...rem])
}

function buildPublish(topic: string, payload: string, pid: number): Uint8Array {
  const tp = [...new TextEncoder().encode(topic)]
  const pp = [...new TextEncoder().encode(payload)]
  // QoS 1: topic len prefix + topic + packet-id + payload
  const rem = [(tp.length >> 8) & 0xff, tp.length & 0xff, ...tp, (pid >> 8) & 0xff, pid & 0xff, ...pp]
  return new Uint8Array([0x32, ...encodeLen(rem.length), ...rem])
}

function buildDisconnect(): Uint8Array { return new Uint8Array([0xe0, 0x00]) }

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

    ws.onopen = () => { ws.send(buildConnect(MQTT_USER, MQTT_PASS)) }

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

    for (const step of rows) {
      if (step.device === 'a6v3') {
        messages.push({
          topic:   A6V3_SET_TOPIC,
          payload: JSON.stringify({ [`output${step.zone_num}`]: { value: step.step_type === 'on' } }),
          label:   `a6v3 relay ${step.zone_num} → ${step.step_type}`,
        })
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

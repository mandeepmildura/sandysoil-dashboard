/**
 * Sandy Soil Automations — A6v3 Pressure Logger
 * Supabase Edge Function — invoked every 5 minutes via pg_cron
 *
 * Connects to HiveMQ, polls the A6v3 device for a fresh STATE message,
 * reads ADC1, converts to PSI, and inserts into pressure_log.
 * Runs server-side so pressure is recorded even when no browser is open.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MQTT_HOST = Deno.env.get('MQTT_HOST') ?? 'eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud'
const MQTT_USER = Deno.env.get('MQTT_USER') ?? 'farmcontrol-web'
const MQTT_PASS = Deno.env.get('MQTT_PASS') ?? 'Zayan@09022022'

const A6V3_STATE_TOPIC = 'A6v3/8CBFEA03002C/STATE'
const A6V3_SET_TOPIC   = 'A6v3/8CBFEA03002C/SET'
const ADC_FULL = 4095
const MAX_PSI  = 116

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Minimal MQTT 3.1.1 helpers ────────────────────────────────────────────────

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
  const clientId = `pressure-logger-${Date.now()}`
  const payload = [...utf8Prefixed(clientId), ...utf8Prefixed(user), ...utf8Prefixed(pass)]
  const varHdr  = [0x00,0x04,0x4d,0x51,0x54,0x54, 0x04, 0b11000010, 0x00,0x1e]
  const rem = [...varHdr, ...payload]
  return new Uint8Array([0x10, ...encodeLen(rem.length), ...rem])
}

function buildSubscribe(topic: string, pid: number): Uint8Array {
  const tp = [...new TextEncoder().encode(topic)]
  const payload = [(tp.length >> 8) & 0xff, tp.length & 0xff, ...tp, 0x00] // QoS 0
  const rem = [(pid >> 8) & 0xff, pid & 0xff, ...payload]
  return new Uint8Array([0x82, ...encodeLen(rem.length), ...rem])
}

function buildPublish(topic: string, payload: string, pid: number): Uint8Array {
  const tp = [...new TextEncoder().encode(topic)]
  const pp = [...new TextEncoder().encode(payload)]
  const rem = [(tp.length >> 8) & 0xff, tp.length & 0xff, ...tp, (pid >> 8) & 0xff, pid & 0xff, ...pp]
  return new Uint8Array([0x32, ...encodeLen(rem.length), ...rem])
}

function buildDisconnect(): Uint8Array { return new Uint8Array([0xe0, 0x00]) }

/** Parse topic + JSON payload from a raw MQTT PUBLISH packet. */
function parseMqttPublish(data: Uint8Array): { topic: string; payload: string } | null {
  try {
    const type = (data[0] >> 4)
    if (type !== 3) return null

    // Decode remaining length
    let offset = 1, mult = 1, remainLen = 0
    do {
      const b = data[offset++]
      remainLen += (b & 0x7f) * mult
      mult *= 128
    } while (data[offset - 1] & 0x80)

    const topicLen = (data[offset] << 8) | data[offset + 1]
    offset += 2
    const topic = new TextDecoder().decode(data.slice(offset, offset + topicLen))
    offset += topicLen

    // Skip packet ID if QoS > 0
    const qos = (data[0] >> 1) & 0x03
    if (qos > 0) offset += 2

    const payload = new TextDecoder().decode(data.slice(offset))
    return { topic, payload }
  } catch {
    return null
  }
}

// ── Main MQTT flow ────────────────────────────────────────────────────────────

async function pollAndLogPressure(): Promise<{ psi: number }> {
  const brokerUrl = `wss://${MQTT_HOST}:8884/mqtt`
  console.log(`[log-a6v3-pressure] connecting to ${brokerUrl}`)

  return new Promise<{ psi: number }>((resolve, reject) => {
    const ws = new WebSocket(brokerUrl, ['mqtt'])
    ws.binaryType = 'arraybuffer'
    let done = false
    let pid = 1

    const fail = (msg: string) => {
      if (done) return; done = true
      clearTimeout(timer)
      try { ws.close() } catch (_) {}
      reject(new Error(msg))
    }

    const succeed = (psi: number) => {
      if (done) return; done = true
      clearTimeout(timer)
      try { ws.send(buildDisconnect()); ws.close() } catch (_) {}
      resolve({ psi })
    }

    // 20s total timeout — device normally responds within 2s
    const timer = setTimeout(() => fail('Timeout waiting for A6v3 STATE (20s)'), 20_000)

    ws.onopen  = () => { ws.send(buildConnect(MQTT_USER, MQTT_PASS)) }
    ws.onerror = (e) => fail(`WebSocket error: ${JSON.stringify(e)}`)
    ws.onclose = (e) => { if (!done) fail(`WebSocket closed: code=${e.code}`) }

    let connacked = false
    let subscribed = false

    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer)
      const type = (data[0] >> 4)

      if (type === 2 && !connacked) {
        // CONNACK
        connacked = true
        const rc = data[3]
        if (rc !== 0) { fail(`CONNACK rejected: code=${rc}`); return }
        console.log('[log-a6v3-pressure] connected, subscribing…')
        ws.send(buildSubscribe(A6V3_STATE_TOPIC, pid++))
      } else if (type === 9 && !subscribed) {
        // SUBACK
        subscribed = true
        // Alternate DAC value each invocation so the value actually changes —
        // A6v3 (KCS firmware) only publishes STATE when an output value changes.
        // Using minute % 2 gives 0 at :00/:10/:20... and 1 at :05/:15/:25...
        const dacValue = new Date().getMinutes() % 2
        console.log(`[log-a6v3-pressure] subscribed, polling device (dac1=${dacValue})…`)
        ws.send(buildPublish(A6V3_SET_TOPIC, JSON.stringify({ dac1: { value: dacValue } }), pid++))
      } else if (type === 3) {
        // PUBLISH — incoming STATE message
        const msg = parseMqttPublish(data)
        if (!msg) return
        console.log(`[log-a6v3-pressure] received on ${msg.topic}`)
        if (msg.topic !== A6V3_STATE_TOPIC) return
        try {
          const state = JSON.parse(msg.payload)
          const adc = state?.adc1?.value ?? 0
          const psi = parseFloat(((adc / ADC_FULL) * MAX_PSI).toFixed(2))
          console.log(`[log-a6v3-pressure] ADC=${adc} → PSI=${psi}`)
          succeed(psi)
        } catch (e) {
          fail(`Failed to parse STATE: ${e}`)
        }
      } else if (type === 4) {
        // PUBACK for our poll publish — just wait for STATE to arrive
      }
    }
  })
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  try {
    // Check if any A6v3 relay is currently running (open zone_history record)
    const { data: openRuns } = await supabase
      .from('zone_history')
      .select('id')
      .eq('device', 'a6v3')
      .is('ended_at', null)
      .limit(1)

    const pumpIsOn = (openRuns?.length ?? 0) > 0

    if (!pumpIsOn) {
      // Pump off — only log every 5 min. Check when we last logged.
      const { data: lastLog } = await supabase
        .from('pressure_log')
        .select('ts')
        .not('a6v3_ch1_psi', 'is', null)
        .order('ts', { ascending: false })
        .limit(1)
        .single()

      const lastTs = lastLog?.ts ? new Date(lastLog.ts).getTime() : 0
      const ageMin = (Date.now() - lastTs) / 60_000

      if (ageMin < 4.5) {
        console.log(`[log-a6v3-pressure] pump off, last log ${ageMin.toFixed(1)} min ago — skipping`)
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'pump off, logged recently' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    console.log(`[log-a6v3-pressure] pump ${pumpIsOn ? 'ON — logging every minute' : 'off — logging every 5 min'}`)

    const { psi } = await pollAndLogPressure()

    const { error } = await supabase.from('pressure_log').insert({
      ts: new Date().toISOString(),
      a6v3_ch1_psi: psi,
    })

    if (error) throw error

    console.log(`[log-a6v3-pressure] logged ${psi} PSI`)
    return new Response(JSON.stringify({ ok: true, psi, pumpIsOn }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = String(err)
    console.error('[log-a6v3-pressure] error:', msg)
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

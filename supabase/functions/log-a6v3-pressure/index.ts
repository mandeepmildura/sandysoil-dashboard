/**
 * Sandy Soil Automations — A6v3 Pressure Logger
 * Supabase Edge Function — invoked every minute via pg_cron
 *
 * Behaviour:
 *   pump ON  (open a6v3 zone_history row) → log every minute
 *   pump OFF (no open row)                → log roughly every 5 min
 *
 * Connects to HiveMQ over WebSocket, polls A6v3 STATE (toggling DAC1 to
 * force a fresh response), reads ADC1, converts to PSI, inserts into
 * pressure_log.a6v3_ch1_psi.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildConnect,
  buildSubscribe,
  buildPublish,
  buildDisconnect,
  parseMqttPublish,
  adcToPsi,
} from '../_shared/mqttPacket.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MQTT_HOST = Deno.env.get('MQTT_HOST') ?? 'eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud'
const MQTT_USER = Deno.env.get('MQTT_USER') ?? 'farmcontrol-web'
const MQTT_PASS = Deno.env.get('MQTT_PASS') ?? 'Zayan@09022022'

const A6V3_STATE_TOPIC = 'A6v3/8CBFEA03002C/STATE'
const A6V3_SET_TOPIC   = 'A6v3/8CBFEA03002C/SET'

// Idle cadence: skip if last a6v3 log is newer than this many minutes.
const IDLE_SKIP_MIN = 4.5

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

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

    ws.onopen  = () => { ws.send(buildConnect(MQTT_USER, MQTT_PASS, `pressure-logger-${Date.now()}`)) }
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
          const psi = adcToPsi(adc)
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
      // Idle: only log if last a6v3 reading is older than IDLE_SKIP_MIN.
      const { data: lastLog } = await supabase
        .from('pressure_log')
        .select('ts')
        .not('a6v3_ch1_psi', 'is', null)
        .order('ts', { ascending: false })
        .limit(1)
        .maybeSingle()

      const lastTs = lastLog?.ts ? new Date(lastLog.ts).getTime() : 0
      const ageMin = (Date.now() - lastTs) / 60_000

      if (ageMin < IDLE_SKIP_MIN) {
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

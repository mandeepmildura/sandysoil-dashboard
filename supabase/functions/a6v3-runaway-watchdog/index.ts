/**
 * Sandy Soil Automations — A6v3 Runaway Relay Watchdog
 * Supabase Edge Function — invoked every minute via pg_cron
 *
 * Why this exists:
 *  The A6v3 firmware has no auto-off — once a relay is set true, it stays true
 *  until something explicitly sets it false. If run-schedules / run-program-queue
 *  fails to queue or fire the off step (e.g. divergent deploy, MQTT outage, queue
 *  function crash, missed cron tick), the relay runs forever. That happened on
 *  2026-05-06 — three relays ran for 14h before being noticed.
 *
 *  This function is a defense-in-depth safety net independent of the scheduler:
 *  it scans zone_history for any open A6v3 row that's been on longer than
 *  MAX_RUNTIME_MIN, publishes an MQTT off command, closes the row, and raises
 *  a fault alert.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildConnect, buildPublish, buildDisconnect } from '../_shared/mqttPacket.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MQTT_HOST            = Deno.env.get('MQTT_HOST') ?? 'eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud'
const MQTT_USER            = Deno.env.get('MQTT_USER')
const MQTT_PASS            = Deno.env.get('MQTT_PASS')
const MAX_RUNTIME_MIN      = Number(Deno.env.get('A6V3_MAX_RUNTIME_MIN') ?? '90')

if (!MQTT_USER || !MQTT_PASS) {
  throw new Error('MQTT_USER and MQTT_PASS must be set as Edge Function secrets')
}

const A6V3_SET_TOPIC = 'A6v3/8CBFEA03002C/SET'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function mqttPublishAll(messages: { topic: string; payload: string }[]): Promise<void> {
  if (messages.length === 0) return
  const brokerUrl = `wss://${MQTT_HOST}:8884/mqtt`

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

    ws.onopen   = () => { ws.send(buildConnect(MQTT_USER, MQTT_PASS, `watchdog-${Date.now()}`)) }
    ws.onerror  = (e) => fail(`WebSocket error: ${JSON.stringify(e)}`)
    ws.onclose  = (e) => { if (!done) fail(`WebSocket closed unexpectedly: code=${e.code} reason=${e.reason}`) }

    let pendingPubacks = 0
    let pid = 1
    let connacked = false

    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer)
      const type = (data[0] >> 4)

      if (type === 2) {
        if (connacked) return
        connacked = true
        const rc = data[3]
        if (rc !== 0) { fail(`MQTT CONNACK rejected: code=${rc}`); return }
        pendingPubacks = messages.length
        for (const msg of messages) {
          ws.send(buildPublish(msg.topic, msg.payload, pid++))
        }
      } else if (type === 4) {
        pendingPubacks--
        if (pendingPubacks === 0) succeed()
      }
    }
  })
}

type RunawayRow = {
  id:         string
  zone_num:   number
  started_at: string
}

Deno.serve(async (_req) => {
  try {
    const cutoff = new Date(Date.now() - MAX_RUNTIME_MIN * 60_000).toISOString()
    console.log(`[a6v3-watchdog] cutoff=${cutoff} (max=${MAX_RUNTIME_MIN}m)`)

    const { data: runaways, error: fetchErr } = await supabase
      .from('zone_history')
      .select('id, zone_num, started_at')
      .eq('device', 'a6v3')
      .is('ended_at', null)
      .lt('started_at', cutoff)

    if (fetchErr) throw fetchErr

    const rows = (runaways ?? []) as RunawayRow[]
    let killed: number[] = []

    if (rows.length > 0) {
      console.log(`[a6v3-watchdog] ${rows.length} runaway relay(s):`,
        rows.map(r => `zone${r.zone_num}@${r.started_at}`).join(', '))

      // 1. MQTT off for each runaway zone (unique zones — defensive in case of
      //    multiple open rows for the same zone)
      const zones = Array.from(new Set(rows.map(r => r.zone_num)))
      killed = zones
      const messages = zones.map(z => ({
        topic:   A6V3_SET_TOPIC,
        payload: JSON.stringify({ [`output${z}`]: { value: false } }),
      }))
      await mqttPublishAll(messages)

      // 2. Close the zone_history rows
      const closedAt = new Date().toISOString()
      const ids = rows.map(r => r.id)
      const { error: closeErr } = await supabase
        .from('zone_history')
        .update({ ended_at: closedAt })
        .in('id', ids)
      if (closeErr) throw closeErr

      // 3. One alert per runaway so the user sees zone-level detail
      const alerts = rows.map(r => {
        const ranForMin = Math.round((Date.now() - new Date(r.started_at).getTime()) / 60_000)
        return {
          severity:    'fault',
          title:       `A6v3 runaway relay: zone ${r.zone_num}`,
          description: `Relay ${r.zone_num} ran for ${ranForMin} min (cap ${MAX_RUNTIME_MIN} min) without an off command. Watchdog forced it off at ${closedAt}.`,
          device:      'a6v3',
          device_id:   '8CBFEA03002C',
          acknowledged: false,
        }
      })
      await supabase.from('device_alerts').insert(alerts)
    }

    // ── irrigation1 tiered alerts ─────────────────────────────────
    const ALERT_THRESHOLD_1_MIN = parseInt(Deno.env.get('IRRIG_ALERT_MIN_1') ?? '180')
    const ALERT_THRESHOLD_2_MIN = parseInt(Deno.env.get('IRRIG_ALERT_MIN_2') ?? '360')

    const { data: irrigOpen } = await supabase
      .from('zone_history')
      .select('id, zone_num, started_at')
      .eq('device', 'irrigation1')
      .is('ended_at', null)

    for (const row of irrigOpen ?? []) {
      const runMin = (Date.now() - new Date(row.started_at).getTime()) / 60_000

      if (runMin >= ALERT_THRESHOLD_2_MIN) {
        await supabase.from('device_alerts').insert({
          severity: 'fault',
          title: `irrigation1 Zone ${row.zone_num} running ${Math.round(runMin / 60)}h`,
          description: `Zone ${row.zone_num} has been running ${Math.round(runMin)} minutes — check immediately.`,
          device: 'irrigation1', device_id: '', acknowledged: false,
        })
      } else if (runMin >= ALERT_THRESHOLD_1_MIN) {
        // Only raise once per session — check if a 3h alert already exists for this zone/session
        const { data: existing } = await supabase
          .from('device_alerts')
          .select('id')
          .eq('device', 'irrigation1')
          .ilike('title', `%Zone ${row.zone_num}%`)
          .gte('created_at', row.started_at)
          .limit(1)
        if (!existing?.length) {
          await supabase.from('device_alerts').insert({
            severity: 'fault',
            title: `irrigation1 Zone ${row.zone_num} running ${ALERT_THRESHOLD_1_MIN / 60}h`,
            description: `Zone ${row.zone_num} has been running ${Math.round(runMin)} minutes — is this intentional?`,
            device: 'irrigation1', device_id: '', acknowledged: false,
          })
        }
      }
    }

    // ── Low pressure alert (during active irrigation) ─────────────
    const LOW_PSI_THRESHOLD = parseFloat(Deno.env.get('LOW_PSI_THRESHOLD') ?? '15')
    const BURST_DROP_PSI    = parseFloat(Deno.env.get('BURST_DROP_PSI') ?? '20')
    const BURST_WINDOW_SEC  = 30

    // Only alert when irrigation is running
    const { data: activeZones } = await supabase
      .from('zone_history')
      .select('id')
      .eq('device', 'irrigation1')
      .is('ended_at', null)
      .limit(1)

    if (activeZones?.length) {
      const { data: latest } = await supabase
        .from('pressure_log')
        .select('psi, logged_at')
        .eq('device', 'irrigation1')
        .order('logged_at', { ascending: false })
        .limit(1)

      if (latest?.length) {
        const psi = latest[0].psi

        if (psi < LOW_PSI_THRESHOLD) {
          const thirtyAgo = new Date(Date.now() - BURST_WINDOW_SEC * 1000).toISOString()
          const { data: older } = await supabase
            .from('pressure_log')
            .select('psi')
            .eq('device', 'irrigation1')
            .lte('logged_at', thirtyAgo)
            .order('logged_at', { ascending: false })
            .limit(1)

          const isBurst = older?.length && (older[0].psi - psi) >= BURST_DROP_PSI
          const severity = isBurst ? 'fault' : 'warning'
          const title = isBurst
            ? `Possible burst pipe — pressure dropped ${Math.round(older![0].psi - psi)} PSI`
            : `Low supply pressure: ${psi.toFixed(1)} PSI during irrigation`

          // Deduplicate: don't raise the same alert within 5 minutes
          const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
          const { data: recent } = await supabase
            .from('device_alerts')
            .select('id')
            .eq('device', 'irrigation1')
            .ilike('title', '%pressure%')
            .gte('created_at', fiveMinAgo)
            .limit(1)

          if (!recent?.length) {
            await supabase.from('device_alerts').insert({
              severity, title,
              description: `Supply PSI: ${psi.toFixed(1)}. Threshold: ${LOW_PSI_THRESHOLD} PSI.`,
              device: 'irrigation1', device_id: '', acknowledged: false,
            })
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, killed, count: rows.length }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const msg = String(err)
    console.error('[a6v3-watchdog] fatal:', msg)
    // Best-effort alert so the failure itself is visible
    try {
      await supabase.from('device_alerts').insert({
        severity: 'fault',
        title:    'A6v3 watchdog failed',
        description: msg,
        device:   'a6v3',
        device_id: '8CBFEA03002C',
        acknowledged: false,
      })
    } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

/**
 * Sandy Soil Automations — Program Queue Executor (shared)
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildConnect, buildPublish, buildDisconnect } from './mqttPacket.ts'

const A6V3_SET_TOPIC = 'A6v3/8CBFEA03002C/SET'

export type QueueRow = {
  id:              string
  group_id:        string | null
  step_type:       string
  device:          string
  zone_num:        number
  duration_min:    number | null
  fire_at:         string
  mqtt_base_topic: string | null
}

export type RunQueueDeps = {
  supabase: SupabaseClient
  mqttHost: string
  mqttUser: string
  mqttPass: string
}

export type RunQueueResult = {
  fired:  string[]
  errors: string[]
}

async function mqttPublishAll(
  deps: RunQueueDeps,
  messages: { topic: string; payload: string }[],
): Promise<void> {
  if (messages.length === 0) return
  const brokerUrl = `wss://${deps.mqttHost}:8884/mqtt`
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

    ws.onopen = () => { ws.send(buildConnect(deps.mqttUser, deps.mqttPass, `edge-${Date.now()}`)) }
    ws.onerror = (e) => fail(`WebSocket error: ${JSON.stringify(e)}`)
    ws.onclose = (e) => { if (!done) fail(`WebSocket closed unexpectedly: code=${e.code} reason=${e.reason}`) }

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
        console.log('[mqtt] connected OK, publishing...')
        pendingPubacks = messages.length
        for (const msg of messages) {
          ws.send(buildPublish(msg.topic, msg.payload, pid++))
        }
      } else if (type === 4) {
        pendingPubacks--
        console.log(`[mqtt] PUBACK received, remaining=${pendingPubacks}`)
        if (pendingPubacks === 0) succeed()
      }
    }
  })
}

export async function runQueue(deps: RunQueueDeps): Promise<RunQueueResult> {
  const { supabase } = deps
  const now = new Date().toISOString()
  const lookAhead = new Date(Date.now() + 65_000).toISOString()
  console.log(`[runQueue] checking at ${now} (lookAhead ${lookAhead})`)

  const { data: due, error: fetchErr } = await supabase
    .from('program_queue')
    .select('*')
    .lte('fire_at', lookAhead)
    .is('fired_at', null)
    .order('fire_at')

  if (fetchErr) throw fetchErr

  const rows = (due ?? []) as QueueRow[]
  console.log(`[runQueue] ${rows.length} step(s) within window`)

  if (rows.length === 0) return { fired: [], errors: [] }

  const claimedAt = new Date().toISOString()
  const ids = rows.map(r => r.id)
  await supabase.from('program_queue').update({ fired_at: claimedAt }).in('id', ids)

  const groups = new Map<string, QueueRow[]>()
  for (const r of rows) {
    const key = r.fire_at
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }
  const orderedKeys = Array.from(groups.keys()).sort()

  const allFiredLabels: string[] = []
  const allHistoryRows: object[] = []
  const allA6v3OffSteps: QueueRow[] = []

  for (const fireAtKey of orderedKeys) {
    const group = groups.get(fireAtKey)!
    const wait = Math.max(0, new Date(fireAtKey).getTime() - Date.now())
    if (wait > 0) {
      console.log(`[runQueue] sleeping ${wait}ms until ${fireAtKey}`)
      await new Promise(r => setTimeout(r, wait))
    }

    const groupMessages: { topic: string; payload: string; label: string }[] = []
    const groupNow = new Date().toISOString()

    for (const step of group) {
      const prefix = step.mqtt_base_topic ?? 'farm/irrigation1'

      if (step.device === 'a6v3') {
        groupMessages.push({
          topic:   A6V3_SET_TOPIC,
          payload: JSON.stringify({ [`output${step.zone_num}`]: { value: step.step_type === 'on' } }),
          label:   `a6v3 relay ${step.zone_num} → ${step.step_type}`,
        })
        if (step.step_type === 'on') {
          allHistoryRows.push({
            device:     'a6v3',
            zone_num:   step.zone_num,
            started_at: groupNow,
            source:     'schedule',
          })
        } else {
          allA6v3OffSteps.push(step)
        }
      } else {
        if (step.step_type === 'on') {
          groupMessages.push({
            topic:   `${prefix}/zone/${step.zone_num}/cmd`,
            payload: JSON.stringify({ cmd: 'on', duration: step.duration_min, source: 'schedule' }),
            label:   `${prefix} zone ${step.zone_num} → on`,
          })
          allHistoryRows.push({
            device:     step.device ?? 'irrigation1',
            zone_num:   step.zone_num,
            started_at: groupNow,
            source:     'schedule',
          })
        } else {
          groupMessages.push({
            topic:   `${prefix}/zone/${step.zone_num}/cmd`,
            payload: JSON.stringify({ cmd: 'off' }),
            label:   `${prefix} zone ${step.zone_num} → off`,
          })
        }
      }
    }

    await mqttPublishAll(deps, groupMessages.map(m => ({ topic: m.topic, payload: m.payload })))
    groupMessages.forEach(m => allFiredLabels.push(m.label))
  }

  if (allHistoryRows.length > 0) {
    await supabase.from('zone_history').insert(allHistoryRows)
  }

  const offClosedAt = new Date().toISOString()
  for (const step of allA6v3OffSteps) {
    const { data: open } = await supabase
      .from('zone_history')
      .select('id')
      .eq('zone_num', step.zone_num)
      .eq('device', 'a6v3')
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
    if (open?.length) {
      await supabase.from('zone_history').update({ ended_at: offClosedAt }).eq('id', open[0].id)
    }
  }

  console.log(`[runQueue] done — ${allFiredLabels.length} step(s) fired`)
  return { fired: allFiredLabels, errors: [] }
}

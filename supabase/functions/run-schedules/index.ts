import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MQTT_HOST            = Deno.env.get('MQTT_HOST') ?? 'eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud'
const MQTT_USER            = Deno.env.get('MQTT_USER') ?? 'farmcontrol-web'
const MQTT_PASS            = Deno.env.get('MQTT_PASS') ?? 'Zayan@09022022'
const TIMEZONE             = Deno.env.get('TIMEZONE') ?? 'Australia/Melbourne'
const A6V3_SERIAL          = '8CBFEA03002C'
const B16M_SERIAL          = 'CCBA97071FD8'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── MQTT over WebSocket (same approach as schedule-runner) ──────────────────
function encode(s: string): Uint8Array { return new TextEncoder().encode(s) }
function mqttStr(s: string): Uint8Array {
  const b = encode(s)
  return new Uint8Array([b.length >> 8, b.length & 0xff, ...b])
}
function buildConnect(clientId: string, user: string, pass: string): Uint8Array {
  const protocol = mqttStr('MQTT'), cid = mqttStr(clientId)
  const uBytes = mqttStr(user), pBytes = mqttStr(pass)
  const payload = new Uint8Array([...protocol, 0x04, 0b11000010, 0x00, 0x3c, ...cid, ...uBytes, ...pBytes])
  return new Uint8Array([0x10, payload.length, ...payload])
}
function buildPublish(topic: string, payload: string): Uint8Array {
  const t = mqttStr(topic), p = encode(payload)
  const rem = t.length + p.length
  const remLen = rem < 128 ? [rem] : [0x80 | (rem & 0x7f), rem >> 7]
  return new Uint8Array([0x30, ...remLen, ...t, ...p])
}
function mqttPublishBatch(messages: Array<{ topic: string; payload: string }>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${MQTT_HOST}:8884/mqtt`, ['mqtt'])
    ws.binaryType = 'arraybuffer'
    let connected = false
    const timer = setTimeout(() => { ws.close(); reject(new Error('MQTT timeout')) }, 12000)
    ws.onopen = () => ws.send(buildConnect(`sandysoil-run-${Date.now()}`, MQTT_USER, MQTT_PASS))
    ws.onmessage = (evt) => {
      const data = new Uint8Array(evt.data as ArrayBuffer)
      if (!connected && data[0] === 0x20) {
        if (data[3] !== 0) { clearTimeout(timer); ws.close(); reject(new Error(`MQTT auth failed: ${data[3]}`)); return }
        connected = true
        for (const { topic, payload } of messages) ws.send(buildPublish(topic, payload))
        setTimeout(() => { clearTimeout(timer); ws.close(); resolve() }, 800)
      }
    }
    ws.onerror = (e) => { clearTimeout(timer); reject(e) }
  })
}

async function closeHistoryRecord(zoneNum: number, device: string): Promise<void> {
  const { data } = await supabase
    .from('zone_history').select('id')
    .eq('zone_num', zoneNum).eq('device', device).is('ended_at', null)
    .order('started_at', { ascending: false }).limit(1)
  if (data?.[0]) {
    await supabase.from('zone_history').update({ ended_at: new Date().toISOString() }).eq('id', data[0].id)
  }
}

function localTimeParts() {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  const hhmm = `${parts.hour.padStart(2, '0')}:${parts.minute.padStart(2, '0')}`
  const dow  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)
  return { hhmm, dow }
}

Deno.serve(async (_req) => {
  try {
    const { hhmm: now, dow } = localTimeParts()
    console.log(`[run-schedules] ${now} DOW=${dow}`)

    const { data: schedules, error: schedErr } = await supabase
      .from('group_schedules')
      .select('id, group_id, label, days_of_week, start_time')
      .eq('enabled', true)
    if (schedErr) throw schedErr

    const due = (schedules ?? []).filter(s =>
      Array.isArray(s.days_of_week) && s.days_of_week.includes(dow)
    )

    const results: string[] = []
    const onMessages:  Array<{ topic: string; payload: string }> = []
    const offMessages: Array<{ topic: string; payload: string }> = []
    const historyRows: Array<{ device: string; zone_num: number }> = []
    const offHistory:  Array<{ device: string; zone_num: number }> = []

    for (const sched of due) {
      const { data: group } = await supabase
        .from('zone_groups').select('id, name, run_mode').eq('id', sched.group_id).single()
      if (!group) continue

      const { data: members } = await supabase
        .from('zone_group_members')
        .select('zone_num, duration_min, device, sort_order')
        .eq('group_id', sched.group_id).order('sort_order')
      const zones = members ?? []

      const startHHMM = String(sched.start_time).slice(0, 5)
      const [sh, sm]  = String(sched.start_time).split(':').map(Number)

      console.log(`[run-schedules] "${group.name}" start=${startHHMM} now=${now} zones=${zones.length}`)

      if (group.run_mode === 'sequential') {
        let offsetMin = 0
        for (const z of zones) {
          const device = z.device ?? 'irrigation1'
          const totalMin = sh * 60 + sm + offsetMin
          const zoneHHMM = `${String(Math.floor(totalMin / 60) % 24).padStart(2,'0')}:${String(totalMin % 60).padStart(2,'0')}`

          if (zoneHHMM === now) {
            onMessages.push(mqttMsg(device, z.zone_num, true, z.duration_min))
            historyRows.push({ device, zone_num: z.zone_num })
            results.push(`${group.name} → ${device} out${z.zone_num} ON`)
          }
          const endHHMM = toHHMM(totalMin + z.duration_min)
          if (endHHMM === now) {
            offMessages.push(mqttMsg(device, z.zone_num, false, 0))
            offHistory.push({ device, zone_num: z.zone_num })
            results.push(`${group.name} → ${device} out${z.zone_num} OFF`)
          }
          offsetMin += z.duration_min
        }
      } else {
        // simultaneous
        for (const z of zones) {
          const device = z.device ?? 'irrigation1'
          if (startHHMM === now) {
            onMessages.push(mqttMsg(device, z.zone_num, true, z.duration_min))
            historyRows.push({ device, zone_num: z.zone_num })
          }
          const endHHMM = toHHMM(sh * 60 + sm + z.duration_min)
          if (endHHMM === now) {
            offMessages.push(mqttMsg(device, z.zone_num, false, 0))
            offHistory.push({ device, zone_num: z.zone_num })
          }
        }
        if (startHHMM === now) results.push(`${group.name} → ${zones.length} output(s) ON`)
      }
    }

    const allMessages = [...onMessages, ...offMessages]
    if (allMessages.length) {
      await mqttPublishBatch(allMessages)
      if (historyRows.length) {
        await supabase.from('zone_history').insert(
          historyRows.map(r => ({ device: r.device, zone_num: r.zone_num, started_at: new Date().toISOString(), source: 'schedule' }))
        )
      }
      for (const r of offHistory) await closeHistoryRecord(r.zone_num, r.device)
    }

    return new Response(JSON.stringify({ ok: true, time: now, dow, ran: results }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('[run-schedules] error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})

function toHHMM(totalMin: number): string {
  return `${String(Math.floor(totalMin / 60) % 24).padStart(2,'0')}:${String(totalMin % 60).padStart(2,'0')}`
}

function mqttMsg(device: string, zoneNum: number, on: boolean, durationMin: number): { topic: string; payload: string } {
  if (device === 'a6v3') {
    return { topic: `A6v3/${A6V3_SERIAL}/SET`, payload: JSON.stringify({ [`output${zoneNum}`]: { value: on } }) }
  } else if (device === 'b16m') {
    return { topic: `B16M/${B16M_SERIAL}/SET`, payload: JSON.stringify({ [`output${zoneNum}`]: { value: on } }) }
  } else {
    return { topic: `farm/irrigation1/zone/${zoneNum}/cmd`, payload: JSON.stringify(on ? { cmd: 'on', duration: durationMin, source: 'schedule' } : { cmd: 'off' }) }
  }
}

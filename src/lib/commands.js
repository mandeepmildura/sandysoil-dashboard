import { mqttPublish, getMqttCache } from './mqttClient'
import { supabase } from './supabase'

export const B16M_SET_TOPIC = 'B16M/CCBA97071FD8/SET'
export const A6V3_SET_TOPIC = 'A6v3/8CBFEA03002C/SET'

// ── PSI snapshot helper ────────────────────────────────────────────────────
function psiSnapshot() {
  const cache      = getMqttCache()
  const irrStatus  = cache['farm/irrigation1/status']
  const a6v3State  = cache[A6V3_SET_TOPIC.replace('SET', 'STATE').replace('8CBFEA03002C/SET', '8CBFEA03002C/STATE')]
    ?? cache['A6v3/8CBFEA03002C/STATE']
  const supplyPsi  = irrStatus?.supply_psi != null
    ? parseFloat(Number(irrStatus.supply_psi).toFixed(2)) : null
  const adcRaw     = a6v3State?.adc1?.value ?? null
  const a6v3Psi    = adcRaw != null
    ? parseFloat(((adcRaw / 4095) * 116).toFixed(2)) : null
  return { supplyPsi, a6v3Psi }
}

// ── DB helpers ─────────────────────────────────────────────────────────────

async function insertZoneStart(zoneNum, source) {
  const { supplyPsi, a6v3Psi } = psiSnapshot()
  const { error } = await supabase.from('zone_history').insert({
    zone_num:         zoneNum,
    started_at:       new Date().toISOString(),
    source,
    supply_psi_start: supplyPsi,
    a6v3_psi_start:   a6v3Psi,
  })
  if (error) console.error(`zone_history insert failed (zone ${zoneNum}):`, error.message, error.code)
}

// ── Zone commands (8-zone irrigation controller) ───────────────────────────

export async function zoneOn(zoneNum, durationMin, source = 'manual') {
  await mqttPublish(`farm/irrigation1/zone/${zoneNum}/cmd`, { cmd: 'on', duration: durationMin })
  await insertZoneStart(zoneNum, source)
}

export async function zoneOff(zoneNum) {
  await mqttPublish(`farm/irrigation1/zone/${zoneNum}/cmd`, { cmd: 'off' })
  await closeOpenHistoryRecord(zoneNum)
}

/** Close the most recent open zone_history row for this zone. */
export async function closeOpenHistoryRecord(zoneNum) {
  const { data, error: selErr } = await supabase
    .from('zone_history')
    .select('id')
    .eq('zone_num', zoneNum)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)

  if (selErr) { console.error('zone_history select failed:', selErr.message); return }
  if (!data?.length) return

  const { error: updErr } = await supabase
    .from('zone_history')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', data[0].id)

  if (updErr) console.error('zone_history close failed:', updErr.message)
}

export async function allZonesOff() {
  await Promise.all(
    [1,2,3,4,5,6,7,8].map(z =>
      mqttPublish(`farm/irrigation1/zone/${z}/cmd`, { cmd: 'off' })
    )
  )
}

// ── Filter commands ────────────────────────────────────────────────────────

export function startBackwash() { return mqttPublish('farm/filter1/backwash/start', '') }
export function stopBackwash()  { return mqttPublish('farm/filter1/backwash/stop', '') }
export function resetBackwash() { return mqttPublish('farm/filter1/backwash/reset', '') }

// ── B16M commands ──────────────────────────────────────────────────────────

export function b16mOutputOn(outputNum) {
  return mqttPublish(B16M_SET_TOPIC, { [`output${outputNum}`]: { value: true } })
}
export function b16mOutputOff(outputNum) {
  return mqttPublish(B16M_SET_TOPIC, { [`output${outputNum}`]: { value: false } })
}

// ── A6v3 commands ──────────────────────────────────────────────────────────

export async function logA6v3Pressure(psi) {
  const { error } = await supabase.from('pressure_log').insert({
    ts: new Date().toISOString(),
    a6v3_ch1_psi: parseFloat(psi.toFixed(2)),
  })
  if (error) console.error('pressure_log insert failed:', error.message, error.code)
}

export function a6v3OutputOn(outputNum) {
  return mqttPublish(A6V3_SET_TOPIC, { [`output${outputNum}`]: { value: true } })
}
export function a6v3OutputOff(outputNum) {
  return mqttPublish(A6V3_SET_TOPIC, { [`output${outputNum}`]: { value: false } })
}

/** Turn on an A6v3 relay and log to zone_history with PSI snapshot. */
export async function a6v3ZoneOn(relayNum, durationMin, source = 'manual') {
  await mqttPublish(A6V3_SET_TOPIC, { [`output${relayNum}`]: { value: true } })
  await insertZoneStart(relayNum, source)
}

/** Turn off an A6v3 relay and close its open zone_history record. */
export async function a6v3ZoneOff(relayNum) {
  await mqttPublish(A6V3_SET_TOPIC, { [`output${relayNum}`]: { value: false } })
  await closeOpenHistoryRecord(relayNum)
}

// Echo current relay outputs back to the device so KCS firmware responds with fresh STATE
export function requestA6v3State(currentOutputs) {
  if (currentOutputs?.length) {
    const payload = {}
    currentOutputs.forEach((val, i) => { payload[`output${i + 1}`] = { value: !!val } })
    return mqttPublish(A6V3_SET_TOPIC, payload)
  }
  return mqttPublish(A6V3_SET_TOPIC, { get: 'STATE' })
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function durationToMinutes(label) {
  if (label === '15 min') return 15
  if (label === '30 min') return 30
  if (label === '1 hour') return 60
  return 30
}

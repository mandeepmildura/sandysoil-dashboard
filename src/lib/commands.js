import { mqttPublish } from './mqttClient'
import { supabase } from './supabase'

export const B16M_SET_TOPIC = 'B16M/CCBA97071FD8/SET'
export const A6V3_SET_TOPIC = 'A6v3/8CBFEA03002C/SET'

// ── Zone commands (old irrigation controller) ──────────────────────────────

export async function zoneOn(zoneNum, durationMin, source = 'manual') {
  await mqttPublish(
    `farm/irrigation1/zone/${zoneNum}/cmd`,
    { cmd: 'on', duration: durationMin }
  )
  // Record the start of this run in zone_history
  try {
    await supabase
      .from('zone_history')
      .insert({ zone_num: zoneNum, started_at: new Date().toISOString(), source })
  } catch (e) {
    console.warn('zone_history insert failed:', e)
  }
}

export async function zoneOff(zoneNum) {
  await mqttPublish(
    `farm/irrigation1/zone/${zoneNum}/cmd`,
    { cmd: 'off' }
  )
  await closeOpenHistoryRecord(zoneNum)
}

/** Close the most recent open zone_history row for this zone. */
export async function closeOpenHistoryRecord(zoneNum) {
  try {
    const { data } = await supabase
      .from('zone_history')
      .select('id')
      .eq('zone_num', zoneNum)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      await supabase
        .from('zone_history')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', data[0].id)
    }
  } catch (e) {
    console.warn('zone_history close failed:', e)
  }
}

export async function allZonesOff() {
  await Promise.all(
    [1,2,3,4,5,6,7,8].map(z =>
      mqttPublish(`farm/irrigation1/zone/${z}/cmd`, { cmd: 'off' })
    )
  )
}

// ── Filter commands (old irrigation controller) ────────────────────────────

export function startBackwash() {
  return mqttPublish('farm/filter1/backwash/start', '')
}

export function stopBackwash() {
  return mqttPublish('farm/filter1/backwash/stop', '')
}

export function resetBackwash() {
  return mqttPublish('farm/filter1/backwash/reset', '')
}

// ── B16M commands ──────────────────────────────────────────────────────────

export function b16mOutputOn(outputNum) {
  return mqttPublish(B16M_SET_TOPIC, { [`output${outputNum}`]: { value: true } })
}

export function b16mOutputOff(outputNum) {
  return mqttPublish(B16M_SET_TOPIC, { [`output${outputNum}`]: { value: false } })
}

// ── A6v3 commands ──────────────────────────────────────────────────────────

export async function logA6v3Pressure(psi) {
  try {
    await supabase.from('pressure_log').insert({
      ts: new Date().toISOString(),
      a6v3_ch1_psi: parseFloat(psi.toFixed(2)),
    })
  } catch (e) { console.warn('a6v3 pressure log failed:', e) }
}

export function a6v3OutputOn(outputNum) {
  return mqttPublish(A6V3_SET_TOPIC, { [`output${outputNum}`]: { value: true } })
}

export function a6v3OutputOff(outputNum) {
  return mqttPublish(A6V3_SET_TOPIC, { [`output${outputNum}`]: { value: false } })
}

export function requestA6v3State() {
  return mqttPublish(A6V3_SET_TOPIC, { get: 'STATE' })
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function durationToMinutes(label) {
  if (label === '15 min') return 15
  if (label === '30 min') return 30
  if (label === '1 hour') return 60
  return 30
}

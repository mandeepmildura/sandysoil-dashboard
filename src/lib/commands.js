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

/** Close the most recent open zone_history row for this zone/device. */
export async function closeOpenHistoryRecord(zoneNum, device = 'irrigation1') {
  try {
    const { data } = await supabase
      .from('zone_history')
      .select('id')
      .eq('zone_num', zoneNum)
      .eq('device', device)
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

export async function b16mOutputOn(outputNum) {
  await mqttPublish(B16M_SET_TOPIC, { [`output${outputNum}`]: { value: true } })
  try {
    await supabase.from('zone_history').insert({
      device: 'b16m',
      zone_num: outputNum,
      started_at: new Date().toISOString(),
      source: 'manual',
    })
  } catch (e) { console.warn('b16m relay history insert failed:', e) }
}

export async function b16mOutputOff(outputNum) {
  await mqttPublish(B16M_SET_TOPIC, { [`output${outputNum}`]: { value: false } })
  await closeOpenHistoryRecord(outputNum, 'b16m')
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

export async function a6v3OutputOn(outputNum) {
  await mqttPublish(A6V3_SET_TOPIC, { [`output${outputNum}`]: { value: true } })
  try {
    await supabase.from('zone_history').insert({
      device: 'a6v3',
      zone_num: outputNum,
      started_at: new Date().toISOString(),
      source: 'manual',
    })
  } catch (e) { console.warn('a6v3 relay history insert failed:', e) }
}

export async function a6v3OutputOff(outputNum) {
  await mqttPublish(A6V3_SET_TOPIC, { [`output${outputNum}`]: { value: false } })
  await closeOpenHistoryRecord(outputNum, 'a6v3')
}

// KCS firmware only publishes STATE when a value actually changes.
// Pulse dac1 0→1→0 to force a STATE response (which includes fresh ADC values).
// DAC outputs are unconnected so this is safe.
export async function requestA6v3State(_currentOutputs) {
  await mqttPublish(A6V3_SET_TOPIC, { dac1: { value: 1 } })
  await mqttPublish(A6V3_SET_TOPIC, { dac1: { value: 0 } })
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function durationToMinutes(label) {
  if (label === '15 min') return 15
  if (label === '30 min') return 30
  if (label === '1 hour') return 60
  return 30
}

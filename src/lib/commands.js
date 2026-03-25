import { mqttPublish } from './mqttClient'
import { supabase } from './supabase'

const SET_TOPIC = 'B16M/CCBA97071FD8/SET'

// ── Zone commands ──────────────────────────────────────────────────────────

export async function zoneOn(zoneNum, durationMin, source = 'manual') {
  await mqttPublish(SET_TOPIC, { [`output${zoneNum}`]: { value: true } })
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
  await mqttPublish(SET_TOPIC, { [`output${zoneNum}`]: { value: false } })
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

export function allZonesOff() {
  const payload = {}
  for (let i = 1; i <= 16; i++) payload[`output${i}`] = { value: false }
  return mqttPublish(SET_TOPIC, payload)
}

// ── Filter commands ────────────────────────────────────────────────────────
// Map backwash to whichever relay is wired to your filter valve

export function startBackwash() {
  return mqttPublish(SET_TOPIC, { output16: { value: true } })
}

export function stopBackwash() {
  return mqttPublish(SET_TOPIC, { output16: { value: false } })
}

export function resetBackwash() {
  return mqttPublish(SET_TOPIC, { output16: { value: false } })
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function durationToMinutes(label) {
  if (label === '15 min') return 15
  if (label === '30 min') return 30
  if (label === '1 hour') return 60
  return 30
}

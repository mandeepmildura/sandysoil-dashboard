import { mqttPublish } from './mqttClient'
import { supabase } from './supabase'

// ── Zone commands ──────────────────────────────────────────────────────────

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

export function allZonesOff() {
  return mqttPublish('farm/irrigation1/all/off', '')
}

// ── Filter commands ────────────────────────────────────────────────────────

export function startBackwash() {
  return mqttPublish('farm/filter1/backwash/start', '')
}

export function stopBackwash() {
  return mqttPublish('farm/filter1/backwash/stop', '')
}

export function resetBackwash() {
  return mqttPublish('farm/filter1/backwash/reset', '')
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function durationToMinutes(label) {
  if (label === '15 min') return 15
  if (label === '30 min') return 30
  if (label === '1 hour') return 60
  return 30
}

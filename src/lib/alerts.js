import { supabase } from './supabase'

// Client-side throttles so repeated alert checks driven by frequent MQTT
// state updates don't hammer Supabase. The DB-level dedup in raiseAlert is
// still correct; these just avoid the round-trip when nothing has changed.
const THROTTLE_MS = 60_000
const lastRaiseAt = new Map()
const lastResolveAt = new Map()

/**
 * Insert an alert into device_alerts, deduplicating within a time window.
 * If an unacknowledged alert with the same device + title already exists
 * within the last `dedupMinutes` minutes, skip the insert.
 *
 * @param {object} alert  - { severity, title, description, device, device_id }
 * @param {number} dedupMinutes  - dedup window in minutes (default: 30)
 */
export async function raiseAlert({ severity, title, description, device, device_id }, dedupMinutes = 30) {
  const key = `${device ?? ''}|${title}`
  const prev = lastRaiseAt.get(key) ?? 0
  if (Date.now() - prev < THROTTLE_MS) return
  lastRaiseAt.set(key, Date.now())

  try {
    const since = new Date(Date.now() - dedupMinutes * 60_000).toISOString()

    const { data: existing } = await supabase
      .from('device_alerts')
      .select('id')
      .eq('device', device ?? '')
      .eq('title', title)
      .eq('acknowledged', false)
      .gte('created_at', since)
      .limit(1)

    if (existing?.length) return  // duplicate — skip

    await supabase.from('device_alerts').insert({
      severity:    severity ?? 'warning',
      title,
      description: description ?? '',
      device:      device ?? '',
      device_id:   device_id ?? '',
      acknowledged: false,
    })
  } catch (e) {
    console.error('raiseAlert failed:', e)
  }
}

/**
 * Auto-acknowledge all open alerts for a device+title (used for recovery events).
 */
export async function resolveAlerts(device, title) {
  const key = `${device ?? ''}|${title}`
  const prev = lastResolveAt.get(key) ?? 0
  if (Date.now() - prev < THROTTLE_MS) return
  lastResolveAt.set(key, Date.now())

  try {
    await supabase
      .from('device_alerts')
      .update({ acknowledged: true })
      .eq('device', device)
      .eq('title', title)
      .eq('acknowledged', false)
  } catch (e) {
    console.error('resolveAlerts failed:', e)
  }
}

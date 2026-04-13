import { supabase } from './supabase'

/**
 * Insert an alert into device_alerts, deduplicating within a time window.
 * If an unacknowledged alert with the same device + title already exists
 * within the last `dedupMinutes` minutes, skip the insert.
 *
 * @param {object} alert  - { severity, title, description, device, device_id }
 * @param {number} dedupMinutes  - dedup window in minutes (default: 30)
 */
export async function raiseAlert({ severity, title, description, device, device_id }, dedupMinutes = 30) {
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

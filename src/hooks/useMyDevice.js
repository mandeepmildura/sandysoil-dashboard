import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { prefixForDevice } from '../lib/topics'

/**
 * Resolve the controller assigned to the logged-in customer.
 *
 * Returns the first SSA-V8 (or generic irrigation) device linked to a farm
 * owned by this user. Admin users get no special treatment here — they get
 * the LEGACY_PREFIX fallback so their UI continues to work against the
 * original deployed unit.
 *
 * Shape:
 *   { device, mqttPrefix, loading, error }
 *   device      — { id, device_id, model, type, mqtt_base_topic, farm_id }  | null
 *   mqttPrefix  — resolved topic prefix (always a string; falls back to
 *                 'farm/irrigation1' if no device is assigned)
 */
export function useMyDevice() {
  const [device, setDevice]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          if (!cancelled) { setDevice(null); setLoading(false) }
          return
        }
        const { data: rows, error: qErr } = await supabase
          .from('farms')
          .select('id, name, farm_devices(id, device_id, model, type, status, last_seen, firmware, mqtt_base_topic, pump_zone_num)')
          .eq('owner_id', user.id)
          .limit(1)
        if (qErr) throw qErr
        const farm    = rows?.[0] ?? null
        const devices = farm?.farm_devices ?? []
        // Prefer a device explicitly typed as an irrigation controller; fall
        // back to the first device if none matches (e.g. a newly provisioned farm
        // with no type set yet).
        const dev = devices.find(d =>
          (d.type ?? '').toLowerCase().includes('irrigation') ||
          (d.model ?? '').toLowerCase().includes('ssa') ||
          (d.model ?? '').toLowerCase().includes('a8v')
        ) ?? devices[0] ?? null
        if (!cancelled) {
          setDevice(dev ? { ...dev, farm_id: farm.id, farm_name: farm.name } : null)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) { setError(e.message ?? String(e)); setLoading(false) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { device, mqttPrefix: prefixForDevice(device), loading, error }
}

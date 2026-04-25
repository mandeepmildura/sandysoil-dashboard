import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Resolve the controller assigned to the logged-in customer.
 *
 * Returns the first SSA-V8 (or generic irrigation) device linked to a farm
 * owned by this user. Admin users get no special treatment here — they see
 * the legacy `irrigation1` topic via Sidebar/Dashboard fallbacks elsewhere.
 *
 * Shape:
 *   { device, loading, error }
 *   device = { id, device_id (chip serial), model, type, farm_id }  | null
 *
 * NOTE: Until the SSA-V8 firmware is updated to publish on
 *       `farm/{chip-serial}/...` (currently hard-coded to `irrigation1`),
 *       the dashboard still subscribes to `farm/irrigation1/...` for the
 *       first customer. This hook is the foundation for that switch.
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
        // Find this user's farms, then their first device.
        const { data: rows, error: qErr } = await supabase
          .from('farms')
          .select('id, name, farm_devices(id, device_id, model, type, status, last_seen, firmware)')
          .eq('owner_id', user.id)
          .limit(1)
        if (qErr) throw qErr
        const farm = rows?.[0] ?? null
        const dev  = farm?.farm_devices?.[0] ?? null
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

  return { device, loading, error }
}

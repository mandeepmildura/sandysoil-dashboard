import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches custom names for zones/relays on a specific device.
 * Returns a map: { [zoneNum]: customName }
 *
 * device: 'irrigation1' (default) | 'a6v3'
 */
export function useZoneNames(device = 'irrigation1') {
  const [names, setNames] = useState({})

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('zone_names')
      .select('zone_num, custom_name')
      .eq('device', device)
    if (data) {
      const map = {}
      data.forEach(r => { map[r.zone_num] = r.custom_name })
      setNames(map)
    }
  }, [device])

  useEffect(() => { load() }, [load])

  async function renameZone(zoneNum, newName) {
    const trimmed = newName.trim()
    if (!trimmed) return
    await supabase.from('zone_names').upsert(
      { device, zone_num: zoneNum, custom_name: trimmed, updated_at: new Date().toISOString() },
      { onConflict: 'device,zone_num' }
    )
    setNames(prev => ({ ...prev, [zoneNum]: trimmed }))
  }

  return { names, renameZone }
}

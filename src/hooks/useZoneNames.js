import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches custom zone names from Supabase and provides a rename function.
 * Returns a map: { [zoneNum]: customName }
 */
export function useZoneNames() {
  const [names, setNames] = useState({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('zone_names').select('zone_num, custom_name')
    if (data) {
      const map = {}
      data.forEach(r => { map[r.zone_num] = r.custom_name })
      setNames(map)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function renameZone(zoneNum, newName) {
    const trimmed = newName.trim()
    if (!trimmed) return
    await supabase.from('zone_names').upsert(
      { zone_num: zoneNum, custom_name: trimmed, updated_at: new Date().toISOString() },
      { onConflict: 'zone_num' }
    )
    setNames(prev => ({ ...prev, [zoneNum]: trimmed }))
  }

  return { names, renameZone }
}

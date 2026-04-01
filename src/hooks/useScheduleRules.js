import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches zone_schedules (per-zone) and group_schedules (program-level).
 */
export function useScheduleRules() {
  const [zoneSchedules, setZoneSchedules]   = useState([])
  const [groupSchedules, setGroupSchedules] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const [zsRes, gsRes] = await Promise.all([
        supabase.from('zone_schedules').select('*').order('zone_num'),
        supabase.from('group_schedules').select('*, zone_groups(name, zone_group_members(zone_num, duration_min, sort_order, device))').order('start_time'),
      ])
      if (zsRes.data)  setZoneSchedules(zsRes.data)
      if (gsRes.data)  setGroupSchedules(gsRes.data)
      setLoading(false)
    }
    fetch()
  }, [])

  return { zoneSchedules, groupSchedules, loading }
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches group_schedules (program-level) for the Dashboard "upcoming" panel.
 * Only pulls the columns the consumer (upcomingSchedules) actually reads.
 */
export function useScheduleRules() {
  const [groupSchedules, setGroupSchedules] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const { data } = await supabase
        .from('group_schedules')
        .select('id, days_of_week, start_time, enabled, zone_groups(name, zone_group_members(duration_min))')
        .eq('enabled', true)
        .order('start_time')
      if (data) setGroupSchedules(data)
      setLoading(false)
    }
    fetch()
  }, [])

  return { zoneSchedules: [], groupSchedules, loading }
}

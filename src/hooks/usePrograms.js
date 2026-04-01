import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches zone_groups with their members and schedules.
 */
export function usePrograms() {
  const [programs, setPrograms] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    async function load() {
      setLoading(true)

      const [groupsRes, membersRes, schedulesRes] = await Promise.all([
        supabase.from('zone_groups').select('id, name, run_mode, created_at'),
        supabase.from('zone_group_members').select('group_id, zone_num, duration_min, sort_order, device').order('sort_order'),
        supabase.from('group_schedules').select('group_id, label, days_of_week, start_time, enabled'),
      ])

      if (groupsRes.data) {
        const members   = membersRes.data   ?? []
        const schedules = schedulesRes.data ?? []

        const merged = groupsRes.data.map(g => ({
          ...g,
          zones:    members.filter(m => m.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order),
          schedule: schedules.find(s => s.group_id === g.id) ?? null,
        }))
        setPrograms(merged)
      }
      setLoading(false)
    }
    load()
  }, [tick])

  return { programs, loading, reload }
}

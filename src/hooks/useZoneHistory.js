import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches zone_history for a specific zone number.
 * Pass zoneNum=null to get all zones.
 */
export function useZoneHistory(zoneNum = null, limit = 20) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      let query = supabase
        .from('zone_history')
        .select('id, zone_num, started_at, ended_at, duration_min, source')
        .order('started_at', { ascending: false })
        .limit(limit)

      if (zoneNum !== null) query = query.eq('zone_num', zoneNum)

      const { data, error } = await query
      if (!error && data) setHistory(data)
      setLoading(false)
    }
    load()
  }, [zoneNum, limit, tick])

  return { history, loading, refresh }
}

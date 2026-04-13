import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches zone_history for a specific zone/relay.
 * - zoneNum: filter by output number (null = all)
 * - device: 'irrigation1' | 'a6v3' (null = all devices)
 * - limit: max rows to fetch
 * Subscribes to realtime changes so history auto-refreshes.
 */
export function useZoneHistory(zoneNum = null, device = 'irrigation1', limit = 50) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('zone_history')
        .select('id, zone_num, device, started_at, ended_at, duration_min, source')
        .order('started_at', { ascending: false })
        .limit(limit)

      if (zoneNum !== null) query = query.eq('zone_num', zoneNum)
      if (device !== null)  query = query.eq('device', device)

      const { data, error } = await query
      if (!error && data) setHistory(data)
    } catch (e) {
      console.error('useZoneHistory error:', e)
    } finally {
      setLoading(false)
    }
  }, [zoneNum, device, limit])

  useEffect(() => {
    load()

    const channel = supabase
      .channel(`zone_history_${device ?? 'all'}_${zoneNum ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'zone_history' },
        () => load()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [load])

  return { history, loading, reload: load }
}

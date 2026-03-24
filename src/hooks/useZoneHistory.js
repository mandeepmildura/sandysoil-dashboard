import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches zone_history for a specific zone number.
 * Pass zoneNum=null to get all zones.
 * Subscribes to realtime changes so history auto-refreshes.
 */
export function useZoneHistory(zoneNum = null, limit = 20) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('zone_history')
        .select('id, zone_num, started_at, ended_at, duration_min, source')
        .order('started_at', { ascending: false })
        .limit(limit)

      if (zoneNum !== null) query = query.eq('zone_num', zoneNum)

      const { data, error } = await query
      if (!error && data) setHistory(data)
    } catch (e) {
      console.error('useZoneHistory error:', e)
    } finally {
      setLoading(false)
    }
  }, [zoneNum, limit])

  useEffect(() => {
    load()

    // Realtime subscription — re-fetch whenever zone_history changes
    const channel = supabase
      .channel(`zone_history_${zoneNum ?? 'all'}`)
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

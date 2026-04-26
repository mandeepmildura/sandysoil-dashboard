import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches zone_history for a specific zone/relay.
 * - zoneNum: filter by output number (null = all)
 * - device: 'irrigation1' | 'a6v3' (null = all devices)
 * - limit: max rows to fetch (ignored when from/to are provided)
 * - from/to: optional ISO strings to filter by date range
 * Subscribes to realtime changes so history auto-refreshes.
 */
export function useZoneHistory(zoneNum = null, device = 'irrigation1', limit = 50, from = null, to = null) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('zone_history')
        .select('id, zone_num, device, started_at, ended_at, duration_min, source')
        .order('started_at', { ascending: false })

      if (zoneNum !== null) query = query.eq('zone_num', zoneNum)
      if (device !== null)  query = query.eq('device', device)

      if (from && to) {
        query = query.gte('started_at', from).lte('started_at', to)
      } else {
        query = query.limit(limit)
      }

      const { data, error } = await query
      if (!error && data) setHistory(data)
    } catch (e) {
      console.error('useZoneHistory error:', e)
    } finally {
      setLoading(false)
    }
  }, [zoneNum, device, limit, from, to])

  useEffect(() => {
    load()

    // Realtime subscription. Use the row payload directly instead of
    // refetching the whole window on every change — that was triggering a
    // full ~50 KB read per insert across every active tab and was a major
    // egress source.
    const channel = supabase
      .channel(`zone_history_${device ?? 'all'}_${zoneNum ?? 'all'}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'zone_history' },
        (payload) => {
          // Filter by zone/device match (the realtime layer doesn't filter for us)
          const row = payload.new ?? payload.old
          if (!row) return
          if (zoneNum != null && row.zone_num !== zoneNum) return
          if (device != null && row.device !== device) return

          if (payload.eventType === 'INSERT') {
            setHistory(prev => [row, ...prev].slice(0, limit))
          } else if (payload.eventType === 'UPDATE') {
            setHistory(prev => prev.map(r => r.id === row.id ? { ...r, ...row } : r))
          } else if (payload.eventType === 'DELETE') {
            setHistory(prev => prev.filter(r => r.id !== row.id))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, zoneNum, device, limit])

  return { history, loading, reload: load }
}

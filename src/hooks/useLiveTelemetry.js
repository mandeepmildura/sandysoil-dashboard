import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Subscribes to device_telemetry via Supabase Realtime.
 * Returns a map of { [topic]: latestPayload } and a connected flag.
 *
 * On mount, fetches the most recent row for each watched topic,
 * then keeps it live via INSERT events.
 */
export function useLiveTelemetry(topics = []) {
  const [data, setData] = useState({})
  const [connected, setConnected] = useState(false)

  const topicsKey = topics.join(',')

  const applyRow = useCallback((row) => {
    if (!row?.topic || !row?.payload) return
    setData(prev => ({ ...prev, [row.topic]: row.payload }))
  }, [])

  useEffect(() => {
    if (!topics.length) return

    // Initial fetch — latest row per topic
    async function fetchLatest() {
      for (const topic of topics) {
        const { data: rows } = await supabase
          .from('device_telemetry')
          .select('topic, payload')
          .eq('topic', topic)
          .order('received_at', { ascending: false })
          .limit(1)
        if (rows?.[0]) applyRow(rows[0])
      }
    }
    fetchLatest()

    // Realtime subscription
    const channel = supabase
      .channel('live-telemetry')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'device_telemetry' },
        (change) => {
          const row = change.new
          if (topics.includes(row.topic)) applyRow(row)
        }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [topicsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, connected }
}

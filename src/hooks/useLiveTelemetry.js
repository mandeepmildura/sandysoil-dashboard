import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Subscribes to device_telemetry rows for the given topics via Supabase Realtime.
 * The device upserts rows into device_telemetry(topic, payload, updated_at).
 * Returns { data: { [topic]: latestPayload }, connected }.
 */
export function useLiveTelemetry(topics = []) {
  const [data,      setData]      = useState({})
  const [connected, setConnected] = useState(false)

  const topicsKey = topics.join(',')

  useEffect(() => {
    if (!topics.length) return

    // Initial fetch — seed data before the realtime stream arrives
    async function load() {
      const { data: rows, error } = await supabase
        .from('device_telemetry')
        .select('topic, payload')
        .in('topic', topics)
      if (!error && rows) {
        const map = {}
        for (const row of rows) map[row.topic] = row.payload
        setData(map)
        setConnected(true)
      }
    }
    load()

    // Realtime subscription — listen for upserts from the device
    const channel = supabase
      .channel(`telemetry:${topicsKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_telemetry' },
        ({ new: row }) => {
          if (row && topics.includes(row.topic)) {
            setConnected(true)
            setData(prev => ({ ...prev, [row.topic]: row.payload }))
          }
        }
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED')    setConnected(true)
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnected(false)
      })

    return () => { supabase.removeChannel(channel) }
  }, [topicsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, connected }
}

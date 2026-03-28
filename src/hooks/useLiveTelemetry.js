import { useEffect, useState, useCallback } from 'react'
import { mqttSubscribe, getMqttCache } from '../lib/mqttClient'

/**
 * Subscribes to MQTT topics directly over WSS.
 * Returns { data: { [topic]: latestPayload }, connected }.
 * Seeds initial state from the module-level cache so navigating
 * back to a page shows the last known values immediately.
 */
export function useLiveTelemetry(topics = []) {
  const [data, setData] = useState(() => {
    // Populate from cache so values don't flash to "—" on navigation
    const cache = getMqttCache()
    const initial = {}
    for (const topic of topics) {
      if (topic.includes('+')) {
        // Wildcard: find all cached topics that match
        const p = topic.split('/')
        for (const [ct, payload] of Object.entries(cache)) {
          const t = ct.split('/')
          if (p.length === t.length && p.every((seg, i) => seg === '+' || seg === t[i])) {
            initial[ct] = payload
          }
        }
      } else if (cache[topic] != null) {
        initial[topic] = cache[topic]
      }
    }
    return initial
  })
  const [connected, setConnected] = useState(false)

  const topicsKey = topics.join(',')

  const handleMessage = useCallback((payload, topic) => {
    setConnected(true)
    setData(prev => ({ ...prev, [topic]: payload }))
  }, [])

  useEffect(() => {
    if (!topics.length) return

    const unsubs = []

    async function subscribe() {
      for (const topic of topics) {
        const unsub = await mqttSubscribe(topic, handleMessage)
        unsubs.push(unsub)
      }
      setConnected(true)
    }

    subscribe().catch(err => {
      console.error('MQTT subscribe error:', err)
      setConnected(false)
    })

    return () => unsubs.forEach(fn => fn())
  }, [topicsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, connected }
}

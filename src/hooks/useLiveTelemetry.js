import { useEffect, useState, useCallback } from 'react'
import { mqttSubscribe } from '../lib/mqttClient'

/**
 * Subscribes to MQTT topics directly over WSS.
 * Returns { data: { [topic]: latestPayload }, connected }.
 * No Railway bridge — updates arrive as fast as the device publishes.
 */
export function useLiveTelemetry(topics = []) {
  const [data,      setData]      = useState({})
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

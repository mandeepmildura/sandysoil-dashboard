import { useMemo } from 'react'
import { useDeviceData } from '../context/DeviceContext'
import { mqttMatch } from '../lib/mqttMatch'

/**
 * Selects the subset of device data for the given topics.
 * Supports single-level MQTT wildcards ('+').
 *
 * All actual MQTT subscriptions live in DeviceProvider (app-level).
 * This hook is a pure selector — no subscriptions, no side-effects.
 * Existing callers are unchanged.
 */
export function useLiveTelemetry(topics = []) {
  const { data: allData, connected } = useDeviceData()

  // Collapse to a primitive so useMemo has a stable, value-comparable dep.
  // Re-derive the list inside the memo — no closure over the array reference.
  const topicsKey = topics.join(',')

  const data = useMemo(() => {
    const topicList = topicsKey ? topicsKey.split(',') : []
    const result = {}
    for (const topic of topicList) {
      if (topic.includes('+')) {
        for (const [t, payload] of Object.entries(allData)) {
          if (mqttMatch(topic, t)) result[t] = payload
        }
      } else if (allData[topic] != null) {
        result[topic] = allData[topic]
      }
    }
    return result
  }, [allData, topicsKey])

  return { data, connected }
}

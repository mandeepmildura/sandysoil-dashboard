import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { mqttSubscribe, getMqttCache } from '../lib/mqttClient'
import { KCS_DEVICES } from '../config/devices'

/**
 * All MQTT topics subscribed at app level.
 * KCS device topics are derived from the device registry — adding a new
 * device to src/config/devices.js automatically adds its topic here.
 */
export const DEVICE_TOPICS = [
  // 8-zone irrigation controller (bespoke firmware)
  'farm/irrigation1/status',
  'farm/irrigation1/zone/+/state',
  // All KCS firmware devices (A6v3, B16M, future boards)
  ...KCS_DEVICES.map(d => d.stateTopic),
  // Filter (future — topics ready for when sensor is wired)
  'farm/filter1/pressure',
  'farm/filter1/backwash/state',
  // Sim pressure (dev/testing)
  'farm/irrigation1/sim/pressure',
  // OTA updates
  'farm/irrigation1/ota/status',
]

const DeviceContext = createContext({ data: {}, connected: false, patchOptimistic: () => {} })

/**
 * App-level provider. Subscribes to all device topics once and never unmounts.
 * Any component can read the latest device data without its own MQTT subscription.
 *
 * Also supports optimistic patches: call patchOptimistic(topic, partial) to
 * immediately update UI state while waiting for the real device response.
 * Optimistic patches are wiped for a topic the moment a real MQTT message arrives.
 */
export function DeviceProvider({ children }) {
  // Seed from module-level cache so values survive page navigation
  const [mqttData, setMqttData] = useState(() => getMqttCache())
  const [optimistic, setOptimistic] = useState({})
  const [connected, setConnected] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const unsubs = []

    async function subscribe() {
      for (const topic of DEVICE_TOPICS) {
        const unsub = await mqttSubscribe(topic, (payload, t) => {
          if (!mountedRef.current) return
          setConnected(true)
          setMqttData(prev => ({ ...prev, [t]: payload }))
          // Real device data trumps any optimistic patch for this topic
          setOptimistic(prev => {
            if (!prev[t]) return prev
            const next = { ...prev }
            delete next[t]
            return next
          })
        })
        unsubs.push(unsub)
      }
      if (mountedRef.current) setConnected(true)
    }

    subscribe().catch(err => console.error('[DeviceProvider] MQTT subscribe error:', err))

    return () => {
      mountedRef.current = false
      unsubs.forEach(fn => fn())
    }
  }, [])

  /**
   * Apply an optimistic patch to a topic's data.
   * The patch is merged shallowly onto the existing data and will be
   * automatically cleared when the next real MQTT message arrives for
   * that topic.
   *
   * Usage: patchOptimistic('farm/irrigation1/status', { zones: [...] })
   */
  const patchOptimistic = useMemo(
    () => (topic, partial) => {
      setOptimistic(prev => ({
        ...prev,
        [topic]: { ...(prev[topic] ?? {}), ...partial },
      }))
    },
    []
  )

  // Merge real data with optimistic patches (optimistic wins until real data arrives)
  const data = useMemo(() => {
    const keys = new Set([...Object.keys(mqttData), ...Object.keys(optimistic)])
    const merged = {}
    for (const k of keys) {
      merged[k] = optimistic[k]
        ? { ...(mqttData[k] ?? {}), ...optimistic[k] }
        : mqttData[k]
    }
    return merged
  }, [mqttData, optimistic])

  const value = useMemo(
    () => ({ data, connected, patchOptimistic }),
    [data, connected, patchOptimistic]
  )

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
}

export function useDeviceData() {
  return useContext(DeviceContext)
}

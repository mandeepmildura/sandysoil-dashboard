import { useEffect, useRef } from 'react'
import { raiseAlert, resolveAlerts } from '../lib/alerts'

/**
 * Raises a device_alerts entry when an MQTT device goes silent for `timeoutMs`.
 * Auto-resolves (acknowledges) the alert when the device comes back online.
 *
 * @param {string}  device       - friendly name, e.g. 'A6v3'
 * @param {string}  deviceId     - serial/topic identifier, e.g. '8CBFEA03002C'
 * @param {any}     lastMessage  - latest MQTT message from the device (changes when a new message arrives)
 * @param {number}  timeoutMs    - silence threshold in milliseconds (default: 5 min)
 */
export function useDeviceOffline(device, deviceId, lastMessage, timeoutMs = 5 * 60_000) {
  const timerRef    = useRef(null)
  const offlineRef  = useRef(false)

  // Reset the offline timer whenever a new message arrives
  useEffect(() => {
    if (lastMessage == null) return   // no message yet — don't start timer

    // Device just came back online
    if (offlineRef.current) {
      offlineRef.current = false
      resolveAlerts(device, `${device} offline`)
    }

    // (Re)start the silence watchdog
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      offlineRef.current = true
      raiseAlert({
        severity:    'fault',
        title:       `${device} offline`,
        description: `No MQTT message from ${device} (${deviceId}) for ${Math.round(timeoutMs / 60_000)} min.`,
        device,
        device_id:   deviceId,
      }, 60) // dedup window: 60 min so we don't flood
    }, timeoutMs)

    return () => clearTimeout(timerRef.current)
  }, [lastMessage]) // eslint-disable-line react-hooks/exhaustive-deps
}

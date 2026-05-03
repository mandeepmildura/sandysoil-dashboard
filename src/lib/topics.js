/**
 * MQTT topic resolution for the irrigation controller.
 *
 * Every device publishes on its own prefix (e.g. `farm/<chip-id>`); the
 * legacy first-customer unit still uses `farm/irrigation1` until its NVS
 * config is migrated. This module is the single source of truth for
 * resolving prefix → concrete topic strings.
 *
 * Usage in a component:
 *   const { device } = useMyDevice()
 *   const t = topicsForDevice(device)
 *   const { data } = useLiveTelemetry([t.status, t.zoneStateWildcard])
 *
 * Usage in commands:
 *   await zoneOn(zoneNum, 30, { prefix: t.prefix })
 */

// Fallback used when no device is assigned (e.g. admin views) or when
// `farm_devices.mqtt_base_topic` hasn't been backfilled yet. Matches the
// original hard-coded literal so existing behavior is preserved.
export const LEGACY_PREFIX = 'farm/irrigation1'

/**
 * Resolve a device row → its MQTT prefix.
 *
 * Priority:
 *   1. device.mqtt_base_topic                  (set by migration 010 / admin console)
 *   2. `farm/<device_id-lower>`                (sensible default for new units)
 *   3. LEGACY_PREFIX                           (back-compat for the original unit)
 */
export function prefixForDevice(device) {
  if (!device) return LEGACY_PREFIX
  if (device.mqtt_base_topic) return device.mqtt_base_topic
  if (device.device_id) return `farm/${String(device.device_id).toLowerCase()}`
  return LEGACY_PREFIX
}

/**
 * Build all topic strings for a given prefix.
 * Returns an object so callers don't have to remember the suffix conventions.
 */
export function topicsForPrefix(prefix = LEGACY_PREFIX) {
  return {
    prefix,
    status:             `${prefix}/status`,
    otaStatus:          `${prefix}/ota/status`,
    otaCmd:             `${prefix}/cmd/ota`,
    simPressure:        `${prefix}/sim/pressure`,
    zoneStateWildcard:  `${prefix}/zone/+/state`,
    zoneState:          (n) => `${prefix}/zone/${n}/state`,
    zoneCmd:            (n) => `${prefix}/zone/${n}/cmd`,
  }
}

/**
 * Convenience: device → topic bundle in one call.
 */
export function topicsForDevice(device) {
  return topicsForPrefix(prefixForDevice(device))
}

/**
 * Filter topics → admin-only filter station + KCS state topics that aren't
 * tied to a customer device. Used by the global subscription list.
 */
export const ADMIN_TOPICS = [
  'farm/filter1/pressure',
  'farm/filter1/backwash/state',
]

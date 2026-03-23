import { mqttPublish } from './mqttClient'

// ── Zone commands ──────────────────────────────────────────────────────────

export function zoneOn(zoneNum, durationMin) {
  return mqttPublish(
    `farm/irrigation1/zone/${zoneNum}/cmd`,
    { cmd: 'on', duration: durationMin }
  )
}

export function zoneOff(zoneNum) {
  return mqttPublish(
    `farm/irrigation1/zone/${zoneNum}/cmd`,
    { cmd: 'off' }
  )
}

export function allZonesOff() {
  return mqttPublish('farm/irrigation1/all/off', '')
}

// ── Filter commands ────────────────────────────────────────────────────────

export function startBackwash() {
  return mqttPublish('farm/filter1/backwash/start', '')
}

export function stopBackwash() {
  return mqttPublish('farm/filter1/backwash/stop', '')
}

export function resetBackwash() {
  return mqttPublish('farm/filter1/backwash/reset', '')
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function durationToMinutes(label) {
  if (label === '15 min') return 15
  if (label === '30 min') return 30
  if (label === '1 hour') return 60
  return 30
}

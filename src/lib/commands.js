import { supabase } from './supabase'

// ── Internal helper ────────────────────────────────────────────────────────

async function sendCommand(topic, payload) {
  const { error } = await supabase
    .from('device_commands')
    .insert({ topic, payload })
  if (error) throw error
}

// ── Zone commands ──────────────────────────────────────────────────────────

export function zoneOn(zoneNum, durationMin) {
  return sendCommand(
    `farm/irrigation1/zone/${zoneNum}/cmd`,
    { cmd: 'on', duration: durationMin }
  )
}

export function zoneOff(zoneNum) {
  return sendCommand(
    `farm/irrigation1/zone/${zoneNum}/cmd`,
    { cmd: 'off' }
  )
}

export function allZonesOff() {
  return sendCommand('farm/irrigation1/all/off', {})
}

// ── Filter commands ────────────────────────────────────────────────────────

export function startBackwash() {
  return sendCommand('farm/filter1/backwash/start', {})
}

export function stopBackwash() {
  return sendCommand('farm/filter1/backwash/stop', {})
}

export function resetBackwash() {
  return sendCommand('farm/filter1/backwash/reset', {})
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function durationToMinutes(label) {
  if (label === '15 min') return 15
  if (label === '30 min') return 30
  if (label === '1 hour') return 60
  return 30
}

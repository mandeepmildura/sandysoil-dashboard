import { supabase } from './supabase'

const IRRIGATION_DEVICE_ID = '6e276ee9-224d-4529-b96b-b165687f6e94'
const FILTER_DEVICE_ID     = '306b8dce-1144-49b2-bdec-05d2f2792289'

async function sendCommand(deviceId, topic, payload) {
  const { error } = await supabase.from('device_commands').insert({
    device_id: deviceId,
    topic,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    sent: false,
  })
  if (error) throw error
}

// Turn a zone on for a given number of minutes
export function zoneOn(zoneNum, durationMin) {
  return sendCommand(
    IRRIGATION_DEVICE_ID,
    `farm/irrigation1/zone/${zoneNum}/cmd`,
    { cmd: 'on', duration: durationMin }
  )
}

// Turn a single zone off
export function zoneOff(zoneNum) {
  return sendCommand(
    IRRIGATION_DEVICE_ID,
    `farm/irrigation1/zone/${zoneNum}/cmd`,
    { cmd: 'off' }
  )
}

// Turn all zones off
export function allZonesOff() {
  return sendCommand(
    IRRIGATION_DEVICE_ID,
    'farm/irrigation1/all/off',
    ''
  )
}

// Trigger filter backwash
export function startBackwash() {
  return sendCommand(
    FILTER_DEVICE_ID,
    'farm/filter1/backwash/start',
    ''
  )
}

// Duration label → minutes
export function durationToMinutes(label) {
  if (label === '15 min') return 15
  if (label === '30 min') return 30
  if (label === '1 hour') return 60
  return 30 // default for Custom
}

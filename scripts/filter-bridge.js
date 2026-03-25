#!/usr/bin/env node
/**
 * filter-bridge.js
 * Reads pressure + backwash data from the filter device on a serial port
 * and publishes it to the MQTT broker used by the dashboard.
 *
 * ── Quick start ────────────────────────────────────────────────────────────
 *  1. Install deps (one-time):
 *       npm install serialport @serialport/parser-readline dotenv
 *
 *  2. Set MQTT_PASS in your .env file (same as VITE_MQTT_PASS but without
 *     the VITE_ prefix so it's readable by Node):
 *       MQTT_PASS=your-real-password
 *
 *  3. Run:
 *       node scripts/filter-bridge.js
 *
 *     Or override port / baud:
 *       FILTER_PORT=COM6 FILTER_BAUD=9600 node scripts/filter-bridge.js
 *
 * ── Expected serial format from the filter device ──────────────────────────
 *  Option A — JSON line (preferred):
 *    {"inlet_psi":45.2,"outlet_psi":40.1,"differential_psi":5.1,"backwash":0}
 *
 *  Option B — CSV line (fallback):
 *    45.2,40.1          → inlet, outlet   (diff = inlet − outlet)
 *    45.2,40.1,5.1      → inlet, outlet, diff
 *    45.2,40.1,5.1,1    → inlet, outlet, diff, backwash_relay (0 or 1)
 *
 * ── MQTT topics published ───────────────────────────────────────────────────
 *  farm/filter1/pressure       → { inlet_psi, outlet_psi, differential_psi }
 *  farm/filter1/backwash/state → { state, relay_on, elapsed_sec, last_complete_ago_sec }
 */

import 'dotenv/config'
import { SerialPort }      from 'serialport'
import { ReadlineParser }  from '@serialport/parser-readline'
import mqtt                from 'mqtt'

// ── Config ──────────────────────────────────────────────────────────────────
const SERIAL_PORT = process.env.FILTER_PORT || 'COM6'
const BAUD_RATE   = Number(process.env.FILTER_BAUD) || 9600

const MQTT_HOST = process.env.MQTT_HOST || process.env.VITE_MQTT_HOST
const MQTT_USER = process.env.MQTT_USER || process.env.VITE_MQTT_USER
const MQTT_PASS = process.env.MQTT_PASS || process.env.VITE_MQTT_PASS

// Backwash triggers when differential pressure exceeds this threshold (PSI)
const BACKWASH_TRIGGER_PSI = Number(process.env.BACKWASH_TRIGGER_PSI) || 8

if (!MQTT_HOST || !MQTT_USER || !MQTT_PASS || MQTT_PASS === 'your-mqtt-password') {
  console.error(
    'ERROR: MQTT credentials not set.\n' +
    'Add MQTT_PASS=<your password> to your .env file, then retry.\n' +
    `  Current host: ${MQTT_HOST}\n` +
    `  Current user: ${MQTT_USER}`
  )
  process.exit(1)
}

// ── Backwash state machine ───────────────────────────────────────────────────
const bw = { state: 'MONITORING', relay_on: false, triggered_at: null, last_complete_at: null }

function tickBackwash(diffPsi, relayBit) {
  const now = Date.now()

  if (relayBit === 1 || diffPsi >= BACKWASH_TRIGGER_PSI) {
    if (bw.state === 'MONITORING') { bw.state = 'TRIGGERED'; bw.triggered_at = now }
    else if (bw.state === 'TRIGGERED') { bw.state = 'FLUSHING'; bw.relay_on = true }
  } else {
    if (bw.state === 'FLUSHING' || bw.state === 'TRIGGERED') {
      bw.state = 'COMPLETE'; bw.relay_on = false; bw.last_complete_at = now
    } else if (bw.state === 'COMPLETE') {
      bw.state = 'MONITORING'
    }
  }

  return {
    state:   bw.state,
    relay_on: bw.relay_on,
    elapsed_sec:           bw.triggered_at     ? Math.round((now - bw.triggered_at)     / 1000) : 0,
    last_complete_ago_sec: bw.last_complete_at  ? Math.round((now - bw.last_complete_at) / 1000) : null,
  }
}

// ── MQTT ─────────────────────────────────────────────────────────────────────
const mqttClient = mqtt.connect(`mqtts://${MQTT_HOST}:8883`, {
  username: MQTT_USER,
  password: MQTT_PASS,
  clientId: `filter-bridge-${Math.random().toString(16).slice(2, 8)}`,
  clean: true,
  reconnectPeriod: 5000,
})

mqttClient.on('connect', () => console.log(`[MQTT] connected  ${MQTT_HOST}`))
mqttClient.on('error',   e  => console.error('[MQTT] error:', e.message))
mqttClient.on('offline', () => console.warn('[MQTT] offline — will retry…'))

function pub(topic, payload) {
  if (!mqttClient.connected) return
  mqttClient.publish(topic, JSON.stringify(payload), { qos: 1, retain: true })
}

// ── Serial port ───────────────────────────────────────────────────────────────
const port   = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE })
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))

port.on('open',  ()  => console.log(`[Serial] opened ${SERIAL_PORT} @ ${BAUD_RATE} baud`))
port.on('error', e   => { console.error(`[Serial] cannot open ${SERIAL_PORT}:`, e.message); process.exit(1) })

parser.on('data', raw => {
  const line = raw.trim()
  if (!line) return

  let inlet, outlet, diff, relayBit = 0

  try {
    if (line.startsWith('{')) {
      // JSON format
      const obj = JSON.parse(line)
      inlet    = parseFloat(obj.inlet_psi)
      outlet   = parseFloat(obj.outlet_psi)
      diff     = obj.differential_psi != null ? parseFloat(obj.differential_psi) : inlet - outlet
      relayBit = obj.backwash ? 1 : 0
    } else {
      // CSV format
      const parts = line.split(',').map(Number)
      if (parts.length < 2 || parts.some(isNaN)) { console.warn('[Serial] skip:', line); return }
      ;[inlet, outlet] = parts
      diff     = (parts[2] != null && !isNaN(parts[2])) ? parts[2] : inlet - outlet
      relayBit = parts[3] === 1 ? 1 : 0
    }

    if (isNaN(inlet) || isNaN(outlet)) { console.warn('[Serial] bad values:', line); return }

    const pressure = {
      inlet_psi:        Math.round(inlet  * 10) / 10,
      outlet_psi:       Math.round(outlet * 10) / 10,
      differential_psi: Math.round(diff   * 10) / 10,
    }
    const backwash = tickBackwash(diff, relayBit)

    pub('farm/filter1/pressure',      pressure)
    pub('farm/filter1/backwash/state', backwash)

    console.log(
      `[data] in=${pressure.inlet_psi} out=${pressure.outlet_psi}` +
      ` diff=${pressure.differential_psi} → ${backwash.state}`
    )
  } catch (e) {
    console.error('[parse error]', e.message, '| raw:', line)
  }
})

process.on('SIGINT', () => {
  console.log('\nShutting down…')
  port.close()
  mqttClient.end()
  process.exit(0)
})

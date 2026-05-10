/**
 * Backwash state machine (filter-bridge).
 *
 * Pure state transitions driven by two inputs on each tick:
 *   - diffPsi:  differential pressure across the filter (inlet − outlet)
 *   - relayBit: 0/1 hardware bit reporting the backwash solenoid state
 *
 * State flow:
 *   MONITORING → TRIGGERED → FLUSHING → COMPLETE → MONITORING
 *
 * Extracted from scripts/filter-bridge.js so the state transitions can be
 * unit tested without opening a serial port.
 */

export function createBackwashState() {
  return {
    state:            'MONITORING',
    relay_on:         false,
    triggered_at:     null,
    last_complete_at: null,
  }
}

export function tickBackwash(bw, diffPsi, relayBit, triggerPsi, now = Date.now()) {
  if (relayBit === 1 || diffPsi >= triggerPsi) {
    if (bw.state === 'MONITORING') {
      bw.state = 'TRIGGERED'
      bw.triggered_at = now
    } else if (bw.state === 'TRIGGERED') {
      bw.state = 'FLUSHING'
      bw.relay_on = true
    }
  } else {
    if (bw.state === 'FLUSHING' || bw.state === 'TRIGGERED') {
      bw.state = 'COMPLETE'
      bw.relay_on = false
      bw.last_complete_at = now
    } else if (bw.state === 'COMPLETE') {
      bw.state = 'MONITORING'
    }
  }

  return {
    state:                 bw.state,
    relay_on:              bw.relay_on,
    elapsed_sec:           bw.triggered_at     ? Math.round((now - bw.triggered_at)     / 1000) : 0,
    last_complete_ago_sec: bw.last_complete_at ? Math.round((now - bw.last_complete_at) / 1000) : null,
  }
}

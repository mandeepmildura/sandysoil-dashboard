/**
 * KCS firmware device registry.
 *
 * Adding a new relay controller = append one entry here.
 * Routes, nav, MQTT subscriptions, and the RelayDevice page all
 * derive from this list automatically — no other files need editing.
 *
 * Optional fields:
 *   pressureConfig  — renders pressure gauge + logging (A6v3-style)
 *   pollConfig      — DAC toggle trick to force STATE response (A6v3-style)
 *
 * Future extension:
 *   sensors: [{ key, type, label, unit }]  — water meters, soil moisture, etc.
 */
export const KCS_DEVICES = [
  {
    // ── A6v3 6-channel relay controller ──────────────────────────────
    id:          'a6v3',
    name:        'A6v3 Controller',
    serial:      '8CBFEA03002C',
    navLabel:    'A6v3',
    path:        '/a6v3',
    stateTopic:  'A6v3/8CBFEA03002C/STATE',
    cmdTopic:    'A6v3/8CBFEA03002C/SET',
    outputCount: 6,
    inputCount:  6,
    adcCount:    4,

    // Pressure gauge: ADC1 → PSI (0–116 range)
    pressureConfig: {
      adcKey:    'adc1',
      maxPsi:    116,
      logColumn: 'a6v3_ch1_psi',  // column in pressure_log table
    },

    // DAC toggle forces a STATE response with fresh ADC values
    pollConfig: {
      dacKey:   'dac1',
      idleMs:   60_000,   // poll every 60 s when all relays off
      activeMs: 5_000,    // poll every 5 s when any relay on
    },
  },

  {
    // ── B16M 16-channel MOSFET board ─────────────────────────────────
    id:          'b16m',
    name:        'B16M Controller',
    serial:      'CCBA97071FD8',
    navLabel:    'B16M',
    path:        '/b16m',
    stateTopic:  'B16M/CCBA97071FD8/STATE',
    cmdTopic:    'B16M/CCBA97071FD8/SET',
    outputCount: 16,
    inputCount:  16,
    adcCount:    4,
    // no pressureConfig — no pressure sensor connected
    // no pollConfig    — B16M responds to commands without polling
  },
]

/** Look up a device by its id string (matches zone_history.device). */
export function findDevice(id) {
  return KCS_DEVICES.find(d => d.id === id) ?? null
}

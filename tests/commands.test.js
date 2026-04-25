import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the MQTT + Supabase modules before importing commands.js
const mqttPublish = vi.fn()
let mqttCache = {}

vi.mock('../src/lib/mqttClient', () => ({
  mqttPublish: (...args) => mqttPublish(...args),
  getMqttCache: () => mqttCache,
}))

// Build a chainable fake that records every terminal insert / update / select.
// Each table gets its own recorder so tests can assert against specific tables.
const sb = { inserts: [], updates: [], selects: [] }
function tableApi(name) {
  const api = {
    insert: vi.fn((row) => {
      sb.inserts.push({ table: name, row })
      return Promise.resolve({ error: null })
    }),
    update: vi.fn((patch) => {
      const chain = {
        eq: vi.fn(() => {
          sb.updates.push({ table: name, patch })
          return Promise.resolve({ error: null })
        }),
      }
      return chain
    }),
    // Select chain: select().eq().eq().is().order().limit()
    select: vi.fn(() => {
      const rec = { table: name, filters: {} }
      sb.selects.push(rec)
      const chain = {
        eq:    vi.fn((col, v) => { rec.filters[col] = v; return chain }),
        is:    vi.fn((col, v) => { rec.filters[`${col}__is`] = v; return chain }),
        order: vi.fn(() => chain),
        limit: vi.fn(() => Promise.resolve({ data: sb.nextSelectRows ?? [], error: null })),
      }
      return chain
    }),
  }
  return api
}

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (name) => tableApi(name),
  },
}))

// Now the subject under test
import {
  durationToMinutes,
  psiSnapshot,
  zoneOn,
  zoneOff,
  allZonesOff,
  a6v3ZoneOn,
  a6v3ZoneOff,
  relayOn,
  relayOff,
  B16M_SET_TOPIC,
  A6V3_SET_TOPIC,
} from '../src/lib/commands'

beforeEach(() => {
  mqttPublish.mockClear()
  mqttCache = {}
  sb.inserts.length = 0
  sb.updates.length = 0
  sb.selects.length = 0
  sb.nextSelectRows = []
})

describe('durationToMinutes', () => {
  it('maps labeled strings to the correct minute value', () => {
    expect(durationToMinutes('15 min')).toBe(15)
    expect(durationToMinutes('30 min')).toBe(30)
    expect(durationToMinutes('1 hour')).toBe(60)
  })

  it('defaults to 30 for anything unknown', () => {
    expect(durationToMinutes('')).toBe(30)
    expect(durationToMinutes(null)).toBe(30)
    expect(durationToMinutes('2 hours')).toBe(30)
    expect(durationToMinutes('45 min')).toBe(30)
  })
})

describe('psiSnapshot', () => {
  it('returns both nulls when the cache is empty', () => {
    expect(psiSnapshot({})).toEqual({ supplyPsi: null, a6v3Psi: null })
  })

  it('reads supply_psi from the irrigation1 status payload, rounded to 2dp', () => {
    const cache = { 'farm/irrigation1/status': { supply_psi: 35.3456 } }
    expect(psiSnapshot(cache).supplyPsi).toBe(35.35)
  })

  it('converts A6v3 adc1 raw (0–4095) to PSI (0–116 range), rounded to 2dp', () => {
    // 2048 / 4095 * 116 = 58.0146... → 58.01
    expect(psiSnapshot({ 'A6v3/8CBFEA03002C/STATE': { adc1: { value: 2048 } } }).a6v3Psi).toBe(58.01)
    // 4095 / 4095 * 116 = 116.00
    expect(psiSnapshot({ 'A6v3/8CBFEA03002C/STATE': { adc1: { value: 4095 } } }).a6v3Psi).toBe(116)
    // 0 / 4095 * 116 = 0
    expect(psiSnapshot({ 'A6v3/8CBFEA03002C/STATE': { adc1: { value: 0 } } }).a6v3Psi).toBe(0)
  })

  it('returns null when the ADC value is missing', () => {
    const cache = { 'A6v3/8CBFEA03002C/STATE': { adc1: {} } }
    expect(psiSnapshot(cache).a6v3Psi).toBeNull()
  })

  it('falls back to getMqttCache() when no argument is passed', () => {
    mqttCache = { 'farm/irrigation1/status': { supply_psi: 10 } }
    expect(psiSnapshot().supplyPsi).toBe(10)
  })
})

describe('zone commands (8-zone irrigation controller)', () => {
  it('zoneOn publishes the on command and writes a zone_history start row', async () => {
    await zoneOn(3, 20, 'manual')
    expect(mqttPublish).toHaveBeenCalledWith('farm/irrigation1/zone/3/cmd', { cmd: 'on', duration: 20 })
    const insert = sb.inserts.find(i => i.table === 'zone_history')
    expect(insert).toBeDefined()
    expect(insert.row).toMatchObject({ zone_num: 3, source: 'manual', device: 'irrigation1' })
    expect(insert.row.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('zoneOff publishes off and looks up the most recent open history row', async () => {
    sb.nextSelectRows = [{ id: 'abc' }]
    await zoneOff(2)
    expect(mqttPublish).toHaveBeenCalledWith('farm/irrigation1/zone/2/cmd', { cmd: 'off' })
    expect(sb.selects[0].filters).toMatchObject({ zone_num: 2, device: 'irrigation1', ended_at__is: null })
    // When a row is returned, an update fires to set ended_at
    expect(sb.updates).toHaveLength(1)
    expect(sb.updates[0].patch).toHaveProperty('ended_at')
  })

  it('zoneOff does not issue an update when no open history row exists', async () => {
    sb.nextSelectRows = []
    await zoneOff(2)
    expect(sb.updates).toHaveLength(0)
  })

  it('allZonesOff publishes an off for every zone 1..8', async () => {
    await allZonesOff()
    const topics = mqttPublish.mock.calls.map(c => c[0])
    expect(topics).toEqual([
      'farm/irrigation1/zone/1/cmd',
      'farm/irrigation1/zone/2/cmd',
      'farm/irrigation1/zone/3/cmd',
      'farm/irrigation1/zone/4/cmd',
      'farm/irrigation1/zone/5/cmd',
      'farm/irrigation1/zone/6/cmd',
      'farm/irrigation1/zone/7/cmd',
      'farm/irrigation1/zone/8/cmd',
    ])
    for (const call of mqttPublish.mock.calls) {
      expect(call[1]).toEqual({ cmd: 'off' })
    }
  })
})

describe('A6v3 commands', () => {
  it('a6v3ZoneOn publishes output1:true and inserts a6v3 history row', async () => {
    await a6v3ZoneOn(1, 15, 'schedule')
    expect(mqttPublish).toHaveBeenCalledWith(A6V3_SET_TOPIC, { output1: { value: true } })
    const insert = sb.inserts.find(i => i.table === 'zone_history')
    expect(insert.row).toMatchObject({ zone_num: 1, source: 'schedule', device: 'a6v3' })
  })

  it('a6v3ZoneOff publishes output4:false and closes the a6v3 open row', async () => {
    sb.nextSelectRows = [{ id: 'xyz' }]
    await a6v3ZoneOff(4)
    expect(mqttPublish).toHaveBeenCalledWith(A6V3_SET_TOPIC, { output4: { value: false } })
    expect(sb.selects[0].filters).toMatchObject({ zone_num: 4, device: 'a6v3' })
    expect(sb.updates).toHaveLength(1)
  })
})

describe('generic KCS relay commands', () => {
  const cfg = { id: 'b16m', cmdTopic: B16M_SET_TOPIC }

  it('relayOn publishes the right topic and writes history keyed to the device id', async () => {
    await relayOn(cfg, 7, 'manual')
    expect(mqttPublish).toHaveBeenCalledWith(B16M_SET_TOPIC, { output7: { value: true } })
    const insert = sb.inserts.find(i => i.table === 'zone_history')
    expect(insert.row).toMatchObject({ zone_num: 7, device: 'b16m', source: 'manual' })
  })

  it('relayOff publishes output:false and closes the matching open history row', async () => {
    sb.nextSelectRows = [{ id: 'hist1' }]
    await relayOff(cfg, 7)
    expect(mqttPublish).toHaveBeenCalledWith(B16M_SET_TOPIC, { output7: { value: false } })
    expect(sb.selects[0].filters).toMatchObject({ zone_num: 7, device: 'b16m' })
  })
})

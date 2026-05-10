import { describe, it, expect, beforeEach } from 'vitest'
import { createBackwashState, tickBackwash } from '../scripts/lib/backwash.js'

const TRIGGER = 8

describe('backwash FSM', () => {
  let bw

  beforeEach(() => {
    bw = createBackwashState()
  })

  it('starts in MONITORING with no relay and no timestamps', () => {
    expect(bw).toEqual({
      state:            'MONITORING',
      relay_on:         false,
      triggered_at:     null,
      last_complete_at: null,
    })
  })

  it('stays in MONITORING while diff is below threshold and relay is off', () => {
    const out = tickBackwash(bw, 3, 0, TRIGGER, 1_000)
    expect(out.state).toBe('MONITORING')
    expect(out.relay_on).toBe(false)
    expect(out.elapsed_sec).toBe(0)
    expect(out.last_complete_ago_sec).toBeNull()
  })

  it('transitions MONITORING → TRIGGERED when diff crosses threshold', () => {
    const out = tickBackwash(bw, TRIGGER, 0, TRIGGER, 10_000)
    expect(out.state).toBe('TRIGGERED')
    expect(out.relay_on).toBe(false)
    expect(bw.triggered_at).toBe(10_000)
  })

  it('transitions MONITORING → TRIGGERED when relay bit is 1 even if diff is low', () => {
    const out = tickBackwash(bw, 0, 1, TRIGGER, 10_000)
    expect(out.state).toBe('TRIGGERED')
  })

  it('transitions TRIGGERED → FLUSHING on next tick while trigger condition holds', () => {
    tickBackwash(bw, 10, 0, TRIGGER, 10_000)
    const out = tickBackwash(bw, 10, 0, TRIGGER, 11_000)
    expect(out.state).toBe('FLUSHING')
    expect(out.relay_on).toBe(true)
    expect(out.elapsed_sec).toBe(1)
  })

  it('reports elapsed_sec from triggered_at, not from tick start', () => {
    tickBackwash(bw, 10, 0, TRIGGER, 100_000)
    const out = tickBackwash(bw, 10, 0, TRIGGER, 145_000)
    // triggered @ 100s, now @ 145s → elapsed 45s
    expect(out.elapsed_sec).toBe(45)
  })

  it('transitions FLUSHING → COMPLETE once trigger condition clears', () => {
    tickBackwash(bw, 10, 0, TRIGGER, 10_000)  // MONITORING → TRIGGERED
    tickBackwash(bw, 10, 0, TRIGGER, 11_000)  // TRIGGERED → FLUSHING
    const out = tickBackwash(bw, 2, 0, TRIGGER, 30_000)
    expect(out.state).toBe('COMPLETE')
    expect(out.relay_on).toBe(false)
    expect(bw.last_complete_at).toBe(30_000)
  })

  it('transitions TRIGGERED → COMPLETE if trigger clears before FLUSHING was reached', () => {
    tickBackwash(bw, 10, 0, TRIGGER, 10_000)  // MONITORING → TRIGGERED
    const out = tickBackwash(bw, 2, 0, TRIGGER, 20_000)
    expect(out.state).toBe('COMPLETE')
  })

  it('transitions COMPLETE → MONITORING on a clean tick', () => {
    tickBackwash(bw, 10, 0, TRIGGER, 10_000)
    tickBackwash(bw, 10, 0, TRIGGER, 11_000)
    tickBackwash(bw, 2,  0, TRIGGER, 30_000) // → COMPLETE
    const out = tickBackwash(bw, 2, 0, TRIGGER, 40_000)
    expect(out.state).toBe('MONITORING')
    expect(out.last_complete_ago_sec).toBe(10)
  })

  it('retains last_complete_ago_sec once a cycle has finished', () => {
    tickBackwash(bw, 10, 0, TRIGGER, 0)
    tickBackwash(bw, 10, 0, TRIGGER, 1_000)
    tickBackwash(bw, 2,  0, TRIGGER, 5_000)     // COMPLETE
    tickBackwash(bw, 2,  0, TRIGGER, 6_000)     // MONITORING
    const out = tickBackwash(bw, 2, 0, TRIGGER, 65_000)
    expect(out.state).toBe('MONITORING')
    expect(out.last_complete_ago_sec).toBe(60)
  })

  it('full cycle: MONITORING → TRIGGERED → FLUSHING → COMPLETE → MONITORING', () => {
    const seq = []
    seq.push(tickBackwash(bw, 0,  0, TRIGGER, 0).state)
    seq.push(tickBackwash(bw, 9,  0, TRIGGER, 1_000).state)
    seq.push(tickBackwash(bw, 9,  0, TRIGGER, 2_000).state)
    seq.push(tickBackwash(bw, 1,  0, TRIGGER, 3_000).state)
    seq.push(tickBackwash(bw, 1,  0, TRIGGER, 4_000).state)
    expect(seq).toEqual(['MONITORING', 'TRIGGERED', 'FLUSHING', 'COMPLETE', 'MONITORING'])
  })

  it('treats relay bit values other than 1 as "off"', () => {
    // Only strict === 1 should count as the relay being on
    const out = tickBackwash(bw, 0, 2, TRIGGER, 0)
    expect(out.state).toBe('MONITORING')
  })
})

import { describe, it, expect } from 'vitest'
import {
  expandSteps,
  type Step,
} from '../supabase/functions/run-schedules/lib/expandSteps.ts'

const BASE = new Date('2026-04-21T06:00:00.000Z').getTime()

function step(partial: Partial<Step>): Step {
  return {
    zone_num:    1,
    duration_min: 10,
    sort_order:  0,
    step_type:   'on',
    delay_min:   null,
    device:      'irrigation1',
    ...partial,
  }
}

describe('expandSteps', () => {
  it('returns an empty array for an empty step list', () => {
    expect(expandSteps('g1', 'sequential', [], BASE)).toEqual([])
  })

  it('walks steps in sort_order, not array order', () => {
    const rows = expandSteps('g1', 'parallel', [
      step({ zone_num: 2, sort_order: 1 }),
      step({ zone_num: 1, sort_order: 0 }),
    ], BASE)
    expect(rows.map(r => r.zone_num)).toEqual([1, 2])
  })

  it('parallel mode fires every step at the base time', () => {
    const rows = expandSteps('g1', 'parallel', [
      step({ zone_num: 1, sort_order: 0, duration_min: 5 }),
      step({ zone_num: 2, sort_order: 1, duration_min: 15 }),
    ], BASE)
    expect(rows).toHaveLength(2)
    expect(rows[0].fire_at).toBe(new Date(BASE).toISOString())
    expect(rows[1].fire_at).toBe(new Date(BASE).toISOString())
  })

  it('sequential mode advances the cursor by each on step duration', () => {
    const rows = expandSteps('g1', 'sequential', [
      step({ zone_num: 1, sort_order: 0, duration_min: 5 }),
      step({ zone_num: 2, sort_order: 1, duration_min: 10 }),
    ], BASE)
    expect(rows).toHaveLength(2)
    expect(rows[0].fire_at).toBe(new Date(BASE).toISOString())
    expect(rows[1].fire_at).toBe(new Date(BASE + 5 * 60_000).toISOString())
  })

  it('delay steps advance the cursor and do not emit a row', () => {
    const rows = expandSteps('g1', 'sequential', [
      step({ zone_num: 1, sort_order: 0, duration_min: 5 }),
      step({ sort_order: 1, step_type: 'delay', delay_min: 3, zone_num: 0, duration_min: null }),
      step({ zone_num: 2, sort_order: 2, duration_min: 7 }),
    ], BASE)
    expect(rows).toHaveLength(2)
    expect(rows[1].fire_at).toBe(new Date(BASE + (5 + 3) * 60_000).toISOString())
  })

  it('emits an explicit off row for a6v3 on steps with a duration', () => {
    const rows = expandSteps('g1', 'parallel', [
      step({ zone_num: 3, sort_order: 0, duration_min: 12, device: 'a6v3' }),
    ], BASE)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ step_type: 'on',  device: 'a6v3', zone_num: 3 })
    expect(rows[1]).toMatchObject({ step_type: 'off', device: 'a6v3', zone_num: 3, duration_min: null })
    expect(rows[1].fire_at).toBe(new Date(BASE + 12 * 60_000).toISOString())
  })

  it('does not emit an off row for a6v3 on steps with zero / null duration', () => {
    const rows = expandSteps('g1', 'parallel', [
      step({ zone_num: 1, sort_order: 0, duration_min: 0,    device: 'a6v3' }),
      step({ zone_num: 2, sort_order: 1, duration_min: null, device: 'a6v3' }),
    ], BASE)
    expect(rows.filter(r => r.step_type === 'off')).toHaveLength(0)
  })

  it('does not emit an off row for irrigation1 — that firmware auto-offs itself', () => {
    const rows = expandSteps('g1', 'parallel', [
      step({ zone_num: 1, sort_order: 0, duration_min: 5, device: 'irrigation1' }),
    ], BASE)
    expect(rows).toHaveLength(1)
    expect(rows[0].step_type).toBe('on')
  })

  it('sequential a6v3 on: cursor advances by duration and off row sits at end of that window', () => {
    const rows = expandSteps('g1', 'sequential', [
      step({ zone_num: 1, sort_order: 0, duration_min: 10, device: 'a6v3' }),
      step({ zone_num: 2, sort_order: 1, duration_min: 5,  device: 'a6v3' }),
    ], BASE)
    // Expected: on1 @ 0, off1 @ 10, on2 @ 10, off2 @ 15
    expect(rows.map(r => `${r.step_type}${r.zone_num}@${new Date(r.fire_at).getTime() - BASE}`)).toEqual([
      'on1@0',
      `off1@${10 * 60_000}`,
      `on2@${10 * 60_000}`,
      `off2@${15 * 60_000}`,
    ])
  })

  it('null step_type defaults to on', () => {
    const rows = expandSteps('g1', 'parallel', [
      step({ zone_num: 1, sort_order: 0, step_type: null }),
    ], BASE)
    expect(rows[0].step_type).toBe('on')
  })

  it('null device defaults to irrigation1', () => {
    const rows = expandSteps('g1', 'parallel', [
      step({ zone_num: 1, sort_order: 0, device: null }),
    ], BASE)
    expect(rows[0].device).toBe('irrigation1')
    // irrigation1 should not get an auto-off row
    expect(rows).toHaveLength(1)
  })

  it('off steps do not advance the cursor in sequential mode', () => {
    const rows = expandSteps('g1', 'sequential', [
      step({ zone_num: 1, sort_order: 0, duration_min: 5 }),
      step({ zone_num: 1, sort_order: 1, step_type: 'off', duration_min: null }),
      step({ zone_num: 2, sort_order: 2, duration_min: 7 }),
    ], BASE)
    // on1 @ 0, off1 @ 5, on2 @ 5 (off doesn't advance cursor)
    expect(rows.map(r => new Date(r.fire_at).getTime() - BASE)).toEqual([
      0,
      5 * 60_000,
      5 * 60_000,
    ])
  })

  it('unknown device still gets queued but does not advance cursor in sequential', () => {
    const rows = expandSteps('g1', 'sequential', [
      step({ zone_num: 1, sort_order: 0, duration_min: 5, device: 'mystery' }),
      step({ zone_num: 2, sort_order: 1, duration_min: 7 }),
    ], BASE)
    // mystery fires at 0; cursor does not advance → irrigation1 also at 0
    expect(new Date(rows[0].fire_at).getTime()).toBe(BASE)
    expect(new Date(rows[1].fire_at).getTime()).toBe(BASE)
  })

  it('dedupes passing the same array reference — does not mutate input', () => {
    const steps: Step[] = [
      step({ zone_num: 2, sort_order: 1 }),
      step({ zone_num: 1, sort_order: 0 }),
    ]
    const snapshot = JSON.stringify(steps)
    expandSteps('g1', 'sequential', steps, BASE)
    expect(JSON.stringify(steps)).toBe(snapshot)
  })
})

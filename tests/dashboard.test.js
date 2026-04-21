import { describe, it, expect } from 'vitest'
import {
  fmtLastRun,
  bucketPressureBars,
  upcomingSchedules,
  diffPsi,
} from '../src/lib/dashboard'

describe('fmtLastRun', () => {
  const now = new Date('2026-04-21T12:00:00Z').getTime()

  it('returns "No runs yet" for null / empty', () => {
    expect(fmtLastRun(null, now)).toBe('No runs yet')
    expect(fmtLastRun('',   now)).toBe('No runs yet')
  })

  it('reports minutes for anything under an hour, minimum 1m', () => {
    expect(fmtLastRun('2026-04-21T11:40:00Z', now)).toBe('20m ago')
    expect(fmtLastRun('2026-04-21T11:59:30Z', now)).toBe('1m ago')   // 30s → still 1m floor
  })

  it('reports hours between 1h and 23h', () => {
    expect(fmtLastRun('2026-04-21T09:00:00Z', now)).toBe('3h ago')
    expect(fmtLastRun('2026-04-20T13:00:00Z', now)).toBe('23h ago')
  })

  it('reports "Yesterday" between 24h and 47h', () => {
    expect(fmtLastRun('2026-04-20T10:00:00Z', now)).toBe('Yesterday')
    expect(fmtLastRun('2026-04-19T13:00:00Z', now)).toBe('Yesterday')
  })

  it('reports days for anything 48h+', () => {
    expect(fmtLastRun('2026-04-19T12:00:00Z', now)).toBe('2 days ago')
    expect(fmtLastRun('2026-04-14T12:00:00Z', now)).toBe('7 days ago')
  })
})

describe('bucketPressureBars', () => {
  it('returns empty array for null / empty / all non-numeric input', () => {
    expect(bucketPressureBars(null)).toEqual([])
    expect(bucketPressureBars([])).toEqual([])
    expect(bucketPressureBars(['nope', null, NaN])).toEqual([])
  })

  it('coerces string numbers (pressure_log returns strings)', () => {
    const bars = bucketPressureBars(['40', '50', '60'])
    expect(bars.length).toBeGreaterThan(0)
    expect(bars.every(v => v >= 10 && v <= 100)).toBe(true)
  })

  it('normalises the peak to 100', () => {
    // 15 evenly-spaced values — peak should map to 100
    const vals = Array.from({ length: 15 }, (_, i) => (i + 1) * 10)
    const bars = bucketPressureBars(vals)
    expect(Math.max(...bars)).toBe(100)
  })

  it('enforces a minimum height of 10 so tiny values remain visible', () => {
    const bars = bucketPressureBars([100, 0.1, 0.1, 0.1])
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(10)
  })

  it('reverses bars so the most recent reading ends up on the right', () => {
    // Input is most-recent-first from DB; output should be oldest-first.
    // Given [100, 10, 10, 10] with bucket=1: [100,10,10,10] averaged,
    // then reversed and normalised → last bar corresponds to the first (100) input.
    const bars = bucketPressureBars([100, 10, 10, 10])
    expect(bars[bars.length - 1]).toBe(100)
  })
})

describe('upcomingSchedules', () => {
  // Freeze "now" to Tuesday 2026-04-21 14:30 (JS day index 2).
  const now = new Date('2026-04-21T14:30:00')

  it('returns [] for null / empty input', () => {
    expect(upcomingSchedules(null, now)).toEqual([])
    expect(upcomingSchedules([], now)).toEqual([])
  })

  it('drops disabled schedules', () => {
    const out = upcomingSchedules([
      { id: 'a', days_of_week: [2], start_time: '06:00:00', enabled: false, zone_groups: { name: 'P' } },
    ], now)
    expect(out).toEqual([])
  })

  it('picks the earliest future occurrence in the same week', () => {
    // Today is Tue (2). A schedule for [Mon, Thu] picks Thu (4) → 2 days ahead.
    const out = upcomingSchedules([
      { id: 'a', days_of_week: [1, 4], start_time: '06:30:00', zone_groups: { name: 'Alfa', zone_group_members: [] } },
    ], now)
    expect(out).toHaveLength(1)
    expect(out[0].month).toBe('Apr')
    expect(out[0].day).toBe(23)
    expect(out[0].time).toBe('06:30')
    expect(out[0].name).toBe('Alfa')
  })

  it('wraps to next week when no day is >= today', () => {
    // Today is Tue (2). A schedule for [Mon] wraps to next Monday → 6 days ahead.
    const out = upcomingSchedules([
      { id: 'a', days_of_week: [1], start_time: '07:00:00', zone_groups: { name: 'Beta', zone_group_members: [] } },
    ], now)
    expect(out[0].day).toBe(27) // Apr 27
  })

  it('picks today when today is in days_of_week', () => {
    const out = upcomingSchedules([
      { id: 'a', days_of_week: [2], start_time: '06:00:00', zone_groups: { name: 'G' } },
    ], now)
    expect(out[0].day).toBe(21)
  })

  it('sums member durations, defaulting each missing duration_min to 30', () => {
    const out = upcomingSchedules([
      { id: 'a', days_of_week: [2], start_time: '06:00:00', zone_groups: {
        name: 'G',
        zone_group_members: [{ duration_min: 10 }, { duration_min: 20 }, {}],
      } },
    ], now)
    expect(out[0].durationMin).toBe(60) // 10 + 20 + default 30
  })

  it('falls back to "Program" when zone_groups has no name', () => {
    const out = upcomingSchedules([
      { id: 'a', days_of_week: [2], start_time: '06:00:00' },
    ], now)
    expect(out[0].name).toBe('Program')
  })

  it('respects the limit argument (default 3)', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`, days_of_week: [2], start_time: '06:00:00',
      zone_groups: { name: `G${i}` },
    }))
    expect(upcomingSchedules(many, now)).toHaveLength(3)
    expect(upcomingSchedules(many, now, 5)).toHaveLength(5)
  })
})

describe('diffPsi', () => {
  it('returns null when nothing is computable', () => {
    expect(diffPsi(null)).toBeNull()
    expect(diffPsi({})).toBeNull()
    expect(diffPsi({ inlet_psi: 40 })).toBeNull()
  })

  it('prefers a pre-computed differential_psi', () => {
    expect(diffPsi({ differential_psi: 3.2, inlet_psi: 40, outlet_psi: 30 })).toBe(3.2)
  })

  it('computes inlet - outlet rounded to 1dp', () => {
    expect(diffPsi({ inlet_psi: 45.27, outlet_psi: 40.11 })).toBe(5.2)
  })

  it('returns null when either leg is not a number', () => {
    expect(diffPsi({ inlet_psi: '45', outlet_psi: 30 })).toBeNull()
    expect(diffPsi({ inlet_psi: 45, outlet_psi: null })).toBeNull()
  })
})

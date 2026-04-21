import { describe, it, expect } from 'vitest'
import {
  dbDayToCalIdx,
  getWeekMonday,
  fmtTime,
  fmtDuration,
  fmtDays,
  totalDuration,
} from '../src/lib/calendar'

describe('dbDayToCalIdx', () => {
  it('maps Sun (DB=0) to the last column (idx 6)', () => {
    expect(dbDayToCalIdx(0)).toBe(6)
  })

  it('maps Mon–Sat (DB=1..6) to idx 0..5', () => {
    expect(dbDayToCalIdx(1)).toBe(0)
    expect(dbDayToCalIdx(2)).toBe(1)
    expect(dbDayToCalIdx(3)).toBe(2)
    expect(dbDayToCalIdx(4)).toBe(3)
    expect(dbDayToCalIdx(5)).toBe(4)
    expect(dbDayToCalIdx(6)).toBe(5)
  })
})

describe('getWeekMonday', () => {
  it('returns the same day when given a Monday', () => {
    // 2026-04-20 is a Monday
    const m = getWeekMonday(new Date('2026-04-20T09:00:00'))
    expect(m.getDay()).toBe(1)
    expect(m.getDate()).toBe(20)
  })

  it('returns the previous Monday when given a mid-week day', () => {
    // 2026-04-22 is a Wednesday
    const m = getWeekMonday(new Date('2026-04-22T14:30:00'))
    expect(m.getDay()).toBe(1)
    expect(m.getDate()).toBe(20)
  })

  it('returns the previous Monday when given a Sunday (DB day 0)', () => {
    // 2026-04-26 is a Sunday — Monday of that week is 2026-04-20
    const m = getWeekMonday(new Date('2026-04-26T10:00:00'))
    expect(m.getDay()).toBe(1)
    expect(m.getDate()).toBe(20)
  })

  it('normalizes to local midnight', () => {
    const m = getWeekMonday(new Date('2026-04-22T14:30:45.123'))
    expect(m.getHours()).toBe(0)
    expect(m.getMinutes()).toBe(0)
    expect(m.getSeconds()).toBe(0)
    expect(m.getMilliseconds()).toBe(0)
  })

  it('crosses month boundaries correctly', () => {
    // 2026-05-03 is a Sunday — the Monday of that week is 2026-04-27
    const m = getWeekMonday(new Date('2026-05-03T12:00:00'))
    expect(m.getMonth()).toBe(3) // April (0-indexed)
    expect(m.getDate()).toBe(27)
  })

  it('does not mutate its input', () => {
    const src = new Date('2026-04-22T14:30:45')
    const snapshot = src.getTime()
    getWeekMonday(src)
    expect(src.getTime()).toBe(snapshot)
  })
})

describe('fmtTime', () => {
  it('truncates seconds from HH:MM:SS', () => {
    expect(fmtTime('06:30:00')).toBe('06:30')
  })

  it('returns em-dash for null / empty', () => {
    expect(fmtTime(null)).toBe('—')
    expect(fmtTime('')).toBe('—')
  })
})

describe('fmtDuration', () => {
  it('renders <60 min as "N min"', () => {
    expect(fmtDuration(5)).toBe('5 min')
    expect(fmtDuration(45)).toBe('45 min')
  })

  it('renders exactly 60 min as "1h"', () => {
    expect(fmtDuration(60)).toBe('1h')
  })

  it('renders whole hours with no minutes', () => {
    expect(fmtDuration(120)).toBe('2h')
  })

  it('renders hours + minutes', () => {
    expect(fmtDuration(90)).toBe('1h 30m')
    expect(fmtDuration(125)).toBe('2h 5m')
  })

  it('handles 0 correctly', () => {
    expect(fmtDuration(0)).toBe('0 min')
  })
})

describe('fmtDays', () => {
  it('renders empty / null days as "No days"', () => {
    expect(fmtDays([])).toBe('No days')
    expect(fmtDays(null)).toBe('No days')
    expect(fmtDays(undefined)).toBe('No days')
  })

  it('maps DB day numbers to short names in order', () => {
    expect(fmtDays([1, 3, 5])).toBe('Mon, Wed, Fri')
    expect(fmtDays([0])).toBe('Sun')
    expect(fmtDays([6])).toBe('Sat')
  })

  it('falls back to the raw value for out-of-range day numbers', () => {
    expect(fmtDays([9])).toBe('9')
  })
})

describe('totalDuration', () => {
  it('returns 0 for a program with no zones', () => {
    expect(totalDuration({ run_mode: 'sequential', zones: [] })).toBe(0)
    expect(totalDuration({ run_mode: 'parallel' })).toBe(0)
  })

  it('sums durations for sequential programs', () => {
    const p = { run_mode: 'sequential', zones: [
      { duration_min: 10 }, { duration_min: 20 }, { duration_min: 5 },
    ] }
    expect(totalDuration(p)).toBe(35)
  })

  it('takes the maximum for parallel programs', () => {
    const p = { run_mode: 'parallel', zones: [
      { duration_min: 10 }, { duration_min: 20 }, { duration_min: 5 },
    ] }
    expect(totalDuration(p)).toBe(20)
  })

  it('treats anything non-sequential as parallel (max)', () => {
    const p = { run_mode: undefined, zones: [{ duration_min: 7 }, { duration_min: 3 }] }
    expect(totalDuration(p)).toBe(7)
  })
})

import { describe, it, expect } from 'vitest'
import {
  localDateStr,
  fmtTime,
  fmtDateLabel,
  fmtRelative,
  fmtDuration,
  fmtDurMin,
  fmtUptime,
  minutesFromMidnight,
  timeStrToMinutes,
  pct,
  fmtEvent,
} from '../src/lib/format'

describe('localDateStr', () => {
  it('formats as YYYY-MM-DD with zero-padded month and day', () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localDateStr(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('defaults to today', () => {
    expect(localDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('fmtTime (D/M HH:MM)', () => {
  it('returns em-dash for null / empty', () => {
    expect(fmtTime(null)).toBe('—')
    expect(fmtTime('')).toBe('—')
  })

  it('formats a timestamp with zero-padded hours and minutes, unpadded day/month', () => {
    const iso = new Date(2026, 3, 5, 7, 3, 0).toISOString()
    expect(fmtTime(iso)).toBe('5/4 07:03')
  })
})

describe('fmtDateLabel', () => {
  // Pin "now" to 2026-04-21 14:30 local
  const now = new Date(2026, 3, 21, 14, 30, 0)

  it('returns "Today" for the current date', () => {
    expect(fmtDateLabel('2026-04-21', now)).toBe('Today')
  })

  it('returns "Yesterday" for one day back', () => {
    expect(fmtDateLabel('2026-04-20', now)).toBe('Yesterday')
  })

  it('returns a long-form localised date for older days', () => {
    const label = fmtDateLabel('2026-04-10', now)
    expect(label).toMatch(/2026/)
    expect(label).not.toBe('Today')
    expect(label).not.toBe('Yesterday')
  })

  it('also renders future dates in long form', () => {
    const label = fmtDateLabel('2026-05-01', now)
    expect(label).not.toBe('Today')
    expect(label).not.toBe('Yesterday')
  })
})

describe('fmtRelative', () => {
  const now = new Date('2026-04-21T12:00:00Z').getTime()

  it('returns em-dash for null / empty', () => {
    expect(fmtRelative(null, now)).toBe('—')
    expect(fmtRelative('', now)).toBe('—')
  })

  it('returns "Just now" for anything under 2 minutes', () => {
    expect(fmtRelative('2026-04-21T11:59:01Z', now)).toBe('Just now')
    expect(fmtRelative('2026-04-21T11:58:01Z', now)).toBe('Just now')
  })

  it('returns "Nm ago" in the 2-59 minute range', () => {
    expect(fmtRelative('2026-04-21T11:55:00Z', now)).toBe('5m ago')
    expect(fmtRelative('2026-04-21T11:01:00Z', now)).toBe('59m ago')
  })

  it('returns "Nh ago" in the 1-23 hour range', () => {
    expect(fmtRelative('2026-04-21T09:00:00Z', now)).toBe('3h ago')
    expect(fmtRelative('2026-04-20T13:00:00Z', now)).toBe('23h ago')
  })

  it('falls back to a localised date for 24h+ ago', () => {
    const s = fmtRelative('2026-04-10T12:00:00Z', now)
    expect(s).not.toMatch(/ago|Just now/)
    expect(s.length).toBeGreaterThan(0)
  })
})

describe('fmtDuration (decimal minutes)', () => {
  it('returns em-dash for null / undefined / non-finite', () => {
    expect(fmtDuration(null)).toBe('—')
    expect(fmtDuration(undefined)).toBe('—')
    expect(fmtDuration('not a number')).toBe('—')
  })

  it('renders sub-minute values as seconds (rounded)', () => {
    expect(fmtDuration(0.5)).toBe('30s')
    expect(fmtDuration(0.25)).toBe('15s')
    expect(fmtDuration(0.999)).toBe('60s')
  })

  it('renders 1+ min with one decimal place', () => {
    expect(fmtDuration(1)).toBe('1.0 min')
    expect(fmtDuration(2.345)).toBe('2.3 min')
  })

  it('accepts numeric strings', () => {
    expect(fmtDuration('5')).toBe('5.0 min')
  })
})

describe('fmtDurMin (integer minutes)', () => {
  it('collapses zero / falsy / < 1 to "< 1 min"', () => {
    expect(fmtDurMin(0)).toBe('< 1 min')
    expect(fmtDurMin(null)).toBe('< 1 min')
    expect(fmtDurMin(0.3)).toBe('< 1 min')
  })

  it('rounds sub-hour values to whole minutes', () => {
    expect(fmtDurMin(1)).toBe('1 min')
    expect(fmtDurMin(45.4)).toBe('45 min')
    expect(fmtDurMin(59.3)).toBe('59 min')
  })

  it('crosses into the hour branch once the rounded value hits 60', () => {
    // Rounding happens before the <60 check — so 59.6 → 60 → "1h"
    expect(fmtDurMin(59.6)).toBe('1h')
  })

  it('renders 60+ as hours, dropping trailing minutes when zero', () => {
    expect(fmtDurMin(60)).toBe('1h')
    expect(fmtDurMin(120)).toBe('2h')
  })

  it('renders hours + minutes for values between multiples of 60', () => {
    expect(fmtDurMin(90)).toBe('1h 30m')
    expect(fmtDurMin(125)).toBe('2h 5m')
  })
})

describe('fmtUptime', () => {
  it('returns em-dash for zero / null / undefined', () => {
    expect(fmtUptime(0)).toBe('—')
    expect(fmtUptime(null)).toBe('—')
    expect(fmtUptime(undefined)).toBe('—')
  })

  it('renders minutes only when under an hour', () => {
    expect(fmtUptime(60)).toBe('1m')
    expect(fmtUptime(300)).toBe('5m')
    expect(fmtUptime(3599)).toBe('59m')
  })

  it('renders hours + minutes for 1h+', () => {
    expect(fmtUptime(3600)).toBe('1h 0m')
    expect(fmtUptime(3660)).toBe('1h 1m')
    expect(fmtUptime(7265)).toBe('2h 1m')
  })
})

describe('minutesFromMidnight', () => {
  it('converts an ISO timestamp to fractional local minutes', () => {
    const iso = new Date(2026, 3, 21, 6, 30, 0).toISOString()
    expect(minutesFromMidnight(iso)).toBe(6 * 60 + 30)
  })

  it('includes seconds as a fractional part', () => {
    const iso = new Date(2026, 3, 21, 0, 0, 30).toISOString()
    expect(minutesFromMidnight(iso)).toBe(0.5)
  })
})

describe('timeStrToMinutes', () => {
  it('converts HH:MM to integer minutes', () => {
    expect(timeStrToMinutes('00:00')).toBe(0)
    expect(timeStrToMinutes('06:30')).toBe(390)
    expect(timeStrToMinutes('23:59')).toBe(23 * 60 + 59)
  })
})

describe('pct', () => {
  it('returns 0 for zero / missing denominator', () => {
    expect(pct(5, 0)).toBe(0)
    expect(pct(5, null)).toBe(0)
  })

  it('rounds to the nearest integer', () => {
    expect(pct(1, 3)).toBe(33)
    expect(pct(2, 3)).toBe(67)
    expect(pct(50, 100)).toBe(50)
  })
})

describe('fmtEvent', () => {
  const now = new Date('2026-04-21T12:00:00Z').getTime()

  it('labels a6v3 rows as "Relay N"', () => {
    const out = fmtEvent({ device: 'a6v3', zone_num: 3, started_at: '2026-04-21T11:55:00Z' }, now)
    expect(out.text).toBe('A6v3 · Relay 3 started')
    expect(out.time).toBe('5m ago')
  })

  it('labels b16m rows as "Relay N"', () => {
    const out = fmtEvent({ device: 'b16m', zone_num: 7, started_at: '2026-04-21T12:00:00Z' }, now)
    expect(out.text).toBe('B16M · Relay 7 started')
    expect(out.time).toBe('just now')
  })

  it('labels irrigation1 rows as "Zone N"', () => {
    const out = fmtEvent({ device: 'irrigation1', zone_num: 2, started_at: '2026-04-21T10:00:00Z' }, now)
    expect(out.text).toBe('Irrigation · Zone 2 started')
    expect(out.time).toBe('2h ago')
  })

  it('falls back to the raw device string for unknown devices', () => {
    const out = fmtEvent({ device: 'future-board', zone_num: 1, started_at: '2026-04-21T12:00:00Z' }, now)
    expect(out.text).toBe('future-board · Relay 1 started')
  })
})

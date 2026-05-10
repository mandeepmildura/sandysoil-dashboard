import { describe, it, expect } from 'vitest'
import { schedulesOverlap, fmtDuration, toMin } from '../src/lib/programUtils'

describe('schedulesOverlap', () => {
  it('returns false when no shared days', () => {
    const a = { start_time: '04:00', duration_min: 120, days_of_week: [1, 3] }
    const b = { start_time: '04:00', duration_min: 120, days_of_week: [2, 4] }
    expect(schedulesOverlap(a, b)).toBe(false)
  })

  it('returns true when same start time and shared day', () => {
    const a = { start_time: '04:00', duration_min: 120, days_of_week: [1] }
    const b = { start_time: '04:00', duration_min: 60,  days_of_week: [1] }
    expect(schedulesOverlap(a, b)).toBe(true)
  })

  it('returns false for back-to-back (no overlap)', () => {
    const a = { start_time: '04:00', duration_min: 120, days_of_week: [1] }
    const b = { start_time: '06:00', duration_min: 120, days_of_week: [1] }
    expect(schedulesOverlap(a, b)).toBe(false)
  })

  it('returns true for partial overlap', () => {
    const a = { start_time: '04:00', duration_min: 180, days_of_week: [1] }
    const b = { start_time: '06:00', duration_min: 120, days_of_week: [1] }
    expect(schedulesOverlap(a, b)).toBe(true)
  })
})

describe('fmtDuration', () => {
  it('shows minutes for < 60', () => { expect(fmtDuration(30)).toBe('30 min') })
  it('shows hours for exact hour', () => { expect(fmtDuration(120)).toBe('2h') })
  it('shows hours and minutes', () => { expect(fmtDuration(150)).toBe('2h 30m') })
})

import { describe, it, expect } from 'vitest'
import { pickDueSchedules, type Schedule } from '../supabase/functions/run-schedules/lib/pickDue.ts'

const TODAY = '2026-05-04'
const SUNDAY = 0
const MONDAY = 1

function sched(partial: Partial<Schedule>): Schedule {
  return {
    start_time:    '04:00:00',
    run_once_date: null,
    days_of_week:  [0, 1, 2, 3, 4, 5, 6],
    ...partial,
  }
}

describe('pickDueSchedules', () => {
  it('matches a schedule whose minute equals nowHHMM', () => {
    expect(pickDueSchedules([sched({})], '04:00', MONDAY, TODAY)).toHaveLength(1)
  })

  it('does NOT match a schedule whose minute differs', () => {
    expect(pickDueSchedules([sched({ start_time: '04:01:00' })], '04:00', MONDAY, TODAY))
      .toHaveLength(0)
  })

  // Regression: the previous PostgREST filter used `< 'HH:MM:59'` which
  // silently dropped the last second of every minute. With minute-precision
  // matching, these rows now fire correctly.
  it('matches start_time stored at HH:MM:59 (regression)', () => {
    expect(pickDueSchedules([sched({ start_time: '04:00:59' })], '04:00', MONDAY, TODAY))
      .toHaveLength(1)
  })

  it('matches start_time with sub-second precision', () => {
    expect(pickDueSchedules([sched({ start_time: '04:00:00.123456' })], '04:00', MONDAY, TODAY))
      .toHaveLength(1)
  })

  it('honours days_of_week when run_once_date is null', () => {
    const monOnly = sched({ days_of_week: [MONDAY] })
    expect(pickDueSchedules([monOnly], '04:00', MONDAY, TODAY)).toHaveLength(1)
    expect(pickDueSchedules([monOnly], '04:00', SUNDAY, TODAY)).toHaveLength(0)
  })

  it('honours run_once_date instead of days_of_week when present', () => {
    const once = sched({ run_once_date: TODAY, days_of_week: [] })
    expect(pickDueSchedules([once], '04:00', MONDAY, TODAY)).toHaveLength(1)
    expect(pickDueSchedules([once], '04:00', MONDAY, '2026-05-05')).toHaveLength(0)
  })

  it('skips rows with a missing or non-string start_time', () => {
    const broken = { start_time: null, run_once_date: null, days_of_week: [MONDAY] } as unknown as Schedule
    expect(pickDueSchedules([broken], '04:00', MONDAY, TODAY)).toHaveLength(0)
  })
})

/**
 * Pure due-schedule selector for run-schedules.
 *
 * Matches start_time on minute granularity (HH:MM), with a small lookback
 * window so a transient cron failure (e.g. a single 500 from PostgREST) is
 * automatically caught up by the next minute's tick. Without the lookback, a
 * one-time schedule that lands on a failing minute is silently missed forever.
 */

export type Schedule = {
  start_time:    string | null
  run_once_date: string | null
  days_of_week:  number[] | null
}

export function pickDueSchedules<T extends Schedule>(
  schedules:        T[],
  nowHHMM:          string,
  dow:              number,
  todayLocal:       string,
  lookbackMinutes:  number = 4,
): T[] {
  const [nowH, nowM] = nowHHMM.split(':').map(Number)
  if (Number.isNaN(nowH) || Number.isNaN(nowM)) return []
  const nowMinutes = nowH * 60 + nowM

  return schedules.filter(s => {
    if (typeof s.start_time !== 'string') return false
    const hhmm = s.start_time.slice(0, 5)
    const [sH, sM] = hhmm.split(':').map(Number)
    if (Number.isNaN(sH) || Number.isNaN(sM)) return false
    const sMinutes = sH * 60 + sM
    const diff = nowMinutes - sMinutes
    if (diff < 0 || diff > lookbackMinutes) return false
    return s.run_once_date
      ? s.run_once_date === todayLocal
      : Array.isArray(s.days_of_week) && s.days_of_week.includes(dow)
  })
}

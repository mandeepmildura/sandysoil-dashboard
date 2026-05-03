/**
 * Pure due-schedule selector for run-schedules.
 *
 * Matches start_time on minute granularity (HH:MM), with a small lookback
 * window so a transient cron failure (e.g. a single 500 from PostgREST) is
 * automatically caught up by the next minute's tick. Without the lookback, a
 * one-time schedule that lands on a failing minute is silently missed forever.
 *
 * The previous PostgREST filter (`start_time >= 'HH:MM:00' AND start_time <
 * 'HH:MM:59'`) silently dropped the HH:MM:59 second and was fragile against
 * any sub-second precision in the time column.
 *
 * Days-of-week / run_once filtering happens here too so the call site stays
 * a single filter() call.
 */

export type Schedule = {
  start_time:    string | null
  run_once_date: string | null
  days_of_week:  number[] | null
}

/**
 * Pick the schedules that should fire this minute (or up to `lookbackMinutes`
 * earlier, to catch up after a failed cron tick).
 *
 * @param schedules        All enabled schedules.
 * @param nowHHMM          Current local time as "HH:MM".
 * @param dow              Current local day-of-week (0=Sun … 6=Sat).
 * @param todayLocal       Current local date as "YYYY-MM-DD" (for run_once_date).
 * @param lookbackMinutes  How many earlier minutes to also accept (default 4).
 *                         Same-day only — does not wrap around midnight.
 */
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
    // No midnight wrap: a 23:59 schedule should not catch up after midnight.
    if (diff < 0 || diff > lookbackMinutes) return false
    return s.run_once_date
      ? s.run_once_date === todayLocal
      : Array.isArray(s.days_of_week) && s.days_of_week.includes(dow)
  })
}

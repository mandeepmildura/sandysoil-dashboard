/**
 * Pure due-schedule selector for run-schedules.
 *
 * Matches start_time on minute granularity (HH:MM), so a row stored as
 * "04:00:00", "04:00:30", or "04:00:59.123456" all count when the current
 * local minute is "04:00". The previous PostgREST filter
 * (`start_time >= 'HH:MM:00' AND start_time < 'HH:MM:59'`) silently dropped
 * the HH:MM:59 second and was fragile against any sub-second precision in
 * the time column.
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
 * Pick the schedules that should fire this minute.
 *
 * @param schedules     All enabled schedules.
 * @param nowHHMM       Current local time as "HH:MM".
 * @param dow           Current local day-of-week (0=Sun … 6=Sat).
 * @param todayLocal    Current local date as "YYYY-MM-DD" (for run_once_date).
 */
export function pickDueSchedules<T extends Schedule>(
  schedules: T[],
  nowHHMM:   string,
  dow:       number,
  todayLocal: string,
): T[] {
  return schedules.filter(s => {
    if (typeof s.start_time !== 'string') return false
    if (s.start_time.slice(0, 5) !== nowHHMM) return false
    return s.run_once_date
      ? s.run_once_date === todayLocal
      : Array.isArray(s.days_of_week) && s.days_of_week.includes(dow)
  })
}

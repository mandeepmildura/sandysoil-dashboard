/**
 * Pure date / display helpers used by the Calendar page.
 *
 * Kept separate from the component so the off-by-one-prone day-of-week math
 * (Sunday = DB day 0 → last column in the calendar grid) can be unit tested.
 */

const DB_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * DB stores day-of-week as JS Date.getDay() (Sun=0 … Sat=6).
 * Calendar grid is Mon-first (index 0 = Mon, index 6 = Sun).
 */
export function dbDayToCalIdx(d) {
  return d === 0 ? 6 : d - 1
}

/** The Monday of the week containing `date`, at local midnight. */
export function getWeekMonday(date) {
  const d = new Date(date)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  d.setHours(0, 0, 0, 0)
  return d
}

/** "HH:MM:SS" → "HH:MM"; empty / null → "—". */
export function fmtTime(t) {
  return t ? t.slice(0, 5) : '—'
}

/** Minutes → "45 min" / "1h" / "1h 30m". */
export function fmtDuration(min) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Array of DB day indices → "Mon, Wed, Fri"; empty → "No days". */
export function fmtDays(days) {
  if (!days?.length) return 'No days'
  return days.map(d => DB_DAY_NAMES[d] ?? d).join(', ')
}

/**
 * Total runtime of a program:
 *   sequential → sum of all zone durations
 *   parallel   → longest zone
 */
export function totalDuration(p) {
  if (!p.zones?.length) return 0
  return p.run_mode === 'sequential'
    ? p.zones.reduce((s, z) => s + z.duration_min, 0)
    : Math.max(...p.zones.map(z => z.duration_min))
}

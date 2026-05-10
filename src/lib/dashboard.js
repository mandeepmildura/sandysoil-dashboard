/**
 * Pure helpers used by the Dashboard page.
 *
 * Kept separate from the component so the relative-time formatting and
 * the schedule-occurrence math can be unit tested without rendering.
 */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Friendly "time since" label for a zone's last-run timestamp.
 *   < 1 h  → "Nm ago"        (minimum 1m)
 *   < 24 h → "Nh ago"
 *   < 48 h → "Yesterday"
 *   else   → "N days ago"
 *
 * @param {string|null} iso      ISO timestamp (or null)
 * @param {number}      nowMs    current time (defaults to Date.now(); injectable for tests)
 */
export function fmtLastRun(iso, nowMs = Date.now()) {
  if (!iso) return 'No runs yet'
  const diffMs = nowMs - new Date(iso).getTime()
  const h = diffMs / 3_600_000
  if (h < 1)  return `${Math.max(1, Math.floor(h * 60))}m ago`
  if (h < 24) return `${Math.floor(h)}h ago`
  if (h < 48) return 'Yesterday'
  return `${Math.floor(h / 24)} days ago`
}

/**
 * Bucket the last N pressure readings into 15 bars for the sparkline strip.
 * Normalises to a 10–100 scale (min 10 so tiny values are still visible).
 *
 * @param {Array<number|string>} values   supply_psi readings, most-recent-first
 * @returns {number[]}                    up to 15 heights, oldest-first
 */
export function bucketPressureBars(values) {
  const finite = (values ?? []).map(parseFloat).filter(Number.isFinite)
  if (!finite.length) return []

  const bucket = Math.max(1, Math.floor(finite.length / 15))
  const bars = []
  for (let i = 0; i < 15; i++) {
    const slice = finite.slice(i * bucket, (i + 1) * bucket)
    if (slice.length) bars.push(slice.reduce((a, b) => a + b, 0) / slice.length)
  }
  if (!bars.length) return []

  const max = Math.max(...bars, 1)
  return bars.reverse().map(v => Math.max(10, (v / max) * 100))
}

/**
 * For each of the first `limit` schedule rows, compute the next occurrence
 * and render it as a dashboard card row.
 *
 *   { id, month, day, name, time, durationMin }
 *
 * `now` is injected so tests can freeze time without touching Date.now().
 */
export function upcomingSchedules(groupSchedules, now = new Date(), limit = 3) {
  const todayIdx = now.getDay()
  return (groupSchedules ?? [])
    .filter(s => s.enabled !== false)
    .slice(0, limit)
    .map(s => {
      const days = s.days_of_week ?? []
      const nextDow   = days.find(d => d >= todayIdx) ?? days[0] ?? todayIdx
      const daysAhead = (nextDow - todayIdx + 7) % 7
      const when = new Date(now)
      when.setDate(now.getDate() + daysAhead)
      const members  = s.zone_groups?.zone_group_members ?? []
      const totalMin = members.reduce((a, m) => a + (m.duration_min ?? 30), 0)
      return {
        id:          s.id,
        month:       MONTHS[when.getMonth()],
        day:         when.getDate(),
        name:        s.zone_groups?.name ?? 'Program',
        time:        (s.start_time ?? '').slice(0, 5),
        durationMin: totalMin,
      }
    })
}

/**
 * Compute differential PSI from an inlet/outlet pair or a pre-computed value.
 * Returns `null` if neither source can produce a number.
 */
export function diffPsi(pressure) {
  if (pressure?.differential_psi != null) return pressure.differential_psi
  const inlet  = pressure?.inlet_psi
  const outlet = pressure?.outlet_psi
  if (typeof inlet === 'number' && typeof outlet === 'number') {
    return +(inlet - outlet).toFixed(1)
  }
  return null
}

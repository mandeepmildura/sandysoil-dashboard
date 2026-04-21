/**
 * Shared display formatters.
 *
 * Every page used to inline its own copy of these — fmtTime was
 * reimplemented four different ways, fmtDuration three times, etc.
 * Consolidating here kills drift between pages and makes the logic
 * unit-testable in isolation.
 *
 * Time-dependent functions accept an optional `nowMs` so tests can
 * freeze the clock without touching Date.now() globally.
 */

const PAD2 = n => String(n).padStart(2, '0')

// ── Date / timestamp formatters ─────────────────────────────────────────────

/** "YYYY-MM-DD" in local time (used for history day filters). */
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${PAD2(d.getMonth() + 1)}-${PAD2(d.getDate())}`
}

/** "D/M HH:MM" — short timestamp for history lists. Null/empty → em dash. */
export function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1} ${PAD2(d.getHours())}:${PAD2(d.getMinutes())}`
}

/**
 * Date label for the history page.
 *   today     → "Today"
 *   yesterday → "Yesterday"
 *   else      → localised long form (e.g. "21 April 2026")
 */
export function fmtDateLabel(dateStr, now = new Date()) {
  const d = new Date(`${dateStr}T00:00:00`)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const yest = new Date(today)
  yest.setDate(yest.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Relative-time formatter used by the alerts + admin pages.
 *   < 2m   → "Just now"
 *   < 60m  → "Nm ago"
 *   < 24h  → "Nh ago"
 *   else   → localised date
 */
export function fmtRelative(iso, nowMs = Date.now()) {
  if (!iso) return '—'
  const d = new Date(iso)
  const diffMin = Math.floor((nowMs - d.getTime()) / 60_000)
  if (diffMin < 2)  return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `${diffH}h ago`
  return d.toLocaleDateString()
}

// ── Duration formatters ─────────────────────────────────────────────────────

/**
 * Decimal minutes → "Ns" (below 1 min) or "N.N min".
 * Accepts strings (Postgres returns numerics as strings over REST).
 */
export function fmtDuration(dur) {
  if (dur == null) return '—'
  const n = parseFloat(dur)
  if (!Number.isFinite(n)) return '—'
  if (n < 1) return `${Math.round(n * 60)}s`
  return `${n.toFixed(1)} min`
}

/**
 * Integer minutes → "< 1 min" / "N min" / "Nh" / "Nh Nm" (used by ZoneHistory).
 */
export function fmtDurMin(min) {
  if (!min || min < 1) return '< 1 min'
  const rounded = Math.round(min)
  if (rounded < 60) return `${rounded} min`
  const h = Math.floor(rounded / 60)
  const r = rounded % 60
  return r > 0 ? `${h}h ${r}m` : `${h}h`
}

/** Seconds → "Nh Nm" or "Nm". */
export function fmtUptime(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Misc ────────────────────────────────────────────────────────────────────

/** ISO timestamp → fractional minutes from local midnight. */
export function minutesFromMidnight(isoStr) {
  const d = new Date(isoStr)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

/** "HH:MM" → integer minutes (used for schedule math). */
export function timeStrToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

/** Safe percent helper — 0 denom → 0. Rounded to the nearest integer. */
export function pct(numerator, denominator) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 100)
}

/**
 * Render a zone_history row as an admin-console event entry.
 *   { text: "<Device> · <Zone/Relay N> started", time: "<relative>" }
 *
 * `nowMs` is injectable for deterministic tests.
 */
export function fmtEvent(row, nowMs = Date.now()) {
  const deviceLabels = { a6v3: 'A6v3', b16m: 'B16M', irrigation1: 'Irrigation' }
  const deviceLabel  = deviceLabels[row.device] ?? row.device
  const unitLabel    = row.device === 'irrigation1' ? `Zone ${row.zone_num}` : `Relay ${row.zone_num}`
  const diff = Math.floor((nowMs - new Date(row.started_at).getTime()) / 60_000)
  const ago  = diff < 2 ? 'just now' : diff < 60 ? `${diff}m ago` : `${Math.floor(diff / 60)}h ago`
  return { text: `${deviceLabel} · ${unitLabel} started`, time: ago }
}

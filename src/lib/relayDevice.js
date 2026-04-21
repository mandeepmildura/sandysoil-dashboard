/**
 * Pure helpers used by the RelayDevice page.
 *
 * Extracted from src/pages/RelayDevice.jsx so the date formatting,
 * duration formatting, grid class selection, and pressure-gauge colour
 * threshold can be unit tested without mounting the component.
 */

/** "YYYY-MM-DD" in local time (used for history day filters). */
export function localDateStr(d = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Short "D/M HH:MM" label for a history timestamp. Null/empty → em dash. */
export function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getDate()}/${d.getMonth() + 1} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Decimal minutes → "Ns" (below 1 min) or "N.N min". Null → em dash. */
export function fmtDuration(dur) {
  if (dur == null) return '—'
  const n = parseFloat(dur)
  if (!Number.isFinite(n)) return '—'
  if (n < 1) return `${Math.round(n * 60)}s`
  return `${n.toFixed(1)} min`
}

/** Tailwind grid-cols string for the relay grid. */
export function relayGridCls(count) {
  if (count <= 6)  return 'grid-cols-2 xl:grid-cols-3'
  if (count <= 12) return 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4'
  return 'grid-cols-2 sm:grid-cols-4'
}

/** Tailwind grid-cols string for the digital-input grid. */
export function inputGridCols(count) {
  return count <= 6 ? 'grid-cols-3' : 'grid-cols-4'
}

/**
 * Pressure gauge colour thresholds:
 *   green   below 69% of maxPsi
 *   orange  69%–86%
 *   red     86%+
 */
export function gaugeColor(psi, maxPsi) {
  const hi   = maxPsi * 0.86
  const warn = maxPsi * 0.69
  if (psi >= hi)   return '#ba1a1a'
  if (psi >= warn) return '#e65c00'
  return '#0d631b'
}

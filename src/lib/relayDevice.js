/**
 * Relay-page-specific helpers (grid layout + pressure-gauge colour).
 *
 * General-purpose formatters (fmtTime, fmtDuration, localDateStr) live in
 * src/lib/format.js — importing them from there keeps a single source
 * across pages.
 */

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

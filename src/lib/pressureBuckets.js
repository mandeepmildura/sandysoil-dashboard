/**
 * Pure time-bucket aggregation for pressure_log rows.
 *
 * Used by both usePressureHistory (multi-series) and useA6v3PressureHistory
 * (single series). Keeps the hooks thin and lets us unit test bucket edges
 * and averaging without a Supabase round trip.
 */

const PAD2 = n => String(n).padStart(2, '0')

function bucketKey(d, bucketMinutes) {
  const mm = Math.floor(d.getMinutes() / bucketMinutes) * bucketMinutes
  const keyDate = `${d.getFullYear()}-${PAD2(d.getMonth() + 1)}-${PAD2(d.getDate())}`
  const keyTime = `${PAD2(d.getHours())}:${PAD2(mm)}`
  return { key: `${keyDate} ${keyTime}`, mm }
}

function timeLabel(d, mm, includeDate) {
  const t = `${PAD2(d.getHours())}:${PAD2(mm)}`
  return includeDate ? `${d.getDate()}/${d.getMonth() + 1} ${t}` : t
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

/**
 * Bucket multi-series rows (inlet/outlet/diff/supply/a6v3).
 *
 * @param {Array<object>} rows   pressure_log rows ordered by ts asc
 * @param {number}        hours  range length; controls bucket width + label
 * @returns {Array<{time, inlet, outlet, diff, supply, a6v3}>}
 */
export function bucketMultiSeries(rows, hours) {
  const bucketMinutes = hours >= 168 ? 60 : 5
  const includeDate   = hours > 24
  const series = ['inlet', 'outlet', 'diff', 'supply', 'a6v3']
  const rowKey = { inlet: 'inlet_psi', outlet: 'outlet_psi', diff: 'diff_psi', supply: 'supply_psi', a6v3: 'a6v3_ch1_psi' }

  const buckets = {}
  for (const row of rows) {
    const d = new Date(row.ts)
    const { key, mm } = bucketKey(d, bucketMinutes)
    if (!buckets[key]) {
      buckets[key] = { time: timeLabel(d, mm, includeDate), _ts: d.getTime() }
      for (const s of series) buckets[key][s] = []
    }
    for (const s of series) {
      if (row[rowKey[s]] != null) buckets[key][s].push(parseFloat(row[rowKey[s]]))
    }
  }

  return Object.values(buckets)
    .sort((a, b) => a._ts - b._ts)
    .map(b => {
      const out = { time: b.time }
      for (const s of series) out[s] = avg(b[s])
      return out
    })
}

/**
 * Bucket a6v3_ch1_psi into 5-minute windows.
 *
 * @param {Array<object>} rows  pressure_log rows with a6v3_ch1_psi
 * @param {boolean}       multiDay  true → labels include date
 * @returns {Array<{time, psi}>}
 */
export function bucketA6v3(rows, multiDay) {
  const buckets = {}
  for (const row of rows) {
    const d = new Date(row.ts)
    const { key, mm } = bucketKey(d, 5)
    if (!buckets[key]) {
      buckets[key] = { time: timeLabel(d, mm, multiDay), _ts: d.getTime(), psi: [] }
    }
    if (row.a6v3_ch1_psi != null) buckets[key].psi.push(parseFloat(row.a6v3_ch1_psi))
  }

  return Object.values(buckets)
    .sort((a, b) => a._ts - b._ts)
    .map(b => ({ time: b.time, psi: avg(b.psi) }))
}

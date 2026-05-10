import { describe, it, expect } from 'vitest'
import { bucketMultiSeries, bucketA6v3 } from '../src/lib/pressureBuckets'

// All test rows use a local TZ where hour/minute are unambiguous.
// Use plain `YYYY-MM-DDTHH:MM:SS` strings (no Z) so the same wall-clock
// math holds regardless of the CI runner's timezone.
const row = (ts, cols) => ({ ts, ...cols })

describe('bucketMultiSeries (5-minute buckets)', () => {
  it('returns an empty array for no rows', () => {
    expect(bucketMultiSeries([], 24)).toEqual([])
  })

  it('groups rows within the same 5-minute window and averages them', () => {
    const rows = [
      row('2026-04-21T06:01:00', { inlet_psi: 40, outlet_psi: 35 }),
      row('2026-04-21T06:03:00', { inlet_psi: 42, outlet_psi: 37 }),
      row('2026-04-21T06:04:59', { inlet_psi: 44, outlet_psi: 39 }),
    ]
    const out = bucketMultiSeries(rows, 24)
    expect(out).toHaveLength(1)
    expect(out[0].inlet).toBe(42)   // (40+42+44)/3
    expect(out[0].outlet).toBe(37)  // (35+37+39)/3
  })

  it('splits rows across bucket boundaries (5-minute edges)', () => {
    const rows = [
      row('2026-04-21T06:04:59', { inlet_psi: 40 }),
      row('2026-04-21T06:05:00', { inlet_psi: 50 }),
    ]
    const out = bucketMultiSeries(rows, 24)
    expect(out).toHaveLength(2)
    expect(out[0].inlet).toBe(40)
    expect(out[1].inlet).toBe(50)
  })

  it('returns null for a series that had no values in the bucket', () => {
    const rows = [row('2026-04-21T06:00:00', { inlet_psi: 40 })]
    const out = bucketMultiSeries(rows, 24)
    expect(out[0].inlet).toBe(40)
    expect(out[0].outlet).toBeNull()
    expect(out[0].a6v3).toBeNull()
  })

  it('sorts output chronologically regardless of input order', () => {
    const rows = [
      row('2026-04-21T08:00:00', { inlet_psi: 1 }),
      row('2026-04-21T06:00:00', { inlet_psi: 2 }),
      row('2026-04-21T07:00:00', { inlet_psi: 3 }),
    ]
    const out = bucketMultiSeries(rows, 24)
    expect(out.map(b => b.inlet)).toEqual([2, 3, 1])
  })

  it('uses 1-hour buckets when hours >= 168 (7 days)', () => {
    const rows = [
      row('2026-04-21T06:05:00', { inlet_psi: 10 }),
      row('2026-04-21T06:35:00', { inlet_psi: 20 }),
      row('2026-04-21T07:15:00', { inlet_psi: 30 }),
    ]
    const out = bucketMultiSeries(rows, 168)
    // First two are in the 6:00 hour, third is in the 7:00 hour
    expect(out).toHaveLength(2)
    expect(out[0].inlet).toBe(15)
    expect(out[1].inlet).toBe(30)
  })

  it('includes date in label when hours > 24', () => {
    const rows = [row('2026-04-21T06:00:00', { inlet_psi: 40 })]
    const out = bucketMultiSeries(rows, 48)
    expect(out[0].time).toMatch(/^21\/4 06:00$/)
  })

  it('omits date in label when hours <= 24', () => {
    const rows = [row('2026-04-21T06:00:00', { inlet_psi: 40 })]
    const out = bucketMultiSeries(rows, 24)
    expect(out[0].time).toBe('06:00')
  })

  it('ignores null column values without NaN leaking into the average', () => {
    const rows = [
      row('2026-04-21T06:00:00', { inlet_psi: 40, outlet_psi: null }),
      row('2026-04-21T06:02:00', { inlet_psi: 60, outlet_psi: 50 }),
    ]
    const out = bucketMultiSeries(rows, 24)
    expect(out[0].inlet).toBe(50)   // (40+60)/2
    expect(out[0].outlet).toBe(50)  // only the one non-null reading
  })
})

describe('bucketA6v3', () => {
  it('returns an empty array for no rows', () => {
    expect(bucketA6v3([], false)).toEqual([])
  })

  it('averages multiple readings in the same 5-minute bucket', () => {
    const rows = [
      row('2026-04-21T06:01:00', { a6v3_ch1_psi: 40 }),
      row('2026-04-21T06:02:00', { a6v3_ch1_psi: 60 }),
    ]
    const out = bucketA6v3(rows, false)
    expect(out).toHaveLength(1)
    expect(out[0].psi).toBe(50)
  })

  it('emits one bucket per 5-minute window', () => {
    const rows = [
      row('2026-04-21T06:04:00', { a6v3_ch1_psi: 40 }),
      row('2026-04-21T06:05:00', { a6v3_ch1_psi: 60 }),
    ]
    const out = bucketA6v3(rows, false)
    expect(out).toHaveLength(2)
  })

  it('prepends date to label when multiDay is true', () => {
    const rows = [row('2026-04-21T06:00:00', { a6v3_ch1_psi: 40 })]
    const out = bucketA6v3(rows, true)
    expect(out[0].time).toMatch(/^21\/4 06:00$/)
  })

  it('returns null psi for buckets where every row had null', () => {
    const rows = [row('2026-04-21T06:00:00', { a6v3_ch1_psi: null })]
    const out = bucketA6v3(rows, false)
    expect(out).toHaveLength(1)
    expect(out[0].psi).toBeNull()
  })
})

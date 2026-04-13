import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches the last `hours` hours of pressure_log data, bucketed for charting.
 * - Up to 24h: 5-minute buckets
 * - 7D+: 1-hour buckets (keeps chart readable)
 * Includes a6v3_ch1_psi alongside the irrigation sensor data.
 */
export function usePressureHistory(hours = 24) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const reload = () => setRefreshKey(k => k + 1)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

      const { data: rows, error } = await supabase
        .from('pressure_log')
        .select('ts, inlet_psi, outlet_psi, diff_psi, supply_psi, a6v3_ch1_psi')
        .gte('ts', since)
        .order('ts', { ascending: true })

      if (!error && rows) {
        // Use 1-hour buckets for 7D+ to keep chart readable; 5-min for shorter ranges
        const bucketMinutes = hours >= 168 ? 60 : 5

        const buckets = {}
        for (const row of rows) {
          const d = new Date(row.ts)
          const mm = Math.floor(d.getMinutes() / bucketMinutes) * bucketMinutes
          const keyDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
          const keyTime = `${String(d.getHours()).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
          const key = `${keyDate} ${keyTime}`

          // Display label: include date if range > 24h
          const timeLabel = hours > 24
            ? `${d.getDate()}/${d.getMonth()+1} ${keyTime}`
            : keyTime

          if (!buckets[key]) {
            buckets[key] = { time: timeLabel, _ts: d.getTime(), inlet: [], outlet: [], diff: [], supply: [], a6v3: [] }
          }
          if (row.inlet_psi != null)      buckets[key].inlet.push(parseFloat(row.inlet_psi))
          if (row.outlet_psi != null)     buckets[key].outlet.push(parseFloat(row.outlet_psi))
          if (row.diff_psi != null)       buckets[key].diff.push(parseFloat(row.diff_psi))
          if (row.supply_psi != null)     buckets[key].supply.push(parseFloat(row.supply_psi))
          if (row.a6v3_ch1_psi != null)   buckets[key].a6v3.push(parseFloat(row.a6v3_ch1_psi))
        }

        const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
        const sorted = Object.values(buckets).sort((a, b) => a._ts - b._ts)
        setData(sorted.map(b => ({
          time:   b.time,
          inlet:  avg(b.inlet),
          outlet: avg(b.outlet),
          diff:   avg(b.diff),
          supply: avg(b.supply),
          a6v3:   avg(b.a6v3),
        })))
      }
      setLoading(false)
    }
    fetch()
  }, [hours, refreshKey])

  return { data, loading, reload }
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches the last `hours` hours of pressure_log data,
 * bucketed by the minute for charting.
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
        .select('ts, inlet_psi, outlet_psi, diff_psi, supply_psi, simulated')
        .gte('ts', since)
        .order('ts', { ascending: true })

      if (!error && rows) {
        // Downsample — average values per 5-minute bucket for chart performance
        const buckets = {}
        for (const row of rows) {
          const d = new Date(row.ts)
          // Include date in key to avoid cross-day collisions
          const mm = Math.floor(d.getMinutes() / 5) * 5
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
          if (!buckets[key]) {
            buckets[key] = { time: `${String(d.getHours()).padStart(2,'0')}:${String(mm).padStart(2,'0')}`, _ts: d.getTime(), inlet: [], outlet: [], diff: [], supply: [], simulated: false }
          }
          buckets[key].inlet.push(parseFloat(row.inlet_psi ?? 0))
          buckets[key].outlet.push(parseFloat(row.outlet_psi ?? 0))
          buckets[key].diff.push(parseFloat(row.diff_psi ?? 0))
          if (row.supply_psi != null) buckets[key].supply.push(parseFloat(row.supply_psi))
          if (row.simulated) buckets[key].simulated = true
        }
        const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
        const sorted = Object.values(buckets).sort((a, b) => a._ts - b._ts)
        setData(sorted.map(b => ({
          time:      b.time,
          inlet:     avg(b.inlet),
          outlet:    avg(b.outlet),
          diff:      avg(b.diff),
          supply:    b.supply.length ? avg(b.supply) : null,
          simulated: b.simulated,
        })))
      }
      setLoading(false)
    }
    fetch()
  }, [hours, refreshKey])

  return { data, loading, reload }
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { bucketMultiSeries } from '../lib/pressureBuckets'

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

      // Cap rows so long ranges can't pull unbounded history; bucketing
      // downsamples to ≤288 points anyway, so 5000 raw rows is plenty.
      const { data: rows, error } = await supabase
        .from('pressure_log')
        .select('ts, inlet_psi, outlet_psi, diff_psi, supply_psi, a6v3_ch1_psi')
        .gte('ts', since)
        .order('ts', { ascending: false })
        .limit(5000)

      if (!error && rows) {
        setData(bucketMultiSeries(rows, hours))
      }
      setLoading(false)
    }
    fetch()
  }, [hours, refreshKey])

  return { data, loading, reload }
}

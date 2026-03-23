import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Fetches the last `hours` hours of pressure_log data,
 * bucketed by the minute for charting.
 */
export function usePressureHistory(hours = 24) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

      const { data: rows, error } = await supabase
        .from('pressure_log')
        .select('ts, inlet_psi, outlet_psi, diff_psi')
        .gte('ts', since)
        .order('ts', { ascending: true })

      if (!error && rows) {
        // Downsample — keep one row per 5-minute bucket for chart performance
        const buckets = {}
        for (const row of rows) {
          const d = new Date(row.ts)
          const key = `${String(d.getHours()).padStart(2,'0')}:${String(Math.floor(d.getMinutes() / 5) * 5).padStart(2,'0')}`
          buckets[key] = {
            time: key,
            inlet:  parseFloat(row.inlet_psi),
            outlet: parseFloat(row.outlet_psi),
            diff:   parseFloat(row.diff_psi),
          }
        }
        setData(Object.values(buckets))
      }
      setLoading(false)
    }
    fetch()
  }, [hours])

  return { data, loading }
}

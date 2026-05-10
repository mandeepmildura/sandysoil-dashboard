import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { bucketA6v3 } from '../lib/pressureBuckets'

/**
 * Fetches A6v3 CH1 pressure history for a given time range.
 * @param {string} from  ISO string for range start
 * @param {string} to    ISO string for range end
 */
export function useA6v3PressureHistory(from, to) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const reload = () => setRefreshKey(k => k + 1)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const rangeMs = new Date(to).getTime() - new Date(from).getTime()
      const multiDay = rangeMs > 24 * 60 * 60 * 1000

      const { data: rows, error } = await supabase
        .from('pressure_log')
        .select('ts, a6v3_ch1_psi')
        .not('a6v3_ch1_psi', 'is', null)
        .gte('ts', from)
        .lte('ts', to)
        .order('ts', { ascending: false })
        .limit(5000)

      if (!error && rows) {
        setData(bucketA6v3(rows, multiDay))
      }
      setLoading(false)
    }
    fetch()
  }, [from, to, refreshKey])

  return { data, loading, reload }
}

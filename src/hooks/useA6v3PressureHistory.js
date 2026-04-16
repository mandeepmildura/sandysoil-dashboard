import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
        .order('ts', { ascending: true })

      if (!error && rows) {
        const buckets = {}
        for (const row of rows) {
          const d = new Date(row.ts)
          const mm = Math.floor(d.getMinutes() / 5) * 5
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
          if (!buckets[key]) {
            const timeLabel = multiDay
              ? `${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
              : `${String(d.getHours()).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
            buckets[key] = { time: timeLabel, _ts: d.getTime(), psi: [] }
          }
          if (row.a6v3_ch1_psi != null) buckets[key].psi.push(parseFloat(row.a6v3_ch1_psi))
        }
        const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
        const sorted = Object.values(buckets).sort((a, b) => a._ts - b._ts)
        setData(sorted.map(b => ({ time: b.time, psi: avg(b.psi) })))
      }
      setLoading(false)
    }
    fetch()
  }, [from, to, refreshKey])

  return { data, loading, reload }
}

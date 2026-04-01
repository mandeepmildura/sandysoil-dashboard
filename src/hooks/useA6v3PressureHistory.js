import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useA6v3PressureHistory(hours = 24) {
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
        .select('ts, a6v3_ch1_psi')
        .not('a6v3_ch1_psi', 'is', null)
        .gte('ts', since)
        .order('ts', { ascending: true })

      if (!error && rows) {
        const buckets = {}
        for (const row of rows) {
          const d = new Date(row.ts)
          const mm = Math.floor(d.getMinutes() / 5) * 5
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(mm).padStart(2,'0')}`
          if (!buckets[key]) {
            buckets[key] = { time: `${String(d.getHours()).padStart(2,'0')}:${String(mm).padStart(2,'0')}`, _ts: d.getTime(), psi: [] }
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
  }, [hours, refreshKey])

  return { data, loading, reload }
}

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * LMW meter readings (one row per day) for the signed-in user.
 *
 *   useLmwMeterReadings()           → last 60 days
 *   useLmwMeterReadings({ days: 30 })
 *   useLmwMeterReadings({ from: '2025-07-01', to: '2026-06-30' }) — full season
 *
 * Returns readings sorted by reading_date ascending so charts plot
 * left-to-right without further reversing.
 */
export function useLmwMeterReadings({
  days = 60,
  from = null,
  to   = null,
} = {}) {
  const [readings, setReadings] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [tick, setTick]         = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const today = new Date()
        const fromDate = from ?? new Date(today.getTime() - days * 24 * 3_600_000).toISOString().slice(0, 10)
        const toDate   = to   ?? today.toISOString().slice(0, 10)

        const { data, error } = await supabase
          .from('lmw_meter_readings')
          .select('reading_date, meter_reading, act_usage_ml, est_usage_ml')
          .gte('reading_date', fromDate)
          .lte('reading_date', toDate)
          .order('reading_date', { ascending: true })

        if (cancelled) return
        if (error) throw error
        setReadings(data ?? [])
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [days, from, to, tick])

  // Convenience aggregates
  const totalAct = readings.reduce((s, r) => s + (Number(r.act_usage_ml) || 0), 0)
  const totalEst = readings.reduce((s, r) => s + (Number(r.est_usage_ml) || 0), 0)

  return { readings, loading, error, reload, totalAct, totalEst }
}

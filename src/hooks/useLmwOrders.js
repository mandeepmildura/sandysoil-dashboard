import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * LMW orders for the signed-in user, scoped to a date range.
 *
 *   useLmwOrders()                         → all upcoming orders (default: now → +30d)
 *   useLmwOrders({ from: '2026-05-01' })   → custom range, ISO date or timestamp
 *
 * Returns rows ordered by start_at ascending. status='cancelled' rows
 * are excluded by default; pass `includeCancelled: true` to include them.
 */
export function useLmwOrders({
  from = null,
  to   = null,
  includeCancelled = false,
} = {}) {
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [tick, setTick]       = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const fromIso = from ?? new Date().toISOString()
        const toIso   = to   ?? new Date(Date.now() + 30 * 24 * 3_600_000).toISOString()

        let q = supabase
          .from('lmw_orders')
          .select('id, receipt_no, start_at, end_at, hours, flow_lps, shift_no, est_ml, status, source, outlet_no')
          .gte('start_at', fromIso)
          .lte('start_at', toIso)
          .order('start_at', { ascending: true })

        if (!includeCancelled) q = q.neq('status', 'cancelled')

        const { data, error } = await q
        if (cancelled) return
        if (error) throw error
        setOrders(data ?? [])
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [from, to, includeCancelled, tick])

  return { orders, loading, error, reload }
}

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Latest LMW allocation snapshot for the signed-in user.
 *
 * Returns the most recent row from lmw_allocation. RLS scopes this to
 * the user's own rows (mandeep@freshoz.com sees all as admin).
 *
 * The lmw-sync edge function inserts a new row every 30 minutes; older
 * rows aren't pruned (they're useful for trending), so always order by
 * snapshot_at DESC.
 */
export function useLmwAllocation() {
  const [allocation, setAllocation] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [tick, setTick]             = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('lmw_allocation')
          .select('*')
          .order('snapshot_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (cancelled) return
        if (error) throw error
        setAllocation(data ?? null)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [tick])

  return { allocation, loading, error, reload }
}

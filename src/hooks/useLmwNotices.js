import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useLmwNotices() {
  const [notices, setNotices] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('lmw_notices')
      .select('id, notice_text, synced_at')
      .order('synced_at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) {
          setNotices(data ?? [])
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [tick])

  return { notices, loading, reload }
}

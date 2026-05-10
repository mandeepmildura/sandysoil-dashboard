// src/hooks/useCalendarHistory.js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useCalendarHistory(dateStr) {
  const [actual, setActual]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dateStr) return
    setLoading(true)

    const dayStart = new Date(`${dateStr}T00:00:00`).toISOString()
    const dayEnd   = new Date(`${dateStr}T23:59:59`).toISOString()

    supabase.from('zone_history')
      .select('zone_num, device, started_at, ended_at, source')
      .gte('started_at', dayStart)
      .lte('started_at', dayEnd)
      .order('started_at')
      .then(({ data }) => {
        setActual(data ?? [])
        setLoading(false)
      })
  }, [dateStr])

  return { actual, loading }
}

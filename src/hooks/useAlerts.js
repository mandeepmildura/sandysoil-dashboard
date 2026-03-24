import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Loads alerts from device_alerts table.
 * Falls back to empty array if table doesn't exist.
 */
export function useAlerts() {
  const [alerts, setAlerts]   = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick]       = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('device_alerts')
          .select('*')
          .order('created_at', { ascending: false })
        if (!error && data) setAlerts(data)
      } catch (e) {
        console.error('useAlerts error:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tick])

  async function acknowledge(id) {
    try {
      const { error } = await supabase
        .from('device_alerts')
        .update({ acknowledged: true })
        .eq('id', id)
      if (!error) {
        setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a))
      }
    } catch (e) {
      console.error('acknowledge error:', e)
    }
  }

  async function dismiss(id) {
    try {
      const { error } = await supabase
        .from('device_alerts')
        .delete()
        .eq('id', id)
      if (!error) {
        setAlerts(prev => prev.filter(a => a.id !== id))
      }
    } catch (e) {
      console.error('dismiss error:', e)
    }
  }

  return { alerts, loading, reload, acknowledge, dismiss }
}

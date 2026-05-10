import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

let cache = { psi: null, simulated: false, ts: 0 }
const listeners = new Set()
let timer = null
// Poll Supabase as a fallback when MQTT live data isn't flowing. MQTT via
// DeviceContext is the primary live source — this DB fallback exists for
// fresh page loads before the MQTT stream warms up. 5 min is plenty.
// (Was 60 s. 12× fewer queries × multiple tabs adds up to meaningful egress.)
const POLL_MS = 300_000

async function fetchLatest() {
  const { data: row } = await supabase
    .from('pressure_log')
    .select('supply_psi, simulated')
    .not('supply_psi', 'is', null)
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (row?.supply_psi != null) {
    cache = {
      psi: parseFloat(row.supply_psi),
      simulated: row.simulated === true,
      ts: Date.now(),
    }
    listeners.forEach(fn => fn(cache))
  }
}

function ensurePolling() {
  if (timer) return
  fetchLatest()
  timer = setInterval(fetchLatest, POLL_MS)
}

function stopPolling() {
  if (listeners.size > 0) return
  if (timer) { clearInterval(timer); timer = null }
}

/**
 * Shared latest-supply-PSI reader backed by a single module-scoped polling loop.
 * Multiple components subscribe without multiplying the Supabase query rate.
 */
export function useLatestSupplyPsi() {
  const [state, setState] = useState(cache)

  useEffect(() => {
    listeners.add(setState)
    ensurePolling()
    if (cache.ts > 0) setState(cache)
    return () => {
      listeners.delete(setState)
      stopPolling()
    }
  }, [])

  return state
}

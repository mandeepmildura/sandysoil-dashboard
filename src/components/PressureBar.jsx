import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Persistent pressure indicator — mounted in App.jsx OUTSIDE <Routes>,
 * so it stays visible on every page. Polls pressure_log directly from
 * Supabase every 10 seconds. No MQTT dependency.
 */
export default function PressureBar() {
  const [psi, setPsi] = useState(null)
  const [simActive, setSimActive] = useState(false)

  useEffect(() => {
    async function fetchLatest() {
      // Get latest pressure reading
      const { data: row } = await supabase
        .from('pressure_log')
        .select('supply_psi, simulated, ts')
        .not('supply_psi', 'is', null)
        .order('ts', { ascending: false })
        .limit(1)
        .single()

      if (row?.supply_psi != null) {
        setPsi(parseFloat(row.supply_psi))
        setSimActive(row.simulated === true)
      }
    }
    fetchLatest()
    const id = setInterval(fetchLatest, 10000)
    return () => clearInterval(id)
  }, [])

  if (psi == null) return null

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-[#304047] text-white">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 12l4-4" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="12" cy="12" r="1" fill="currentColor"/>
        </svg>
        <span className="text-xs font-body text-white/60">Supply</span>
        <span className="font-headline font-bold text-sm">{psi.toFixed(1)}</span>
        <span className="text-[10px] text-white/40">PSI</span>
      </div>
      {simActive && (
        <span className="text-[10px] text-[#4caf50] font-semibold flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4caf50] animate-pulse" />
          SIM
        </span>
      )}
    </div>
  )
}

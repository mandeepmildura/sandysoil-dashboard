import { useState, useEffect, useRef, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { usePressureHistory } from '../hooks/usePressureHistory'
import { supabase } from '../lib/supabase'

// Per-zone pressure draw shown in UI (matches edge function ZONE_DRAW)
const ZONE_DRAW = { 1: 8, 2: 6, 3: 12, 4: 10, 5: 7, 6: 9, 7: 5, 8: 11 }
const PUMP_BASE_PSI = 52

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-xl p-3 shadow-card text-xs font-body border border-[#f3f3f3]">
      <p className="font-semibold text-[#1a1c1c] mb-1">{label}</p>
      {payload.map(p => p.value != null && (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {Number(p.value).toFixed(1)} PSI</p>
      ))}
    </div>
  )
}

export default function PressureAnalysis() {
  const { data: live, connected } = useLiveTelemetry([
    'farm/irrigation1/status',
    'farm/filter1/pressure',
    'farm/filter1/backwash/state',
  ])

  const [historyHours, setHistoryHours] = useState(24)
  const { data: history, loading, reload: reloadHistory } = usePressureHistory(historyHours)

  const irr      = live['farm/irrigation1/status'] ?? {}
  const pressure = live['farm/filter1/pressure']      ?? {}
  const backwash = live['farm/filter1/backwash/state'] ?? {}

  const supplyPsi = irr.supply_psi ?? '—'
  const inletPsi  = pressure.inlet_psi        ?? '—'
  const outletPsi = pressure.outlet_psi       ?? '—'
  const diffPsi   = pressure.differential_psi ?? '—'

  // ── Simulator (server-side via sim-tick edge function + pg_cron) ──
  const [simRunning,  setSimRunning]  = useState(false)
  const [simStatus,   setSimStatus]   = useState('idle') // idle | starting | running | stopped | error
  const [simZone,     setSimZone]     = useState(3)
  const [simScenario, setSimScenario] = useState('full_cycle')
  const [sessionId,   setSessionId]   = useState(null)
  const [liveSimPsi,  setLiveSimPsi]  = useState(null)
  const pollRef = useRef(null)

  // Poll pressure_log for latest simulated value (for live PSI display)
  const startPolling = useCallback(() => {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('pressure_log')
        .select('supply_psi, ts')
        .eq('simulated', true)
        .order('ts', { ascending: false })
        .limit(1)
        .single()
      if (data?.supply_psi != null) setLiveSimPsi(data.supply_psi)
      reloadHistory()
    }, 10000)
  }, [reloadHistory])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // On mount: check if there is already an active session from a previous page visit
  useEffect(() => {
    async function checkActive() {
      const { data } = await supabase
        .from('sim_sessions')
        .select('id, scenario, zone_num')
        .eq('status', 'running')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (data) {
        setSessionId(data.id)
        setSimZone(data.zone_num)
        setSimScenario(data.scenario)
        setSimRunning(true)
        setSimStatus('running')
        startPolling()
      }
    }
    checkActive()
    return () => stopPolling()
  }, [startPolling, stopPolling])

  async function startSimulator() {
    setSimStatus('starting')
    try {
      // Look up irrigation1 device_id
      const { data: device } = await supabase
        .from('devices')
        .select('id')
        .eq('mqtt_topic_base', 'farm/irrigation1')
        .single()

      // Stop any existing session first
      await supabase
        .from('sim_sessions')
        .update({ status: 'stopped' })
        .eq('status', 'running')

      const { data: session, error } = await supabase
        .from('sim_sessions')
        .insert({
          device_id: device?.id ?? null,
          scenario:  simScenario,
          zone_num:  simZone,
          status:    'running',
        })
        .select()
        .single()

      if (error) throw error
      setSessionId(session.id)
      setSimRunning(true)
      setSimStatus('running')
      startPolling()
    } catch (e) {
      setSimStatus('error')
      alert(`Failed to start simulator: ${e.message}`)
    }
  }

  async function stopSimulator() {
    stopPolling()
    if (sessionId) {
      await supabase
        .from('sim_sessions')
        .update({ status: 'stopped' })
        .eq('id', sessionId)
    }
    setSimRunning(false)
    setSimStatus('stopped')
    setSessionId(null)
    setLiveSimPsi(null)
    reloadHistory()
  }

  async function clearSimData() {
    await supabase.from('pressure_log').delete().eq('simulated', true)
    setSimStatus('idle')
    setLiveSimPsi(null)
    reloadHistory()
  }

  // Chart data — filter to supply PSI rows if any exist, else show filter data
  const hasSupply = history.some(d => d.supply != null && d.supply > 0)
  const hasFilter = history.some(d => d.inlet > 0)

  const vitals = [
    { label: 'Supply PSI',   value: liveSimPsi ?? supplyPsi, unit: 'PSI', highlight: true },
    { label: 'Inlet PSI',    value: inletPsi,  unit: 'PSI' },
    { label: 'Outlet PSI',   value: outletPsi, unit: 'PSI' },
    { label: 'Differential', value: diffPsi,   unit: 'PSI' },
  ]

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Pressure Analysis</h1>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
          <span className="text-xs font-body text-[#40493d]">{connected ? 'Live' : 'Connecting…'}</span>
        </div>
      </div>

      {/* Vitals */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {vitals.map(v => (
          <div key={v.label} className="bg-[#ffffff] rounded-xl shadow-card p-4">
            <p className="text-xs font-body text-[#40493d] uppercase tracking-[0.02em] mb-1">{v.label}</p>
            <div className="flex items-end gap-2">
              <span className={`text-3xl font-headline font-bold leading-none ${v.highlight ? 'text-[#00639a]' : 'text-[#1a1c1c]'}`}>
                {v.value}
              </span>
              {v.unit && <span className="text-sm text-[#40493d] mb-0.5">{v.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* Chart */}
        <div className="col-span-2">
          <Card accent="blue">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">
                Pressure History
                {loading && <span className="ml-2 text-xs font-body text-[#40493d] font-normal">Loading…</span>}
              </h2>
              <div className="flex gap-1">
                {[1, 6, 24, 48].map(h => (
                  <button key={h} onClick={() => setHistoryHours(h)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${historyHours === h ? 'bg-[#1a1c1c] text-white' : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'}`}>
                    {h}h
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-[#f3f3f3] rounded-xl p-4">
              {history.length === 0 && !loading ? (
                <div className="h-[240px] flex items-center justify-center text-sm text-[#40493d]">
                  No pressure data yet — run the simulator to generate test data.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={history} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e2" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#40493d' }} interval={Math.max(1, Math.floor(history.length / 10))} />
                    <YAxis domain={[0, 80]} tick={{ fontSize: 10, fill: '#40493d' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={30} stroke="#ba1a1a" strokeDasharray="4 2" label={{ value: 'Low', fontSize: 9, fill: '#ba1a1a' }} />
                    <ReferenceLine y={70} stroke="#e65100" strokeDasharray="4 2" label={{ value: 'High', fontSize: 9, fill: '#e65100' }} />
                    {hasSupply && <Line type="monotone" dataKey="supply" name="Supply" stroke="#00639a" strokeWidth={2} dot={false} />}
                    {hasFilter && <Line type="monotone" dataKey="inlet"  name="Inlet"  stroke="#0d631b" strokeWidth={1.5} dot={false} />}
                    {hasFilter && <Line type="monotone" dataKey="outlet" name="Outlet" stroke="#485860" strokeWidth={1.5} dot={false} />}
                    {hasFilter && <Line type="monotone" dataKey="diff"   name="Diff"   stroke="#6750a4" strokeWidth={1} dot={false} strokeDasharray="4 2" />}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </div>

        {/* Simulator */}
        <div className="space-y-4">
          <Card accent="green">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Pressure Simulator</h2>
            <p className="text-[10px] text-[#40493d] mb-3 leading-relaxed">
              Mimics real pump behaviour — each zone has a different pressure draw. Writes to history log so you can test graphs and alerts.
            </p>

            {/* Zone selector */}
            <div className="mb-3">
              <p className="text-xs text-[#40493d] mb-1.5">Zone</p>
              <div className="grid grid-cols-4 gap-1">
                {[1,2,3,4,5,6,7,8].map(z => (
                  <button key={z} onClick={() => setSimZone(z)} disabled={simRunning}
                    className={`py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${simZone === z ? 'bg-[#00639a] text-white' : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'}`}>
                    Z{z}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#40493d] mt-1">
                Zone {simZone} draw: ~{ZONE_DRAW[simZone]} PSI drop → runs at ~{PUMP_BASE_PSI - ZONE_DRAW[simZone]} PSI
              </p>
            </div>

            {/* Scenario selector */}
            <div className="mb-3">
              <p className="text-xs text-[#40493d] mb-1.5">Scenario</p>
              <div className="space-y-1">
                {[
                  { id: 'full_cycle',   label: 'Full Cycle',         desc: 'Start → run → stop' },
                  { id: 'low_pressure', label: 'Low Pressure Event', desc: 'Fault mid-run → tests alert' },
                  { id: 'ramp_up',      label: 'Pump Start Only',    desc: '0 → 52 PSI ramp' },
                  { id: 'ramp_down',    label: 'Pump Stop Only',     desc: '52 → 0 PSI ramp' },
                ].map(s => (
                  <button key={s.id} onClick={() => setSimScenario(s.id)} disabled={simRunning}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors disabled:opacity-40 ${simScenario === s.id ? 'bg-[#0d631b]/10 border border-[#0d631b]/30' : 'bg-[#f3f3f3] hover:bg-[#e8e8e8]'}`}>
                    <p className="text-xs font-semibold text-[#1a1c1c]">{s.label}</p>
                    <p className="text-[10px] text-[#40493d]">{s.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            {simStatus === 'running' && (
              <div className="mb-3 bg-[#00639a]/10 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-[#00639a] animate-pulse" />
                  <span className="text-[10px] font-semibold text-[#00639a]">Server-side · runs while you navigate</span>
                </div>
                {liveSimPsi != null && (
                  <p className="text-[10px] text-[#40493d]">Latest: <span style={{ color: '#00639a', fontWeight: 600 }}>{liveSimPsi} PSI</span> · chart updates every 10s</p>
                )}
              </div>
            )}
            {simStatus === 'starting' && (
              <p className="text-xs text-[#40493d] mb-2">Starting…</p>
            )}
            {simStatus === 'stopped' && (
              <p className="text-xs text-[#0d631b] font-semibold mb-2">Simulation stopped — chart updated.</p>
            )}
            {simStatus === 'error' && (
              <p className="text-xs text-[#ba1a1a] font-semibold mb-2">Simulation failed.</p>
            )}

            <div className="space-y-2">
              <button
                onClick={simRunning ? stopSimulator : startSimulator}
                disabled={simStatus === 'starting'}
                className={`w-full py-2.5 rounded-xl text-white text-xs font-semibold shadow-fab transition-opacity disabled:opacity-50 ${simRunning ? 'bg-[#ba1a1a] hover:opacity-90' : 'gradient-primary hover:opacity-90'}`}>
                {simStatus === 'starting' ? 'Starting…' : simRunning ? 'Stop Simulation' : 'Run Simulation'}
              </button>
              <button onClick={clearSimData} disabled={simRunning}
                className="w-full py-2 rounded-xl bg-[#f3f3f3] text-[#40493d] text-xs font-semibold hover:bg-[#e8e8e8] disabled:opacity-40 transition-colors">
                Clear Sim Data
              </button>
            </div>
          </Card>

          {/* Backwash */}
          <Card accent="amber">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Backwash Status</h2>
            <div className="space-y-2">
              {[
                { label: 'State',    value: backwash.state   ?? '—' },
                { label: 'Elapsed', value: backwash.elapsed_sec != null ? `${backwash.elapsed_sec}s` : '—' },
                { label: 'Last',    value: backwash.last_complete_ago_sec != null ? fmtAgo(backwash.last_complete_ago_sec) : '—' },
              ].map(r => (
                <div key={r.label} className="flex justify-between bg-[#f3f3f3] rounded-lg px-3 py-2">
                  <span className="text-xs text-[#40493d]">{r.label}</span>
                  <span className="text-xs font-semibold text-[#1a1c1c]">{r.value}</span>
                </div>
              ))}
              <StatusChip
                status={backwash.state === 'MONITORING' ? 'online' : backwash.state === 'TRIGGERED' ? 'running' : 'offline'}
                label={backwash.state ?? 'UNKNOWN'}
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Stats */}
      {history.length > 0 && hasSupply && (
        <Card accent="blue">
          <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Supply Pressure Summary</h2>
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Max',  value: Math.max(...history.filter(d => d.supply).map(d => d.supply)).toFixed(1) + ' PSI' },
              { label: 'Min',  value: Math.min(...history.filter(d => d.supply).map(d => d.supply)).toFixed(1) + ' PSI' },
              { label: 'Avg',  value: (history.filter(d => d.supply).reduce((s, d) => s + d.supply, 0) / history.filter(d => d.supply).length).toFixed(1) + ' PSI' },
              { label: 'Low alerts (<30)',  value: history.filter(d => d.supply < 30 && d.supply > 0).length },
              { label: 'High alerts (>70)', value: history.filter(d => d.supply > 70).length },
            ].map(r => (
              <div key={r.label} className="bg-[#f3f3f3] rounded-lg p-3">
                <p className="text-[10px] text-[#40493d]">{r.label}</p>
                <p className="text-sm font-headline font-bold text-[#1a1c1c] mt-0.5">{r.value}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function fmtAgo(sec) {
  if (sec < 60)   return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

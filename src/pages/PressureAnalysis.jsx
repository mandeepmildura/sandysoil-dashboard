import { useState, useEffect, useRef, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { usePressureHistory } from '../hooks/usePressureHistory'
import { supabase } from '../lib/supabase'

const TIME_RANGES = [
  { label: 'Live', hours: 1 },
  { label: '1H',   hours: 1 },
  { label: '24H',  hours: 24 },
  { label: '7D',   hours: 168 },
]

const ZONE_DRAW    = { 1: 8, 2: 6, 3: 12, 4: 10, 5: 7, 6: 9, 7: 5, 8: 11 }
const PUMP_BASE_PSI = 52

function Icon({ name, className = '' }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-xl p-3 shadow-lg text-xs font-body border border-[#e1e3e2]">
      <p className="font-bold text-[#191c1c] mb-1">{label}</p>
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

  const [rangeIdx,      setRangeIdx]      = useState(0)
  const [historyHours,  setHistoryHours]  = useState(1)
  const { data: history, loading, reload: reloadHistory } = usePressureHistory(historyHours)

  const irr      = live['farm/irrigation1/status']       ?? {}
  const pressure = live['farm/filter1/pressure']         ?? {}
  const backwash = live['farm/filter1/backwash/state']   ?? {}

  const supplyPsi = irr.supply_psi        ?? '—'
  const inletPsi  = pressure.inlet_psi   ?? '—'
  const outletPsi = pressure.outlet_psi  ?? '—'
  const diffPsi   = pressure.differential_psi ?? '—'

  // ── Simulator ──────────────────────────────────────────────────────────────
  const [simRunning,  setSimRunning]  = useState(false)
  const [simStatus,   setSimStatus]   = useState('idle')
  const [simZone,     setSimZone]     = useState(3)
  const [simScenario, setSimScenario] = useState('full_cycle')
  const [sessionId,   setSessionId]   = useState(null)
  const [liveSimPsi,  setLiveSimPsi]  = useState(null)
  const pollRef = useRef(null)

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
        setSessionId(data.id); setSimZone(data.zone_num)
        setSimScenario(data.scenario); setSimRunning(true)
        setSimStatus('running'); startPolling()
      }
    }
    checkActive()
    return () => stopPolling()
  }, [startPolling, stopPolling])

  async function startSimulator() {
    setSimStatus('starting')
    try {
      const { data: device } = await supabase.from('devices').select('id').eq('mqtt_topic_base', 'farm/irrigation1').single()
      await supabase.from('sim_sessions').update({ status: 'stopped' }).eq('status', 'running')
      const { data: session, error } = await supabase.from('sim_sessions')
        .insert({ device_id: device?.id ?? null, scenario: simScenario, zone_num: simZone, status: 'running' })
        .select().single()
      if (error) throw error
      setSessionId(session.id); setSimRunning(true); setSimStatus('running'); startPolling()
    } catch (e) {
      setSimStatus('error'); alert(`Failed to start simulator: ${e.message}`)
    }
  }

  async function stopSimulator() {
    stopPolling()
    if (sessionId) await supabase.from('sim_sessions').update({ status: 'stopped' }).eq('id', sessionId)
    setSimRunning(false); setSimStatus('stopped'); setSessionId(null); setLiveSimPsi(null)
    reloadHistory()
  }

  async function clearSimData() {
    await supabase.from('pressure_log').delete().eq('simulated', true)
    setSimStatus('idle'); setLiveSimPsi(null); reloadHistory()
  }

  async function exportCSV() {
    if (!history.length) return
    const rows = [['Time', 'Supply PSI', 'Inlet PSI', 'Outlet PSI', 'Differential PSI']]
    history.forEach(d => rows.push([d.time, d.supply ?? '', d.inlet ?? '', d.outlet ?? '', d.diff ?? '']))
    const csv  = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'pressure_history.csv' })
    a.click(); URL.revokeObjectURL(url)
  }

  const hasSupply = history.some(d => d.supply != null && d.supply > 0)
  const hasFilter = history.some(d => d.inlet > 0)

  const displayPsi = liveSimPsi ?? supplyPsi

  const vitals = [
    {
      label: 'Supply PSI',
      value: displayPsi,
      icon: 'compress',
      trend: simRunning ? 'up' : null,
      trendLabel: simRunning ? `Sim zone ${simZone} active` : (irr.online ? 'Device online' : 'Device offline'),
      trendColor: irr.online || simRunning ? 'text-emerald-600' : 'text-[#717975]',
    },
    {
      label: 'Inlet PSI',
      value: inletPsi,
      icon: 'input',
      trend: 'flat',
      trendLabel: 'Stable performance',
      trendColor: 'text-[#717975]',
    },
    {
      label: 'Outlet PSI',
      value: outletPsi,
      icon: 'output',
      trend: outletPsi !== '—' && outletPsi < 30 ? 'down' : 'flat',
      trendLabel: outletPsi !== '—' && outletPsi < 30 ? 'Low pressure alert' : 'Normal',
      trendColor: outletPsi !== '—' && outletPsi < 30 ? 'text-[#ba1a1a]' : 'text-[#717975]',
    },
    {
      label: 'Differential',
      value: diffPsi,
      icon: 'difference',
      trend: null,
      trendLabel: 'Optimized Range',
      trendColor: 'text-emerald-600',
      badge: true,
    },
  ]

  return (
    <div className="flex-1 p-8 md:p-12 bg-[#f8faf9] overflow-auto">

      {/* Page header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#717975] mb-2">System Diagnostics</p>
          <h1 className="text-4xl font-extrabold text-[#17362e] tracking-tight">Pressure Analysis</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 mr-2">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-[#c1c8c4]'}`} />
            <span className="text-xs font-semibold text-[#717975]">{connected ? 'Live' : 'Connecting…'}</span>
          </div>
          <button
            onClick={exportCSV}
            className="px-5 py-2.5 rounded-full border border-[#c1c8c4] text-sm font-bold text-[#17362e] hover:bg-[#f2f4f3] transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={reloadHistory}
            className="px-5 py-2.5 rounded-full text-white text-sm font-bold shadow-lg shadow-[#17362e]/20"
            style={{ background: 'linear-gradient(135deg, #17362e 0%, #2e4d44 100%)' }}
          >
            Refresh Data
          </button>
        </div>
      </div>

      {/* Vitals grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {vitals.map(v => (
          <div key={v.label} className="bg-white p-7 rounded-xl shadow-[0px_12px_32px_rgba(25,28,28,0.04)] relative overflow-hidden group">
            {/* Background icon */}
            <div className="absolute top-0 right-0 p-3 opacity-[0.07] group-hover:opacity-[0.13] transition-opacity pointer-events-none">
              <Icon name={v.icon} className="text-6xl text-[#17362e]" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#717975] mb-4">{v.label}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-extrabold text-[#17362e] tracking-tighter leading-none">{v.value}</span>
              <span className="text-sm font-semibold text-[#c1c8c4]">psi</span>
            </div>
            <div className={`mt-4 flex items-center gap-1 ${v.trendColor}`}>
              {v.badge ? (
                <span className="text-[10px] font-extrabold uppercase tracking-widest bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full">
                  {v.trendLabel}
                </span>
              ) : (
                <>
                  <Icon
                    name={v.trend === 'up' ? 'trending_up' : v.trend === 'down' ? 'trending_down' : 'horizontal_rule'}
                    className="text-sm"
                  />
                  <span className="text-xs font-bold">{v.trendLabel}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pressure history chart */}
      <div className="bg-white rounded-xl shadow-[0px_12px_32px_rgba(25,28,28,0.04)] overflow-hidden mb-6">
        <div className="px-8 py-5 border-b border-[#f2f4f3] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-extrabold text-[#17362e] tracking-tight">Pressure History</h2>
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">Live Monitoring</span>
            </div>
          </div>
          <div className="flex bg-[#f2f4f3] p-1 rounded-lg">
            {TIME_RANGES.map((r, i) => (
              <button
                key={r.label}
                onClick={() => { setRangeIdx(i); setHistoryHours(r.hours) }}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                  rangeIdx === i
                    ? 'bg-white shadow-sm text-[#17362e]'
                    : 'text-[#717975] hover:text-[#17362e]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-8">
          {loading ? (
            <div className="h-64 flex items-center justify-center text-sm text-[#717975]">Loading…</div>
          ) : history.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-[#717975]">
              No pressure data yet — run the simulator to generate test data.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={history} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f2f4f3" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#717975', fontFamily: 'Manrope', fontWeight: 600 }} interval={Math.max(1, Math.floor(history.length / 8))} />
                <YAxis domain={[0, 80]} tick={{ fontSize: 10, fill: '#717975', fontFamily: 'Manrope', fontWeight: 600 }} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={30} stroke="#ba1a1a" strokeDasharray="4 2" label={{ value: 'Low', fontSize: 9, fill: '#ba1a1a' }} />
                <ReferenceLine y={70} stroke="#e65100" strokeDasharray="4 2" label={{ value: 'High', fontSize: 9, fill: '#e65100' }} />
                {hasSupply && <Line type="monotone" dataKey="supply" name="Supply" stroke="#17362e" strokeWidth={2.5} dot={false} />}
                {hasFilter && <Line type="monotone" dataKey="inlet"  name="Inlet"  stroke="#2e4d44" strokeWidth={1.5} dot={false} />}
                {hasFilter && <Line type="monotone" dataKey="outlet" name="Outlet" stroke="#4c616c" strokeWidth={1.5} dot={false} />}
                {hasFilter && <Line type="monotone" dataKey="diff"   name="Diff"   stroke="#717975" strokeWidth={1} dot={false} strokeDasharray="4 2" />}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom row — simulator + backwash */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Simulator */}
        <div className="bg-white rounded-xl shadow-[0px_12px_32px_rgba(25,28,28,0.04)] p-7">
          <h2 className="text-base font-extrabold text-[#17362e] mb-1">Pressure Simulator</h2>
          <p className="text-xs text-[#717975] mb-5 leading-relaxed">
            Mimics real pump behaviour — each zone has a different pressure draw. Writes to history log so you can test graphs and alerts.
          </p>

          <div className="mb-4">
            <p className="text-xs font-bold text-[#717975] uppercase tracking-wider mb-2">Zone</p>
            <div className="grid grid-cols-8 gap-1.5">
              {[1,2,3,4,5,6,7,8].map(z => (
                <button key={z} onClick={() => setSimZone(z)} disabled={simRunning}
                  className={`py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 ${simZone === z ? 'bg-[#17362e] text-white' : 'bg-[#f2f4f3] text-[#717975] hover:bg-[#e6e9e8]'}`}>
                  Z{z}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[#717975] mt-2">
              Zone {simZone} draw: ~{ZONE_DRAW[simZone]} PSI → runs at ~{PUMP_BASE_PSI - ZONE_DRAW[simZone]} PSI
            </p>
          </div>

          <div className="mb-5">
            <p className="text-xs font-bold text-[#717975] uppercase tracking-wider mb-2">Scenario</p>
            <div className="space-y-1.5">
              {[
                { id: 'full_cycle',   label: 'Full Cycle',         desc: 'Start → run → stop' },
                { id: 'low_pressure', label: 'Low Pressure Event', desc: 'Fault mid-run → tests alert' },
                { id: 'ramp_up',      label: 'Pump Start Only',    desc: '0 → 52 PSI ramp' },
                { id: 'ramp_down',    label: 'Pump Stop Only',     desc: '52 → 0 PSI ramp' },
              ].map(s => (
                <button key={s.id} onClick={() => setSimScenario(s.id)} disabled={simRunning}
                  className={`w-full text-left px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40 ${simScenario === s.id ? 'bg-[#17362e]/8 border border-[#17362e]/20' : 'bg-[#f2f4f3] hover:bg-[#e6e9e8]'}`}>
                  <p className="text-xs font-bold text-[#191c1c]">{s.label}</p>
                  <p className="text-[10px] text-[#717975]">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {simStatus === 'running' && liveSimPsi != null && (
            <div className="mb-4 bg-emerald-50 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-emerald-700">
                Live: {liveSimPsi} PSI · updates every 10s
              </span>
            </div>
          )}
          {simStatus === 'stopped' && (
            <p className="text-xs font-bold text-emerald-700 mb-3">Simulation stopped — chart updated.</p>
          )}
          {simStatus === 'error' && (
            <p className="text-xs font-bold text-[#ba1a1a] mb-3">Simulation failed.</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={simRunning ? stopSimulator : startSimulator}
              disabled={simStatus === 'starting'}
              className="flex-1 py-2.5 rounded-full text-white text-sm font-bold disabled:opacity-50 transition-opacity"
              style={{ background: simRunning ? '#ba1a1a' : 'linear-gradient(135deg, #17362e 0%, #2e4d44 100%)' }}
            >
              {simStatus === 'starting' ? 'Starting…' : simRunning ? 'Stop Simulation' : 'Run Simulation'}
            </button>
            <button onClick={clearSimData} disabled={simRunning}
              className="px-4 py-2.5 rounded-full bg-[#f2f4f3] text-[#17362e] text-sm font-bold hover:bg-[#e6e9e8] disabled:opacity-40 transition-colors">
              Clear
            </button>
          </div>
        </div>

        {/* Backwash + stats */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-[0px_12px_32px_rgba(25,28,28,0.04)] p-7">
            <h2 className="text-base font-extrabold text-[#17362e] mb-4">Backwash Status</h2>
            <div className="space-y-2">
              {[
                { label: 'State',   value: backwash.state ?? '—' },
                { label: 'Elapsed', value: backwash.elapsed_sec != null ? `${backwash.elapsed_sec}s` : '—' },
                { label: 'Last',    value: backwash.last_complete_ago_sec != null ? fmtAgo(backwash.last_complete_ago_sec) : '—' },
              ].map(r => (
                <div key={r.label} className="flex justify-between bg-[#f2f4f3] rounded-lg px-4 py-2.5">
                  <span className="text-xs font-semibold text-[#717975]">{r.label}</span>
                  <span className="text-xs font-bold text-[#191c1c]">{r.value}</span>
                </div>
              ))}
            </div>
          </div>

          {history.length > 0 && hasSupply && (
            <div className="bg-white rounded-xl shadow-[0px_12px_32px_rgba(25,28,28,0.04)] p-7">
              <h2 className="text-base font-extrabold text-[#17362e] mb-4">Supply Summary</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Max',  value: Math.max(...history.filter(d => d.supply).map(d => d.supply)).toFixed(1) + ' PSI' },
                  { label: 'Min',  value: Math.min(...history.filter(d => d.supply).map(d => d.supply)).toFixed(1) + ' PSI' },
                  { label: 'Avg',  value: (history.filter(d => d.supply).reduce((s, d) => s + d.supply, 0) / history.filter(d => d.supply).length).toFixed(1) + ' PSI' },
                ].map(r => (
                  <div key={r.label} className="bg-[#f2f4f3] rounded-lg p-3 text-center">
                    <p className="text-[10px] font-bold text-[#717975] uppercase tracking-wider">{r.label}</p>
                    <p className="text-lg font-extrabold text-[#17362e] mt-1">{r.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

function fmtAgo(sec) {
  if (sec < 60)   return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

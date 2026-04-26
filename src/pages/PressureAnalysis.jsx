import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { usePressureHistory } from '../hooks/usePressureHistory'
import PressureGauge from '../components/PressureGauge'

const TIME_RANGES = [
  { label: '1H',  hours: 1   },
  { label: '24H', hours: 24  },
  { label: '7D',  hours: 168 },
  { label: '1M',  hours: 720 },
]

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

  const [rangeIdx,     setRangeIdx]     = useState(0)
  const [historyHours, setHistoryHours] = useState(1)
  const { data: history, loading, reload: reloadHistory } = usePressureHistory(historyHours)

  const irr      = live['farm/irrigation1/status']      ?? {}
  const pressure = live['farm/filter1/pressure']        ?? {}
  const backwash = live['farm/filter1/backwash/state']  ?? {}

  const supplyPsi = irr.supply_psi             ?? '—'
  const inletPsi  = pressure.inlet_psi         ?? '—'
  const outletPsi = pressure.outlet_psi        ?? '—'
  const diffPsi   = pressure.differential_psi  ?? '—'

  function exportCSV() {
    if (!history.length) return
    const rows = [['Time', 'Supply PSI', 'Inlet PSI', 'Outlet PSI', 'Differential PSI', 'A6v3 Ch1 PSI']]
    history.forEach(d => rows.push([d.time, d.supply ?? '', d.inlet ?? '', d.outlet ?? '', d.diff ?? '', d.a6v3 ?? '']))
    const csv  = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'pressure_history.csv' })
    a.click(); URL.revokeObjectURL(url)
  }

  const hasSupply = history.some(d => d.supply != null && d.supply > 0)
  const hasFilter = history.some(d => d.inlet > 0)
  const hasA6v3   = history.some(d => d.a6v3 != null && d.a6v3 > 0)

  const vitals = [
    {
      label: 'Supply PSI',
      value: supplyPsi,
      icon: 'compress',
      trendLabel: irr.online ? 'Device online' : 'Device offline',
      trendColor: irr.online ? 'text-emerald-600' : 'text-[#717975]',
    },
    {
      label: 'Inlet PSI',
      value: inletPsi,
      icon: 'input',
      trendLabel: 'Filter inlet',
      trendColor: 'text-[#717975]',
    },
    {
      label: 'Outlet PSI',
      value: outletPsi,
      icon: 'output',
      trendLabel: outletPsi !== '—' && outletPsi < 30 ? 'Low pressure alert' : 'Normal',
      trendColor: outletPsi !== '—' && outletPsi < 30 ? 'text-[#ba1a1a]' : 'text-[#717975]',
    },
    {
      label: 'Differential',
      value: diffPsi,
      icon: 'difference',
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

      {/* Supply pressure gauge — the SSA-V8's primary live reading */}
      <div className="bg-white p-7 rounded-xl shadow-[0px_12px_32px_rgba(25,28,28,0.04)] mb-8 flex items-center justify-between gap-6 flex-wrap">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#717975] mb-2">Supply Pressure</p>
          <p className="text-xs text-[#40493d] max-w-md">
            Live reading from the irrigation controller's pressure sensor. Green = healthy range, orange = high, red = over threshold.
          </p>
        </div>
        <PressureGauge psi={typeof supplyPsi === 'number' ? supplyPsi : 0} maxPsi={100} size="lg" />
      </div>

      {/* Vitals grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {vitals.map(v => (
          <div key={v.label} className="bg-white p-7 rounded-xl shadow-[0px_12px_32px_rgba(25,28,28,0.04)] relative overflow-hidden group">
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
                <span className="text-xs font-bold">{v.trendLabel}</span>
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
              No pressure data recorded yet.
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
                {hasSupply && <Line type="monotone" dataKey="supply" name="Supply"      stroke="#17362e" strokeWidth={2.5} dot={false} />}
                {hasFilter && <Line type="monotone" dataKey="inlet"  name="Inlet"       stroke="#2e4d44" strokeWidth={1.5} dot={false} />}
                {hasFilter && <Line type="monotone" dataKey="outlet" name="Outlet"      stroke="#4c616c" strokeWidth={1.5} dot={false} />}
                {hasFilter && <Line type="monotone" dataKey="diff"   name="Diff"        stroke="#717975" strokeWidth={1}   dot={false} strokeDasharray="4 2" />}
                {hasA6v3   && <Line type="monotone" dataKey="a6v3"   name="A6v3 Ch1"   stroke="#00639a" strokeWidth={2}   dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom row — backwash + supply summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                { label: 'Max', value: Math.max(...history.filter(d => d.supply).map(d => d.supply)).toFixed(1) + ' PSI' },
                { label: 'Min', value: Math.min(...history.filter(d => d.supply).map(d => d.supply)).toFixed(1) + ' PSI' },
                { label: 'Avg', value: (history.filter(d => d.supply).reduce((s, d) => s + d.supply, 0) / history.filter(d => d.supply).length).toFixed(1) + ' PSI' },
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
  )
}

function fmtAgo(sec) {
  if (sec < 60)   return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

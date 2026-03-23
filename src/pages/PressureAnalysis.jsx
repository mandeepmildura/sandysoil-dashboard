import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { usePressureHistory } from '../hooks/usePressureHistory'

const TOPICS = ['farm/filter1/pressure', 'farm/filter1/backwash/state']

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 shadow-card text-xs font-body">
      <p className="font-semibold text-[#1a1c1c] mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {Number(p.value).toFixed(1)} PSI</p>
      ))}
    </div>
  )
}

export default function PressureAnalysis() {
  const { data: live, connected } = useLiveTelemetry(TOPICS)
  const { data: history, loading } = usePressureHistory(24)

  const pressure = live['farm/filter1/pressure']      ?? {}
  const backwash = live['farm/filter1/backwash/state'] ?? {}

  const inletPsi  = pressure.inlet_psi        ?? '—'
  const outletPsi = pressure.outlet_psi       ?? '—'
  const diffPsi   = pressure.differential_psi ?? '—'

  const vitals = [
    { label: 'Inlet PSI',      value: inletPsi,  unit: 'PSI' },
    { label: 'Outlet PSI',     value: outletPsi, unit: 'PSI' },
    { label: 'Differential',   value: diffPsi,   unit: 'PSI' },
    { label: 'Backwash State', value: backwash.state ?? '—', unit: '' },
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
              <span className="text-3xl font-headline font-bold text-[#1a1c1c] leading-none">{v.value}</span>
              {v.unit && <span className="text-sm text-[#40493d] mb-0.5">{v.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <Card accent="blue" className="mb-6">
        <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">
          24-Hour Pressure History
          {loading && <span className="ml-2 text-xs font-body text-[#40493d] font-normal">Loading…</span>}
        </h2>
        <div className="bg-[#f3f3f3] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={history} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e2" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#40493d', fontFamily: 'Inter' }} interval={Math.max(1, Math.floor(history.length / 12))} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#40493d', fontFamily: 'Inter' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'Inter' }} />
              <Line type="monotone" dataKey="inlet"  name="Inlet"   stroke="#00639a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="outlet" name="Outlet"  stroke="#485860" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="diff"   name="Diff"    stroke="#0d631b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-6">
        <Card accent="green">
          <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Pressure Summary</h2>
          {history.length > 0 ? (
            <div className="space-y-3">
              {[
                { label: 'Inlet — Max',  value: Math.max(...history.map(d => d.inlet)).toFixed(1)  + ' PSI' },
                { label: 'Inlet — Min',  value: Math.min(...history.map(d => d.inlet)).toFixed(1)  + ' PSI' },
                { label: 'Inlet — Avg',  value: (history.reduce((s, d) => s + d.inlet, 0) / history.length).toFixed(1) + ' PSI' },
                { label: 'Outlet — Avg', value: (history.reduce((s, d) => s + d.outlet, 0) / history.length).toFixed(1) + ' PSI' },
                { label: 'Max Diff',     value: Math.max(...history.map(d => d.diff)).toFixed(1)   + ' PSI' },
              ].map(r => (
                <div key={r.label} className="flex justify-between bg-[#f3f3f3] rounded-lg p-3">
                  <span className="text-xs text-[#40493d]">{r.label}</span>
                  <span className="text-sm font-headline font-bold text-[#1a1c1c]">{r.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#40493d]">No data for the last 24 hours.</p>
          )}
        </Card>

        <Card accent="amber">
          <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Backwash Status</h2>
          <div className="space-y-3">
            {[
              { label: 'State',               value: backwash.state          ?? '—' },
              { label: 'Relay',               value: backwash.relay_on ? 'ON' : 'OFF' },
              { label: 'Elapsed',             value: backwash.elapsed_sec    != null ? `${backwash.elapsed_sec}s`  : '—' },
              { label: 'Last complete',        value: backwash.last_complete_ago_sec != null ? fmtAgo(backwash.last_complete_ago_sec) : '—' },
            ].map(r => (
              <div key={r.label} className="flex justify-between bg-[#f3f3f3] rounded-lg p-3">
                <span className="text-xs text-[#40493d]">{r.label}</span>
                <span className="text-sm font-semibold text-[#1a1c1c]">{r.value}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <StatusChip
                status={backwash.state === 'MONITORING' ? 'online' : backwash.state === 'TRIGGERED' ? 'running' : 'offline'}
                label={backwash.state ?? 'UNKNOWN'}
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function fmtAgo(sec) {
  if (sec < 60)   return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

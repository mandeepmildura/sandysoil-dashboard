import { useState, useEffect, useRef } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useA6v3PressureHistory } from '../hooks/useA6v3PressureHistory'
import { a6v3OutputOn, a6v3OutputOff, logA6v3Pressure } from '../lib/commands'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts'

const A6V3_TOPIC = 'A6v3/8CBFEA03002C/STATE'
const MAX_PSI = 116
const ADC_MAX = 4095

function adcToPsi(adc) {
  return (adc / ADC_MAX) * MAX_PSI
}

function gaugeColor(psi) {
  if (psi >= 100) return '#ba1a1a'
  if (psi >= 80)  return '#e65c00'
  return '#0d631b'
}

function PressureGauge({ psi }) {
  const R = 70
  const cx = 90
  const cy = 90
  const startAngle = 210
  const endAngle   = -30
  const totalArc   = 240

  const clampedPsi = Math.min(Math.max(psi, 0), MAX_PSI)
  const fraction   = clampedPsi / MAX_PSI
  const fillArc    = fraction * totalArc

  function polar(angle, r = R) {
    const rad = (angle * Math.PI) / 180
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)]
  }

  function arcPath(startDeg, sweepDeg, r = R) {
    const [x1, y1] = polar(startDeg, r)
    const endDeg   = startDeg - sweepDeg
    const [x2, y2] = polar(endDeg, r)
    const large    = sweepDeg > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
  }

  const color = gaugeColor(clampedPsi)

  return (
    <svg viewBox="0 0 180 110" className="w-full max-w-[220px] mx-auto">
      {/* Track */}
      <path d={arcPath(startAngle, totalArc)} fill="none" stroke="#e2e2e2" strokeWidth="10" strokeLinecap="round" />
      {/* Fill */}
      {fillArc > 0 && (
        <path d={arcPath(startAngle, fillArc)} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      )}
      {/* Zone markers */}
      <text x={polar(startAngle, R + 14)[0]} y={polar(startAngle, R + 14)[1]} textAnchor="middle" fontSize="8" fill="#40493d">0</text>
      <text x={polar(-30, R + 14)[0]} y={polar(-30, R + 14)[1]} textAnchor="middle" fontSize="8" fill="#40493d">{MAX_PSI}</text>
      {/* PSI value */}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill={color} fontFamily="sans-serif">
        {clampedPsi.toFixed(1)}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="#40493d" fontFamily="sans-serif">PSI</text>
    </svg>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#e2e2e2] rounded-lg px-3 py-2 shadow text-xs">
      <p className="text-[#40493d] mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.value?.toFixed(1)} PSI
        </p>
      ))}
    </div>
  )
}

export default function A6v3Controller() {
  const { data: live, connected } = useLiveTelemetry([A6V3_TOPIC])
  const [a6v3Busy, setA6v3Busy] = useState({})
  const [showGraph, setShowGraph] = useState(false)
  const [historyHours, setHistoryHours] = useState(6)
  const lastLogRef = useRef(0)

  const { data: history, loading: histLoading, reload } = useA6v3PressureHistory(historyHours)

  const a6v3 = live[A6V3_TOPIC] ?? null
  const a6v3Outputs = Array.from({ length: 6 }, (_, i) => a6v3?.[`output${i + 1}`]?.value ?? false)
  const a6v3Inputs  = Array.from({ length: 6 }, (_, i) => a6v3?.[`input${i + 1}`]?.value ?? false)
  const adcRaw = a6v3?.adc1?.value ?? 0
  const psi    = adcToPsi(adcRaw)

  // Log to Supabase at most once per 60s when adc reading changes
  useEffect(() => {
    if (!a6v3 || adcRaw === 0) return
    const now = Date.now()
    if (now - lastLogRef.current < 60000) return
    lastLogRef.current = now
    logA6v3Pressure(psi)
  }, [adcRaw])

  // Reload history when graph opens or time range changes
  useEffect(() => {
    if (showGraph) reload()
  }, [showGraph, historyHours])

  async function handleToggle(n, currentlyOn) {
    setA6v3Busy(b => ({ ...b, [n]: true }))
    try {
      currentlyOn ? await a6v3OutputOff(n) : await a6v3OutputOn(n)
    } catch (e) { console.error(e) }
    setA6v3Busy(b => ({ ...b, [n]: false }))
  }

  const color = gaugeColor(psi)

  return (
    <div className="flex-1 p-4 md:p-6 bg-[#f9f9f9] overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">A6v3 Controller</h1>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
        </div>
        <StatusChip status={a6v3 ? 'online' : 'offline'} label={a6v3 ? 'Online' : 'Offline'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — pressure gauge + graph */}
        <div className="space-y-4">
          {/* Pressure gauge card */}
          <Card
            accent={psi >= 100 ? 'red' : psi >= 80 ? 'amber' : 'green'}
            className="cursor-pointer select-none"
          >
            <div onClick={() => setShowGraph(s => !s)}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-headline font-semibold text-sm text-[#1a1c1c]">CH1 Pressure</h2>
                <span className="text-xs text-[#40493d]">{showGraph ? '▲ Hide graph' : '▼ Show graph'}</span>
              </div>
              <PressureGauge psi={psi} />
              <div className="mt-2 text-center">
                <span className="text-xs font-body text-[#40493d]">ADC {adcRaw} / {ADC_MAX} · 0–{MAX_PSI} PSI range</span>
              </div>
            </div>

            {/* Inline history graph */}
            {showGraph && (
              <div className="mt-4 border-t border-[#e2e2e2] pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[#40493d]">History</span>
                  <div className="flex gap-1">
                    {[1, 6, 24].map(h => (
                      <button
                        key={h}
                        onClick={e => { e.stopPropagation(); setHistoryHours(h) }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                          historyHours === h
                            ? 'bg-[#0d631b] text-white'
                            : 'bg-[#e2e2e2] text-[#40493d] hover:bg-[#d5d5d5]'
                        }`}
                      >{h}h</button>
                    ))}
                  </div>
                </div>
                {histLoading ? (
                  <div className="h-[160px] flex items-center justify-center text-xs text-[#40493d]">Loading…</div>
                ) : history.length === 0 ? (
                  <div className="h-[160px] flex items-center justify-center text-xs text-[#40493d]">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={history} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} onClick={e => e?.stopPropagation?.()}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f2f4f3" />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#717975' }} interval={Math.max(1, Math.floor(history.length / 6))} />
                      <YAxis domain={[0, MAX_PSI]} tick={{ fontSize: 9, fill: '#717975' }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="psi" name="Pressure" stroke={color} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </Card>

          {/* Inputs */}
          <Card>
            <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">Inputs (DI1–DI6)</h3>
            <div className="grid grid-cols-3 gap-1.5">
              {a6v3Inputs.map((active, i) => (
                <div
                  key={i}
                  className={`py-1.5 rounded text-[10px] font-semibold text-center ${
                    active ? 'bg-[#e8f5e9] text-[#0d631b]' : 'bg-[#f3f3f3] text-[#40493d]'
                  }`}
                >
                  DI{i + 1}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right — relay cards */}
        <div className="lg:col-span-2">
          <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-3">Relays (DO1–DO6)</h2>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            {a6v3Outputs.map((on, i) => (
              <Card key={i} accent={on ? 'green' : undefined}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-headline font-bold text-[#1a1c1c]">Relay {i + 1}</p>
                    <p className="text-xs text-[#40493d]">DO{i + 1}</p>
                  </div>
                  <span className={`w-3 h-3 rounded-full mt-0.5 ${on ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
                </div>
                <StatusChip status={on ? 'running' : 'offline'} label={on ? 'ON' : 'OFF'} />
                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => handleToggle(i + 1, on)}
                    disabled={!!a6v3Busy[i + 1] || on}
                    className="flex-1 py-1 rounded-md bg-[#0d631b] text-white text-[10px] font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >On</button>
                  <button
                    onClick={() => handleToggle(i + 1, on)}
                    disabled={!!a6v3Busy[i + 1] || !on}
                    className="flex-1 py-1 rounded-md bg-[#e2e2e2] text-[#1a1c1c] text-[10px] font-semibold hover:bg-[#d5d5d5] disabled:opacity-40 transition-all"
                  >Off</button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

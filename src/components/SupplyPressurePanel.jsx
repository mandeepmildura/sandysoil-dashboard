import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import Card from './Card'
import PressureGauge from './PressureGauge'
import { gaugeColor } from '../lib/relayDevice'
import { supabase } from '../lib/supabase'
import { localDateStr } from '../lib/format'

/**
 * Supply-pressure panel for the SSA-V8 irrigation controller.
 *
 * Mirrors the A6v3 PressurePanel layout:
 *   - Click-to-expand card with gauge on top
 *   - Time-range buttons (1h / 6h / 24h / 7d / Custom)
 *   - Recharts line chart of historical supply PSI
 *
 * Reads live PSI from the firmware's `supply_psi` field. History is
 * pulled from `pressure_log.supply_psi`.
 */
export default function SupplyPressurePanel({ supplyPsi, maxPsi = 100 }) {
  const psi = typeof supplyPsi === 'number' ? supplyPsi : 0
  const [showGraph, setShowGraph] = useState(false)
  const [histPreset, setHistPreset] = useState('6h')
  const [customDate, setCustomDate] = useState(() => localDateStr())
  const [customFrom, setCustomFrom] = useState('05:00')
  const [customTo, setCustomTo]   = useState('07:00')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)

  // Tick once a minute so rolling windows advance
  const [rangeTick, setRangeTick] = useState(0)
  useEffect(() => {
    if (histPreset === 'custom') return
    const id = setInterval(() => setRangeTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [histPreset])

  const range = useMemo(() => {
    if (histPreset === 'custom') {
      return {
        from: new Date(`${customDate}T${customFrom}:00`).toISOString(),
        to:   new Date(`${customDate}T${customTo}:00`).toISOString(),
      }
    }
    const hours = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 }[histPreset] ?? 6
    const now = Date.now()
    return {
      from: new Date(now - hours * 3600_000).toISOString(),
      to:   new Date(now).toISOString(),
    }
  }, [histPreset, customDate, customFrom, customTo, rangeTick])

  async function reload() {
    if (!showGraph) return
    setLoading(true)
    const { data: rows, error } = await supabase
      .from('pressure_log')
      .select('ts, supply_psi')
      .gte('ts', range.from)
      .lte('ts', range.to)
      .not('supply_psi', 'is', null)
      .order('ts', { ascending: true })
    if (error || !rows) { setHistory([]); setLoading(false); return }
    // Bucket: choose interval so we have ~60 points max
    const points = rows.map(r => ({
      ts:  new Date(r.ts).getTime(),
      psi: parseFloat(r.supply_psi),
    }))
    if (points.length === 0) { setHistory([]); setLoading(false); return }

    const bucketMin = histPreset === '1h' ? 1 : histPreset === '6h' ? 6 : histPreset === '24h' ? 15 : histPreset === '7d' ? 60 : 5
    const bucketMs  = bucketMin * 60_000
    const buckets   = new Map()
    for (const p of points) {
      const bucketKey = Math.floor(p.ts / bucketMs) * bucketMs
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, [])
      buckets.get(bucketKey).push(p.psi)
    }
    const out = Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([ts, vals]) => {
        const d = new Date(ts)
        const tag = histPreset === '24h' || histPreset === '7d'
          ? `${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
          : `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
        return { time: tag, psi: vals.reduce((a, b) => a + b, 0) / vals.length }
      })
    setHistory(out)
    setLoading(false)
  }

  useEffect(() => { reload() }, [showGraph, range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 5 min while open
  useEffect(() => {
    if (!showGraph) return
    const id = setInterval(reload, 300_000)
    return () => clearInterval(id)
  }, [showGraph, range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const color = gaugeColor(psi, maxPsi)

  return (
    <Card accent={psi >= maxPsi * 0.86 ? 'red' : psi >= maxPsi * 0.69 ? 'amber' : 'green'} className="cursor-pointer select-none">
      <div onClick={() => setShowGraph(s => !s)}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-headline font-semibold text-sm text-[#1a1c1c]">Supply Pressure</h2>
          <span className="text-xs text-[#40493d]">{showGraph ? '▲ Hide graph' : '▼ Show graph'}</span>
        </div>
        <PressureGauge psi={psi} maxPsi={maxPsi} />
        <div className="mt-2 text-center">
          <span className="text-xs font-body text-[#40493d]">0–{maxPsi} PSI range</span>
        </div>
      </div>

      {showGraph && (
        <div className="mt-4 border-t border-[#e2e2e2] pt-4">
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#40493d]">History</span>
              <div className="flex gap-1">
                {[['1h','1h'],['6h','6h'],['24h','24h'],['7d','7d'],['custom','Custom']].map(([val, label]) => (
                  <button key={val} onClick={e => { e.stopPropagation(); setHistPreset(val) }}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                      histPreset === val ? 'bg-[#0d631b] text-white' : 'bg-[#e2e2e2] text-[#40493d] hover:bg-[#d5d5d5]'
                    }`}
                  >{label}</button>
                ))}
              </div>
            </div>
            {histPreset === 'custom' && (
              <div className="flex flex-wrap gap-2 items-end mt-2" onClick={e => e.stopPropagation()}>
                <div className="flex-1 min-w-[110px]">
                  <label className="text-[10px] text-[#40493d] block mb-0.5">Date</label>
                  <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
                    className="w-full bg-[#f3f3f3] rounded px-2 py-1 text-[11px] outline-none border border-[#e2e2e2]" />
                </div>
                <div>
                  <label className="text-[10px] text-[#40493d] block mb-0.5">From</label>
                  <input type="time" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="bg-[#f3f3f3] rounded px-2 py-1 text-[11px] w-24 outline-none border border-[#e2e2e2]" />
                </div>
                <div>
                  <label className="text-[10px] text-[#40493d] block mb-0.5">To</label>
                  <input type="time" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="bg-[#f3f3f3] rounded px-2 py-1 text-[11px] w-24 outline-none border border-[#e2e2e2]" />
                </div>
                <button onClick={e => { e.stopPropagation(); reload() }}
                  className="px-3 py-1 rounded bg-[#0d631b] text-white text-[10px] font-semibold hover:opacity-90">Go</button>
              </div>
            )}
          </div>
          {loading ? (
            <div className="h-[160px] flex items-center justify-center text-xs text-[#40493d]">Loading…</div>
          ) : history.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-xs text-[#40493d]">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={history} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} onClick={e => e?.stopPropagation?.()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f2f4f3" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#717975' }} interval={Math.max(1, Math.floor(history.length / 6))} />
                <YAxis domain={[0, maxPsi]} tick={{ fontSize: 9, fill: '#717975' }} />
                <Tooltip content={<PressureTooltip />} />
                <Line type="monotone" dataKey="psi" name="Pressure" stroke={color} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </Card>
  )
}

function PressureTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#e2e2e2] rounded-lg px-3 py-2 shadow text-xs">
      <p className="text-[#40493d] mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">{p.value?.toFixed(1)} PSI</p>
      ))}
    </div>
  )
}

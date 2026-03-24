import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useZoneHistory } from '../hooks/useZoneHistory'
import { zoneOn, zoneOff, allZonesOff, durationToMinutes } from '../lib/commands'

const DURATIONS = ['15 min', '30 min', '1 hour', 'Custom']

export default function ZoneDetail() {
  const { id = '1' } = useParams()
  const zoneNum = parseInt(id)
  const [selectedDuration, setSelectedDuration] = useState('30 min')
  const [cmdSending, setCmdSending] = useState(false)
  const [cmdError, setCmdError]     = useState(null)

  async function handleStart() {
    setCmdSending(true); setCmdError(null)
    try { await zoneOn(zoneNum, durationToMinutes(selectedDuration)) }
    catch (e) { setCmdError(e.message) }
    setCmdSending(false)
  }

  async function handleStop() {
    setCmdSending(true); setCmdError(null)
    try { await zoneOff(zoneNum) }
    catch (e) { setCmdError(e.message) }
    setCmdSending(false)
  }

  async function handleAllOff() {
    setCmdSending(true); setCmdError(null)
    try { await allZonesOff() }
    catch (e) { setCmdError(e.message) }
    setCmdSending(false)
  }

  const { data: live } = useLiveTelemetry(['farm/irrigation1/status'])
  const { history, loading, reload } = useZoneHistory(zoneNum, 20)

  const irr   = live['farm/irrigation1/status'] ?? null
  const zones = irr?.zones ?? []
  const zone  = zones.find(z => z.id === zoneNum) ?? null
  const isRunning = zone?.on ?? false

  // Chart data — last 10 completed runs, oldest first
  const chartData = [...history]
    .filter(h => h.duration_min)
    .slice(0, 10)
    .reverse()
    .map(h => ({
      label: fmtTime(new Date(h.started_at)),
      duration: Number(Number(h.duration_min).toFixed(1)),
    }))

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs font-body text-[#40493d] mb-4">
        <Link to="/" className="hover:text-[#1a1c1c]">Dashboard</Link>
        <span>/</span>
        <Link to="/zones" className="hover:text-[#1a1c1c]">Zones</Link>
        <span>/</span>
        <span className="text-[#1a1c1c] font-semibold">{zone?.name ?? `Zone ${zoneNum}`}</span>
      </nav>

      <div className="flex items-center gap-4 mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">{zone?.name ?? `Zone ${zoneNum}`}</h1>
        <StatusChip status={isRunning ? 'running' : 'offline'} label={isRunning ? 'RUNNING' : 'OFF'} />
      </div>

      {/* Vitals */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Supply PSI',    value: irr?.supply_psi ?? '—', unit: 'PSI' },
          { label: 'Zone State',    value: zone?.state ?? '—',     unit: '' },
          { label: 'Device',        value: irr?.online ? 'Online' : 'Offline', unit: '' },
        ].map(v => (
          <div key={v.label} className="bg-[#ffffff] rounded-xl shadow-card p-4">
            <p className="text-xs font-body text-[#40493d] uppercase tracking-[0.02em] mb-1">{v.label}</p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-headline font-bold text-[#1a1c1c] leading-none">{v.value}</span>
              {v.unit && <span className="text-sm text-[#40493d] mb-0.5">{v.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* History chart */}
      {chartData.length > 0 && (
        <div className="mb-6">
          <Card accent="blue">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">Run Duration History</h2>
              <button
                onClick={reload}
                className="text-xs text-[#00639a] font-semibold hover:underline"
              >
                Refresh
              </button>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f3f3" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#40493d' }} />
                <YAxis tick={{ fontSize: 10, fill: '#40493d' }} unit=" min" />
                <Tooltip
                  formatter={(v) => [`${v} min`, 'Duration']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
                />
                <Bar dataKey="duration" fill="#0d631b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Manual control */}
        <div className="space-y-4">
          <Card accent="green">
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Manual Control</h2>
            {isRunning ? (
              <>
                <div className="mb-4 bg-[#0d631b]/5 rounded-xl p-4 text-center">
                  <p className="text-xs text-[#40493d] mb-1">Zone is running</p>
                  <p className="text-2xl font-headline font-bold text-[#0d631b]">{zone?.state}</p>
                </div>
                <button
                  onClick={handleStop}
                  disabled={cmdSending}
                  className="w-full py-4 rounded-xl bg-[#ba1a1a] text-white font-headline font-bold text-lg shadow-fab hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {cmdSending ? 'Sending…' : 'STOP ZONE'}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs font-body text-[#40493d] mb-2">Run for:</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {DURATIONS.map(d => (
                    <button
                      key={d}
                      onClick={() => setSelectedDuration(d)}
                      className={`py-2 rounded-lg text-sm font-body font-medium transition-colors ${
                        selectedDuration === d ? 'gradient-primary text-white' : 'bg-[#f3f3f3] text-[#1a1c1c] hover:bg-[#e8e8e8]'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleStart}
                  disabled={cmdSending}
                  className="w-full py-3 rounded-xl gradient-primary text-white font-headline font-bold text-base shadow-fab hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {cmdSending ? 'Sending…' : 'Start Zone'}
                </button>
              </>
            )}
            {cmdError && (
              <p className="mt-2 text-xs text-[#ba1a1a] bg-[#ffdad6] rounded-lg px-3 py-2">{cmdError}</p>
            )}
            <div className="mt-4 pt-4 border-t border-[#f3f3f3]">
              <button
                onClick={handleAllOff}
                disabled={cmdSending}
                className="w-full py-2.5 rounded-xl border-2 border-[#ba1a1a]/30 text-[#ba1a1a] font-body font-semibold text-sm hover:bg-[#ba1a1a]/5 transition-colors disabled:opacity-50"
              >
                ALL ZONES OFF
              </button>
            </div>
          </Card>
        </div>

        {/* Run history */}
        <div className="col-span-2">
          <Card accent="blue">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">
                Run History
                {loading && <span className="ml-2 text-xs font-body text-[#40493d] font-normal">Loading…</span>}
              </h2>
              <button
                onClick={reload}
                className="text-xs text-[#00639a] font-semibold hover:underline"
              >
                Refresh
              </button>
            </div>
            {history.length === 0 && !loading && (
              <p className="text-sm text-[#40493d]">No run history for this zone.</p>
            )}
            <div className="space-y-2">
              {history.map((h) => {
                const start  = new Date(h.started_at)
                const isOpen = !h.ended_at
                const durMin = h.duration_min ? Number(h.duration_min).toFixed(0) : null
                return (
                  <div
                    key={h.id}
                    className={`rounded-xl p-4 flex items-center justify-between ${isOpen ? 'bg-[#0d631b]/5' : 'bg-[#f3f3f3]'}`}
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-xs font-semibold text-[#40493d]">{fmtDate(start)}</p>
                        <p className="text-sm font-headline font-bold text-[#1a1c1c]">{fmtTime(start)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#40493d]">Duration</p>
                        <p className="text-sm font-semibold text-[#1a1c1c]">{durMin ? `${durMin} min` : 'Running…'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#40493d]">Source</p>
                        <p className="text-sm font-semibold text-[#1a1c1c] capitalize">{h.source}</p>
                      </div>
                    </div>
                    <StatusChip
                      status={isOpen ? 'running' : 'completed'}
                      label={isOpen ? 'RUNNING' : 'DONE'}
                    />
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function fmtDate(d) {
  const now   = new Date()
  const today = now.toDateString()
  const yest  = new Date(now - 86400000).toDateString()
  if (d.toDateString() === today) return 'Today'
  if (d.toDateString() === yest)  return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
function fmtTime(d) {
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
}

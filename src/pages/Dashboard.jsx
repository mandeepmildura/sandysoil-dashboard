import { useState } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { startBackwash, allZonesOff, zoneOn, zoneOff } from '../lib/commands'

const TOPICS = [
  'farm/irrigation1/status',
  'farm/filter1/pressure',
  'farm/filter1/backwash/state',
]

export default function Dashboard() {
  const { data, connected } = useLiveTelemetry(TOPICS)
  const [busy, setBusy] = useState({})

  async function handleZoneOn(id) {
    setBusy(b => ({ ...b, [id]: true }))
    try { await zoneOn(id, 30) } catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [id]: false }))
  }

  async function handleZoneOff(id) {
    setBusy(b => ({ ...b, [id]: true }))
    try { await zoneOff(id) } catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [id]: false }))
  }

  const irr      = data['farm/irrigation1/status']   ?? null
  const pressure = data['farm/filter1/pressure']      ?? null
  const backwash = data['farm/filter1/backwash/state'] ?? null

  const zones       = irr?.zones ?? Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}`, on: false, state: 'off' }))
  const supplyPsi   = irr?.supply_psi ?? '—'
  const activeCount = zones.filter(z => z.on).length
  const inletPsi    = pressure?.inlet_psi ?? '—'
  const outletPsi   = pressure?.outlet_psi ?? '—'
  const diffPsi     = pressure?.differential_psi ?? '—'
  const bwState     = backwash?.state ?? '—'

  const vitals = [
    { label: 'Supply Pressure', value: supplyPsi, unit: 'PSI', status: irr?.online ? 'online' : 'offline', statusLabel: irr?.online ? 'ONLINE' : 'OFFLINE' },
    { label: 'Filter Inlet',    value: inletPsi,  unit: 'PSI', status: 'online',  statusLabel: 'NORMAL' },
    { label: 'Filter Outlet',   value: outletPsi, unit: 'PSI', status: 'online',  statusLabel: 'NORMAL' },
    { label: 'Active Zones',    value: String(activeCount), unit: `/ ${zones.length}`, status: activeCount > 0 ? 'running' : 'offline', statusLabel: activeCount > 0 ? 'RUNNING' : 'IDLE' },
  ]

  return (
    <div className="flex-1 p-4 md:p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Farm Dashboard</h1>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
          <span className="text-xs font-body text-[#40493d]">{connected ? 'Live' : 'Connecting…'}</span>
        </div>
      </div>

      {/* Vitals strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {vitals.map(v => (
          <div key={v.label} className="bg-[#ffffff] rounded-xl shadow-card p-4">
            <p className="text-xs font-body text-[#40493d] uppercase tracking-[0.02em] mb-1">{v.label}</p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-headline font-bold text-[#1a1c1c] leading-none">{v.value}</span>
              <span className="text-sm text-[#40493d] mb-0.5">{v.unit}</span>
            </div>
            <div className="mt-2"><StatusChip status={v.status} label={v.statusLabel} /></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Zone grid */}
        <div className="lg:col-span-2">
          <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-3">Irrigation Zones</h2>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {zones.map(zone => (
              <Card key={zone.id} accent={zone.on ? 'green' : undefined}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-headline font-bold text-sm text-[#1a1c1c]">{zone.name}</p>
                    <p className="text-xs text-[#40493d]">{zone.state}</p>
                  </div>
                  <span className={`w-2.5 h-2.5 rounded-full mt-1 ${zone.on ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
                </div>
                <StatusChip status={zone.on ? 'running' : 'offline'} label={zone.on ? 'ON' : 'OFF'} />
                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => handleZoneOn(zone.id)}
                    disabled={!!busy[zone.id]}
                    className="flex-1 py-1 rounded-md bg-[#0d631b] text-white text-[10px] font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >Start</button>
                  <button
                    onClick={() => handleZoneOff(zone.id)}
                    disabled={!!busy[zone.id]}
                    className="flex-1 py-1 rounded-md bg-[#e2e2e2] text-[#1a1c1c] text-[10px] font-semibold hover:bg-[#d5d5d5] disabled:opacity-40 transition-all"
                  >Stop</button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Filter station */}
          <Card accent="blue">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Filter Station</h2>
            <div className="space-y-2 mb-4">
              {[
                { label: 'Inlet PSI',     value: inletPsi },
                { label: 'Outlet PSI',    value: outletPsi },
                { label: 'Differential',  value: diffPsi !== '—' ? `${diffPsi} PSI` : '—' },
                { label: 'Backwash',      value: bwState },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-xs">
                  <span className="text-[#40493d]">{r.label}</span>
                  <span className="font-semibold text-[#1a1c1c]">{r.value}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => startBackwash().catch(console.error)}
              className="w-full py-2 rounded-lg bg-[#f3f3f3] text-xs font-body font-semibold text-[#00639a] hover:bg-[#e8e8e8] transition-colors"
            >
              Start Backwash
            </button>
          </Card>

          {/* Device info */}
          <Card accent="green">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Device Status</h2>
            <div className="space-y-2 text-xs font-body">
              {[
                { label: 'Firmware',  value: irr?.fw      ?? '—' },
                { label: 'RSSI',      value: irr?.rssi != null ? `${irr.rssi} dBm` : '—' },
                { label: 'Uptime',    value: irr?.uptime  != null ? fmtUptime(irr.uptime) : '—' },
                { label: 'Status',    value: irr?.online  ? 'Online' : 'Offline' },
              ].map(r => (
                <div key={r.label} className="flex justify-between">
                  <span className="text-[#40493d]">{r.label}</span>
                  <span className="font-semibold text-[#1a1c1c]">{r.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

import { useState } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { startBackwash, allZonesOff, zoneOn, zoneOff, b16mOutputOn, b16mOutputOff } from '../lib/commands'

const IRR_TOPIC = 'farm/irrigation1/status'
const ZONE_STATE_TOPIC = 'farm/irrigation1/zone/+/state'
const PRESSURE_TOPIC = 'farm/filter1/pressure'
const BACKWASH_TOPIC = 'farm/filter1/backwash/state'
const B16M_TOPIC = 'B16M/CCBA97071FD8/STATE'
const SIM_TOPIC = 'farm/irrigation1/sim/pressure'
const TOPICS = [IRR_TOPIC, ZONE_STATE_TOPIC, PRESSURE_TOPIC, BACKWASH_TOPIC, B16M_TOPIC, SIM_TOPIC]

export default function Dashboard() {
  const { data, connected } = useLiveTelemetry(TOPICS)
  const [busy, setBusy] = useState({})
  const [b16mBusy, setB16mBusy] = useState({})

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

  const irr      = data[IRR_TOPIC]      ?? null
  const pressure = data[PRESSURE_TOPIC] ?? null
  const backwash = data[BACKWASH_TOPIC] ?? null
  const b16m     = data[B16M_TOPIC]     ?? null

  // Merge per-zone state updates over the full status zones array
  const zoneOverrides = {}
  Object.entries(data).forEach(([topic, payload]) => {
    const m = topic.match(/^farm\/irrigation1\/zone\/(\d+)\/state$/)
    if (m) zoneOverrides[Number(m[1])] = payload
  })
  const baseZones = irr?.zones ?? Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}`, on: false, state: 'off' }))
  const zones = baseZones.map(z => zoneOverrides[z.id] ? { ...z, ...zoneOverrides[z.id] } : z)
  const sim         = data[SIM_TOPIC]  ?? null
  const supplyPsi   = sim?.supply_psi ?? irr?.supply_psi ?? '—'
  const activeCount = zones.filter(z => z.on).length
  const inletPsi    = pressure?.inlet_psi ?? '—'
  const outletPsi   = pressure?.outlet_psi ?? '—'
  const diffPsi     = pressure?.differential_psi ?? '—'
  const bwState     = backwash?.state ?? '—'

  const b16mOutputs = Array.from({ length: 16 }, (_, i) => b16m?.[`output${i + 1}`]?.value ?? false)
  const b16mInputs  = Array.from({ length: 16 }, (_, i) => b16m?.[`input${i + 1}`]?.value ?? false)
  const b16mAdc     = [1, 2, 3, 4].map(n => b16m?.[`adc${n}`]?.value ?? 0)

  async function handleB16mToggle(n, currentlyOn) {
    setB16mBusy(b => ({ ...b, [n]: true }))
    try {
      currentlyOn ? await b16mOutputOff(n) : await b16mOutputOn(n)
    } catch (e) { console.error(e) }
    setB16mBusy(b => ({ ...b, [n]: false }))
  }

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

          {/* B16M status summary */}
          <Card accent="green">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">B16M (Test)</h2>
            <div className="space-y-2 text-xs font-body">
              {[
                { label: 'Status',  value: b16m ? 'Online' : 'Offline' },
                { label: 'Outputs', value: `${b16mOutputs.filter(Boolean).length} / 16 on` },
                { label: 'Inputs',  value: `${b16mInputs.filter(Boolean).length} / 16 active` },
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

      {/* B16M full detail — outputs, inputs, ADC */}
      <div className="mt-6">
        <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-3">
          B16M Detail
          <span className={`ml-2 inline-block w-2 h-2 rounded-full align-middle ${b16m ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Outputs */}
          <Card>
            <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">Outputs (DO1–DO16)</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {b16mOutputs.map((on, i) => (
                <button
                  key={i}
                  onClick={() => handleB16mToggle(i + 1, on)}
                  disabled={!!b16mBusy[i + 1]}
                  className={`py-1.5 rounded text-[10px] font-semibold transition-all disabled:opacity-40 ${
                    on
                      ? 'bg-[#0d631b] text-white'
                      : 'bg-[#e2e2e2] text-[#40493d] hover:bg-[#d5d5d5]'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </Card>

          {/* Inputs */}
          <Card>
            <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">Inputs (DI1–DI16)</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {b16mInputs.map((active, i) => (
                <div
                  key={i}
                  className={`py-1.5 rounded text-[10px] font-semibold text-center ${
                    active ? 'bg-[#e8f5e9] text-[#0d631b]' : 'bg-[#f3f3f3] text-[#40493d]'
                  }`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </Card>

          {/* ADC */}
          <Card>
            <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">Analog (CH1–CH4)</h3>
            <div className="space-y-3">
              {b16mAdc.map((val, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#40493d]">CH{i + 1}</span>
                    <span className="font-semibold text-[#1a1c1c]">{val}</span>
                  </div>
                  <div className="h-1.5 bg-[#e2e2e2] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#0d631b] rounded-full transition-all"
                      style={{ width: `${Math.min((val / 4095) * 100, 100)}%` }}
                    />
                  </div>
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

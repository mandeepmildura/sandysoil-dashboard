import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { allZonesOff, a6v3OutputOn, a6v3OutputOff } from '../lib/commands'

const A6V3_TOPIC = 'A6v3/8CBFEA03002C/STATE'

export default function Zones() {
  const navigate = useNavigate()
  const { data: live, connected } = useLiveTelemetry(['farm/irrigation1/status', 'farm/irrigation1/zone/+/state', A6V3_TOPIC])
  const [a6v3Busy, setA6v3Busy] = useState({})

  const irr  = live['farm/irrigation1/status'] ?? null
  const a6v3 = live[A6V3_TOPIC] ?? null
  const a6v3Outputs = Array.from({ length: 6 }, (_, i) => a6v3?.[`output${i + 1}`]?.value ?? false)

  async function handleA6v3Toggle(n, currentlyOn) {
    setA6v3Busy(b => ({ ...b, [n]: true }))
    try {
      currentlyOn ? await a6v3OutputOff(n) : await a6v3OutputOn(n)
    } catch (e) { console.error(e) }
    setA6v3Busy(b => ({ ...b, [n]: false }))
  }
  const zoneOverrides = {}
  Object.entries(live).forEach(([topic, payload]) => {
    const m = topic.match(/^farm\/irrigation1\/zone\/(\d+)\/state$/)
    if (m) zoneOverrides[Number(m[1])] = payload
  })
  const baseZones = irr?.zones ?? Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}`, on: false, state: 'off' }))
  // Only apply per-zone overrides when the device is online — prevents stale
  // cached MQTT state from showing zones as ON when the board is disconnected
  const zones = baseZones.map(z => (irr?.online && zoneOverrides[z.id]) ? { ...z, ...zoneOverrides[z.id] } : z)

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Irrigation Zones</h1>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
            <span className="text-xs font-body text-[#40493d]">{connected ? 'Live' : 'Connecting…'}</span>
          </div>
        </div>
        <button
          onClick={() => allZonesOff().catch(console.error)}
          className="border-2 border-[#ba1a1a]/30 text-[#ba1a1a] font-body font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-[#ba1a1a]/5 transition-colors"
        >
          All Zones OFF
        </button>
      </div>

      {irr && (
        <div className="flex gap-4 mb-5 text-xs font-body">
          <span className="text-[#40493d]">Supply: <strong className="text-[#1a1c1c]">{irr.supply_psi} PSI</strong></span>
          <span className="text-[#40493d]">Firmware: <strong className="text-[#1a1c1c]">v{irr.fw}</strong></span>
          <span className="text-[#40493d]">RSSI: <strong className="text-[#1a1c1c]">{irr.rssi} dBm</strong></span>
          <span className="text-[#40493d]">Uptime: <strong className="text-[#1a1c1c]">{fmtUptime(irr.uptime)}</strong></span>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {zones.map(zone => (
          <Card
            key={zone.id}
            accent={zone.on ? 'green' : undefined}
            className="cursor-pointer hover:shadow-md transition-shadow"
          >
            <div onClick={() => navigate(`/zones/${zone.id}`)}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-headline font-bold text-[#1a1c1c]">{zone.name}</p>
                  <p className="text-xs text-[#40493d] capitalize">{zone.state}</p>
                </div>
                <span className={`w-3 h-3 rounded-full mt-0.5 ${zone.on ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
              </div>
              <StatusChip status={zone.on ? 'running' : 'offline'} label={zone.on ? 'ON' : 'OFF'} />
              <p className="text-[10px] text-[#40493d] mt-2">Tap to view detail</p>
            </div>
          </Card>
        ))}
      </div>

      {/* A6v3 Relays */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="font-headline font-semibold text-lg text-[#1a1c1c]">A6v3 Relays</h2>
          <span className={`w-2 h-2 rounded-full ${a6v3 ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
          <span className="text-xs font-body text-[#40493d]">{a6v3 ? 'Online' : 'Offline'}</span>
        </div>
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
                  onClick={() => handleA6v3Toggle(i + 1, on)}
                  disabled={!!a6v3Busy[i + 1] || on}
                  className="flex-1 py-1 rounded-md bg-[#0d631b] text-white text-[10px] font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                >On</button>
                <button
                  onClick={() => handleA6v3Toggle(i + 1, on)}
                  disabled={!!a6v3Busy[i + 1] || !on}
                  className="flex-1 py-1 rounded-md bg-[#e2e2e2] text-[#1a1c1c] text-[10px] font-semibold hover:bg-[#d5d5d5] disabled:opacity-40 transition-all"
                >Off</button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

function fmtUptime(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

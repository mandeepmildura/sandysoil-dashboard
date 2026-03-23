import { useNavigate } from 'react-router-dom'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { allZonesOff } from '../lib/commands'

export default function Zones() {
  const navigate = useNavigate()
  const { data: live, connected } = useLiveTelemetry(['farm/irrigation1/status'])

  const irr   = live['farm/irrigation1/status'] ?? null
  const zones = irr?.zones ?? Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}`, on: false, state: 'off' }))

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
    </div>
  )
}

function fmtUptime(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

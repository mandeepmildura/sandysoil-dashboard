import { useState } from 'react'
import Card from '../components/Card'
import VitalsStrip from '../components/VitalsStrip'
import StatusChip from '../components/StatusChip'

const ZONES = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  name: `Zone ${i + 1}`,
  label: ['North Block', 'South Block', 'East Row', 'West Row', 'Orchard A', 'Orchard B', 'Nursery', 'Holding'][i],
  active: [true, false, true, false, false, true, false, false][i],
  runtime: ['14:32', null, '08:15', null, null, '22:00', null, null][i],
  lastRun: ['Today 06:00', 'Today 06:30', 'Today 07:00', 'Yesterday', 'Yesterday', 'Today 05:00', '2 days ago', '3 days ago'][i],
}))

const VITALS = [
  { label: 'Supply Pressure', value: '47.3', unit: 'PSI', status: 'online', statusLabel: 'ONLINE' },
  { label: 'Filter Inlet',    value: '52.1', unit: 'PSI', status: 'online', statusLabel: 'NORMAL' },
  { label: 'Filter Outlet',   value: '48.6', unit: 'PSI', status: 'online', statusLabel: 'NORMAL' },
  { label: 'Active Zones',    value: '3',    unit: '/ 8',  status: 'running', statusLabel: 'RUNNING' },
]

const SCHEDULE = [
  { time: '06:00', zone: 'Zone 1 — North Block', duration: '30 min', status: 'completed' },
  { time: '07:30', zone: 'Zone 3 — East Row',    duration: '45 min', status: 'running' },
  { time: '09:00', zone: 'Zone 6 — Orchard B',   duration: '60 min', status: 'upcoming' },
]

const ALERTS = [
  { id: 1, title: 'High Pressure Alert', desc: 'Supply PSI exceeded 65 at 14:32', status: 'fault' },
  { id: 2, title: 'Filter Fault', desc: 'Backwash cycle failed to complete', status: 'warning' },
]

export default function Dashboard() {
  const [zones, setZones] = useState(ZONES)

  function toggleZone(id) {
    setZones(z => z.map(zone => zone.id === id ? { ...zone, active: !zone.active } : zone))
  }

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <h1 className="font-headline font-bold text-2xl text-[#1a1c1c] mb-6">Farm Dashboard</h1>

      <VitalsStrip vitals={VITALS} />

      <div className="grid grid-cols-3 gap-6">
        {/* Zone grid */}
        <div className="col-span-2">
          <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-3">Irrigation Zones</h2>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {zones.map(zone => (
              <Card key={zone.id} accent={zone.active ? 'green' : undefined}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-headline font-bold text-sm text-[#1a1c1c]">{zone.name}</p>
                    <p className="text-xs text-[#40493d]">{zone.label}</p>
                  </div>
                  <Toggle on={zone.active} onChange={() => toggleZone(zone.id)} />
                </div>
                {zone.active && zone.runtime && (
                  <p className="text-2xl font-headline font-bold text-[#0d631b] leading-none mb-1">{zone.runtime}</p>
                )}
                <p className="text-[10px] text-[#40493d]">Last: {zone.lastRun}</p>
              </Card>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Schedule */}
          <Card accent="blue">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Today's Schedule</h2>
            <div className="space-y-3">
              {SCHEDULE.map((s, i) => (
                <div key={i} className={`rounded-lg p-3 ${s.status === 'running' ? 'bg-[#0d631b]/5' : 'bg-[#f3f3f3]'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-body font-semibold text-[#1a1c1c]">{s.time}</span>
                    <StatusChip status={s.status} />
                  </div>
                  <p className="text-xs text-[#40493d]">{s.zone}</p>
                  <p className="text-xs text-[#40493d]">{s.duration}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Alerts */}
          <Card accent="red">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Recent Alerts</h2>
            <div className="space-y-2">
              {ALERTS.map(a => (
                <div key={a.id} className="rounded-lg bg-[#f3f3f3] p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusChip status={a.status} />
                  </div>
                  <p className="text-xs font-semibold text-[#1a1c1c]">{a.title}</p>
                  <p className="text-[10px] text-[#40493d]">{a.desc}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Filter station */}
          <Card accent="blue">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Filter Station</h2>
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-[#40493d]">Inlet PSI</span>
                <span className="font-semibold text-[#1a1c1c]">52.1</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#40493d]">Outlet PSI</span>
                <span className="font-semibold text-[#1a1c1c]">48.6</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#40493d]">Differential</span>
                <span className="font-semibold text-[#1a1c1c]">3.5 PSI</span>
              </div>
            </div>
            <button className="w-full py-2 rounded-lg border border-[#bfcaba]/40 text-xs font-body font-semibold text-[#00639a] hover:bg-[#00639a]/5 transition-colors">
              Start Backwash
            </button>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 ${on ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'

const ZONES = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  name: `Zone ${i + 1}`,
  label: ['North Block', 'South Block', 'East Row', 'West Row', 'Orchard A', 'Orchard B', 'Nursery', 'Holding'][i],
  active: [true, false, true, false, false, true, false, false][i],
  runtime: ['14:32', null, '08:15', null, null, '22:00', null, null][i],
  lastRun: ['Today 06:00', 'Today 06:30', 'Today 07:00', 'Yesterday', 'Yesterday', 'Today 05:00', '2 days ago', '3 days ago'][i],
  program: ['Morning Run A', 'Morning Run A', 'Morning Run A', 'Morning Run A', 'Evening Orchard', 'Evening Orchard', 'Nursery Top-Up', 'Holding Tank'][i],
}))

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange() }}
      className={`relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0 ${on ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}
    >
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5' : 'translate-x-1'}`} />
    </button>
  )
}

export default function Zones() {
  const [zones, setZones] = useState(ZONES)
  const navigate = useNavigate()

  function toggleZone(id) {
    setZones(z => z.map(zone => zone.id === id ? { ...zone, active: !zone.active } : zone))
  }

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Irrigation Zones</h1>
        <button className="border-2 border-[#ba1a1a]/30 text-[#ba1a1a] font-body font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-[#ba1a1a]/5 transition-colors">
          All Zones OFF
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {zones.map(zone => (
          <Card
            key={zone.id}
            accent={zone.active ? 'green' : undefined}
            className="cursor-pointer hover:shadow-md transition-shadow"
          >
            <div onClick={() => navigate(`/zones/${zone.id}`)}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-headline font-bold text-[#1a1c1c]">{zone.name}</p>
                  <p className="text-xs text-[#40493d]">{zone.label}</p>
                </div>
                <Toggle on={zone.active} onChange={() => toggleZone(zone.id)} />
              </div>

              {zone.active && zone.runtime ? (
                <div className="mb-2">
                  <p className="text-[10px] text-[#40493d] uppercase tracking-data">Time remaining</p>
                  <p className="text-3xl font-headline font-bold text-[#0d631b] leading-tight">{zone.runtime}</p>
                </div>
              ) : (
                <div className="mb-2">
                  <StatusChip status="offline" label="OFF" />
                </div>
              )}

              <p className="text-[10px] text-[#40493d]">Last: {zone.lastRun}</p>
              <p className="text-[10px] text-[#40493d] mt-0.5">{zone.program}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'

const DURATIONS = ['15 min', '30 min', '1 hour', 'Custom']

const HISTORY = [
  { date: 'Today',        start: '07:30', duration: '60 min', psi: 47.3, status: 'running'   },
  { date: 'Today',        start: '06:00', duration: '30 min', psi: 46.8, status: 'completed' },
  { date: 'Yesterday',    start: '07:00', duration: '30 min', psi: 45.2, status: 'completed' },
  { date: 'Mon 18 Mar',   start: '07:00', duration: '30 min', psi: 48.1, status: 'completed' },
  { date: 'Sun 17 Mar',   start: '07:00', duration: '28 min', psi: 44.6, status: 'completed' },
  { date: 'Sat 16 Mar',   start: '08:00', duration: '30 min', psi: 49.2, status: 'fault'     },
]

export default function ZoneDetail() {
  const { id = '3' } = useParams()
  const [selectedDuration, setSelectedDuration] = useState('30 min')
  const [running, setRunning] = useState(true)

  const zoneNames = ['North Block','South Block','East Row','West Row','Orchard A','Orchard B','Nursery','Holding']
  const zoneName = zoneNames[(parseInt(id) - 1) % 8] ?? 'Block'

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs font-body text-[#40493d] mb-4">
        <Link to="/" className="hover:text-[#1a1c1c]">Dashboard</Link>
        <span>/</span>
        <Link to="/zones" className="hover:text-[#1a1c1c]">Zones</Link>
        <span>/</span>
        <span className="text-[#1a1c1c] font-semibold">Zone {id}</span>
      </nav>

      <div className="flex items-center gap-4 mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Zone {id} — {zoneName}</h1>
        <StatusChip status={running ? 'running' : 'offline'} label={running ? 'RUNNING' : 'OFF'} />
      </div>

      {/* Vitals strip */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Supply PSI',       value: '47.3', unit: 'PSI' },
          { label: 'Runtime Remaining',value: '14:32', unit: 'min' },
          { label: 'Water This Week',  value: '3.2',  unit: 'hrs' },
          { label: 'Last Run',         value: 'Today', unit: '06:00' },
        ].map(v => (
          <div key={v.label} className="bg-[#ffffff] rounded-xl shadow-card p-4">
            <p className="text-xs font-body text-[#40493d] uppercase tracking-data mb-1">{v.label}</p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-headline font-bold text-[#1a1c1c] leading-none">{v.value}</span>
              <span className="text-sm text-[#40493d] mb-0.5">{v.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Manual control */}
        <div className="space-y-4">
          <Card accent="green">
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Manual Control</h2>

            {running ? (
              <button
                onClick={() => setRunning(false)}
                className="w-full py-4 rounded-xl bg-[#ba1a1a] text-white font-headline font-bold text-lg shadow-fab hover:opacity-90 transition-opacity mb-4"
              >
                STOP ZONE
              </button>
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
                  onClick={() => setRunning(true)}
                  className="w-full py-3 rounded-xl gradient-primary text-white font-headline font-bold text-base shadow-fab hover:opacity-90 transition-opacity"
                >
                  Start Zone
                </button>
              </>
            )}

            <div className="mt-4 pt-4 border-t border-[#f3f3f3]">
              <button className="w-full py-2.5 rounded-xl border-2 border-[#ba1a1a]/30 text-[#ba1a1a] font-body font-semibold text-sm hover:bg-[#ba1a1a]/5 transition-colors">
                ALL ZONES OFF
              </button>
            </div>
          </Card>

          <Card>
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Zone Settings</h2>
            <div className="space-y-2 text-xs font-body">
              <div className="flex justify-between">
                <span className="text-[#40493d]">Program</span>
                <span className="text-[#1a1c1c] font-semibold">Morning Run A</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#40493d]">Soil type</span>
                <span className="text-[#1a1c1c] font-semibold">Sandy loam</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#40493d]">Default runtime</span>
                <span className="text-[#1a1c1c] font-semibold">30 min</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Run history */}
        <div className="col-span-2">
          <Card accent="blue">
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Run History</h2>
            <div className="space-y-2">
              {HISTORY.map((h, i) => (
                <div
                  key={i}
                  className={`rounded-xl p-4 flex items-center justify-between ${
                    h.status === 'running' ? 'bg-[#0d631b]/5' : 'bg-[#f3f3f3]'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-xs font-semibold text-[#40493d]">{h.date}</p>
                      <p className="text-sm font-headline font-bold text-[#1a1c1c]">{h.start}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#40493d]">Duration</p>
                      <p className="text-sm font-semibold text-[#1a1c1c] tracking-data">{h.duration}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#40493d]">Avg PSI</p>
                      <p className="text-sm font-semibold text-[#1a1c1c] tracking-data">{h.psi}</p>
                    </div>
                  </div>
                  <StatusChip status={h.status} label={h.status.toUpperCase()} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

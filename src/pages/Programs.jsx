import { useState } from 'react'
import StatusChip from '../components/StatusChip'

const PROGRAMS = [
  { id: 1, name: 'Morning Run A',     zones: [1,2,3,4], schedule: 'Daily 06:00',   duration: '2h 30m', lastRun: '2h ago',    nextRun: 'Tomorrow 06:00', status: 'active' },
  { id: 2, name: 'Evening Orchard',   zones: [5,6],     schedule: 'MWF 17:30',     duration: '2h 00m', lastRun: '1d ago',    nextRun: 'Today 17:30',   status: 'active' },
  { id: 3, name: 'Weekend Deep',      zones: [1,2,3,4,5,6,7,8], schedule: 'Sat 07:00', duration: '6h 00m', lastRun: '6d ago', nextRun: 'Sat 07:00',     status: 'paused' },
  { id: 4, name: 'Nursery Top-Up',    zones: [7],       schedule: 'Daily 08:00',   duration: '0h 30m', lastRun: '3h ago',    nextRun: 'Tomorrow 08:00', status: 'active' },
  { id: 5, name: 'Holding Tank Fill', zones: [8],       schedule: 'MF 07:00',      duration: '1h 00m', lastRun: '1d ago',    nextRun: 'Today 19:00',   status: 'fault'  },
  { id: 6, name: 'South Block',       zones: [2],       schedule: 'TTh 06:30',     duration: '0h 45m', lastRun: '2d ago',    nextRun: 'Thu 06:30',     status: 'active' },
]

export default function Programs() {
  const [expanded, setExpanded] = useState(null)
  const [filter, setFilter] = useState('All')

  const filters = ['All', 'Active', 'Paused', 'Fault']
  const filtered = PROGRAMS.filter(p => filter === 'All' || p.status === filter.toLowerCase())

  const active = PROGRAMS.filter(p => p.status === 'active').length
  const paused = PROGRAMS.filter(p => p.status === 'paused').length
  const fault  = PROGRAMS.filter(p => p.status === 'fault').length

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Programs</h1>
        <button className="gradient-primary text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
          + New Program
        </button>
      </div>

      {/* Filter + search */}
      <div className="flex items-center gap-3 mb-5">
        <input
          placeholder="Search programs..."
          className="bg-[#ffffff] rounded-xl px-4 py-2 text-sm font-body text-[#1a1c1c] shadow-card outline-none focus:bg-white w-64 transition-all"
        />
        <div className="flex gap-1.5">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-colors ${
                filter === f ? 'bg-[#0d631b] text-white' : 'bg-[#ffffff] text-[#40493d] shadow-card hover:bg-[#f3f3f3]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#ffffff] rounded-xl shadow-card overflow-hidden mb-4">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="bg-[#f3f3f3]">
              {['Program', 'Zones', 'Schedule', 'Duration', 'Last Run', 'Next Run', 'Status', ''].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-[#40493d] px-4 py-3 first:pl-5 last:pr-5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, idx) => (
              <>
                <tr
                  key={p.id}
                  onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  className={`cursor-pointer transition-colors hover:bg-[#f9f9f9] ${idx % 2 === 0 ? '' : 'bg-[#f3f3f3]/50'}`}
                >
                  <td className="px-5 py-3 font-semibold text-[#1a1c1c]">{p.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {p.zones.map(z => (
                        <span key={z} className="px-1.5 py-0.5 bg-[#f3f3f3] rounded-full text-[10px] text-[#40493d]">Z{z}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#40493d]">{p.schedule}</td>
                  <td className="px-4 py-3 text-[#40493d] tracking-data">{p.duration}</td>
                  <td className="px-4 py-3 text-[#40493d]">{p.lastRun}</td>
                  <td className="px-4 py-3 text-[#40493d]">{p.nextRun}</td>
                  <td className="px-4 py-3"><StatusChip status={p.status} /></td>
                  <td className="px-5 py-3 text-[#40493d] text-xs">{expanded === p.id ? '▲' : '▼'}</td>
                </tr>
                {expanded === p.id && (
                  <tr key={`${p.id}-expand`} className="bg-[#f9f9f9]">
                    <td colSpan={8} className="px-5 py-4">
                      <div className="flex items-center gap-6">
                        <div className="text-xs text-[#40493d] flex-1">
                          <p className="font-semibold text-[#1a1c1c] mb-1">Zone Sequence</p>
                          <div className="flex gap-2">
                            {p.zones.map((z, i) => (
                              <span key={z} className="px-2.5 py-1 bg-[#f3f3f3] rounded-lg text-xs">
                                {i + 1}. Zone {z}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <button className="gradient-primary text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-fab hover:opacity-90 transition-opacity">
                            Run Now
                          </button>
                          <button className="bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#e8e8e8] transition-colors">
                            Pause
                          </button>
                          <button className="text-[#00639a] text-xs font-semibold px-4 py-2 hover:underline">
                            Edit
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[#40493d] font-body">
        {PROGRAMS.length} programs — {active} active — {paused} paused — {fault} fault
      </p>
    </div>
  )
}

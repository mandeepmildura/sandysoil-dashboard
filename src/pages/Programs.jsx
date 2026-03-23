import { useState } from 'react'
import StatusChip from '../components/StatusChip'
import { usePrograms } from '../hooks/usePrograms'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function fmtDays(days) {
  if (!days?.length) return 'No days'
  // days_of_week is 0=Sun…6=Sat in postgres, map to display
  const names = days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d] ?? d)
  return names.join(', ')
}

function fmtTime(t) {
  if (!t) return '—'
  return t.slice(0, 5)
}

export default function Programs() {
  const { programs, loading } = usePrograms()
  const [expanded, setExpanded] = useState(null)
  const [filter, setFilter] = useState('All')
  const filters = ['All', 'Active', 'Paused']

  const filtered = programs.filter(p => {
    if (filter === 'All')    return true
    if (filter === 'Active') return p.schedule?.enabled !== false
    if (filter === 'Paused') return p.schedule?.enabled === false
    return true
  })

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Programs</h1>
        <button className="gradient-primary text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
          + New Program
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 mb-5">
        <input placeholder="Search programs…" className="bg-[#ffffff] rounded-xl px-4 py-2 text-sm font-body text-[#1a1c1c] shadow-card outline-none w-64" />
        <div className="flex gap-1.5">
          {filters.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-colors ${
                filter === f ? 'bg-[#0d631b] text-white' : 'bg-[#ffffff] text-[#40493d] shadow-card hover:bg-[#f3f3f3]'
              }`}
            >{f}</button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-[#40493d]">Loading programs…</p>}

      {/* Table */}
      {!loading && (
        <div className="bg-[#ffffff] rounded-xl shadow-card overflow-hidden mb-4">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="bg-[#f3f3f3]">
                {['Program', 'Zones', 'Schedule', 'Start', 'Mode', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-[#40493d] px-4 py-3 first:pl-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, idx) => {
                const active = p.schedule?.enabled !== false
                const sched  = p.schedule
                return (
                  <>
                    <tr
                      key={p.id}
                      onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                      className={`cursor-pointer transition-colors hover:bg-[#f9f9f9] ${idx % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}
                    >
                      <td className="px-5 py-3 font-semibold text-[#1a1c1c]">{p.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {p.zones.map(z => (
                            <span key={z.id} className="px-1.5 py-0.5 bg-[#f3f3f3] rounded-full text-[10px] text-[#40493d]">Z{z.zone_num}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#40493d] text-xs">{sched ? fmtDays(sched.days_of_week) : '—'}</td>
                      <td className="px-4 py-3 text-[#40493d]">{sched ? fmtTime(sched.start_time) : '—'}</td>
                      <td className="px-4 py-3 text-[#40493d] capitalize">{p.run_mode}</td>
                      <td className="px-4 py-3"><StatusChip status={active ? 'online' : 'paused'} label={active ? 'ACTIVE' : 'PAUSED'} /></td>
                      <td className="px-4 py-3 text-[#40493d] text-xs">{expanded === p.id ? '▲' : '▼'}</td>
                    </tr>

                    {expanded === p.id && (
                      <tr key={`${p.id}-exp`} className="bg-[#f9f9f9]">
                        <td colSpan={7} className="px-5 py-4">
                          <div className="flex items-center gap-6">
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-[#1a1c1c] mb-2">Zone Sequence ({p.run_mode})</p>
                              <div className="flex gap-2 flex-wrap">
                                {p.zones.map((z, i) => (
                                  <span key={z.id} className="px-2.5 py-1 bg-[#f3f3f3] rounded-lg text-xs">
                                    {i + 1}. Zone {z.zone_num} — {z.duration_min} min
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-3 shrink-0">
                              <button className="gradient-primary text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-fab hover:opacity-90">Run Now</button>
                              <button className="bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#e8e8e8]">{active ? 'Pause' : 'Enable'}</button>
                              <button className="text-[#00639a] text-xs font-semibold px-2 hover:underline">Edit</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="text-center text-sm text-[#40493d] py-8">No programs found.</p>
          )}
        </div>
      )}

      <p className="text-xs text-[#40493d] font-body">
        {programs.length} programs — {programs.filter(p => p.schedule?.enabled !== false).length} active — {programs.filter(p => p.schedule?.enabled === false).length} paused
      </p>
    </div>
  )
}

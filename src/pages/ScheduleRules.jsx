import { useState } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useScheduleRules } from '../hooks/useScheduleRules'
import { supabase } from '../lib/supabase'

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DAY_NAMES  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dbDowToCalIdx(d) { return d === 0 ? 6 : d - 1 }

function fmtDays(days) {
  if (!days?.length) return 'No days'
  return days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d] ?? d).join(', ')
}

function fmtTime(t) { return t ? t.slice(0, 5) : '—' }

export default function ScheduleRules() {
  const { groupSchedules, loading, zoneSchedules } = useScheduleRules()
  const [selected, setSelected]   = useState(null)
  const [saving,   setSaving]     = useState(false)
  const [saveMsg,  setSaveMsg]    = useState(null)

  const rule = groupSchedules.find(r => r.group_id === selected)

  async function toggleEnabled(r) {
    try {
      await supabase
        .from('group_schedules')
        .update({ enabled: !r.enabled })
        .eq('group_id', r.group_id)
      setSaveMsg({ ok: true, text: `Schedule ${!r.enabled ? 'enabled' : 'paused'}.` })
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Schedule Rules</h1>
      </div>

      {saveMsg && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-semibold ${saveMsg.ok ? 'bg-[#0d631b]/10 text-[#0d631b] border border-[#0d631b]/20' : 'bg-[#ffdad6] text-[#ba1a1a]'}`}>
          {saveMsg.text}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Rules list */}
        <div className="col-span-2 space-y-4">
          {loading && <p className="text-sm text-[#40493d]">Loading schedules…</p>}

          {!loading && groupSchedules.length === 0 && (
            <Card>
              <p className="text-sm text-[#40493d] text-center py-4">
                No group schedules found. Create programs in the{' '}
                <a href="/programs" className="text-[#00639a] hover:underline font-semibold">Programs</a> page to add schedules.
              </p>
            </Card>
          )}

          {groupSchedules.map(r => {
            const active    = r.enabled !== false
            const dowBools  = Array.from({ length: 7 }, (_, i) => {
              const dbDay = i === 6 ? 0 : i + 1
              return r.days_of_week?.includes(dbDay) ?? false
            })
            const members   = r.zone_groups?.zone_group_members ?? []
            const hasA6v3   = members.some(m => m.device === 'a6v3')
            const hasIrr    = members.some(m => !m.device || m.device === 'irrigation1')
            return (
              <Card key={r.group_id} accent={active ? 'green' : undefined}
                className={`cursor-pointer transition-all ${selected === r.group_id ? 'ring-2 ring-[#0d631b]/30' : ''}`}
              >
                <div onClick={() => setSelected(selected === r.group_id ? null : r.group_id)}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-headline font-semibold text-[#1a1c1c]">{r.label ?? r.zone_groups?.name ?? 'Unnamed'}</p>
                        {hasA6v3 && <span className="px-1.5 py-0.5 bg-[#e8f5e9] text-[#0d631b] text-[9px] font-semibold rounded">A6v3</span>}
                        {hasIrr && <span className="px-1.5 py-0.5 bg-[#e3f2fd] text-[#00639a] text-[9px] font-semibold rounded">Irrigation</span>}
                      </div>
                      <p className="text-xs text-[#40493d] mt-0.5">
                        {fmtTime(r.start_time)} · {fmtDays(r.days_of_week)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusChip status={active ? 'online' : 'paused'} label={active ? 'ACTIVE' : 'PAUSED'} />
                      <button
                        onClick={e => { e.stopPropagation(); toggleEnabled(r) }}
                        className={`relative w-9 h-5 rounded-full transition-colors ${active ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  </div>

                  {/* Day chips */}
                  <div className="flex gap-1.5 mb-2">
                    {DAY_LABELS.map((d, i) => (
                      <span key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-body font-semibold ${
                        dowBools[i] ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'
                      }`}>{d}</span>
                    ))}
                  </div>

                  {/* Members */}
                  {members.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {members.sort((a, b) => a.sort_order - b.sort_order).map((m, i) => (
                        <span key={i} className="px-2 py-0.5 bg-[#f3f3f3] rounded text-[10px] text-[#40493d]">
                          {m.device === 'a6v3' ? 'Relay' : 'Zone'} {m.zone_num} · {m.duration_min}m
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )
          })}

          {/* Zone schedules section */}
          {!loading && zoneSchedules.length > 0 && (
            <div className="mt-6">
              <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-3">Per-Zone Schedules</h2>
              <div className="bg-[#ffffff] rounded-xl shadow-card overflow-hidden">
                <table className="w-full text-sm font-body">
                  <thead>
                    <tr className="bg-[#f3f3f3]">
                      {['Device', 'Zone / Relay', 'Days', 'Start Time', 'Duration', 'Status'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-[#40493d] px-4 py-3 first:pl-5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {zoneSchedules.map((z, i) => {
                      const isA6v3 = z.device === 'a6v3'
                      return (
                        <tr key={z.id} className={`hover:bg-[#f9f9f9] transition-colors ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}>
                          <td className="px-5 py-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${isA6v3 ? 'bg-[#e8f5e9] text-[#0d631b]' : 'bg-[#e3f2fd] text-[#00639a]'}`}>
                              {isA6v3 ? 'A6v3' : 'Irrigation'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-[#1a1c1c]">{isA6v3 ? 'Relay' : 'Zone'} {z.zone_num}</td>
                          <td className="px-4 py-3 text-xs text-[#40493d]">{fmtDays(z.days_of_week)}</td>
                          <td className="px-4 py-3 text-[#40493d]">{fmtTime(z.start_time)}</td>
                          <td className="px-4 py-3 text-[#40493d]">{z.duration_min ? `${z.duration_min} min` : '—'}</td>
                          <td className="px-4 py-3">
                            <StatusChip status={z.enabled !== false ? 'online' : 'paused'} label={z.enabled !== false ? 'ACTIVE' : 'PAUSED'} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Smart conditions sidebar */}
        <div className="space-y-4">
          <Card accent="blue">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Smart Conditions</h2>
            <div className="space-y-2">
              {[
                { label: 'Filter fault → Skip schedule',     color: 'red'   },
                { label: 'PSI drops below 30 → Pause & alert', color: 'amber' },
                { label: 'Rain sensor → Skip all zones',     color: 'blue'  },
              ].map((c, i) => (
                <div key={i} className="bg-[#f3f3f3] rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      c.color === 'red' ? 'bg-[#ba1a1a]' :
                      c.color === 'amber' ? 'bg-[#e65100]' :
                      'bg-[#00639a]'
                    }`} />
                    <p className="text-xs font-body text-[#1a1c1c]">{c.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-2">Summary</h2>
            <div className="space-y-2 text-xs font-body">
              <div className="flex justify-between">
                <span className="text-[#40493d]">Group schedules</span>
                <span className="font-semibold text-[#1a1c1c]">{groupSchedules.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#40493d]">Active</span>
                <span className="font-semibold text-[#0d631b]">{groupSchedules.filter(r => r.enabled !== false).length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#40493d]">Paused</span>
                <span className="font-semibold text-[#e65100]">{groupSchedules.filter(r => r.enabled === false).length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#40493d]">Zone schedules</span>
                <span className="font-semibold text-[#1a1c1c]">{zoneSchedules.length}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

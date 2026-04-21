import { useState, useEffect, useCallback } from 'react'
import StatusChip from '../components/StatusChip'
import PageHeader from '../components/PageHeader'
import { btnPrimary, btnPrimaryStyle, btnSecondary } from '../components/ui'
import { supabase } from '../lib/supabase'
import { zoneOn, a6v3ZoneOn } from '../lib/commands'
import {
  dbDayToCalIdx,
  getWeekMonday,
  fmtTime,
  fmtDuration,
  fmtDays,
  totalDuration,
} from '../lib/calendar'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 18 }, (_, i) => i + 5) // 5am–10pm
const COLORS = ['#0d631b', '#2e7d32', '#00639a', '#6a4c93', '#c0392b', '#d35400', '#16a085', '#8e44ad']

// ── Event detail modal ──────────────────────────────────────────────────────
function EventModal({ event, onClose }) {
  const p = event.program
  const [running, setRunning] = useState(false)

  async function runNow() {
    if (!p.zones?.length) return
    setRunning(true)
    try {
      // A6v3 firmware has no auto-off timer, so for each A6v3 'on' we also
      // queue an 'off' step in program_queue at now + duration. The
      // run-program-queue cron job fires it. (irrigation1 auto-offs itself.)
      const a6v3OffSteps = []
      for (const z of p.zones) {
        const dur = z.duration_min ?? 30
        if (z.device === 'a6v3') {
          await a6v3ZoneOn(z.zone_num, dur)
          a6v3OffSteps.push({
            group_id:     p.id,
            step_type:    'off',
            device:       'a6v3',
            zone_num:     z.zone_num,
            duration_min: null,
            fire_at:      new Date(Date.now() + dur * 60_000).toISOString(),
          })
        } else {
          await zoneOn(z.zone_num, dur)
        }
      }
      if (a6v3OffSteps.length > 0) {
        const { error } = await supabase.from('program_queue').insert(a6v3OffSteps)
        if (error) console.error('failed to queue a6v3 off step(s):', error)
      }
    } catch (e) { console.error(e) }
    setRunning(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: event.color }} />
              <h2 className="font-headline font-bold text-base text-[#1a1c1c]">{p.name}</h2>
            </div>
            <p className="text-xs text-[#40493d]">{fmtTime(p.schedule.start_time)} · {fmtDuration(totalDuration(p))}</p>
          </div>
          <button onClick={onClose} className="text-[#40493d] text-lg leading-none ml-3">✕</button>
        </div>

        <div className="space-y-2 text-xs mb-4">
          <div className="flex justify-between">
            <span className="text-[#40493d]">Days</span>
            <span className="font-semibold text-[#1a1c1c] text-right max-w-[60%]">{fmtDays(p.schedule.days_of_week)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#40493d]">Mode</span>
            <span className="font-semibold text-[#1a1c1c] capitalize">{p.run_mode}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#40493d]">Status</span>
            <StatusChip status={p.schedule.enabled ? 'online' : 'paused'} label={p.schedule.enabled ? 'ACTIVE' : 'PAUSED'} />
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs font-semibold text-[#1a1c1c] mb-2">
            {p.zones.some(z => z.device === 'a6v3') ? 'Relays' : 'Zones'}
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {p.zones.map((z, i) => (
              <span key={z.zone_num} className="px-2 py-1 bg-[#f3f3f3] rounded-lg text-xs">
                {i + 1}. {z.device === 'a6v3' ? 'Relay' : 'Zone'} {z.zone_num} — {z.duration_min} min
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={runNow} disabled={running}
            className="flex-1 py-2.5 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity">
            {running ? 'Starting…' : 'Run Now'}
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d] hover:bg-[#e8e8e8] transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add schedule modal ──────────────────────────────────────────────────────
function AddScheduleModal({ onClose, onSaved }) {
  const [groups, setGroups]               = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [days, setDays]                   = useState([false,false,false,false,false,false,false])
  const [startTime, setStartTime]         = useState('06:00')
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState(null)

  useEffect(() => {
    supabase
      .from('zone_groups')
      .select('id, name, zone_group_members(device, zone_num, duration_min)')
      .order('name')
      .then(({ data }) => {
        const list = data ?? []
        setGroups(list)
        if (list.length) setSelectedGroupId(list[0].id)
      })
  }, [])

  function toggleDay(i) { setDays(prev => prev.map((v, j) => j === i ? !v : v)) }

  function deviceHint(group) {
    const devices = [...new Set((group.zone_group_members ?? []).map(m => m.device ?? 'irrigation1'))]
    return devices.join(', ')
  }

  async function save() {
    if (!selectedGroupId)    { setError('Select a group'); return }
    if (!days.some(Boolean)) { setError('Select at least one day'); return }
    setSaving(true); setError(null)
    try {
      const selectedGroup = groups.find(g => g.id === selectedGroupId)
      const dow = days.map((on, i) => on ? (i === 6 ? 0 : i + 1) : null).filter(d => d !== null)
      const { data: { session } } = await supabase.auth.getSession()
      const { error: e } = await supabase.from('group_schedules').insert({
        group_id: selectedGroupId,
        label: selectedGroup.name,
        days_of_week: dow,
        start_time: startTime,
        enabled: true,
        customer_id: session?.user?.id,
      })
      if (e) throw e
      onSaved(); onClose()
    } catch (err) {
      setError(err.message ?? 'Save failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h2 className="font-headline font-bold text-lg text-[#1a1c1c] mb-4">Add Schedule</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-1">Group</label>
            {groups.length === 0 ? (
              <p className="text-xs text-[#40493d] italic">No groups found. Create a group in the Irrigation or A6v3 page first.</p>
            ) : (
              <select value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)}
                className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none">
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name} ({deviceHint(g)})</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-2">Days</label>
            <div className="flex gap-1.5">
              {DAY_NAMES.map((d, i) => (
                <button key={i} type="button" onClick={() => toggleDay(i)}
                  className={`w-8 h-8 rounded-full text-xs font-semibold transition-colors ${days[i] ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'}`}>
                  {d[0]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-1">Start Time</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none" />
          </div>
          {error && <p className="text-xs text-[#ba1a1a]">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d] hover:bg-[#e8e8e8] transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={saving || groups.length === 0}
              className="flex-1 py-2.5 rounded-xl gradient-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Run zone modal ──────────────────────────────────────────────────────────
function RunZoneModal({ onClose }) {
  const [zone, setZone]         = useState(1)
  const [duration, setDuration] = useState(30)
  const [running, setRunning]   = useState(false)

  async function run() {
    setRunning(true)
    try { await zoneOn(zone, duration) } catch (e) { console.error(e) }
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-xs">
        <h2 className="font-headline font-bold text-lg text-[#1a1c1c] mb-4">Run Zone Now</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-1">Zone</label>
            <select value={zone} onChange={e => setZone(Number(e.target.value))}
              className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none">
              {[1,2,3,4,5,6,7,8].map(z => <option key={z} value={z}>Zone {z}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-1">Duration (min)</label>
            <select value={duration} onChange={e => setDuration(Number(e.target.value))}
              className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none">
              {[15, 30, 45, 60, 90].map(d => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d] hover:bg-[#e8e8e8] transition-colors">
              Cancel
            </button>
            <button onClick={run} disabled={running}
              className="flex-1 py-2.5 rounded-xl gradient-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
              {running ? 'Starting…' : 'Start Zone'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Time grid (shared by week + day views) ──────────────────────────────────
function EventBlock({ event, onClick }) {
  return (
    <button
      onClick={() => onClick(event)}
      className="w-full text-left rounded-md px-1.5 py-0.5 text-[10px] font-body font-medium text-white mb-0.5 truncate hover:opacity-80 transition-opacity"
      style={{ backgroundColor: event.color }}
    >
      {event.label}
    </button>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
export default function Calendar() {
  const [view, setView]               = useState('week')
  const [selectedDay, setSelectedDay] = useState(new Date())
  const [showAddModal, setShowAddModal] = useState(false)
  const [showRunModal, setShowRunModal] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [saved, setSaved]             = useState(false)
  const [programs, setPrograms]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [tick, setTick]               = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [groupsRes, membersRes, schedulesRes] = await Promise.all([
        supabase.from('zone_groups').select('id, name, run_mode'),
        supabase.from('zone_group_members').select('group_id, zone_num, duration_min, sort_order, device').order('sort_order'),
        supabase.from('group_schedules').select('group_id, label, days_of_week, start_time, enabled'),
      ])
      if (groupsRes.data) {
        const members   = membersRes.data   ?? []
        const schedules = schedulesRes.data ?? []
        const merged = groupsRes.data
          .map(g => ({
            ...g,
            zones:    members.filter(m => m.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order),
            schedule: schedules.find(s => s.group_id === g.id) ?? null,
          }))
          .filter(g => g.schedule)
        setPrograms(merged)
      }
      setLoading(false)
    }
    load()
  }, [tick])

  function onSaved() {
    setSaved(true); reload()
    setTimeout(() => setSaved(false), 3000)
  }

  const today       = new Date()
  const weekMonday  = getWeekMonday(today)
  const weekDates   = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekMonday)
    d.setDate(weekMonday.getDate() + i)
    return d
  })
  const todayDbDow  = today.getDay()
  const todayCalIdx = dbDayToCalIdx(todayDbDow)

  // Build events from programs
  const events = []
  programs.forEach((p, pi) => {
    if (!p.schedule?.days_of_week?.length) return
    const [hh, mm] = p.schedule.start_time.split(':').map(Number)
    const start  = hh + mm / 60
    const dur    = totalDuration(p) / 60
    const color  = COLORS[pi % COLORS.length]
    p.schedule.days_of_week.forEach(dbDay => {
      events.push({ day: dbDayToCalIdx(dbDay), start, duration: dur, label: p.name, color, program: p })
    })
  })

  // Today's programs
  const todayPrograms = programs
    .filter(p => p.schedule?.days_of_week?.includes(todayDbDow))
    .sort((a, b) => (a.schedule.start_time > b.schedule.start_time ? 1 : -1))

  // Day view: selected day's DB day of week
  const selDbDow  = selectedDay.getDay()
  const selCalIdx = dbDayToCalIdx(selDbDow)
  const dayEvents = events
    .filter(e => e.day === selCalIdx)
    .sort((a, b) => a.start - b.start)

  function prevDay() {
    const d = new Date(selectedDay)
    d.setDate(d.getDate() - 1)
    setSelectedDay(d)
  }
  function nextDay() {
    const d = new Date(selectedDay)
    d.setDate(d.getDate() + 1)
    setSelectedDay(d)
  }

  const isToday = (d) =>
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()

  return (
    <div className="flex-1 p-8 md:p-12 bg-[#f8faf9] overflow-auto min-h-screen">
      <PageHeader
        eyebrow="Scheduling"
        title="Irrigation Calendar"
        subtitle="Weekly and daily view of all programs"
        actions={
          <div className="inline-flex bg-[#f2f4f3] p-1 rounded-full">
            {['week', 'day'].map(v => (
              <button key={v} onClick={() => {
                setView(v)
                if (v === 'day') setSelectedDay(today)
              }}
                className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all capitalize ${
                  view === v ? 'bg-white shadow-sm text-[#17362e]' : 'text-[#717975] hover:text-[#17362e]'
                }`}>{v}</button>
            ))}
          </div>
        }
      />

      {saved && (
        <div className="mb-4 px-4 py-3 bg-[#0d631b]/10 border border-[#0d631b]/20 rounded-xl text-sm text-[#0d631b] font-semibold">
          Schedule saved successfully.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* ── Calendar grid ──────────────────────────────────────────────── */}
        <div className="lg:col-span-3 bg-[#ffffff] rounded-xl shadow-card overflow-hidden">

          {/* WEEK VIEW */}
          {view === 'week' && (
            <>
              <div className="grid grid-cols-8 border-b border-[#f3f3f3]">
                <div className="p-3" />
                {weekDates.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => { setSelectedDay(d); setView('day') }}
                    className={`p-3 text-center hover:bg-[#f3f3f3] transition-colors ${i === todayCalIdx ? 'bg-[#0d631b]/5' : ''}`}
                  >
                    <p className="text-xs text-[#40493d] font-body">{DAY_NAMES[i]}</p>
                    <p className={`text-lg font-headline font-bold ${i === todayCalIdx ? 'text-[#0d631b]' : 'text-[#1a1c1c]'}`}>{d.getDate()}</p>
                  </button>
                ))}
              </div>
              <div className="overflow-y-auto max-h-96">
                {loading ? (
                  <div className="p-8 text-center text-sm text-[#40493d]">Loading schedules…</div>
                ) : (
                  HOURS.map(hour => (
                    <div key={hour} className="grid grid-cols-8 border-b border-[#f3f3f3]/50 min-h-[48px]">
                      <div className="p-2 text-[10px] text-[#40493d] font-body text-right pr-3 pt-1">
                        {`${String(hour).padStart(2,'0')}:00`}
                      </div>
                      {DAY_NAMES.map((_, dayIdx) => {
                        const slot = events.filter(e => e.day === dayIdx && Math.floor(e.start) === hour)
                        return (
                          <div key={dayIdx} className={`relative border-l border-[#f3f3f3]/50 p-1 ${dayIdx === todayCalIdx ? 'bg-[#0d631b]/[0.02]' : ''}`}>
                            {slot.map((e, ei) => <EventBlock key={ei} event={e} onClick={setSelectedEvent} />)}
                          </div>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* DAY VIEW */}
          {view === 'day' && (
            <>
              {/* Day nav */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#f3f3f3]">
                <button onClick={prevDay} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f3f3f3] text-[#40493d] transition-colors">‹</button>
                <div className="text-center">
                  <p className={`font-headline font-bold text-base ${isToday(selectedDay) ? 'text-[#0d631b]' : 'text-[#1a1c1c]'}`}>
                    {DAY_NAMES[selCalIdx]} {selectedDay.getDate()}
                    {isToday(selectedDay) && <span className="ml-2 text-xs font-body text-[#0d631b]">Today</span>}
                  </p>
                  <p className="text-xs text-[#40493d]">
                    {selectedDay.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
                  </p>
                </div>
                <button onClick={nextDay} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f3f3f3] text-[#40493d] transition-colors">›</button>
              </div>

              <div className="overflow-y-auto max-h-[480px]">
                {loading ? (
                  <div className="p-8 text-center text-sm text-[#40493d]">Loading schedules…</div>
                ) : dayEvents.length === 0 ? (
                  <div className="p-8 text-center text-sm text-[#40493d]">No schedules on this day.</div>
                ) : (
                  HOURS.map(hour => {
                    const slot = dayEvents.filter(e => Math.floor(e.start) === hour)
                    return (
                      <div key={hour} className={`flex border-b border-[#f3f3f3]/50 min-h-[56px] ${slot.length ? 'bg-[#f9f9f9]/50' : ''}`}>
                        <div className="w-16 shrink-0 p-2 text-[10px] text-[#40493d] font-body text-right pr-3 pt-2">
                          {`${String(hour).padStart(2,'0')}:00`}
                        </div>
                        <div className="flex-1 p-1.5 space-y-1">
                          {slot.map((e, i) => (
                            <button
                              key={i}
                              onClick={() => setSelectedEvent(e)}
                              className="w-full text-left rounded-lg px-3 py-2 text-white hover:opacity-90 transition-opacity"
                              style={{ backgroundColor: e.color }}
                            >
                              <p className="text-sm font-semibold font-body leading-tight">{e.label}</p>
                              <p className="text-[11px] opacity-80">{fmtTime(e.program.schedule.start_time)} · {fmtDuration(totalDuration(e.program))}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Sidebar ────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="bg-[#ffffff] rounded-xl shadow-card p-4">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">
              Today — {DAY_NAMES[todayCalIdx]} {today.getDate()}
            </h2>
            {loading ? (
              <p className="text-xs text-[#40493d]">Loading…</p>
            ) : todayPrograms.length === 0 ? (
              <p className="text-xs text-[#40493d]">No schedules today.</p>
            ) : (
              <div className="space-y-2">
                {todayPrograms.map((p, pi) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedEvent({ program: p, color: COLORS[programs.indexOf(p) % COLORS.length], label: p.name })}
                    className="w-full text-left rounded-lg p-3 bg-[#f9f9f9] hover:bg-[#f3f3f3] transition-colors"
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-body font-semibold text-[#1a1c1c]">{fmtTime(p.schedule.start_time)}</span>
                      <StatusChip status={p.schedule.enabled ? 'online' : 'paused'} label={p.schedule.enabled ? 'ACTIVE' : 'PAUSED'} />
                    </div>
                    <p className="text-[11px] text-[#40493d]">{p.name}</p>
                    <p className="text-[10px] text-[#40493d]">{fmtDuration(totalDuration(p))}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className={`w-full ${btnPrimary}`}
            style={btnPrimaryStyle}
          >
            + Add Schedule
          </button>
          <button onClick={() => setShowRunModal(true)} className={`w-full ${btnSecondary}`}>
            Run Zone Now
          </button>
        </div>
      </div>

      {showAddModal    && <AddScheduleModal onClose={() => setShowAddModal(false)} onSaved={onSaved} />}
      {showRunModal    && <RunZoneModal onClose={() => setShowRunModal(false)} />}
      {selectedEvent   && <EventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  )
}

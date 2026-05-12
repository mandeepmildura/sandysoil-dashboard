import { useState, useEffect, useCallback } from 'react'
import StatusChip from '../components/StatusChip'
import PageHeader from '../components/PageHeader'
import ProgramBuilder from '../components/ProgramBuilder'
import { btnPrimary, btnPrimaryStyle, btnSecondary } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useMyDevice } from '../hooks/useMyDevice'
import { zoneOn } from '../lib/commands'
import {
  dbDayToCalIdx,
  getWeekMonday,
  fmtTime,
  fmtDuration,
  fmtDays,
  totalDuration,
} from '../lib/calendar'
import { useCalendarHistory } from '../hooks/useCalendarHistory'
import DayTimeline from '../components/DayTimeline'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 18 }, (_, i) => i + 5) // 5am–10pm
const COLORS = ['#0d631b', '#2e7d32', '#00639a', '#6a4c93', '#c0392b', '#d35400', '#16a085', '#8e44ad']

// ── Event detail modal ──────────────────────────────────────────────────────
function EventModal({ event, onClose, mqttPrefix, myDeviceId, onReload, onEdit }) {
  const p = event.program
  const [running, setRunning] = useState(false)

  async function runNow() {
    if (!p.zones?.length) return
    setRunning(true)
    try {
      // Insert all steps into program_queue with sequential fire_at timestamps
      // so run-program-queue executes them one at a time (no simultaneous zones).
      // A6v3 needs an explicit 'off' step; irrigation firmware auto-offs itself.
      const steps = []
      let offset = 0
      for (const z of p.zones) {
        const dur    = z.duration_min ?? 30
        const device = z.device ?? 'irrigation1'
        const fireAt = new Date(Date.now() + offset).toISOString()
        steps.push({
          group_id:        p.id,
          step_type:       'on',
          device,
          zone_num:        z.zone_num,
          duration_min:    dur,
          fire_at:         fireAt,
          mqtt_base_topic: device === 'a6v3' ? null : mqttPrefix,
        })
        if (device === 'a6v3') {
          steps.push({
            group_id:        p.id,
            step_type:       'off',
            device:          'a6v3',
            zone_num:        z.zone_num,
            duration_min:    null,
            fire_at:         new Date(Date.now() + offset + dur * 60_000).toISOString(),
            mqtt_base_topic: null,
          })
        }
        offset += (dur + (z.delay_min ?? 0)) * 60_000
      }
      const { error } = await supabase.from('program_queue').insert(steps)
      if (error) throw error
      // Kick run-program-queue immediately so the first zone fires now rather
      // than waiting up to 1 minute for pg_cron. Fire-and-forget — cron catches
      // it if this call fails.
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-program-queue`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).catch(e => console.warn('[runNow] run-program-queue kick failed:', e))
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

        {p.schedule?.id && (
          <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
            {onEdit && (
              <button
                onClick={() => { onEdit(p); onClose() }}
                style={{ background: '#e8f4ea', color: '#0d4d20', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
              >
                Edit
              </button>
            )}
            <button
              onClick={async () => {
                if (!window.confirm('Delete this schedule? This cannot be undone.')) return
                await supabase.from('group_schedules').delete().eq('id', p.schedule.id)
                if (onReload) onReload()
                onClose()
              }}
              style={{ background: '#fde8e8', color: '#c0392b', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
            >
              Delete
            </button>
            <button
              onClick={async () => {
                await supabase.from('group_schedules')
                  .update({ enabled: !p.schedule.enabled })
                  .eq('id', p.schedule.id)
                if (onReload) onReload()
              }}
              style={{ background: '#fff3cd', color: '#856404', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
            >
              {p.schedule.enabled ? 'Pause' : 'Resume'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Run zone modal ──────────────────────────────────────────────────────────
function RunZoneModal({ onClose, mqttPrefix, myDeviceId }) {
  const [zone, setZone]         = useState(1)
  const [duration, setDuration] = useState(30)
  const [running, setRunning]   = useState(false)

  async function run() {
    setRunning(true)
    try { await zoneOn(zone, duration, 'manual', { prefix: mqttPrefix, device: myDeviceId }) } catch (e) { console.error(e) }
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
  const { device: myDevice, mqttPrefix } = useMyDevice()
  const myDeviceId = myDevice?.device_id ?? 'irrigation1'
  const [view, setView]               = useState('week')
  const [selectedDay, setSelectedDay] = useState(new Date())
  const [showProgramBuilder, setShowProgramBuilder] = useState(false)
  const [editingProgram, setEditingProgram]         = useState(null)
  const [showRunModal, setShowRunModal] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [saved, setSaved]             = useState(false)
  const [programs, setPrograms]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [tick, setTick]               = useState(0)
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  })

  const reload = useCallback(() => setTick(t => t + 1), [])

  const { actual } = useCalendarHistory(selectedDate)

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toISOString().slice(0, 10)
  })

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [groupsRes, membersRes, schedulesRes] = await Promise.all([
        supabase.from('zone_groups').select('id, name, run_mode, duration_min'),
        supabase.from('zone_group_members').select('group_id, zone_num, duration_min, sort_order, device').order('sort_order'),
        supabase.from('group_schedules').select('id, group_id, label, days_of_week, start_time, enabled'),
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

          {/* 7-day navigation strip */}
          <div style={{ display: 'flex', gap: 4 }}>
            {weekDays.map(date => {
              const d = new Date(date + 'T12:00:00')
              const label = d.toLocaleDateString('en-AU', { weekday: 'short' })
              const dayNum = d.getDate()
              const isSelected = date === selectedDate
              return (
                <button key={date} onClick={() => setSelectedDate(date)}
                  style={{ flex: 1, background: isSelected ? '#0d4d20' : 'white', color: isSelected ? 'white' : '#3b4a44', border: '1.5px solid', borderColor: isSelected ? '#0d4d20' : '#e4e9e6', borderRadius: 8, padding: '4px 2px', cursor: 'pointer', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.55rem', color: isSelected ? '#b8d5c0' : '#7a8580' }}>{label}</div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600 }}>{dayNum}</div>
                </button>
              )
            })}
          </div>

          {/* Day timeline — planned vs actual */}
          <DayTimeline actual={actual} programs={programs} selectedDate={selectedDate} />

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

          {/* All programs — direct edit list */}
          <div className="bg-white rounded-xl shadow-card p-4">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">All Programs</h2>
            {loading ? (
              <p className="text-xs text-[#40493d]">Loading…</p>
            ) : programs.length === 0 ? (
              <p className="text-xs text-[#40493d]">No programs yet.</p>
            ) : (
              <div className="space-y-2">
                {programs.map((p, pi) => (
                  <div key={p.id} className="flex items-center gap-2.5 p-2.5 bg-[#f9f9f9] rounded-lg">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: COLORS[pi % COLORS.length] }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#1a1c1c] truncate">{p.name}</p>
                      <p className="text-[10px] text-[#40493d]">{fmtTime(p.schedule.start_time)} · {fmtDuration(totalDuration(p))}</p>
                      <p className="text-[10px] text-[#717975]">{fmtDays(p.schedule.days_of_week)}</p>
                    </div>
                    <button
                      onClick={() => setEditingProgram(p)}
                      className="shrink-0 px-2.5 py-1 rounded-md bg-[#e8f4ea] text-[#0d4d20] text-xs font-bold hover:bg-[#d4ecda] transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowProgramBuilder(true)}
            className={`w-full ${btnPrimary}`}
            style={btnPrimaryStyle}
          >
            + New Program
          </button>
          <button onClick={() => setShowRunModal(true)} className={`w-full ${btnSecondary}`}>
            Run Zone Now
          </button>
        </div>
      </div>

      {(showProgramBuilder || editingProgram) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => { setShowProgramBuilder(false); setEditingProgram(null) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-y-auto max-h-[90vh]"
            onClick={e => e.stopPropagation()}>
            <ProgramBuilder
              pumpZoneNum={myDevice?.pump_zone_num ?? null}
              existingSchedules={programs.filter(p => p.schedule).map(p => ({
                group_id: p.id,
                start_time: p.schedule.start_time,
                days_of_week: p.schedule.days_of_week,
                zone_groups: { duration_min: p.duration_min ?? 30 },
              }))}
              onSave={() => { setShowProgramBuilder(false); setEditingProgram(null); onSaved() }}
              onCancel={() => { setShowProgramBuilder(false); setEditingProgram(null) }}
              editProgram={editingProgram}
            />
          </div>
        </div>
      )}
      {showRunModal    && <RunZoneModal onClose={() => setShowRunModal(false)} mqttPrefix={mqttPrefix} myDeviceId={myDeviceId} />}
      {selectedEvent   && <EventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} mqttPrefix={mqttPrefix} myDeviceId={myDeviceId} onReload={reload} onEdit={(prog) => { setSelectedEvent(null); setEditingProgram(prog) }} />}
    </div>
  )
}

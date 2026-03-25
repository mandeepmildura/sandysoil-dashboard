import { useState, useEffect, useCallback } from 'react'
import StatusChip from '../components/StatusChip'
import { supabase } from '../lib/supabase'
import { zoneOn } from '../lib/commands'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 16 }, (_, i) => i + 5) // 5am–8pm
const COLORS = ['#0d631b', '#2e7d32', '#00639a', '#6a4c93', '#c0392b', '#d35400', '#16a085', '#8e44ad']

// DB day_of_week (0=Sun, 1=Mon, …, 6=Sat) → calendar column index (0=Mon, …, 6=Sun)
function dbDayToCalIdx(d) { return d === 0 ? 6 : d - 1 }

function getWeekMonday(date) {
  const d = new Date(date)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  d.setHours(0, 0, 0, 0)
  return d
}

function fmtTime(t) { return t ? t.slice(0, 5) : '—' }

function fmtDuration(min) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function AddScheduleModal({ onClose, onSaved }) {
  const [label, setLabel]         = useState('')
  const [zone, setZone]           = useState(1)
  const [days, setDays]           = useState([false,false,false,false,false,false,false])
  const [startTime, setStartTime] = useState('06:00')
  const [duration, setDuration]   = useState(30)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  function toggleDay(i) {
    setDays(prev => prev.map((v, j) => j === i ? !v : v))
  }

  async function save() {
    if (!label.trim())         { setError('Enter a schedule name'); return }
    if (!days.some(Boolean))   { setError('Select at least one day'); return }
    setSaving(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      const { data: group, error: e1 } = await supabase
        .from('zone_groups')
        .insert({ name: label.trim(), run_mode: 'sequential', owner_id: user?.id, customer_id: user?.id })
        .select('id').single()
      if (e1) throw e1

      const { error: e2 } = await supabase.from('zone_group_members').insert({
        group_id: group.id, zone_num: zone, duration_min: duration, sort_order: 0,
      })
      if (e2) throw e2

      // days_of_week: 0=Sun, 1=Mon, …, 6=Sat
      const dow = days.map((on, i) => on ? (i === 6 ? 0 : i + 1) : null).filter(d => d !== null)
      const { error: e3 } = await supabase.from('group_schedules').insert({
        group_id: group.id, label: label.trim(),
        days_of_week: dow, start_time: startTime, enabled: true, customer_id: user?.id,
      })
      if (e3) throw e3

      onSaved()
      onClose()
    } catch (err) {
      setError(err.message ?? 'Save failed — check Supabase permissions')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h2 className="font-headline font-bold text-lg text-[#1a1c1c] mb-4">Add Schedule</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-1">Schedule Name</label>
            <input
              value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Morning Zone 1"
              className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-body text-[#40493d] block mb-1">Zone</label>
              <select value={zone} onChange={e => setZone(Number(e.target.value))}
                className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none">
                {[1,2,3,4,5,6,7,8].map(z => <option key={z} value={z}>Zone {z}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-body text-[#40493d] block mb-1">Duration (min)</label>
              <input type="number" min={5} max={120} value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none" />
            </div>
          </div>

          <div>
            <label className="text-xs font-body text-[#40493d] block mb-2">Days</label>
            <div className="flex gap-1.5">
              {DAY_NAMES.map((d, i) => (
                <button key={i} type="button" onClick={() => toggleDay(i)}
                  className={`w-8 h-8 rounded-full text-xs font-semibold transition-colors ${
                    days[i] ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'
                  }`}>{d[0]}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-body text-[#40493d] block mb-1">Start Time</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none" />
          </div>

          {error && <p className="text-xs text-[#ba1a1a]">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d] hover:bg-[#e8e8e8] transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 rounded-xl gradient-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

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

export default function Calendar() {
  const [view, setView]               = useState('week')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showRunModal, setShowRunModal] = useState(false)
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
        supabase.from('zone_group_members').select('group_id, zone_num, duration_min, sort_order').order('sort_order'),
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
          .filter(g => g.schedule) // only show programs that have a schedule
        setPrograms(merged)
      }
      setLoading(false)
    }
    load()
  }, [tick])

  function onSaved() {
    setSaved(true)
    reload()
    setTimeout(() => setSaved(false), 3000)
  }

  // Current week dates (Mon–Sun)
  const today       = new Date()
  const weekMonday  = getWeekMonday(today)
  const weekDates   = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekMonday)
    d.setDate(weekMonday.getDate() + i)
    return d
  })
  const todayDbDow  = today.getDay()           // 0=Sun…6=Sat
  const todayCalIdx = dbDayToCalIdx(todayDbDow) // 0=Mon…6=Sun

  // Build calendar events from programs
  const events = []
  programs.forEach((p, pi) => {
    if (!p.schedule?.days_of_week?.length) return
    const [hh, mm] = p.schedule.start_time.split(':').map(Number)
    const startDecimal  = hh + mm / 60
    const totalMin      = p.run_mode === 'sequential'
      ? p.zones.reduce((sum, z) => sum + z.duration_min, 0)
      : (p.zones.length ? Math.max(...p.zones.map(z => z.duration_min)) : 30)
    const color = COLORS[pi % COLORS.length]

    p.schedule.days_of_week.forEach(dbDay => {
      events.push({ day: dbDayToCalIdx(dbDay), start: startDecimal, duration: totalMin / 60, label: p.name, color })
    })
  })

  // Today's programs sorted by start time
  const todayPrograms = programs
    .filter(p => p.schedule?.days_of_week?.includes(todayDbDow))
    .sort((a, b) => (a.schedule.start_time > b.schedule.start_time ? 1 : -1))

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Irrigation Calendar</h1>
        <div className="flex items-center gap-2">
          {['week', 'day'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-body font-medium transition-colors capitalize ${
                view === v ? 'bg-[#0d631b] text-white' : 'text-[#40493d] hover:bg-[#f3f3f3]'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {saved && (
        <div className="mb-4 px-4 py-3 bg-[#0d631b]/10 border border-[#0d631b]/20 rounded-xl text-sm text-[#0d631b] font-semibold">
          Schedule saved successfully.
        </div>
      )}

      <div className="grid grid-cols-4 gap-6">
        {/* Calendar grid */}
        <div className="col-span-3 bg-[#ffffff] rounded-xl shadow-card overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-8 border-b border-[#f3f3f3]">
            <div className="p-3 text-xs text-[#40493d] font-body" />
            {weekDates.map((d, i) => (
              <div key={i} className={`p-3 text-center ${i === todayCalIdx ? 'bg-[#0d631b]/5' : ''}`}>
                <p className="text-xs text-[#40493d] font-body">{DAY_NAMES[i]}</p>
                <p className={`text-lg font-headline font-bold ${i === todayCalIdx ? 'text-[#0d631b]' : 'text-[#1a1c1c]'}`}>{d.getDate()}</p>
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div className="overflow-y-auto max-h-96">
            {loading ? (
              <div className="p-8 text-center text-sm text-[#40493d]">Loading schedules…</div>
            ) : (
              HOURS.map(hour => (
                <div key={hour} className="grid grid-cols-8 border-b border-[#f3f3f3]/50 min-h-[48px]">
                  <div className="p-2 text-[10px] text-[#40493d] font-body text-right pr-3 pt-1">
                    {`${String(hour).padStart(2, '0')}:00`}
                  </div>
                  {DAY_NAMES.map((_, dayIdx) => {
                    const eventsInSlot = events.filter(e => e.day === dayIdx && Math.floor(e.start) === hour)
                    return (
                      <div key={dayIdx} className={`relative border-l border-[#f3f3f3]/50 p-1 ${dayIdx === todayCalIdx ? 'bg-[#0d631b]/[0.02]' : ''}`}>
                        {eventsInSlot.map((e, ei) => (
                          <div
                            key={ei}
                            className="rounded-md px-1.5 py-0.5 text-[10px] font-body font-medium text-white mb-0.5 truncate"
                            style={{ backgroundColor: e.color, opacity: 0.9 }}
                          >
                            {e.label}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Today's schedule */}
        <div className="space-y-4">
          <div className="bg-[#ffffff] rounded-xl shadow-card p-4 accent-green">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">
              Today — {DAY_NAMES[todayCalIdx]} {today.getDate()}
            </h2>
            {loading ? (
              <p className="text-xs text-[#40493d]">Loading…</p>
            ) : todayPrograms.length === 0 ? (
              <p className="text-xs text-[#40493d]">No schedules today.</p>
            ) : (
              <div className="space-y-2">
                {todayPrograms.map(p => {
                  const totalMin = p.run_mode === 'sequential'
                    ? p.zones.reduce((sum, z) => sum + z.duration_min, 0)
                    : (p.zones.length ? Math.max(...p.zones.map(z => z.duration_min)) : 0)
                  return (
                    <div key={p.id} className="rounded-lg p-3 bg-[#f9f9f9]">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-body font-semibold text-[#1a1c1c]">{fmtTime(p.schedule.start_time)}</span>
                        <StatusChip status={p.schedule.enabled ? 'online' : 'paused'} label={p.schedule.enabled ? 'ACTIVE' : 'PAUSED'} />
                      </div>
                      <p className="text-[11px] text-[#40493d]">{p.name}</p>
                      <p className="text-[10px] text-[#40493d]">{fmtDuration(totalMin)}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="w-full gradient-primary text-white font-body font-semibold text-sm py-3 rounded-xl shadow-fab hover:opacity-90 transition-opacity"
          >
            + Add Schedule
          </button>
          <button
            onClick={() => setShowRunModal(true)}
            className="w-full bg-[#e2e2e2] text-[#1a1c1c] font-body font-semibold text-sm py-3 rounded-xl hover:bg-[#e8e8e8] transition-colors"
          >
            Run Zone Now
          </button>
        </div>
      </div>

      {showAddModal && (
        <AddScheduleModal onClose={() => setShowAddModal(false)} onSaved={onSaved} />
      )}
      {showRunModal && (
        <RunZoneModal onClose={() => setShowRunModal(false)} />
      )}
    </div>
  )
}

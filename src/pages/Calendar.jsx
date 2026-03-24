import { useState } from 'react'
import StatusChip from '../components/StatusChip'
import { supabase } from '../lib/supabase'
import { zoneOn } from '../lib/commands'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DATES = [17, 18, 19, 20, 21, 22, 23]

const EVENTS = [
  { day: 0, start: 6,  duration: 0.5, zone: 'Zone 1', color: '#0d631b' },
  { day: 0, start: 6.5,duration: 0.75,zone: 'Zone 2', color: '#2e7d32' },
  { day: 0, start: 7.5,duration: 1,   zone: 'Zone 3', color: '#0d631b' },
  { day: 1, start: 6,  duration: 0.5, zone: 'Zone 1', color: '#0d631b' },
  { day: 1, start: 6.5,duration: 0.75,zone: 'Zone 2', color: '#2e7d32' },
  { day: 2, start: 6,  duration: 1.5, zone: 'Zone 4', color: '#00639a' },
  { day: 2, start: 7.5,duration: 0.5, zone: 'Backwash',color: '#00639a' },
  { day: 3, start: 6,  duration: 0.5, zone: 'Zone 1', color: '#0d631b' },
  { day: 4, start: 6,  duration: 2,   zone: 'Zone 5', color: '#2e7d32' },
  { day: 5, start: 7,  duration: 1,   zone: 'Zone 6', color: '#0d631b' },
  { day: 6, start: 6,  duration: 0.5, zone: 'Zone 1', color: '#0d631b' },
]

const TODAY_SCHEDULE = [
  { time: '06:00', zone: 'Zone 1 — North Block', duration: '30 min', status: 'completed' },
  { time: '06:30', zone: 'Zone 2 — South Block', duration: '45 min', status: 'completed' },
  { time: '07:30', zone: 'Zone 3 — East Row',    duration: '60 min', status: 'running' },
  { time: '09:00', zone: 'Zone 6 — Orchard B',   duration: '60 min', status: 'upcoming' },
  { time: '10:30', zone: 'Backwash',              duration: '15 min', status: 'upcoming' },
]

const HOURS = Array.from({ length: 16 }, (_, i) => i + 5) // 5am–8pm

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

      // 1. Create zone_group (program)
      const { data: group, error: e1 } = await supabase
        .from('zone_groups')
        .insert({ name: label.trim(), run_mode: 'sequential', owner_id: user?.id })
        .select('id').single()
      if (e1) throw e1

      // 2. Create zone member
      const { error: e2 } = await supabase.from('zone_group_members').insert({
        group_id: group.id, zone_num: zone, duration_min: duration, sort_order: 0,
      })
      if (e2) throw e2

      // 3. Create schedule — days_of_week: 0=Sun, 1=Mon, ..., 6=Sat
      const dow = days.map((on, i) => on ? (i === 6 ? 0 : i + 1) : null).filter(d => d !== null)
      const { error: e3 } = await supabase.from('group_schedules').insert({
        group_id: group.id, label: label.trim(),
        days_of_week: dow, start_time: startTime, enabled: true,
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
              {DAYS.map((d, i) => (
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
  const [view, setView]             = useState('week')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showRunModal, setShowRunModal] = useState(false)
  const [saved, setSaved]           = useState(false)

  function onSaved() {
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

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
            {DAYS.map((d, i) => (
              <div key={d} className={`p-3 text-center ${i === 3 ? 'bg-[#0d631b]/5' : ''}`}>
                <p className="text-xs text-[#40493d] font-body">{d}</p>
                <p className={`text-lg font-headline font-bold ${i === 3 ? 'text-[#0d631b]' : 'text-[#1a1c1c]'}`}>{DATES[i]}</p>
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div className="overflow-y-auto max-h-96">
            {HOURS.map(hour => (
              <div key={hour} className="grid grid-cols-8 border-b border-[#f3f3f3]/50 min-h-[48px]">
                <div className="p-2 text-[10px] text-[#40493d] font-body text-right pr-3 pt-1">
                  {`${String(hour).padStart(2, '0')}:00`}
                </div>
                {DAYS.map((_, dayIdx) => {
                  const eventsInSlot = EVENTS.filter(e => e.day === dayIdx && Math.floor(e.start) === hour)
                  return (
                    <div key={dayIdx} className={`relative border-l border-[#f3f3f3]/50 p-1 ${dayIdx === 3 ? 'bg-[#0d631b]/[0.02]' : ''}`}>
                      {eventsInSlot.map((e, ei) => (
                        <div
                          key={ei}
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-body font-medium text-white mb-0.5 truncate"
                          style={{ backgroundColor: e.color, opacity: 0.9 }}
                        >
                          {e.zone}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Today's schedule */}
        <div className="space-y-4">
          <div className="bg-[#ffffff] rounded-xl shadow-card p-4 accent-green">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Today — Mon 20</h2>
            <div className="space-y-2">
              {TODAY_SCHEDULE.map((s, i) => (
                <div key={i} className={`rounded-lg p-3 ${s.status === 'running' ? 'bg-[#0d631b]/5' : s.status === 'completed' ? 'bg-[#f3f3f3]' : 'bg-[#f9f9f9]'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-body font-semibold text-[#1a1c1c]">{s.time}</span>
                    <StatusChip status={s.status} />
                  </div>
                  <p className="text-[11px] text-[#40493d]">{s.zone}</p>
                  <p className="text-[10px] text-[#40493d]">{s.duration}</p>
                </div>
              ))}
            </div>
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

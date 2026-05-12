import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { schedulesOverlap, toMin } from '../lib/programUtils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ALL_ZONES = [1, 2, 3, 4, 5, 6, 7, 8]
const DURATION_PRESETS = [
  { label: '30 min', value: 30 },
  { label: '1 hr',   value: 60 },
  { label: '2 hr',   value: 120 },
  { label: '4 hr',   value: 240 },
]

/**
 * @param {object} props
 * @param {number|null} props.pumpZoneNum - zone excluded from picker
 * @param {Array}  props.existingSchedules - for overlap detection
 * @param {function} props.onSave - called after successful save
 * @param {function} props.onCancel
 * @param {object|null} props.editProgram - program to edit, or null for new
 */
export default function ProgramBuilder({ pumpZoneNum, existingSchedules = [], onSave, onCancel, editProgram = null }) {
  const [name, setName]                   = useState(editProgram?.name ?? '')
  const [selectedZones, setSelectedZones] = useState(
    editProgram ? editProgram.zones.map(z => z.zone_num) : []
  )
  const [durationMin, setDurationMin]     = useState(editProgram?.duration_min ?? 60)
  const [startTime, setStartTime]         = useState(editProgram?.schedule?.start_time?.slice(0, 5) ?? '06:00')
  const [days, setDays]                   = useState(editProgram?.schedule?.days_of_week ?? [1, 3, 5])
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState(null)

  function toggleZone(z) {
    setSelectedZones(prev => prev.includes(z) ? prev.filter(x => x !== z) : [...prev, z])
  }

  function toggleDay(d) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  async function save() {
    setError(null)
    if (!name.trim()) { setError('Enter a program name'); return }
    if (selectedZones.length === 0) { setError('Select at least one zone'); return }
    if (days.length === 0) { setError('Select at least one day'); return }
    if (durationMin < 1) { setError('Duration must be at least 1 minute'); return }

    const proposed = { start_time: startTime, duration_min: durationMin, days_of_week: days }
    const conflict = existingSchedules.find(s =>
      s.group_id !== editProgram?.id && schedulesOverlap(proposed, {
        start_time: s.start_time,
        duration_min: s.zone_groups?.duration_min ?? 30,
        days_of_week: s.days_of_week,
      })
    )
    if (conflict) {
      const conflictStart = toMin(conflict.start_time)
      const conflictDur   = conflict.zone_groups?.duration_min ?? 30
      const endTotal      = conflictStart + conflictDur
      const endH = Math.floor(endTotal / 60)
      const endM = endTotal % 60
      setError(`Overlaps with "${conflict.zone_groups?.name ?? conflict.label}" — earliest start: ${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`)
      return
    }

    setSaving(true)
    try {
      let groupId = editProgram?.id
      if (groupId) {
        await supabase.from('zone_groups').update({ name: name.trim(), duration_min: durationMin, run_mode: 'simultaneous' }).eq('id', groupId)
        await supabase.from('zone_group_members').delete().eq('group_id', groupId)
      } else {
        const { data } = await supabase.from('zone_groups').insert({ name: name.trim(), duration_min: durationMin, run_mode: 'simultaneous' }).select('id').single()
        groupId = data.id
      }

      const members = selectedZones.map((z, i) => ({
        group_id: groupId, zone_num: z, sort_order: i,
        step_type: 'on', device: 'irrigation1', duration_min: null, delay_min: null,
      }))
      await supabase.from('zone_group_members').insert(members)

      if (editProgram?.schedule?.id) {
        await supabase.from('group_schedules').update({ start_time: startTime + ':00', days_of_week: days, enabled: true }).eq('id', editProgram.schedule.id)
      } else {
        await supabase.from('group_schedules').insert({ group_id: groupId, start_time: startTime + ':00', days_of_week: days, enabled: true })
      }

      onSave()
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const availableZones = ALL_ZONES.filter(z => z !== pumpZoneNum)
  const isPreset = DURATION_PRESETS.some(p => p.value === durationMin)

  return (
    <div className="p-6 w-full max-w-md">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-bold text-[#0d4d20]">
          {editProgram ? 'Edit Program' : 'New Program'}
        </h2>
        <button
          onClick={onCancel}
          className="text-sm text-[#7a8580] hover:text-[#40493d] transition-colors"
        >
          ✕ Cancel
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-100 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Program name */}
      <label className="block text-xs font-bold text-[#7a8580] uppercase tracking-wider mb-1.5">
        Program name
      </label>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="e.g. Avocados Morning"
        className="w-full border border-[#e4e9e6] rounded-lg px-3 py-2.5 text-sm mb-5 focus:outline-none focus:border-[#0d4d20] transition-colors"
      />

      {/* Zones */}
      <label className="block text-xs font-bold text-[#7a8580] uppercase tracking-wider mb-2">
        Zones <span className="normal-case font-normal">(run simultaneously)</span>
      </label>
      <div className="grid grid-cols-4 gap-2 mb-1">
        {availableZones.map(z => {
          const on = selectedZones.includes(z)
          return (
            <button
              key={z}
              onClick={() => toggleZone(z)}
              className={`py-3 rounded-xl text-sm font-bold transition-colors ${
                on
                  ? 'bg-[#0d4d20] text-white'
                  : 'bg-white border-2 border-[#e4e9e6] text-[#7a8580] hover:border-[#0d4d20] hover:text-[#0d4d20]'
              }`}
            >
              {on ? '✓' : ''} Z{z}
            </button>
          )
        })}
      </div>
      {pumpZoneNum && (
        <p className="text-[10px] text-[#7a8580] mb-4">Zone {pumpZoneNum} (Pump) runs automatically</p>
      )}
      {!pumpZoneNum && <div className="mb-4" />}

      {/* Duration */}
      <label className="block text-xs font-bold text-[#7a8580] uppercase tracking-wider mb-2">
        Duration <span className="normal-case font-normal">(all zones)</span>
      </label>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {DURATION_PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => setDurationMin(p.value)}
            className={`py-3 rounded-xl text-sm font-bold transition-colors ${
              durationMin === p.value
                ? 'bg-[#0d4d20] text-white'
                : 'bg-white border-2 border-[#e4e9e6] text-[#7a8580] hover:border-[#0d4d20] hover:text-[#0d4d20]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-5">
        <input
          type="number"
          min="1"
          value={durationMin}
          onChange={e => setDurationMin(parseInt(e.target.value) || 1)}
          className="w-24 border border-[#e4e9e6] rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:border-[#0d4d20] transition-colors"
        />
        <span className="text-sm text-[#7a8580]">
          min
          {durationMin >= 60 && (
            <span className="ml-1 text-[#0d4d20] font-semibold">
              = {Math.floor(durationMin / 60)}h{durationMin % 60 ? ` ${durationMin % 60}m` : ''}
            </span>
          )}
        </span>
      </div>

      {/* Start time */}
      <label className="block text-xs font-bold text-[#7a8580] uppercase tracking-wider mb-1.5">
        Start time
      </label>
      <input
        type="time"
        value={startTime}
        onChange={e => setStartTime(e.target.value)}
        className="border border-[#e4e9e6] rounded-lg px-3 py-2.5 text-sm mb-5 focus:outline-none focus:border-[#0d4d20] transition-colors"
      />

      {/* Days */}
      <label className="block text-xs font-bold text-[#7a8580] uppercase tracking-wider mb-2">
        Days
      </label>
      <div className="grid grid-cols-7 gap-1.5 mb-6">
        {DAYS.map((d, i) => (
          <button
            key={i}
            onClick={() => toggleDay(i)}
            className={`py-2.5 rounded-xl text-xs font-bold transition-colors ${
              days.includes(i)
                ? 'bg-[#0d4d20] text-white'
                : 'bg-white border-2 border-[#e4e9e6] text-[#7a8580] hover:border-[#0d4d20] hover:text-[#0d4d20]'
            }`}
          >
            {d.slice(0, 2)}
          </button>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full py-3 bg-[#0d4d20] text-white rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {saving ? 'Saving…' : 'Save Program'}
      </button>
    </div>
  )
}

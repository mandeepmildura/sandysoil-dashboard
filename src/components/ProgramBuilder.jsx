// src/components/ProgramBuilder.jsx
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { schedulesOverlap, toMin } from '../lib/programUtils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ALL_ZONES = [1, 2, 3, 4, 5, 6, 7, 8]

/**
 * @param {object} props
 * @param {number|null} props.pumpZoneNum - zone excluded from picker
 * @param {Array}  props.existingSchedules - for overlap detection
 * @param {function} props.onSave - called after successful save
 * @param {function} props.onCancel
 * @param {object|null} props.editProgram - program to edit, or null for new
 */
export default function ProgramBuilder({ pumpZoneNum, existingSchedules = [], onSave, onCancel, editProgram = null }) {
  const [name, setName]           = useState(editProgram?.name ?? '')
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

  return (
    <div style={{ padding: '1.25rem', maxWidth: 360 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0d4d20' }}>
          {editProgram ? 'Edit Program' : 'New Program'}
        </span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#7a8580', fontSize: '0.8rem', cursor: 'pointer' }}>✕ Cancel</button>
      </div>

      {error && <div style={{ background: '#fde8e8', color: '#c0392b', borderRadius: 6, padding: '6px 10px', fontSize: '0.78rem', marginBottom: '0.75rem' }}>{error}</div>}

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Program name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Avocados Morning"
        style={{ width: '100%', border: '1.5px solid #e4e9e6', borderRadius: 6, padding: '6px 10px', fontSize: '0.85rem', marginBottom: '0.85rem', boxSizing: 'border-box' }} />

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Zones (run together)</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.4rem' }}>
        {availableZones.map(z => (
          <button key={z} onClick={() => toggleZone(z)}
            style={{ background: selectedZones.includes(z) ? '#0d4d20' : 'white', color: selectedZones.includes(z) ? 'white' : '#7a8580', border: '1.5px solid', borderColor: selectedZones.includes(z) ? '#0d4d20' : '#e4e9e6', borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
            {selectedZones.includes(z) ? '✓ ' : ''}Zone {z}
          </button>
        ))}
      </div>
      {pumpZoneNum && <p style={{ fontSize: '0.6rem', color: '#7a8580', marginBottom: '0.85rem' }}>Zone {pumpZoneNum} (Pump) runs automatically</p>}

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Duration (all zones)</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.85rem' }}>
        <input type="number" min="1" value={durationMin} onChange={e => setDurationMin(parseInt(e.target.value) || 1)}
          style={{ width: 64, border: '1.5px solid #e4e9e6', borderRadius: 6, padding: '6px 8px', fontSize: '0.85rem', textAlign: 'center' }} />
        <span style={{ fontSize: '0.8rem', color: '#7a8580' }}>minutes</span>
        {durationMin >= 60 && <span style={{ fontSize: '0.7rem', color: '#7a8580', marginLeft: 'auto' }}>= {Math.floor(durationMin/60)}h{durationMin%60 ? ` ${durationMin%60}m` : ''}</span>}
      </div>

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Start time</label>
      <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
        style={{ border: '1.5px solid #e4e9e6', borderRadius: 6, padding: '6px 8px', fontSize: '0.85rem', marginBottom: '0.75rem' }} />

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Days</label>
      <div style={{ display: 'flex', gap: 5, marginBottom: '1rem' }}>
        {DAYS.map((d, i) => (
          <button key={i} onClick={() => toggleDay(i)}
            style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: days.includes(i) ? '#0d4d20' : '#e4e9e6', color: days.includes(i) ? 'white' : '#7a8580', fontSize: '0.6rem', fontWeight: 700, cursor: 'pointer' }}>
            {d[0]}
          </button>
        ))}
      </div>

      <button onClick={save} disabled={saving}
        style={{ width: '100%', background: saving ? '#7a8580' : '#0d4d20', color: 'white', border: 'none', borderRadius: 8, padding: '0.65rem', fontSize: '0.85rem', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
        {saving ? 'Saving…' : 'Save Program'}
      </button>
    </div>
  )
}

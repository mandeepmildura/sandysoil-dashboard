import { useState } from 'react'
import StatusChip from '../components/StatusChip'
import { usePrograms } from '../hooks/usePrograms'
import { useUserContext } from '../hooks/useUserContext'
import { supabase } from '../lib/supabase'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function fmtDays(days) {
  if (!days?.length) return 'No days'
  const names = days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d] ?? d)
  return names.join(', ')
}

function fmtTime(t) {
  if (!t) return '—'
  return t.slice(0, 5)
}

// Convert days_of_week array (0=Sun…6=Sat) back to boolean[7] (index 0=Mon…6=Sun)
function dowToBools(dow) {
  const bools = [false,false,false,false,false,false,false]
  if (!dow) return bools
  dow.forEach(d => {
    const idx = d === 0 ? 6 : d - 1  // 0(Sun)→6, 1(Mon)→0, …
    bools[idx] = true
  })
  return bools
}

function ProgramModal({ program, deviceId, userId, onClose, onSaved }) {
  const isEdit = !!program

  const [name, setName]       = useState(isEdit ? program.name : '')
  const [runMode, setRunMode] = useState(isEdit ? program.run_mode : 'sequential')
  const [zones, setZones]     = useState(
    isEdit
      ? program.zones.map(z => ({ num: z.zone_num, duration: z.duration_min }))
      : [{ num: 1, duration: 30 }]
  )
  const [hasSchedule, setHasSchedule] = useState(isEdit ? !!program.schedule : false)
  const [days, setDays]               = useState(isEdit && program.schedule ? dowToBools(program.schedule.days_of_week) : [false,false,false,false,false,false,false])
  const [startTime, setStartTime]     = useState(isEdit && program.schedule ? fmtTime(program.schedule.start_time) : '06:00')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState(null)

  function addZone() {
    setZones(z => [...z, { num: 1, duration: 30 }])
  }

  function removeZone(i) {
    setZones(z => z.filter((_, j) => j !== i))
  }

  function updateZone(i, field, value) {
    setZones(z => z.map((zone, j) => j === i ? { ...zone, [field]: value } : zone))
  }

  function toggleDay(i) {
    setDays(prev => prev.map((v, j) => j === i ? !v : v))
  }

  async function save() {
    if (!name.trim())           { setError('Enter a program name'); return }
    if (zones.length === 0)     { setError('Add at least one zone'); return }
    if (hasSchedule && !days.some(Boolean)) { setError('Select at least one day for the schedule'); return }
    if (!deviceId || !userId) { setError('Device not loaded — try refreshing'); return }
    setSaving(true)
    setError(null)

    try {
      let groupId

      if (isEdit) {
        const { error: e1 } = await supabase.from('zone_groups')
          .update({ name: name.trim(), run_mode: runMode }).eq('id', program.id)
        if (e1) throw e1
        groupId = program.id
        await supabase.from('zone_group_members').delete().eq('group_id', groupId)
      } else {
        const { data: group, error: e1 } = await supabase.from('zone_groups')
          .insert({ name: name.trim(), run_mode: runMode, device_id: deviceId, customer_id: userId })
          .select('id').single()
        if (e1) throw e1
        groupId = group.id
      }

      const { error: e2 } = await supabase.from('zone_group_members').insert(
        zones.map((z, i) => ({ group_id: groupId, zone_num: z.num, duration_min: z.duration, sort_order: i }))
      )
      if (e2) throw e2

      if (hasSchedule) {
        const dow = days.map((on, i) => on ? (i === 6 ? 0 : i + 1) : null).filter(d => d !== null)
        const schedData = { group_id: groupId, device_id: deviceId, customer_id: userId, label: name.trim(), days_of_week: dow, start_time: startTime, enabled: true }

        if (isEdit && program.schedule) {
          const { error: e3 } = await supabase.from('group_schedules').update(schedData).eq('group_id', groupId)
          if (e3) throw e3
        } else {
          await supabase.from('group_schedules').delete().eq('group_id', groupId)
          const { error: e3 } = await supabase.from('group_schedules').insert(schedData)
          if (e3) throw e3
        }
      } else if (isEdit && program.schedule) {
        await supabase.from('group_schedules').delete().eq('group_id', groupId)
      }

      onSaved()
      onClose()
    } catch (err) {
      setError(err.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteProgram() {
    if (!window.confirm(`Delete "${program.name}"?`)) return
    setSaving(true)
    try {
      await supabase.from('group_schedules').delete().eq('group_id', program.id)
      await supabase.from('zone_group_members').delete().eq('group_id', program.id)
      const { error } = await supabase.from('zone_groups').delete().eq('id', program.id)
      if (error) throw error
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message ?? 'Delete failed')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md my-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-headline font-bold text-lg text-[#1a1c1c]">{isEdit ? 'Edit Program' : 'New Program'}</h2>
          {isEdit && (
            <button onClick={deleteProgram} disabled={saving}
              className="text-xs text-[#ba1a1a] font-semibold hover:underline disabled:opacity-50">
              Delete
            </button>
          )}
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-1">Program Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Morning Block"
              className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none" />
          </div>

          {/* Run mode */}
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-2">Run Mode</label>
            <div className="flex gap-2">
              {['sequential', 'parallel'].map(m => (
                <button key={m} type="button" onClick={() => setRunMode(m)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${
                    runMode === m ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'
                  }`}>{m}</button>
              ))}
            </div>
          </div>

          {/* Zones */}
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-2">Zones</label>
            <div className="space-y-2">
              {zones.map((z, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-[#40493d] w-4 shrink-0">{i + 1}.</span>
                  <select value={z.num} onChange={e => updateZone(i, 'num', Number(e.target.value))}
                    className="flex-1 bg-[#f3f3f3] rounded-lg px-2 py-2 text-sm font-body text-[#1a1c1c] outline-none">
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>Zone {n}</option>)}
                  </select>
                  <input type="number" min={1} max={240} value={z.duration}
                    onChange={e => updateZone(i, 'duration', Number(e.target.value))}
                    className="w-16 bg-[#f3f3f3] rounded-lg px-2 py-2 text-sm font-body text-[#1a1c1c] outline-none text-center" />
                  <span className="text-xs text-[#40493d]">min</span>
                  {zones.length > 1 && (
                    <button onClick={() => removeZone(i)}
                      className="text-[#ba1a1a] text-xs font-semibold hover:opacity-70 transition-opacity">✕</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addZone}
              className="mt-2 text-xs text-[#00639a] font-semibold hover:underline">+ Add Zone</button>
          </div>

          {/* Schedule toggle */}
          <div className="flex items-center justify-between py-2 border-t border-[#f3f3f3]">
            <span className="text-sm font-body font-semibold text-[#1a1c1c]">Set Schedule</span>
            <button type="button" onClick={() => setHasSchedule(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${hasSchedule ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${hasSchedule ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {hasSchedule && (
            <>
              <div>
                <label className="text-xs font-body text-[#40493d] block mb-2">Days</label>
                <div className="flex gap-1.5">
                  {DAY_LABELS.map((d, i) => (
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
            </>
          )}

          {error && <p className="text-xs text-[#ba1a1a]">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d] hover:bg-[#e8e8e8] transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 rounded-xl gradient-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
              {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Programs() {
  const { programs, loading, reload }           = usePrograms()
  const { irrigationId, userId, loading: ctxLoading } = useUserContext()
  const [expanded, setExpanded] = useState(null)
  const [filter, setFilter]     = useState('All')
  const [modal, setModal]       = useState(null) // null | 'new' | program object
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
        <button
          onClick={() => setModal('new')}
          className="gradient-primary text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity"
        >
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
                            <span key={z.zone_num} className="px-1.5 py-0.5 bg-[#f3f3f3] rounded-full text-[10px] text-[#40493d]">Z{z.zone_num}</span>
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
                                  <span key={z.zone_num} className="px-2.5 py-1 bg-[#f3f3f3] rounded-lg text-xs">
                                    {i + 1}. Zone {z.zone_num} — {z.duration_min} min
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-3 shrink-0">
                              <button className="gradient-primary text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-fab hover:opacity-90">Run Now</button>
                              <button
                                onClick={e => { e.stopPropagation(); setModal(p) }}
                                className="bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#e8e8e8]"
                              >Edit</button>
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

      {modal !== null && !ctxLoading && (
        <ProgramModal
          program={modal === 'new' ? null : modal}
          deviceId={irrigationId}
          userId={userId}
          onClose={() => setModal(null)}
          onSaved={() => { reload(); setExpanded(null) }}
        />
      )}
    </div>
  )
}

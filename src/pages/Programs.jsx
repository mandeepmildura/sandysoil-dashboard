import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePrograms } from '../hooks/usePrograms'
import { useZoneNames } from '../hooks/useZoneNames'
import { supabase } from '../lib/supabase'
import { zoneOn, a6v3ZoneOn, a6v3OutputOn, a6v3OutputOff, zoneOff } from '../lib/commands'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function fmtDays(days) {
  if (!days?.length) return 'No days'
  return days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d] ?? d).join(', ')
}

function fmtTime(t) {
  if (!t) return '—'
  return t.slice(0, 5)
}

function fmtDelay(min) {
  if (!min) return '0 min'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h > 0 && m > 0) return `${h}h ${m}min`
  if (h > 0) return `${h}h`
  return `${m}min`
}

function dowToBools(dow) {
  const bools = [false,false,false,false,false,false,false]
  if (!dow) return bools
  dow.forEach(d => { bools[d === 0 ? 6 : d - 1] = true })
  return bools
}

// ── Inline toggle ─────────────────────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onChange(!on) }}
      className={`relative w-10 h-[22px] rounded-full transition-colors shrink-0 ${on ? 'bg-[#0d631b]' : 'bg-[#c9c9c9]'}`}>
      <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
    </button>
  )
}

// ── Step icon ─────────────────────────────────────────────────────────────────
function StepIcon({ stepType }) {
  if (stepType === 'delay') {
    return (
      <div className="w-9 h-9 rounded-lg bg-[#fff3e0] flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#e65100]" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" strokeLinecap="round" />
        </svg>
      </div>
    )
  }
  return (
    <div className="w-9 h-9 rounded-lg bg-[#f3f3f3] flex items-center justify-center shrink-0">
      <div className="w-5 h-5 rounded bg-[#d0d0d0]" />
    </div>
  )
}

// ── Schedule trigger icon ─────────────────────────────────────────────────────
function ClockIcon() {
  return (
    <div className="w-9 h-9 rounded-full bg-[#1976d2] flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.2}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" strokeLinecap="round" />
      </svg>
    </div>
  )
}

// ── Add Step Modal ────────────────────────────────────────────────────────────
function AddStepModal({ groupId, nextSortOrder, onClose, onSaved }) {
  const [stepKind, setStepKind]   = useState('device')  // 'device' | 'delay'
  const [device, setDevice]       = useState('irrigation1')
  const [zoneNum, setZoneNum]     = useState(1)
  const [action, setAction]       = useState('on')
  const [durationMin, setDurationMin] = useState(30)
  const [delayHours, setDelayHours]   = useState(2)
  const [delayMins, setDelayMins]     = useState(0)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  const { names: irrNames } = useZoneNames('irrigation1')
  const { names: a6v3Names } = useZoneNames('a6v3')

  const slotMax = device === 'a6v3' ? 6 : 8
  const names   = device === 'a6v3' ? a6v3Names : irrNames
  const slotLbl = device === 'a6v3' ? 'Relay' : 'Zone'

  async function save() {
    setSaving(true)
    setError(null)
    try {
      let row
      if (stepKind === 'delay') {
        row = {
          group_id:   groupId,
          step_type:  'delay',
          zone_num:   0,
          duration_min: null,
          delay_min:  delayHours * 60 + delayMins,
          device:     'irrigation1',
          sort_order: nextSortOrder,
        }
      } else {
        row = {
          group_id:    groupId,
          step_type:   action,
          zone_num:    zoneNum,
          duration_min: action === 'on' ? durationMin : null,
          delay_min:   null,
          device,
          sort_order:  nextSortOrder,
        }
      }
      const { error: e } = await supabase.from('zone_group_members').insert(row)
      if (e) throw e
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message ?? 'Save failed')
      setSaving(false)
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[9999]" onClick={onClose} />
      <div className="fixed inset-0 z-[9999] flex flex-col justify-end sm:justify-center sm:items-center sm:p-6 pointer-events-none">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md flex flex-col pointer-events-auto" style={{ maxHeight: '75vh' }} onClick={e => e.stopPropagation()}>
        <div className="overflow-y-auto px-5 pt-5 flex-1">
          <h3 className="font-headline font-bold text-base text-[#1a1c1c] mb-4">Add Step</h3>

          <div className="flex gap-2 mb-4">
            {[{id:'device', label:'Device Action'}, {id:'delay', label:'Delay'}].map(k => (
              <button key={k.id} type="button" onClick={() => setStepKind(k.id)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${stepKind === k.id ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'}`}>
                {k.label}
              </button>
            ))}
          </div>

          {stepKind === 'device' ? (
            <div className="space-y-3 pb-2">
              <div>
                <label className="text-xs text-[#40493d] block mb-1.5">Device</label>
                <div className="flex gap-2">
                  {[{id:'irrigation1',label:'Irrigation (8-Zone)'},{id:'a6v3',label:'A6v3 Relays'}].map(d => (
                    <button key={d.id} type="button" onClick={() => { setDevice(d.id); setZoneNum(1) }}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${device === d.id ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'}`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-[#40493d] block mb-1.5">{slotLbl}</label>
                <select value={zoneNum} onChange={e => setZoneNum(Number(e.target.value))}
                  className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none">
                  {Array.from({ length: slotMax }, (_, n) => n + 1).map(n => (
                    <option key={n} value={n}>{names[n] ?? `${slotLbl} ${n}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[#40493d] block mb-1.5">Action</label>
                <div className="flex gap-2">
                  {['on', 'off'].map(a => (
                    <button key={a} type="button" onClick={() => setAction(a)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${action === a ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'}`}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              {action === 'on' && (
                <div>
                  <label className="text-xs text-[#40493d] block mb-1.5">Duration (min)</label>
                  <input type="number" min={1} max={480} value={durationMin}
                    onChange={e => setDurationMin(Number(e.target.value))}
                    className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none" />
                </div>
              )}
            </div>
          ) : (
            <div className="pb-2">
              <label className="text-xs text-[#40493d] block mb-1.5">Delay duration</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <input type="number" min={0} max={23} value={delayHours}
                    onChange={e => setDelayHours(Number(e.target.value))}
                    className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none text-center" />
                  <p className="text-[10px] text-[#40493d] text-center mt-1">hours</p>
                </div>
                <div className="flex-1">
                  <input type="number" min={0} max={59} value={delayMins}
                    onChange={e => setDelayMins(Number(e.target.value))}
                    className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none text-center" />
                  <p className="text-[10px] text-[#40493d] text-center mt-1">minutes</p>
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-[#ba1a1a] mt-3">{error}</p>}
        </div>

        {/* Sticky footer — button above iOS browser toolbar */}
        <div className="px-5 pt-3 bg-white border-t border-[#f3f3f3] flex-shrink-0">
          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d]">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#0d631b] text-white text-sm font-semibold disabled:opacity-50">
              {saving ? 'Adding…' : 'Add Step'}
            </button>
          </div>
          <div className="h-24 sm:h-0" />
        </div>
      </div>
      </div>
    </>,
    document.body
  )
}

// ── IF/THEN Detail Panel ──────────────────────────────────────────────────────
function AutomationDetail({ program, onReload, onEdit }) {
  const [addingStep, setAddingStep] = useState(false)
  const steps = [...(program.zones ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  const sched = program.schedule

  async function removeStep(memberId) {
    await supabase.from('zone_group_members').delete().eq('id', memberId)
    onReload()
  }

  async function toggleSchedule(enabled) {
    if (!sched?.id) return
    await supabase.from('group_schedules').update({ enabled }).eq('id', sched.id)
    onReload()
  }

  const deviceLabel = d => d === 'a6v3' ? 'A6v3 Relays' : 'Irrigation (8-Zone)'

  return (
    <div className="px-4 pb-4 space-y-4">
      {/* IF */}
      <div className="bg-[#f9f9f9] rounded-xl p-3">
        <p className="font-headline font-bold text-sm text-[#1a1c1c] mb-2">If</p>
        {sched ? (
          <div className="flex items-center gap-3">
            <ClockIcon />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-[#1a1c1c]">Schedule: {fmtTime(sched.start_time)}</p>
              <p className="text-xs text-[#40493d] truncate">{fmtDays(sched.days_of_week)}</p>
            </div>
            <Toggle on={sched.enabled !== false} onChange={v => toggleSchedule(v)} />
          </div>
        ) : (
          <p className="text-xs text-[#40493d]">No trigger set — edit to add a schedule.</p>
        )}
      </div>

      {/* THEN */}
      <div className="bg-[#f9f9f9] rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="font-headline font-bold text-sm text-[#1a1c1c]">Then</p>
          <button onClick={() => setAddingStep(true)}
            className="w-7 h-7 rounded-full bg-[#0d631b] text-white text-lg leading-none flex items-center justify-center hover:opacity-90">
            +
          </button>
        </div>

        {steps.length === 0 && (
          <p className="text-xs text-[#40493d] py-2">No steps yet — tap + to add one.</p>
        )}

        <div className="space-y-1">
          {steps.map((step, i) => {
            const type = step.step_type ?? 'on'
            return (
              <div key={step.id ?? i} className="flex items-center gap-3 py-2 border-b border-[#efefef] last:border-0">
                <StepIcon stepType={type} />
                <div className="flex-1 min-w-0">
                  {type === 'delay' ? (
                    <>
                      <p className="font-semibold text-sm text-[#1a1c1c]">Delay the action</p>
                      <p className="text-xs text-[#40493d]">{fmtDelay(step.delay_min)}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-sm text-[#1a1c1c]">
                        {step.device === 'a6v3' ? `Relay ${step.zone_num}` : `Zone ${step.zone_num}`} : {type}
                      </p>
                      <p className="text-xs text-[#40493d]">
                        {deviceLabel(step.device)}
                        {type === 'on' && step.duration_min ? ` · ${step.duration_min} min` : ''}
                      </p>
                    </>
                  )}
                </div>
                <button onClick={() => removeStep(step.id)}
                  className="text-[#ba1a1a] text-xs font-semibold hover:opacity-70 transition-opacity shrink-0 px-1">
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={onEdit}
          className="flex-1 py-2 rounded-xl bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold hover:bg-[#d5d5d5]">
          Edit Automation
        </button>
        <RunNowButton program={program} />
      </div>

      {addingStep && (
        <AddStepModal
          groupId={program.id}
          nextSortOrder={steps.length}
          onClose={() => setAddingStep(false)}
          onSaved={() => { setAddingStep(false); onReload() }}
        />
      )}
    </div>
  )
}

// ── Run Now Button (queues all steps for immediate execution) ─────────────────
function RunNowButton({ program }) {
  const [running, setRunning] = useState(false)

  async function run() {
    if (!program.zones?.length) return
    setRunning(true)
    try {
      const steps = [...program.zones].sort((a, b) => a.sort_order - b.sort_order)
      const now = Date.now()
      let cursorMs = now
      const queueRows = []

      for (const step of steps) {
        const type = step.step_type ?? 'on'
        if (type === 'delay') {
          cursorMs += (step.delay_min ?? 0) * 60_000
          continue
        }
        queueRows.push({
          group_id:    program.id,
          step_type:   type,
          device:      step.device ?? 'irrigation1',
          zone_num:    step.zone_num,
          duration_min: step.duration_min,
          fire_at:     new Date(cursorMs).toISOString(),
        })
        if (type === 'on' && (step.device ?? 'irrigation1') === 'irrigation1' && program.run_mode === 'sequential') {
          cursorMs += (step.duration_min ?? 0) * 60_000
        }
      }

      if (queueRows.length > 0) {
        const { error } = await supabase.from('program_queue').insert(queueRows)
        if (error) throw error
      }
    } catch (e) {
      alert(`Failed to queue program: ${e.message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <button onClick={run} disabled={running}
      className="flex-1 py-2 rounded-xl gradient-primary text-white text-xs font-semibold disabled:opacity-50 hover:opacity-90">
      {running ? 'Queuing…' : 'Run Now'}
    </button>
  )
}

// ── New / Edit Automation Modal ───────────────────────────────────────────────
function AutomationModal({ program, onClose, onSaved }) {
  const isEdit = !!program

  const [name, setName]           = useState(isEdit ? program.name : '')
  const [runMode, setRunMode]     = useState(isEdit ? program.run_mode : 'sequential')
  const [hasSchedule, setHasSchedule] = useState(isEdit ? !!program.schedule : false)
  const [days, setDays]           = useState(isEdit && program.schedule ? dowToBools(program.schedule.days_of_week) : [false,false,false,false,false,false,false])
  const [startTime, setStartTime] = useState(isEdit && program.schedule ? fmtTime(program.schedule.start_time) : '06:00')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  function toggleDay(i) {
    setDays(prev => prev.map((v, j) => j === i ? !v : v))
  }

  async function save() {
    if (!name.trim()) { setError('Enter an automation name'); return }
    if (hasSchedule && !days.some(Boolean)) { setError('Select at least one day'); return }
    setSaving(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let groupId

      if (isEdit) {
        const { error: e1 } = await supabase.from('zone_groups')
          .update({ name: name.trim(), run_mode: runMode }).eq('id', program.id)
        if (e1) throw e1
        groupId = program.id
      } else {
        const { data: group, error: e1 } = await supabase.from('zone_groups')
          .insert({ name: name.trim(), run_mode: runMode, owner_id: user?.id, customer_id: user?.id })
          .select('id').single()
        if (e1) throw e1
        groupId = group.id
      }

      if (hasSchedule) {
        const dow = days.map((on, i) => on ? (i === 6 ? 0 : i + 1) : null).filter(d => d !== null)
        const schedData = { group_id: groupId, label: name.trim(), days_of_week: dow, start_time: startTime, enabled: true, customer_id: user?.id }
        if (isEdit && program.schedule?.id) {
          const { error: e3 } = await supabase.from('group_schedules').update(schedData).eq('id', program.schedule.id)
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

  async function deleteAutomation() {
    if (!window.confirm(`Delete "${program.name}"?`)) return
    setSaving(true)
    try {
      await supabase.from('group_schedules').delete().eq('group_id', program.id)
      await supabase.from('zone_group_members').delete().eq('group_id', program.id)
      await supabase.from('zone_groups').delete().eq('id', program.id)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message ?? 'Delete failed')
      setSaving(false)
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[9999]" onClick={onClose} />
      <div className="fixed inset-0 z-[9999] flex flex-col justify-end sm:justify-center sm:items-center sm:p-6 pointer-events-none">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md flex flex-col pointer-events-auto" style={{ maxHeight: '75vh' }} onClick={e => e.stopPropagation()}>
        <div className="overflow-y-auto px-5 pt-5 flex-1">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-headline font-bold text-lg text-[#1a1c1c]">{isEdit ? 'Edit Automation' : 'New Automation'}</h2>
            {isEdit && (
              <button onClick={deleteAutomation} disabled={saving}
                className="text-xs text-[#ba1a1a] font-semibold hover:underline disabled:opacity-50">Delete</button>
            )}
          </div>

          <div className="space-y-4 pb-2">
            <div>
              <label className="text-xs font-body text-[#40493d] block mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Avocado 2 Hours"
                className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none" />
            </div>

            <div>
              <label className="text-xs font-body text-[#40493d] block mb-2">Run Mode</label>
              <div className="flex gap-2">
                {['sequential', 'parallel'].map(m => (
                  <button key={m} type="button" onClick={() => setRunMode(m)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize ${runMode === m ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'}`}>{m}</button>
                ))}
              </div>
            </div>

            <div className="border-t border-[#f3f3f3] pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-[#1a1c1c]">Schedule Trigger</span>
                <Toggle on={hasSchedule} onChange={setHasSchedule} />
              </div>

              {hasSchedule && (
                <div className="space-y-3 mt-3">
                  <div>
                    <label className="text-xs text-[#40493d] block mb-2">Days</label>
                    <div className="flex gap-1.5">
                      {DAY_LABELS.map((d, i) => (
                        <button key={i} type="button" onClick={() => toggleDay(i)}
                          className={`w-8 h-8 rounded-full text-xs font-semibold transition-colors ${days[i] ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'}`}>
                          {d[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[#40493d] block mb-1">Start Time</label>
                    <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                      className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body outline-none" />
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-[#ba1a1a]">{error}</p>}
          </div>
        </div>

        {/* Sticky footer — button above iOS browser toolbar */}
        <div className="px-5 pt-3 bg-white border-t border-[#f3f3f3] flex-shrink-0">
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d]">Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create')}
            </button>
          </div>
          <div className="h-24 sm:h-0" />
        </div>
      </div>
      </div>
    </>,
    document.body
  )
}

// ── Automation card (Tuya-style) ──────────────────────────────────────────────
function AutomationCard({ program, expanded, onToggleExpand, onReload, onEdit }) {
  const steps   = program.zones ?? []
  const sched   = program.schedule
  const enabled = sched?.enabled !== false

  const devices = [...new Set(steps.filter(s => s.step_type !== 'delay').map(s => s.device ?? 'irrigation1'))]

  async function handleToggle(val) {
    if (!sched?.id) return
    await supabase.from('group_schedules').update({ enabled: val }).eq('id', sched.id)
    onReload()
  }

  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      {/* Card header */}
      <button className="w-full text-left px-4 pt-4 pb-3" onClick={onToggleExpand}>
        <div className="flex items-center gap-2 mb-2">
          <ClockIcon />
          <span className="text-[#40493d] text-sm">→</span>
          {devices.map(d => (
            <div key={d} className="w-8 h-8 rounded-lg bg-[#f3f3f3] flex items-center justify-center">
              <div className="w-4 h-4 rounded bg-[#c0c0c0]" />
            </div>
          ))}
          <div className="flex-1" />
          <svg viewBox="0 0 20 20" className={`w-4 h-4 text-[#9a9a9a] transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
          </svg>
        </div>
        <p className="font-headline font-bold text-[15px] text-[#1a1c1c] leading-tight">{program.name}</p>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-xs text-[#40493d]">
            {steps.length} task{steps.length !== 1 ? 's' : ''}
            {sched ? ` · ${fmtTime(sched.start_time)} ${fmtDays(sched.days_of_week).slice(0,30)}` : ''}
          </p>
          <Toggle on={enabled} onChange={handleToggle} />
        </div>
      </button>

      {/* Expanded IF/THEN */}
      {expanded && (
        <div className="border-t border-[#f3f3f3]">
          <AutomationDetail program={program} onReload={onReload} onEdit={onEdit} />
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Programs() {
  const { programs, loading, reload } = usePrograms()
  const [expanded, setExpanded] = useState(null)
  const [modal, setModal]       = useState(null)  // null | 'new' | program object

  return (
    <div className="flex-1 p-4 md:p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Automations</h1>
          <p className="text-xs text-[#40493d] mt-0.5">
            {programs.length} automation{programs.length !== 1 ? 's' : ''} · {programs.filter(p => p.schedule?.enabled !== false && p.schedule).length} active
          </p>
        </div>
        <button onClick={() => setModal('new')}
          className="gradient-primary text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
          + New
        </button>
      </div>

      {loading && <p className="text-sm text-[#40493d]">Loading automations…</p>}

      {!loading && programs.length === 0 && (
        <div className="text-center py-16">
          <p className="text-[#40493d] text-sm mb-2">No automations yet.</p>
          <button onClick={() => setModal('new')} className="text-[#0d631b] text-sm font-semibold hover:underline">
            Create your first automation
          </button>
        </div>
      )}

      <div className="space-y-3 max-w-lg">
        {programs.map(p => (
          <AutomationCard
            key={p.id}
            program={p}
            expanded={expanded === p.id}
            onToggleExpand={() => setExpanded(expanded === p.id ? null : p.id)}
            onReload={reload}
            onEdit={() => setModal(p)}
          />
        ))}
      </div>

      {modal !== null && (
        <AutomationModal
          program={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { reload(); setExpanded(null) }}
        />
      )}
    </div>
  )
}

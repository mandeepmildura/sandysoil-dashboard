import { useState, useEffect, useRef, useCallback } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useZoneNames } from '../hooks/useZoneNames'
import { useZoneHistory } from '../hooks/useZoneHistory'
import { b16mOutputOn, b16mOutputOff } from '../lib/commands'
import { supabase } from '../lib/supabase'

const B16M_TOPIC = 'B16M/CCBA97071FD8/STATE'

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDuration(dur) {
  if (dur == null) return '—'
  const n = parseFloat(dur)
  if (n < 1) return `${Math.round(n * 60)}s`
  return `${n.toFixed(1)} min`
}

export default function B16MController() {
  const { data: live, connected } = useLiveTelemetry([B16M_TOPIC])
  const { names, renameZone } = useZoneNames('b16m')
  const [activeTab, setActiveTab] = useState('relays')
  const [busy, setBusy] = useState({})
  const [editingOutput, setEditingOutput] = useState(null)
  const [outputNameInput, setOutputNameInput] = useState('')
  const outputNameRef = useRef(null)

  // History
  const { history, loading: histLoading } = useZoneHistory(null, 'b16m', 50)

  // Groups
  const [groups, setGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupBusy, setGroupBusy] = useState({})
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupOutputs, setNewGroupOutputs] = useState([])
  const [addingGroup, setAddingGroup] = useState(false)
  const [groupError, setGroupError] = useState(null)
  const [editingGroup, setEditingGroup] = useState(null)
  const [editName, setEditName] = useState('')
  const [editOutputs, setEditOutputs] = useState([])
  const [editDuration, setEditDuration] = useState(30)
  const [savingEdit, setSavingEdit] = useState(false)
  const [schedulingGroup, setSchedulingGroup] = useState(null)
  const [schedDays, setSchedDays] = useState([false,false,false,false,false,false,false])
  const [schedStartTime, setSchedStartTime] = useState('06:00')
  const [savingSched, setSavingSched] = useState(false)
  const [schedError, setSchedError] = useState(null)

  const b16m = live[B16M_TOPIC] ?? null
  const outputs = Array.from({ length: 16 }, (_, i) => b16m?.[`output${i + 1}`]?.value ?? false)
  const inputs  = Array.from({ length: 16 }, (_, i) => b16m?.[`input${i + 1}`]?.value ?? false)
  const adc     = [1, 2, 3, 4].map(n => b16m?.[`adc${n}`]?.value ?? 0)

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true)
    const { data, error } = await supabase
      .from('zone_groups')
      .select('id, name, zone_group_members(zone_num, device, sort_order, duration_min), group_schedules(id, days_of_week, start_time, enabled)')
      .order('created_at', { ascending: false })
    if (!error && data) {
      setGroups(
        data
          .map(g => ({
            ...g,
            members: (g.zone_group_members ?? [])
              .filter(m => m.device === 'b16m')
              .sort((a, b) => a.sort_order - b.sort_order),
          }))
          .filter(g => g.members.length > 0)
      )
    }
    setGroupsLoading(false)
  }, [])

  useEffect(() => { loadGroups() }, [loadGroups])

  async function createGroup() {
    if (!newGroupName.trim() || newGroupOutputs.length === 0) return
    setAddingGroup(true)
    setGroupError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data: grp, error: e1 } = await supabase
        .from('zone_groups')
        .insert({ name: newGroupName.trim(), run_mode: 'simultaneous', customer_id: session?.user?.id })
        .select()
        .single()
      if (e1) throw e1
      const members = newGroupOutputs.map((n, i) => ({
        group_id: grp.id, zone_num: n, device: 'b16m', duration_min: 30, sort_order: i,
      }))
      const { error: e2 } = await supabase.from('zone_group_members').insert(members)
      if (e2) throw e2
      setNewGroupName('')
      setNewGroupOutputs([])
      await loadGroups()
    } catch (err) {
      setGroupError(err.message ?? 'Failed to create group')
      console.error('createGroup error:', err)
    }
    setAddingGroup(false)
  }

  async function deleteGroup(groupId) {
    if (!window.confirm('Delete this group?')) return
    await supabase.from('zone_groups').delete().eq('id', groupId)
    loadGroups()
  }

  async function startGroup(group) {
    setGroupBusy(b => ({ ...b, [group.id]: true }))
    for (const m of group.members) await b16mOutputOn(m.zone_num)
    setGroupBusy(b => ({ ...b, [group.id]: false }))
  }

  async function stopGroup(group) {
    setGroupBusy(b => ({ ...b, [group.id]: true }))
    for (const m of group.members) await b16mOutputOff(m.zone_num)
    setGroupBusy(b => ({ ...b, [group.id]: false }))
  }

  function openEdit(group) {
    setEditName(group.name)
    setEditOutputs(group.members.map(m => m.zone_num))
    setEditDuration(group.members[0]?.duration_min ?? 30)
    setEditingGroup(group)
  }

  function toggleEditOutput(n) {
    setEditOutputs(prev => prev.includes(n) ? prev.filter(o => o !== n) : [...prev, n])
  }

  async function saveEdit() {
    if (!editName.trim() || editOutputs.length === 0) return
    setSavingEdit(true)
    try {
      await supabase.from('zone_groups').update({ name: editName.trim() }).eq('id', editingGroup.id)
      await supabase.from('zone_group_members').delete().eq('group_id', editingGroup.id).eq('device', 'b16m')
      await supabase.from('zone_group_members').insert(
        editOutputs.map((o, i) => ({ group_id: editingGroup.id, zone_num: o, device: 'b16m', duration_min: editDuration, sort_order: i }))
      )
      setEditingGroup(null)
      await loadGroups()
    } catch (err) { console.error('saveEdit error:', err) }
    setSavingEdit(false)
  }

  function openSchedule(group) {
    const sched = group.group_schedules?.[0]
    if (sched) {
      const d = [false,false,false,false,false,false,false]
      sched.days_of_week.forEach(dow => { d[dow === 0 ? 6 : dow - 1] = true })
      setSchedDays(d)
      setSchedStartTime(sched.start_time.slice(0, 5))
    } else {
      setSchedDays([false,false,false,false,false,false,false])
      setSchedStartTime('06:00')
    }
    setSchedError(null)
    setSchedulingGroup(group)
  }

  async function saveSchedule() {
    if (!schedDays.some(Boolean)) { setSchedError('Select at least one day'); return }
    setSavingSched(true); setSchedError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const dow = schedDays.map((on, i) => on ? (i === 6 ? 0 : i + 1) : null).filter(d => d !== null)
      const existingId = schedulingGroup.group_schedules?.[0]?.id
      if (existingId) {
        const { error } = await supabase.from('group_schedules').update({ days_of_week: dow, start_time: schedStartTime, enabled: true }).eq('id', existingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('group_schedules').insert({
          group_id: schedulingGroup.id, label: schedulingGroup.name, days_of_week: dow,
          start_time: schedStartTime, enabled: true, customer_id: session?.user?.id,
        })
        if (error) throw error
      }
      setSchedulingGroup(null)
      await loadGroups()
    } catch (err) { setSchedError(err.message ?? 'Save failed') }
    setSavingSched(false)
  }

  function fmtScheduleSummary(sched) {
    if (!sched) return null
    const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const days = (sched.days_of_week ?? []).map(d => DAY_ABBR[d]).join(', ')
    return `${days} at ${sched.start_time?.slice(0, 5) ?? ''}${sched.enabled ? '' : ' (paused)'}`
  }

  function toggleGroupOutput(n) {
    setNewGroupOutputs(prev =>
      prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]
    )
  }

  function startOutputEdit(n, currentName) {
    setOutputNameInput(currentName)
    setEditingOutput(n)
    setTimeout(() => outputNameRef.current?.select(), 0)
  }

  async function commitRename(n) {
    setEditingOutput(null)
    const trimmed = outputNameInput.trim()
    if (trimmed && trimmed !== (names[n] ?? `Output ${n}`)) {
      await renameZone(n, trimmed)
    }
  }

  async function handleToggle(n, currentlyOn) {
    setBusy(b => ({ ...b, [n]: true }))
    try {
      currentlyOn ? await b16mOutputOff(n) : await b16mOutputOn(n)
    } catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [n]: false }))
  }

  const inputCls = 'bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:ring-2 focus:ring-[#0d631b]/10 focus:bg-white transition-all'

  return (
    <div className="flex-1 p-4 md:p-6 bg-[#f9f9f9] overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">B16M Controller</h1>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
        </div>
        <StatusChip status={b16m ? 'online' : 'offline'} label={b16m ? 'Online' : 'Offline'} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5">
        {[
          { id: 'relays',  label: 'Relays' },
          { id: 'history', label: 'History' },
          { id: 'groups',  label: 'Groups' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-body font-medium transition-colors ${
              activeTab === t.id ? 'bg-[#1a1c1c] text-white' : 'text-[#40493d] hover:bg-[#f3f3f3]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── RELAYS TAB ─────────────────────────────────────────────── */}
      {activeTab === 'relays' && (
        <div className="space-y-6">
          {/* Output buttons 4×4 grid */}
          <div>
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-3">Outputs (DO1–DO16)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-4 gap-3">
              {outputs.map((on, i) => {
                const n = i + 1
                const outputName = names[n] ?? `Output ${n}`
                return (
                  <Card key={i} accent={on ? 'green' : undefined}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        {editingOutput === n ? (
                          <input
                            ref={outputNameRef}
                            value={outputNameInput}
                            onChange={e => setOutputNameInput(e.target.value)}
                            onBlur={() => commitRename(n)}
                            onKeyDown={e => { if (e.key === 'Enter') commitRename(n); if (e.key === 'Escape') setEditingOutput(null) }}
                            className="font-headline font-bold text-[#1a1c1c] bg-transparent border-b-2 border-[#0d631b] outline-none w-full text-sm"
                            maxLength={32}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => startOutputEdit(n, outputName)}
                            className="font-headline font-bold text-[#1a1c1c] hover:text-[#0d631b] transition-colors flex items-center gap-1 group text-sm"
                            title="Click to rename"
                          >
                            <span className="truncate">{outputName}</span>
                            <span className="opacity-0 group-hover:opacity-60 transition-opacity text-xs">✏️</span>
                          </button>
                        )}
                        <p className="text-xs text-[#40493d]">DO{n}</p>
                      </div>
                      <span className={`w-3 h-3 rounded-full mt-0.5 shrink-0 ${on ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
                    </div>
                    <StatusChip status={on ? 'running' : 'offline'} label={on ? 'ON' : 'OFF'} />
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() => handleToggle(n, on)}
                        disabled={!!busy[n] || on}
                        className="flex-1 py-1.5 rounded-md bg-[#0d631b] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                      >On</button>
                      <button
                        onClick={() => handleToggle(n, on)}
                        disabled={!!busy[n] || !on}
                        className="flex-1 py-1.5 rounded-md bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold hover:bg-[#d5d5d5] disabled:opacity-40 transition-all"
                      >Off</button>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>

          {/* Inputs + ADC */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">Inputs (DI1–DI16)</h3>
              <div className="grid grid-cols-4 gap-1.5">
                {inputs.map((active, i) => (
                  <div
                    key={i}
                    className={`py-1.5 rounded text-[10px] font-semibold text-center ${
                      active ? 'bg-[#e8f5e9] text-[#0d631b]' : 'bg-[#f3f3f3] text-[#40493d]'
                    }`}
                  >
                    DI{i + 1}
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">Analog (CH1–CH4)</h3>
              <div className="space-y-3">
                {adc.map((val, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#40493d]">CH{i + 1}</span>
                      <span className="font-semibold text-[#1a1c1c]">{val}</span>
                    </div>
                    <div className="h-1.5 bg-[#e2e2e2] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0d631b] rounded-full transition-all"
                        style={{ width: `${Math.min((val / 4095) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── HISTORY TAB ────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f3f3f3]">
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">Output On/Off Log</h2>
            <p className="text-xs text-[#40493d] mt-0.5">Last 50 output events — newest first</p>
          </div>
          {histLoading ? (
            <div className="px-5 py-8 text-sm text-[#40493d]">Loading…</div>
          ) : history.length === 0 ? (
            <div className="px-5 py-10 text-sm text-[#40493d] text-center">No output events recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-body">
                <thead>
                  <tr className="bg-[#f3f3f3]">
                    <th className="text-left text-xs font-semibold text-[#40493d] px-5 py-3">Output</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Turned On</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Turned Off</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Duration</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => {
                    const outputName = names[row.zone_num] ?? `Output ${row.zone_num}`
                    return (
                      <tr key={row.id} className={`hover:bg-[#f9f9f9] transition-colors ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}>
                        <td className="px-5 py-3 font-semibold text-[#1a1c1c]">
                          {outputName}
                          <span className="ml-1.5 text-[10px] text-[#40493d] font-normal">DO{row.zone_num}</span>
                        </td>
                        <td className="px-4 py-3 text-[#40493d] text-xs">{fmtTime(row.started_at)}</td>
                        <td className="px-4 py-3 text-[#40493d] text-xs">{fmtTime(row.ended_at)}</td>
                        <td className="px-4 py-3 text-[#40493d] text-xs">{fmtDuration(row.duration_min)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            row.source === 'schedule' ? 'bg-[#00639a]/10 text-[#00639a]' : 'bg-[#f3f3f3] text-[#40493d]'
                          }`}>
                            {row.source ?? 'manual'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── GROUPS TAB ─────────────────────────────────────────────── */}
      {activeTab === 'groups' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Groups list */}
          <div className="lg:col-span-2 space-y-3">
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-1">Output Groups</h2>
            {groupsLoading ? (
              <p className="text-sm text-[#40493d]">Loading groups…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-[#40493d]">No output groups yet. Create one on the right.</p>
            ) : groups.map(group => {
              const anyOn = group.members.some(m => outputs[m.zone_num - 1])
              const schedSummary = fmtScheduleSummary(group.group_schedules?.[0])
              return (
                <div key={group.id} className="bg-white rounded-xl shadow-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-headline font-semibold text-sm text-[#1a1c1c]">{group.name}</p>
                        {anyOn && <span className="w-2 h-2 rounded-full bg-[#0d631b] animate-pulse shrink-0" />}
                      </div>
                      <p className="text-xs text-[#40493d] mt-0.5">
                        {group.members.map(m => names[m.zone_num] ?? `Output ${m.zone_num}`).join(', ')} · {group.members[0]?.duration_min ?? 30}m each
                      </p>
                      {schedSummary
                        ? <p className="text-xs text-[#00639a] mt-1">{schedSummary}</p>
                        : <p className="text-xs text-[#40493d]/50 mt-1">No schedule</p>
                      }
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      <button onClick={() => openEdit(group)} className="px-2 py-1 rounded text-xs text-[#40493d] hover:bg-[#f3f3f3] transition-colors">Edit</button>
                      <button onClick={() => openSchedule(group)} className="px-2 py-1 rounded text-xs text-[#00639a] font-semibold hover:bg-[#00639a]/10 transition-colors">Schedule</button>
                      <button onClick={() => startGroup(group)} disabled={!!groupBusy[group.id]} className="px-3 py-1.5 rounded-lg bg-[#0d631b] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">{groupBusy[group.id] ? '…' : 'Start'}</button>
                      <button onClick={() => stopGroup(group)} disabled={!!groupBusy[group.id]} className="px-3 py-1.5 rounded-lg bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold hover:bg-[#d5d5d5] disabled:opacity-40 transition-all">Stop</button>
                      <button onClick={() => deleteGroup(group.id)} className="px-2 py-1.5 rounded-lg text-[#ba1a1a] text-xs font-semibold hover:bg-[#ba1a1a]/10 transition-colors">✕</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Create group */}
          <div className="bg-white rounded-xl shadow-card p-5">
            <h3 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-4">New Group</h3>
            <div className="space-y-3">
              <input
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                placeholder="Group name (e.g. Row 1)"
                className={`w-full ${inputCls}`}
              />
              <div>
                <p className="text-xs font-semibold text-[#40493d] mb-2">Select outputs:</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {Array.from({ length: 16 }, (_, i) => i + 1).map(n => (
                    <button
                      key={n}
                      onClick={() => toggleGroupOutput(n)}
                      className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        newGroupOutputs.includes(n)
                          ? 'bg-[#0d631b] text-white'
                          : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              {groupError && <p className="text-xs text-[#ba1a1a]">{groupError}</p>}
              <button
                onClick={createGroup}
                disabled={addingGroup || !newGroupName.trim() || newGroupOutputs.length === 0}
                className="w-full py-2 rounded-xl gradient-primary text-white text-sm font-semibold shadow-fab hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {addingGroup ? 'Creating…' : 'Create Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT GROUP MODAL ── */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditingGroup(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="font-headline font-bold text-base text-[#1a1c1c] mb-4">Edit Group</h2>
            <div className="space-y-3">
              <input value={editName} onChange={e => setEditName(e.target.value)} className={`w-full ${inputCls}`} placeholder="Group name" />
              <div>
                <p className="text-xs font-semibold text-[#40493d] mb-2">Outputs:</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {Array.from({ length: 16 }, (_, i) => i + 1).map(n => {
                    const sel = editOutputs.includes(n)
                    return (
                      <button key={n} onClick={() => toggleEditOutput(n)} className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${sel ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'}`}>
                        {names[n] ?? n}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-[#40493d]/60 mt-1">Tap to select/deselect outputs.</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#40493d] mb-2">Duration (minutes):</p>
                <input type="number" min={1} max={240} value={editDuration}
                  onChange={e => setEditDuration(Number(e.target.value))}
                  className={`w-full ${inputCls}`}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditingGroup(null)} className="flex-1 py-2 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d] hover:bg-[#e8e8e8]">Cancel</button>
                <button onClick={saveEdit} disabled={savingEdit || !editName.trim() || editOutputs.length === 0} className="flex-1 py-2 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90">
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SCHEDULE MODAL ── */}
      {schedulingGroup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSchedulingGroup(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="font-headline font-bold text-base text-[#1a1c1c] mb-1">Schedule</h2>
            <p className="text-xs text-[#40493d] mb-4">{schedulingGroup.name}</p>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#40493d] block mb-2">Days</label>
                <div className="flex gap-1.5">
                  {['M','T','W','T','F','S','S'].map((d, i) => (
                    <button key={i} onClick={() => setSchedDays(prev => prev.map((v, j) => j === i ? !v : v))}
                      className={`w-8 h-8 rounded-full text-xs font-semibold transition-colors ${schedDays[i] ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#40493d] block mb-1">Start Time</label>
                <input type="time" value={schedStartTime} onChange={e => setSchedStartTime(e.target.value)} className={`w-full ${inputCls}`} />
              </div>
              {schedError && <p className="text-xs text-[#ba1a1a]">{schedError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setSchedulingGroup(null)} className="flex-1 py-2 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d] hover:bg-[#e8e8e8]">Cancel</button>
                <button onClick={saveSchedule} disabled={savingSched} className="flex-1 py-2 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90">
                  {savingSched ? 'Saving…' : 'Save Schedule'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

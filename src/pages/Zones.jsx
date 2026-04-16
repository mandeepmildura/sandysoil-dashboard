import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useDeviceData } from '../context/DeviceContext'
import { useZoneNames } from '../hooks/useZoneNames'
import { useZoneHistory } from '../hooks/useZoneHistory'
import { zoneOn, zoneOff, allZonesOff } from '../lib/commands'
import { supabase } from '../lib/supabase'

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

function fmtUptime(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function Zones() {
  const navigate = useNavigate()
  const { data: live, connected } = useLiveTelemetry(['farm/irrigation1/status', 'farm/irrigation1/zone/+/state'])
  const { patchOptimistic } = useDeviceData()
  const { names, renameZone } = useZoneNames('irrigation1')
  const [activeTab, setActiveTab] = useState('zones')
  const [busy, setBusy] = useState({})
  const [editingZone, setEditingZone] = useState(null)
  const [zoneNameInput, setZoneNameInput] = useState('')
  const zoneNameRef = useRef(null)

  // History
  const { history, loading: histLoading } = useZoneHistory(null, 'irrigation1', 50)

  // Groups
  const [groups, setGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupBusy, setGroupBusy] = useState({})
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupZones, setNewGroupZones] = useState([])
  const [addingGroup, setAddingGroup] = useState(false)
  const [groupError, setGroupError] = useState(null)
  const [editingGroup, setEditingGroup] = useState(null)
  const [editName, setEditName] = useState('')
  const [editZones, setEditZones] = useState([])
  const [editDuration, setEditDuration] = useState(30)
  const [savingEdit, setSavingEdit] = useState(false)
  const [schedulingGroup, setSchedulingGroup] = useState(null)
  const [schedDays, setSchedDays] = useState([false,false,false,false,false,false,false])
  const [schedStartTime, setSchedStartTime] = useState('06:00')
  const [savingSched, setSavingSched] = useState(false)
  const [schedError, setSchedError] = useState(null)

  const irr = live['farm/irrigation1/status'] ?? null
  // Per-zone state responses override the full status zones array.
  // No irr?.online guard here — per-zone state is a direct command response
  // and should be trusted immediately. The DeviceContext clears these when
  // the next real MQTT message arrives.
  const zoneOverrides = {}
  Object.entries(live).forEach(([topic, payload]) => {
    const m = topic.match(/^farm\/irrigation1\/zone\/(\d+)\/state$/)
    if (m) zoneOverrides[Number(m[1])] = payload
  })
  const baseZones = irr?.zones ?? Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}`, on: false, state: 'off' }))
  const zones = baseZones.map(z => zoneOverrides[z.id] ? { ...z, ...zoneOverrides[z.id] } : z)

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true)
    const { data, error } = await supabase
      .from('zone_groups')
      .select('id, name, zone_group_members(zone_num, device, duration_min, sort_order), group_schedules(id, days_of_week, start_time, enabled)')
      .order('created_at', { ascending: false })
    if (!error && data) {
      setGroups(
        data
          .map(g => ({
            ...g,
            members: (g.zone_group_members ?? [])
              .filter(m => m.device === 'irrigation1')
              .sort((a, b) => a.sort_order - b.sort_order),
          }))
          .filter(g => g.members.length > 0)
      )
    }
    setGroupsLoading(false)
  }, [])

  useEffect(() => { loadGroups() }, [loadGroups])

  async function createGroup() {
    if (!newGroupName.trim() || newGroupZones.length === 0) return
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
      const members = newGroupZones.map((zoneNum, i) => ({
        group_id: grp.id, zone_num: zoneNum, device: 'irrigation1', duration_min: 30, sort_order: i,
      }))
      const { error: e2 } = await supabase.from('zone_group_members').insert(members)
      if (e2) throw e2
      setNewGroupName('')
      setNewGroupZones([])
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
    for (const m of group.members) await zoneOn(m.zone_num, m.duration_min ?? 30, 'manual')
    setGroupBusy(b => ({ ...b, [group.id]: false }))
  }

  async function stopGroup(group) {
    setGroupBusy(b => ({ ...b, [group.id]: true }))
    for (const m of group.members) await zoneOff(m.zone_num)
    setGroupBusy(b => ({ ...b, [group.id]: false }))
  }

  function toggleGroupZone(n) {
    setNewGroupZones(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])
  }

  function openEdit(group) {
    setEditName(group.name)
    setEditZones(group.members.map(m => m.zone_num))
    setEditDuration(group.members[0]?.duration_min ?? 30)
    setEditingGroup(group)
  }

  function toggleEditZone(n) {
    setEditZones(prev => prev.includes(n) ? prev.filter(z => z !== n) : [...prev, n])
  }

  async function saveEdit() {
    if (!editName.trim() || editZones.length === 0) return
    setSavingEdit(true)
    try {
      await supabase.from('zone_groups').update({ name: editName.trim() }).eq('id', editingGroup.id)
      await supabase.from('zone_group_members').delete().eq('group_id', editingGroup.id).eq('device', 'irrigation1')
      await supabase.from('zone_group_members').insert(
        editZones.map((z, i) => ({ group_id: editingGroup.id, zone_num: z, device: 'irrigation1', duration_min: editDuration, sort_order: i }))
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

  function startZoneEdit(id, currentName) {
    setZoneNameInput(currentName)
    setEditingZone(id)
    setTimeout(() => zoneNameRef.current?.select(), 0)
  }

  async function commitRename(id) {
    setEditingZone(null)
    const trimmed = zoneNameInput.trim()
    if (trimmed && trimmed !== (names[id] ?? `Zone ${id}`)) {
      await renameZone(id, trimmed)
    }
  }

  async function handleOn(id) {
    setBusy(b => ({ ...b, [id]: true }))
    // Optimistically show zone as ON immediately — no waiting for device response
    patchOptimistic(`farm/irrigation1/zone/${id}/state`, { on: true, state: 'manual', zone: id })
    try { await zoneOn(id, 30) } catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [id]: false }))
  }

  async function handleOff(id) {
    setBusy(b => ({ ...b, [id]: true }))
    // Optimistically show zone as OFF immediately
    patchOptimistic(`farm/irrigation1/zone/${id}/state`, { on: false, state: 'off', zone: id })
    try { await zoneOff(id) } catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [id]: false }))
  }

  const inputCls = 'bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:ring-2 focus:ring-[#0d631b]/10 focus:bg-white transition-all'

  return (
    <div className="flex-1 p-4 md:p-6 bg-[#f9f9f9] overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Irrigation</h1>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
        </div>
        <div className="flex items-center gap-3">
          <StatusChip status={irr?.online ? 'online' : 'offline'} label={irr?.online ? 'Online' : 'Offline'} />
          <button
            onClick={() => allZonesOff().catch(console.error)}
            className="border-2 border-[#ba1a1a]/30 text-[#ba1a1a] font-body font-semibold text-xs px-4 py-2 rounded-xl hover:bg-[#ba1a1a]/5 transition-colors"
          >
            All Off
          </button>
        </div>
      </div>

      {/* Device info strip */}
      {irr && (
        <div className="flex flex-wrap gap-4 mb-4 text-xs font-body">
          <span className="text-[#40493d]">Supply: <strong className="text-[#1a1c1c]">{irr.supply_psi} PSI</strong></span>
          <span className="text-[#40493d]">Firmware: <strong className="text-[#1a1c1c]">v{irr.fw}</strong></span>
          <span className="text-[#40493d]">RSSI: <strong className="text-[#1a1c1c]">{irr.rssi} dBm</strong></span>
          <span className="text-[#40493d]">Uptime: <strong className="text-[#1a1c1c]">{fmtUptime(irr.uptime)}</strong></span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-5">
        {[
          { id: 'zones',   label: 'Zones' },
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

      {/* ── ZONES TAB ─────────────────────────────────────────────── */}
      {activeTab === 'zones' && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {zones.map(zone => {
            const zoneName = names[zone.id] ?? zone.name
            return (
              <Card key={zone.id} accent={zone.on ? 'green' : undefined}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    {editingZone === zone.id ? (
                      <input
                        ref={zoneNameRef}
                        value={zoneNameInput}
                        onChange={e => setZoneNameInput(e.target.value)}
                        onBlur={() => commitRename(zone.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(zone.id); if (e.key === 'Escape') setEditingZone(null) }}
                        className="font-headline font-bold text-[#1a1c1c] bg-transparent border-b-2 border-[#0d631b] outline-none w-full text-sm"
                        maxLength={32}
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => startZoneEdit(zone.id, zoneName)}
                        className="font-headline font-bold text-[#1a1c1c] hover:text-[#0d631b] transition-colors flex items-center gap-1 group text-sm"
                        title="Click to rename"
                      >
                        <span className="truncate">{zoneName}</span>
                        <span className="opacity-0 group-hover:opacity-60 transition-opacity text-xs">✏️</span>
                      </button>
                    )}
                    <p className="text-xs text-[#40493d] capitalize">{zone.state}</p>
                  </div>
                  <span className={`w-3 h-3 rounded-full mt-0.5 shrink-0 ${zone.on ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
                </div>
                <StatusChip status={zone.on ? 'running' : 'offline'} label={zone.on ? 'ON' : 'OFF'} />
                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => handleOn(zone.id)}
                    disabled={!!busy[zone.id] || zone.on}
                    className="flex-1 py-1.5 rounded-md bg-[#0d631b] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >On</button>
                  <button
                    onClick={() => handleOff(zone.id)}
                    disabled={!!busy[zone.id] || !zone.on}
                    className="flex-1 py-1.5 rounded-md bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold hover:bg-[#d5d5d5] disabled:opacity-40 transition-all"
                  >Off</button>
                  <button
                    onClick={() => navigate(`/zones/${zone.id}`)}
                    className="px-2 py-1.5 rounded-md bg-[#f3f3f3] text-[#40493d] text-xs font-semibold hover:bg-[#e8e8e8] transition-colors"
                    title="View detail"
                  >···</button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── HISTORY TAB ────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f3f3f3]">
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">Zone Run Log</h2>
            <p className="text-xs text-[#40493d] mt-0.5">Last 50 zone events — newest first</p>
          </div>
          {histLoading ? (
            <div className="px-5 py-8 text-sm text-[#40493d]">Loading…</div>
          ) : history.length === 0 ? (
            <div className="px-5 py-10 text-sm text-[#40493d] text-center">No zone events recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-body">
                <thead>
                  <tr className="bg-[#f3f3f3]">
                    <th className="text-left text-xs font-semibold text-[#40493d] px-5 py-3">Zone</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Started</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Ended</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Duration</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => {
                    const zoneName = names[row.zone_num] ?? `Zone ${row.zone_num}`
                    return (
                      <tr key={row.id} className={`hover:bg-[#f9f9f9] transition-colors ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}>
                        <td className="px-5 py-3 font-semibold text-[#1a1c1c]">
                          {zoneName}
                          <span className="ml-1.5 text-[10px] text-[#40493d] font-normal">Z{row.zone_num}</span>
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
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-1">Zone Groups</h2>
            {groupsLoading ? (
              <p className="text-sm text-[#40493d]">Loading groups…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-[#40493d]">No zone groups yet. Create one on the right.</p>
            ) : groups.map(group => {
              const anyOn = group.members.some(m => zones.find(z => z.id === m.zone_num)?.on)
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
                        {group.members.map(m => names[m.zone_num] ?? `Zone ${m.zone_num}`).join(', ')} · {group.members[0]?.duration_min ?? 30}m each
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
                placeholder="Group name (e.g. Front Block)"
                className={`w-full ${inputCls}`}
              />
              <div>
                <p className="text-xs font-semibold text-[#40493d] mb-2">Select zones:</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {zones.map(z => (
                    <button
                      key={z.id}
                      onClick={() => toggleGroupZone(z.id)}
                      className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        newGroupZones.includes(z.id)
                          ? 'bg-[#0d631b] text-white'
                          : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'
                      }`}
                    >
                      {names[z.id] ?? `Z${z.id}`}
                    </button>
                  ))}
                </div>
              </div>
              {groupError && <p className="text-xs text-[#ba1a1a]">{groupError}</p>}
              <button
                onClick={createGroup}
                disabled={addingGroup || !newGroupName.trim() || newGroupZones.length === 0}
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
                <p className="text-xs font-semibold text-[#40493d] mb-2">Zones:</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {zones.map(z => {
                    const sel = editZones.includes(z.id)
                    return (
                      <button key={z.id} onClick={() => toggleEditZone(z.id)} className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${sel ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'}`}>
                        {names[z.id] ?? `Z${z.id}`}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-[#40493d]/60 mt-1">Tap to select/deselect zones.</p>
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
                <button onClick={saveEdit} disabled={savingEdit || !editName.trim() || editZones.length === 0} className="flex-1 py-2 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90">
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

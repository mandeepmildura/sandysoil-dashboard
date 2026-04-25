import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import PageHeader from '../components/PageHeader'
import { btnPrimary, btnPrimaryStyle, btnSecondary, btnDanger } from '../components/ui'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useDeviceData } from '../context/DeviceContext'
import { useZoneNames } from '../hooks/useZoneNames'
import { useZoneHistory } from '../hooks/useZoneHistory'
import { useDeviceOffline } from '../hooks/useDeviceOffline'
import { useAuth } from '../hooks/useAuth'
import { useMyDevice } from '../hooks/useMyDevice'
import { zoneOn, zoneOff, allZonesOff } from '../lib/commands'
import { supabase } from '../lib/supabase'
import { raiseAlert, resolveAlerts } from '../lib/alerts'
import { fmtTime, fmtDuration, fmtUptime } from '../lib/format'
import { isAdmin } from '../lib/role'

export default function Zones() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const admin = isAdmin(session)
  const { device: myDevice, loading: deviceLoading } = useMyDevice()
  const { data: live, connected } = useLiveTelemetry(['farm/irrigation1/status', 'farm/irrigation1/zone/+/state'])
  const { patchOptimistic } = useDeviceData()
  const { names, renameZone } = useZoneNames('irrigation1')
  const [activeTab, setActiveTab] = useState('zones')
  const [busy, setBusy] = useState({})
  const [editingZone, setEditingZone] = useState(null)
  const [zoneNameInput, setZoneNameInput] = useState('')
  const zoneNameRef = useRef(null)

  // History — date-picker driven (default = today)
  const localDateStr = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const [histDate, setHistDate] = useState(() => localDateStr())
  const histFrom = new Date(`${histDate}T00:00:00`).toISOString()
  const histTo   = new Date(`${histDate}T23:59:59.999`).toISOString()
  const { history, loading: histLoading } = useZoneHistory(null, 'irrigation1', 200, histFrom, histTo)

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
  const [schedMode, setSchedMode] = useState('repeat')
  const [schedDays, setSchedDays] = useState([false,false,false,false,false,false,false])
  const [schedStartTime, setSchedStartTime] = useState('06:00')
  const [schedOnceDate, setSchedOnceDate] = useState('')
  const [savingSched, setSavingSched] = useState(false)
  const [schedError, setSchedError] = useState(null)

  // Manual zone control — per-zone minutes input + auto-off countdown
  const [zoneMinutes, setZoneMinutes] = useState({}) // { [zoneNum]: number }
  const autoOffRef = useRef({})                       // { [zoneNum]: endTimeMs }
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const [num, end] of Object.entries(autoOffRef.current)) {
        if (now >= end) { delete autoOffRef.current[num]; changed = true }
      }
      setTick(t => t + 1)
      if (changed) {} // no-op; firmware handles the actual off via duration
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const irr = live['farm/irrigation1/status'] ?? null

  // Track last-seen timestamp for the irrigation controller (for live offline badge)
  const lastSeenRef = useRef(null)
  useEffect(() => { if (irr) lastSeenRef.current = Date.now() }, [irr])
  const [, setLastSeenTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setLastSeenTick(t => t + 1), 10_000)
    return () => clearInterval(id)
  }, [])

  // 15-min offline alert
  useDeviceOffline('Irrigation Controller', 'irrigation1', irr, 15 * 60_000)

  // Stuck-valve / manual-left-on watchdog — track when each zone first turned ON
  // and raise an alert if it stays on past expected duration + 10-min grace.
  const onSinceRef = useRef({})  // { [zoneNum]: { since: ms, expectedMin: number, source: 'manual'|'schedule' } }
  useEffect(() => {
    const live = irr?.zones ?? []
    const now = Date.now()
    for (const z of live) {
      if (z.on && !onSinceRef.current[z.id]) {
        onSinceRef.current[z.id] = { since: now, expectedMin: zoneMinutes[z.id] || 30, source: z.state || 'manual' }
      } else if (!z.on && onSinceRef.current[z.id]) {
        delete onSinceRef.current[z.id]
        resolveAlerts('Irrigation Controller', `Zone ${z.id} stuck on`)
        resolveAlerts('Irrigation Controller', `Zone ${z.id} manually left on`)
      }
    }
    for (const [numStr, info] of Object.entries(onSinceRef.current)) {
      const elapsedMin = (now - info.since) / 60_000
      const overrun = elapsedMin - info.expectedMin
      if (overrun > 10) {
        const isManual = (info.source ?? 'manual') === 'manual'
        raiseAlert({
          severity: 'warning',
          title: isManual ? `Zone ${numStr} manually left on` : `Zone ${numStr} stuck on`,
          description: `Zone ${numStr} has been ON for ${Math.round(elapsedMin)} minutes (expected ${info.expectedMin}).`,
          device: 'Irrigation Controller',
          device_id: 'irrigation1',
        }, 60)
      }
    }
  }, [irr, zoneMinutes])
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
      if (sched.run_once_date) {
        setSchedMode('once'); setSchedOnceDate(sched.run_once_date)
        setSchedDays([false,false,false,false,false,false,false])
      } else {
        setSchedMode('repeat')
        const d = [false,false,false,false,false,false,false]
        sched.days_of_week.forEach(dow => { d[dow === 0 ? 6 : dow - 1] = true })
        setSchedDays(d)
        setSchedOnceDate('')
      }
      setSchedStartTime(sched.start_time.slice(0, 5))
    } else {
      setSchedMode('repeat')
      setSchedDays([false,false,false,false,false,false,false])
      setSchedStartTime('06:00')
      setSchedOnceDate('')
    }
    setSchedError(null)
    setSchedulingGroup(group)
  }

  async function saveSchedule() {
    if (schedMode === 'repeat' && !schedDays.some(Boolean)) { setSchedError('Select at least one day'); return }
    if (schedMode === 'once' && !schedOnceDate) { setSchedError('Pick a date'); return }
    setSavingSched(true); setSchedError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const dow = schedMode === 'repeat'
        ? schedDays.map((on, i) => on ? (i === 6 ? 0 : i + 1) : null).filter(d => d !== null)
        : []
      const fields = {
        days_of_week: dow,
        start_time:   schedStartTime,
        enabled:      true,
        run_once_date: schedMode === 'once' ? schedOnceDate : null,
      }
      const existingId = schedulingGroup.group_schedules?.[0]?.id
      if (existingId) {
        const { error } = await supabase.from('group_schedules').update(fields).eq('id', existingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('group_schedules').insert({
          group_id: schedulingGroup.id, label: schedulingGroup.name,
          customer_id: session?.user?.id, ...fields,
        })
        if (error) throw error
      }
      setSchedulingGroup(null)
      await loadGroups()
    } catch (err) { setSchedError(err.message ?? 'Save failed') }
    setSavingSched(false)
  }

  async function toggleScheduleEnabled(sched) {
    if (!sched?.id) return
    await supabase.from('group_schedules').update({ enabled: !sched.enabled }).eq('id', sched.id)
    await loadGroups()
  }

  function fmtScheduleSummary(sched) {
    if (!sched) return null
    const time = sched.start_time?.slice(0, 5) ?? ''
    const paused = sched.enabled ? '' : ' (paused)'
    if (sched.run_once_date) return `Once on ${sched.run_once_date} at ${time}${paused}`
    const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    return `${(sched.days_of_week ?? []).map(d => DAY_ABBR[d]).join(', ')} at ${time}${paused}`
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
    const minutes = Number.isFinite(zoneMinutes[id]) && zoneMinutes[id] > 0 ? zoneMinutes[id] : 30
    setBusy(b => ({ ...b, [id]: true }))
    patchOptimistic(`farm/irrigation1/zone/${id}/state`, { on: true, state: 'manual', zone: id })
    autoOffRef.current[id] = Date.now() + minutes * 60_000
    try { await zoneOn(id, minutes) } catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [id]: false }))
  }

  async function handleOff(id) {
    setBusy(b => ({ ...b, [id]: true }))
    patchOptimistic(`farm/irrigation1/zone/${id}/state`, { on: false, state: 'off', zone: id })
    delete autoOffRef.current[id]
    try { await zoneOff(id) } catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [id]: false }))
  }

  const inputCls = 'bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:ring-2 focus:ring-[#0d631b]/10 focus:bg-white transition-all'

  // Customer (non-admin) with no controller assigned to their account
  if (!admin && !deviceLoading && !myDevice) {
    return (
      <div className="flex-1 p-8 md:p-12 bg-[#f8faf9] overflow-auto min-h-screen flex items-center justify-center">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-4">🌱</div>
          <h1 className="text-3xl font-extrabold text-[#17362e] tracking-tight mb-2">No controller assigned</h1>
          <p className="text-sm text-[#717975] mb-6">
            Your account doesn't have an irrigation controller linked yet. Please contact Sandy Soil Automations to assign your SSA-V8 to your farm.
          </p>
          <a href="mailto:mandeep@freshoz.com" className="inline-block px-6 py-3 rounded-full text-white text-sm font-bold shadow-lg shadow-[#17362e]/20"
             style={{ background: 'linear-gradient(135deg, #17362e 0%, #2e4d44 100%)' }}>
            Contact Support
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-8 md:p-12 bg-[#f8faf9] overflow-auto min-h-screen">
      {!connected && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-orange-50 border border-orange-200 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shrink-0" />
          <p className="text-sm text-orange-800 font-semibold">Can't reach controller right now. Live controls are disabled. Check back in a few minutes.</p>
        </div>
      )}

      <PageHeader
        eyebrow="Irrigation Controller • SSA-V8"
        title="Zones & Programs"
        subtitle={(() => {
          if (irr) return `Supply ${irr.supply_psi} PSI • Firmware v${irr.fw} • Uptime ${fmtUptime(irr.uptime)}`
          if (lastSeenRef.current) {
            const mins = Math.floor((Date.now() - lastSeenRef.current) / 60_000)
            return `Controller offline — last seen ${mins}m ago`
          }
          return undefined
        })()}
        connected={connected && !!irr}
        actions={
          <button onClick={() => allZonesOff().catch(console.error)} disabled={!connected} className={btnDanger} style={!connected ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            All Off
          </button>
        }
      />

      {/* Tabs */}
      <div className="inline-flex bg-[#f2f4f3] p-1 rounded-full mb-6">
        {[
          { id: 'zones',   label: 'Zones' },
          { id: 'history', label: 'History' },
          { id: 'groups',  label: 'Programs' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeTab === t.id ? 'bg-white shadow-sm text-[#17362e]' : 'text-[#717975] hover:text-[#17362e]'
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

                {/* Minutes input — shown when zone is OFF */}
                {!zone.on && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <input
                      type="number"
                      min={1}
                      max={240}
                      placeholder="30"
                      value={zoneMinutes[zone.id] ?? ''}
                      onChange={e => setZoneMinutes(prev => ({ ...prev, [zone.id]: e.target.value === '' ? '' : Number(e.target.value) }))}
                      className="w-14 bg-[#f3f3f3] rounded-md px-2 py-1 text-xs text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:bg-white transition-all"
                    />
                    <span className="text-[10px] text-[#40493d]">min</span>
                  </div>
                )}

                {/* Countdown — shown when zone is ON */}
                {zone.on && autoOffRef.current[zone.id] && (() => {
                  const rem = Math.max(0, autoOffRef.current[zone.id] - Date.now())
                  const min = Math.floor(rem / 60000)
                  const sec = Math.floor((rem % 60000) / 1000)
                  return (
                    <p className="text-[10px] text-center text-[#0d631b] font-semibold mt-2">
                      auto-off {min}:{String(sec).padStart(2, '0')}
                    </p>
                  )
                })()}

                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => handleOn(zone.id)}
                    disabled={!!busy[zone.id] || zone.on || !connected}
                    className="flex-1 py-1.5 rounded-md bg-[#0d631b] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >On</button>
                  <button
                    onClick={() => handleOff(zone.id)}
                    disabled={!!busy[zone.id] || !zone.on || !connected}
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
          <div className="px-5 py-4 border-b border-[#f3f3f3] flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">Zone Run Log</h2>
              <p className="text-xs text-[#40493d] mt-0.5">All zone events for the selected day</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-xs font-semibold text-[#40493d]">Date</label>
              <input type="date" value={histDate} onChange={e => setHistDate(e.target.value)}
                className="bg-[#f3f3f3] rounded-lg px-3 py-1.5 text-sm outline-none border border-[#e2e2e2] focus:border-[#0d631b]/40" />
            </div>
          </div>
          {histLoading ? (
            <div className="px-5 py-8 text-sm text-[#40493d]">Loading…</div>
          ) : history.length === 0 ? (
            <div className="px-5 py-10 text-sm text-[#40493d] text-center">No zone events for this day.</div>
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
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-1">Programs</h2>
            {groupsLoading ? (
              <p className="text-sm text-[#40493d]">Loading programs…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-[#40493d]">No programs yet. Create one on the right.</p>
            ) : groups.map(group => {
              const anyOn = group.members.some(m => zones.find(z => z.id === m.zone_num)?.on)
              const sched = group.group_schedules?.[0]
              const schedSummary = fmtScheduleSummary(sched)
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
                      {schedSummary ? (
                        <div className="flex items-center gap-2 mt-1">
                          <p className={`text-xs ${sched.enabled ? 'text-[#00639a]' : 'text-[#40493d]/50 line-through'}`}>{schedSummary}</p>
                          <button onClick={() => toggleScheduleEnabled(sched)}
                            className={`relative inline-flex w-7 h-4 rounded-full transition-colors shrink-0 ${sched.enabled ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}
                            title={sched.enabled ? 'Pause schedule' : 'Resume schedule'}>
                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${sched.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-[#40493d]/50 mt-1">No schedule</p>
                      )}
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
            <h3 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-4">New Program</h3>
            <div className="space-y-3">
              <input
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                placeholder="Program name (e.g. Avocado Block)"
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
                {addingGroup ? 'Creating…' : 'Create Program'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT GROUP MODAL ── */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditingGroup(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="font-headline font-bold text-base text-[#1a1c1c] mb-4">Edit Program</h2>
            <div className="space-y-3">
              <input value={editName} onChange={e => setEditName(e.target.value)} className={`w-full ${inputCls}`} placeholder="Program name" />
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
              {/* Repeat / Once toggle */}
              <div className="flex gap-1 bg-[#f3f3f3] rounded-lg p-1">
                {[['repeat','Repeat'],['once','Once']].map(([m, label]) => (
                  <button key={m} onClick={() => setSchedMode(m)}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${schedMode === m ? 'bg-white text-[#1a1c1c] shadow-sm' : 'text-[#40493d]'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {schedMode === 'repeat' ? (
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
              ) : (
                <div>
                  <label className="text-xs font-semibold text-[#40493d] block mb-1">Date</label>
                  <input type="date" value={schedOnceDate} onChange={e => setSchedOnceDate(e.target.value)} className={`w-full ${inputCls}`} />
                </div>
              )}
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

import { useState, useEffect, useRef, useCallback } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useA6v3PressureHistory } from '../hooks/useA6v3PressureHistory'
import { useZoneNames } from '../hooks/useZoneNames'
import { useZoneHistory } from '../hooks/useZoneHistory'
import { a6v3ZoneOn, a6v3ZoneOff, logA6v3Pressure, requestA6v3State } from '../lib/commands'
import { supabase } from '../lib/supabase'
import { raiseAlert, resolveAlerts } from '../lib/alerts'
import { useDeviceOffline } from '../hooks/useDeviceOffline'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts'

const A6V3_TOPIC = 'A6v3/8CBFEA03002C/STATE'
const MAX_PSI  = 116
const ADC_FULL = 4095

function adcToPsi(adc) {
  return (adc / ADC_FULL) * MAX_PSI
}

function gaugeColor(psi) {
  if (psi >= 100) return '#ba1a1a'
  if (psi >= 80)  return '#e65c00'
  return '#0d631b'
}

function PressureGauge({ psi }) {
  const R = 70, cx = 90, cy = 90
  const startAngle = 210, totalArc = 240
  const clampedPsi = Math.min(Math.max(psi, 0), MAX_PSI)
  const fillArc = (clampedPsi / MAX_PSI) * totalArc
  const color = gaugeColor(clampedPsi)

  function polar(angle, r = R) {
    const rad = (angle * Math.PI) / 180
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)]
  }
  function arcPath(startDeg, sweepDeg, r = R) {
    const [x1, y1] = polar(startDeg, r)
    const endDeg = startDeg - sweepDeg
    const [x2, y2] = polar(endDeg, r)
    const large = sweepDeg > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
  }

  return (
    <svg viewBox="0 0 180 110" className="w-full max-w-[220px] mx-auto">
      <path d={arcPath(startAngle, totalArc)} fill="none" stroke="#e2e2e2" strokeWidth="10" strokeLinecap="round" />
      {fillArc > 0 && (
        <path d={arcPath(startAngle, fillArc)} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      )}
      <text x={polar(startAngle, R + 14)[0]} y={polar(startAngle, R + 14)[1]} textAnchor="middle" fontSize="8" fill="#40493d">0</text>
      <text x={polar(-30, R + 14)[0]} y={polar(-30, R + 14)[1]} textAnchor="middle" fontSize="8" fill="#40493d">{MAX_PSI}</text>
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill={color} fontFamily="sans-serif">
        {clampedPsi.toFixed(1)}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="#40493d" fontFamily="sans-serif">PSI</text>
    </svg>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#e2e2e2] rounded-lg px-3 py-2 shadow text-xs">
      <p className="text-[#40493d] mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">{p.value?.toFixed(1)} PSI</p>
      ))}
    </div>
  )
}

/** Returns today's date as YYYY-MM-DD in local (Melbourne) time, not UTC. */
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function fmtDuration(dur) {
  if (dur == null) return '—'
  const n = parseFloat(dur)
  if (n < 1) return `${Math.round(n * 60)}s`
  return `${n.toFixed(1)} min`
}

export default function A6v3Controller() {
  const { data: live, connected } = useLiveTelemetry([A6V3_TOPIC])
  const { names, renameZone } = useZoneNames('a6v3')
  const [activeTab, setActiveTab] = useState('relays')
  const [a6v3Busy, setA6v3Busy] = useState({})
  const [editingRelay, setEditingRelay] = useState(null)
  const [relayNameInput, setRelayNameInput] = useState('')
  const relayNameRef = useRef(null)
  const [showGraph, setShowGraph] = useState(false)
  const [logStatus, setLogStatus] = useState(null) // null | 'ok' | string (error message)

  // Pressure history range
  const [histPreset, setHistPreset] = useState('6h') // '1h'|'6h'|'24h'|'7d'|'custom'
  const [customDate, setCustomDate] = useState(() => localDateStr())
  const [customFrom, setCustomFrom] = useState('05:00')
  const [customTo, setCustomTo]   = useState('07:00')

  function computeHistRange(preset, date, fromTime, toTime) {
    if (preset === 'custom') {
      return {
        from: new Date(`${date}T${fromTime}:00`).toISOString(),
        to:   new Date(`${date}T${toTime}:00`).toISOString(),
      }
    }
    const hours = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 }[preset] ?? 6
    const now = Date.now()
    return {
      from: new Date(now - hours * 60 * 60 * 1000).toISOString(),
      to:   new Date(now).toISOString(),
    }
  }

  const histRange = computeHistRange(histPreset, customDate, customFrom, customTo)

  // History tab date filter
  const [histDate, setHistDate] = useState(() => localDateStr())
  const outputsRef = useRef([])
  const psiRef = useRef(0)
  const a6v3LiveRef = useRef(null)
  const smoothedAdcRef = useRef(null)

  // Relay history (filtered by selected date)
  // Use local-time midnight so the date picker matches what the user sees on their clock
  const histDateFrom = new Date(`${histDate}T00:00:00`).toISOString()
  const histDateTo   = new Date(`${histDate}T23:59:59.999`).toISOString()
  const { history: relayHistory, loading: histLoading } = useZoneHistory(null, 'a6v3', 200, histDateFrom, histDateTo)

  // Pressure history
  const { data: pressureHistory, loading: pressHistLoading, reload: reloadPressure } = useA6v3PressureHistory(histRange.from, histRange.to)

  // Relay groups
  const [groups, setGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupBusy, setGroupBusy] = useState({})
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupRelays, setNewGroupRelays] = useState([])
  const [addingGroup, setAddingGroup] = useState(false)
  const [groupError, setGroupError] = useState(null)
  const [editingGroup, setEditingGroup] = useState(null)
  const [editName, setEditName] = useState('')
  const [editRelays, setEditRelays] = useState([])
  const [editDuration, setEditDuration] = useState(30)
  const [savingEdit, setSavingEdit] = useState(false)
  const [schedulingGroup, setSchedulingGroup] = useState(null)
  const [schedMode, setSchedMode] = useState('repeat') // 'repeat' | 'once'
  const [schedDays, setSchedDays] = useState([false,false,false,false,false,false,false])
  const [schedStartTime, setSchedStartTime] = useState('06:00')
  const [schedOnceDate, setSchedOnceDate] = useState('')
  const [savingSched, setSavingSched] = useState(false)
  const [schedError, setSchedError] = useState(null)

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true)
    const { data, error } = await supabase
      .from('zone_groups')
      .select('id, name, zone_group_members(zone_num, device, sort_order, duration_min), group_schedules(id, days_of_week, start_time, enabled, run_once_date)')
      .order('created_at', { ascending: false })
    if (!error && data) {
      setGroups(
        data
          .map(g => ({
            ...g,
            members: (g.zone_group_members ?? [])
              .filter(m => m.device === 'a6v3')
              .sort((a, b) => a.sort_order - b.sort_order),
          }))
          .filter(g => g.members.length > 0)
      )
    }
    setGroupsLoading(false)
  }, [])

  useEffect(() => { loadGroups() }, [loadGroups])

  async function createGroup() {
    if (!newGroupName.trim() || newGroupRelays.length === 0) return
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
      const members = newGroupRelays.map((relayNum, i) => ({
        group_id: grp.id, zone_num: relayNum, device: 'a6v3', duration_min: 30, sort_order: i,
      }))
      const { error: e2 } = await supabase.from('zone_group_members').insert(members)
      if (e2) throw e2
      setNewGroupName('')
      setNewGroupRelays([])
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
    for (const m of group.members) {
      await a6v3ZoneOn(m.zone_num, m.duration_min, 'group')
    }
    setGroupBusy(b => ({ ...b, [group.id]: false }))
  }

  async function stopGroup(group) {
    setGroupBusy(b => ({ ...b, [group.id]: true }))
    for (const m of group.members) {
      await a6v3ZoneOff(m.zone_num)
    }
    setGroupBusy(b => ({ ...b, [group.id]: false }))
  }

  function toggleGroupRelay(n) {
    setNewGroupRelays(prev =>
      prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]
    )
  }

  function openEdit(group) {
    setEditName(group.name)
    setEditRelays(group.members.map(m => m.zone_num))
    setEditDuration(group.members[0]?.duration_min ?? 30)
    setEditingGroup(group)
  }

  function toggleEditRelay(n) {
    setEditRelays(prev => prev.includes(n) ? prev.filter(r => r !== n) : [...prev, n])
  }

  async function saveEdit() {
    if (!editName.trim() || editRelays.length === 0) return
    setSavingEdit(true)
    try {
      await supabase.from('zone_groups').update({ name: editName.trim() }).eq('id', editingGroup.id)
      await supabase.from('zone_group_members').delete().eq('group_id', editingGroup.id).eq('device', 'a6v3')
      await supabase.from('zone_group_members').insert(
        editRelays.map((r, i) => ({
          group_id: editingGroup.id, zone_num: r, device: 'a6v3',
          duration_min: editDuration, sort_order: i,
        }))
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
        setSchedMode('once')
        setSchedOnceDate(sched.run_once_date)
      } else {
        setSchedMode('repeat')
        const d = [false,false,false,false,false,false,false]
        sched.days_of_week.forEach(dow => { d[dow === 0 ? 6 : dow - 1] = true })
        setSchedDays(d)
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
        start_time: schedStartTime,
        enabled: true,
        run_once_date: schedMode === 'once' ? schedOnceDate : null,
      }
      const existingId = schedulingGroup.group_schedules?.[0]?.id
      if (existingId) {
        const { error } = await supabase.from('group_schedules').update(fields).eq('id', existingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('group_schedules').insert({
          group_id: schedulingGroup.id, label: schedulingGroup.name,
          customer_id: session?.user?.id,
          ...fields,
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
    const days = (sched.days_of_week ?? []).map(d => DAY_ABBR[d]).join(', ')
    return `${days} at ${time}${paused}`
  }

  function startRelayEdit(n, currentName) {
    setRelayNameInput(currentName)
    setEditingRelay(n)
    setTimeout(() => relayNameRef.current?.select(), 0)
  }

  async function commitRelayRename(n) {
    setEditingRelay(null)
    if (relayNameInput.trim() && relayNameInput.trim() !== (names[n] ?? `Relay ${n}`)) {
      await renameZone(n, relayNameInput.trim())
    }
  }

  const a6v3 = live[A6V3_TOPIC] ?? null
  const a6v3Outputs = Array.from({ length: 6 }, (_, i) => a6v3?.[`output${i + 1}`]?.value ?? false)
  const a6v3Inputs  = Array.from({ length: 6 }, (_, i) => a6v3?.[`input${i + 1}`]?.value ?? false)
  const adcRaw = a6v3?.adc1?.value ?? 0
  // Exponential moving average (α=0.2) to smooth ADC jitter
  if (adcRaw > 0 || smoothedAdcRef.current === null) {
    smoothedAdcRef.current = smoothedAdcRef.current === null
      ? adcRaw
      : smoothedAdcRef.current * 0.8 + adcRaw * 0.2
  }
  const smoothedAdc = Math.round(smoothedAdcRef.current ?? adcRaw)
  const psi = adcToPsi(smoothedAdc)

  // Keep refs current so interval callbacks never close over stale values
  psiRef.current = psi
  a6v3LiveRef.current = a6v3

  // Log pressure immediately when device comes online, then every 5 min.
  useEffect(() => {
    if (!a6v3) return
    async function doLog() {
      const err = await logA6v3Pressure(psiRef.current)
      setLogStatus(err ? err.message : 'ok')
    }
    doLog()
    const id = setInterval(() => {
      if (a6v3LiveRef.current) doLog()
    }, 300_000)
    return () => clearInterval(id)
  }, [!!a6v3]) // eslint-disable-line react-hooks/exhaustive-deps

  outputsRef.current = a6v3Outputs

  // Poll every 5 s when any relay is on, every 60 s otherwise.
  const anyRelayOn = a6v3Outputs.some(Boolean)
  // Request fresh state immediately on mount so pressure/ADC is always current
  useEffect(() => { requestA6v3State(outputsRef.current) }, [])
  useEffect(() => {
    requestA6v3State()
    const interval = anyRelayOn ? 5_000 : 60_000
    const id = setInterval(() => requestA6v3State(), interval)
    return () => clearInterval(id)
  }, [anyRelayOn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Device offline alert — fires if no STATE message for 5 min
  useDeviceOffline('A6v3', '8CBFEA03002C', a6v3)

  // Pressure alerts — check whenever PSI changes
  useEffect(() => {
    if (!a6v3) return
    if (psi >= 100) {
      raiseAlert({
        severity:    'fault',
        title:       'A6v3 high pressure',
        description: `CH1 pressure is ${psi.toFixed(1)} PSI — exceeds 100 PSI threshold.`,
        device:      'A6v3',
        device_id:   '8CBFEA03002C',
      })
    } else {
      resolveAlerts('A6v3', 'A6v3 high pressure')
    }
    if (anyRelayOn && psi < 5) {
      raiseAlert({
        severity:    'warning',
        title:       'A6v3 low pressure during run',
        description: `CH1 pressure is only ${psi.toFixed(1)} PSI while a relay is active — possible flow issue.`,
        device:      'A6v3',
        device_id:   '8CBFEA03002C',
      }, 15) // dedup: 15 min
    }
  }, [psi, anyRelayOn, !!a6v3]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showGraph) return
    reloadPressure()
    const id = setInterval(reloadPressure, 300_000)
    return () => clearInterval(id)
  }, [showGraph, histRange.from, histRange.to])

  async function handleToggle(n, currentlyOn) {
    setA6v3Busy(b => ({ ...b, [n]: true }))
    try {
      if (currentlyOn) {
        await a6v3ZoneOff(n)   // publishes MQTT OFF + closes zone_history record
      } else {
        await a6v3ZoneOn(n, null, 'manual')  // publishes MQTT ON + logs zone_history with PSI snapshot
      }
    } catch (e) { console.error(e) }
    setA6v3Busy(b => ({ ...b, [n]: false }))
  }

  const color = gaugeColor(psi)
  const inputCls = 'bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:ring-2 focus:ring-[#0d631b]/10 focus:bg-white transition-all'

  return (
    <div className="flex-1 p-4 md:p-6 bg-[#f9f9f9] overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">A6v3 Controller</h1>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
        </div>
        <StatusChip status={a6v3 ? 'online' : 'offline'} label={a6v3 ? 'Online' : 'Offline'} />
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

      {/* ── RELAYS TAB ────────────────────────────────────────────── */}
      {activeTab === 'relays' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left — pressure gauge + inputs */}
          <div className="space-y-4">
            <Card accent={psi >= 100 ? 'red' : psi >= 80 ? 'amber' : 'green'} className="cursor-pointer select-none">
              <div onClick={() => setShowGraph(s => !s)}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-headline font-semibold text-sm text-[#1a1c1c]">CH1 Pressure</h2>
                  <span className="text-xs text-[#40493d]">{showGraph ? '▲ Hide graph' : '▼ Show graph'}</span>
                </div>
                <PressureGauge psi={psi} />
                <div className="mt-2 text-center">
                  <span className="text-xs font-body text-[#40493d]">ADC {smoothedAdc} · 0–{MAX_PSI} PSI range</span>
                </div>
              </div>

              {showGraph && (
                <div className="mt-4 border-t border-[#e2e2e2] pt-4">
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[#40493d]">History</span>
                      <div className="flex gap-1">
                        {[['1h','1h'],['6h','6h'],['24h','24h'],['7d','7d'],['custom','Custom']].map(([val, label]) => (
                          <button
                            key={val}
                            onClick={e => { e.stopPropagation(); setHistPreset(val) }}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                              histPreset === val ? 'bg-[#0d631b] text-white' : 'bg-[#e2e2e2] text-[#40493d] hover:bg-[#d5d5d5]'
                            }`}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                    {histPreset === 'custom' && (
                      <div className="flex flex-wrap gap-2 items-end mt-2" onClick={e => e.stopPropagation()}>
                        <div className="flex-1 min-w-[110px]">
                          <label className="text-[10px] text-[#40493d] block mb-0.5">Date</label>
                          <input
                            type="date"
                            value={customDate}
                            onChange={e => setCustomDate(e.target.value)}
                            className="w-full bg-[#f3f3f3] rounded px-2 py-1 text-[11px] outline-none border border-[#e2e2e2] focus:border-[#0d631b]/40"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#40493d] block mb-0.5">From</label>
                          <input
                            type="time"
                            value={customFrom}
                            onChange={e => setCustomFrom(e.target.value)}
                            className="bg-[#f3f3f3] rounded px-2 py-1 text-[11px] w-24 outline-none border border-[#e2e2e2] focus:border-[#0d631b]/40"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#40493d] block mb-0.5">To</label>
                          <input
                            type="time"
                            value={customTo}
                            onChange={e => setCustomTo(e.target.value)}
                            className="bg-[#f3f3f3] rounded px-2 py-1 text-[11px] w-24 outline-none border border-[#e2e2e2] focus:border-[#0d631b]/40"
                          />
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); reloadPressure() }}
                          className="px-3 py-1 rounded bg-[#0d631b] text-white text-[10px] font-semibold hover:opacity-90"
                        >Go</button>
                      </div>
                    )}
                  </div>
                  {pressHistLoading ? (
                    <div className="h-[160px] flex items-center justify-center text-xs text-[#40493d]">Loading…</div>
                  ) : pressureHistory.length === 0 ? (
                    <div className="h-[160px] flex items-center justify-center text-xs text-[#40493d]">No data yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={pressureHistory} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} onClick={e => e?.stopPropagation?.()}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f2f4f3" />
                        <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#717975' }} interval={Math.max(1, Math.floor(pressureHistory.length / 6))} />
                        <YAxis domain={[0, MAX_PSI]} tick={{ fontSize: 9, fill: '#717975' }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="psi" name="Pressure" stroke={color} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}
            </Card>

            <Card>
              <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">Inputs (DI1–DI6)</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {a6v3Inputs.map((active, i) => (
                  <div key={i} className={`py-1.5 rounded text-[10px] font-semibold text-center ${active ? 'bg-[#e8f5e9] text-[#0d631b]' : 'bg-[#f3f3f3] text-[#40493d]'}`}>
                    DI{i + 1}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Right — relay buttons */}
          <div className="lg:col-span-2">
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-3">Relays (DO1–DO6)</h2>
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
              {a6v3Outputs.map((on, i) => {
                const relayNum = i + 1
                const relayName = names[relayNum] ?? `Relay ${relayNum}`
                return (
                  <Card key={i} accent={on ? 'green' : undefined}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        {editingRelay === relayNum ? (
                          <input
                            ref={relayNameRef}
                            value={relayNameInput}
                            onChange={e => setRelayNameInput(e.target.value)}
                            onBlur={() => commitRelayRename(relayNum)}
                            onKeyDown={e => { if (e.key === 'Enter') commitRelayRename(relayNum); if (e.key === 'Escape') setEditingRelay(null) }}
                            className="font-headline font-bold text-[#1a1c1c] bg-transparent border-b-2 border-[#0d631b] outline-none w-full text-sm"
                            maxLength={32}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => startRelayEdit(relayNum, relayName)}
                            className="font-headline font-bold text-[#1a1c1c] hover:text-[#0d631b] transition-colors flex items-center gap-1 group text-sm"
                            title="Click to rename"
                          >
                            <span className="truncate">{relayName}</span>
                            <span className="opacity-0 group-hover:opacity-60 transition-opacity text-xs">✏️</span>
                          </button>
                        )}
                        <p className="text-xs text-[#40493d]">DO{relayNum}</p>
                      </div>
                      <span className={`w-3 h-3 rounded-full mt-0.5 shrink-0 ${on ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
                    </div>
                    <StatusChip status={on ? 'running' : 'offline'} label={on ? 'ON' : 'OFF'} />
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() => handleToggle(relayNum, on)}
                        disabled={!!a6v3Busy[relayNum] || on}
                        className="flex-1 py-1.5 rounded-md bg-[#0d631b] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                      >On</button>
                      <button
                        onClick={() => handleToggle(relayNum, on)}
                        disabled={!!a6v3Busy[relayNum] || !on}
                        className="flex-1 py-1.5 rounded-md bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold hover:bg-[#d5d5d5] disabled:opacity-40 transition-all"
                      >Off</button>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY TAB ───────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f3f3f3] flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">Relay On/Off Log</h2>
              <p className="text-xs text-[#40493d] mt-0.5">All relay events for the selected day</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-xs font-semibold text-[#40493d]">Date</label>
              <input
                type="date"
                value={histDate}
                onChange={e => setHistDate(e.target.value)}
                className="bg-[#f3f3f3] rounded-lg px-3 py-1.5 text-sm outline-none border border-[#e2e2e2] focus:border-[#0d631b]/40"
              />
            </div>
          </div>
          {histLoading ? (
            <div className="px-5 py-8 text-sm text-[#40493d]">Loading…</div>
          ) : relayHistory.length === 0 ? (
            <div className="px-5 py-10 text-sm text-[#40493d] text-center">No relay events recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-body">
                <thead>
                  <tr className="bg-[#f3f3f3]">
                    <th className="text-left text-xs font-semibold text-[#40493d] px-5 py-3">Relay</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Turned On</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Turned Off</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Duration</th>
                    <th className="text-left text-xs font-semibold text-[#40493d] px-4 py-3">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {relayHistory.map((row, i) => {
                    const relayName = names[row.zone_num] ?? `Relay ${row.zone_num}`
                    return (
                      <tr key={row.id} className={`hover:bg-[#f9f9f9] transition-colors ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}>
                        <td className="px-5 py-3 font-semibold text-[#1a1c1c]">
                          {relayName}
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

      {/* ── GROUPS TAB ────────────────────────────────────────────── */}
      {activeTab === 'groups' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Groups list */}
          <div className="lg:col-span-2 space-y-3">
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-1">Relay Groups</h2>
            {groupsLoading ? (
              <p className="text-sm text-[#40493d]">Loading groups…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-[#40493d]">No relay groups yet. Create one on the right.</p>
            ) : groups.map(group => {
              const anyOn = group.members.some(m => a6v3Outputs[m.zone_num - 1])
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
                        {group.members.map(m => names[m.zone_num] ?? `Relay ${m.zone_num}`).join(', ')} · {group.members[0]?.duration_min ?? 30}m each
                      </p>
                      {schedSummary ? (
                        <div className="flex items-center gap-2 mt-1">
                          <p className={`text-xs ${group.group_schedules[0].enabled ? 'text-[#00639a]' : 'text-[#40493d]/50 line-through'}`}>{schedSummary}</p>
                          <button
                            onClick={() => toggleScheduleEnabled(group.group_schedules[0])}
                            title={group.group_schedules[0].enabled ? 'Pause schedule' : 'Enable schedule'}
                            className={`relative inline-flex w-7 h-4 rounded-full transition-colors shrink-0 ${group.group_schedules[0].enabled ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}
                          >
                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${group.group_schedules[0].enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
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
            <h3 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-4">New Group</h3>
            <div className="space-y-3">
              <input
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                placeholder="Group name (e.g. Morning Run)"
                className={`w-full ${inputCls}`}
              />
              <div>
                <p className="text-xs font-semibold text-[#40493d] mb-2">Select relays:</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {Array.from({ length: 6 }, (_, i) => i + 1).map(n => (
                    <button
                      key={n}
                      onClick={() => toggleGroupRelay(n)}
                      className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        newGroupRelays.includes(n)
                          ? 'bg-[#0d631b] text-white'
                          : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'
                      }`}
                    >
                      {names[n] ?? `R${n}`}
                    </button>
                  ))}
                </div>
              </div>
              {groupError && <p className="text-xs text-[#ba1a1a]">{groupError}</p>}
              <button
                onClick={createGroup}
                disabled={addingGroup || !newGroupName.trim() || newGroupRelays.length === 0}
                className="w-full py-2 rounded-xl gradient-primary text-white text-sm font-semibold shadow-fab hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {addingGroup ? 'Creating…' : 'Create Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT GROUP MODAL ──────────────────────────────────────── */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditingGroup(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="font-headline font-bold text-base text-[#1a1c1c] mb-4">Edit Group</h2>
            <div className="space-y-3">
              <input value={editName} onChange={e => setEditName(e.target.value)} className={`w-full ${inputCls}`} placeholder="Group name" />
              <div>
                <p className="text-xs font-semibold text-[#40493d] mb-2">Relays:</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {Array.from({ length: 6 }, (_, i) => i + 1).map(n => {
                    const sel = editRelays.includes(n)
                    return (
                      <button key={n} onClick={() => toggleEditRelay(n)} className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${sel ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'}`}>
                        {names[n] ?? `R${n}`}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-[#40493d]/60 mt-1">Tap to select/deselect relays.</p>
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
                <button onClick={saveEdit} disabled={savingEdit || !editName.trim() || editRelays.length === 0} className="flex-1 py-2 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90">
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SCHEDULE MODAL ────────────────────────────────────────── */}
      {schedulingGroup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSchedulingGroup(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="font-headline font-bold text-base text-[#1a1c1c] mb-1">Schedule</h2>
            <p className="text-xs text-[#40493d] mb-4">{schedulingGroup.name}</p>
            <div className="space-y-4">
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

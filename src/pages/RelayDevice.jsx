/**
 * Generic relay device page — works for any KCS firmware device.
 * Driven entirely by the deviceCfg prop from src/config/devices.js.
 *
 * Tabs: Relays / History / Groups
 * Optional sections (rendered only when deviceCfg has the relevant config):
 *   pressureConfig → PressurePanel (gauge, history graph, alerts)
 *   pollConfig     → DAC-toggle polling to force STATE responses
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import PageHeader from '../components/PageHeader'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useDeviceData } from '../context/DeviceContext'
import { useZoneNames } from '../hooks/useZoneNames'
import { useZoneHistory } from '../hooks/useZoneHistory'
import { useA6v3PressureHistory } from '../hooks/useA6v3PressureHistory'
import { useDeviceOffline } from '../hooks/useDeviceOffline'
import { relayOn, relayOff, requestDeviceState } from '../lib/commands'
import { raiseAlert, resolveAlerts } from '../lib/alerts'
import { supabase } from '../lib/supabase'
import { localDateStr, fmtTime, fmtDuration } from '../lib/format'
import { relayGridCls, inputGridCols, gaugeColor } from '../lib/relayDevice'
import PressureGauge from '../components/PressureGauge'

const inputCls = 'bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:ring-2 focus:ring-[#0d631b]/10 focus:bg-white transition-all'

// PressureGauge moved to ../components/PressureGauge for reuse across pages.

function PressureTooltip({ active, payload, label }) {
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

// ── PressurePanel sub-component ───────────────────────────────────────────────

function PressurePanel({ deviceCfg, live, anyRelayOn }) {
  const { adcKey, maxPsi } = deviceCfg.pressureConfig
  const device = live[deviceCfg.stateTopic] ?? null
  const adcRaw = device?.[adcKey]?.value ?? 0

  const smoothedAdcRef = useRef(null)
  const psiRef = useRef(0)
  const [showGraph, setShowGraph] = useState(false)
  const [histPreset, setHistPreset] = useState('6h')
  const [customDate, setCustomDate] = useState(() => localDateStr())
  const [customFrom, setCustomFrom] = useState('05:00')
  const [customTo, setCustomTo]   = useState('07:00')

  // EMA smoothing (α=0.2)
  if (adcRaw > 0 || smoothedAdcRef.current === null) {
    smoothedAdcRef.current = smoothedAdcRef.current === null
      ? adcRaw
      : smoothedAdcRef.current * 0.8 + adcRaw * 0.2
  }
  const smoothedAdc = Math.round(smoothedAdcRef.current ?? adcRaw)
  const psi = (smoothedAdc / 4095) * maxPsi
  psiRef.current = psi

  // Tick once a minute so rolling windows advance, but not on every render.
  const [rangeTick, setRangeTick] = useState(0)
  useEffect(() => {
    if (histPreset === 'custom') return
    const id = setInterval(() => setRangeTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [histPreset])

  const histRange = useMemo(() => {
    if (histPreset === 'custom') {
      return {
        from: new Date(`${customDate}T${customFrom}:00`).toISOString(),
        to:   new Date(`${customDate}T${customTo}:00`).toISOString(),
      }
    }
    const hours = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 }[histPreset] ?? 6
    const now = Date.now()
    return {
      from: new Date(now - hours * 3600_000).toISOString(),
      to:   new Date(now).toISOString(),
    }
  }, [histPreset, customDate, customFrom, customTo, rangeTick])

  const { data: pressureHistory, loading: pressHistLoading, reload: reloadPressure } = useA6v3PressureHistory(histRange.from, histRange.to)

  // Pressure alerts
  useEffect(() => {
    if (!device) return
    const highThreshold = maxPsi * 0.86
    if (psi >= highThreshold) {
      raiseAlert({
        severity: 'fault', title: `${deviceCfg.name} high pressure`,
        description: `CH1 pressure is ${psi.toFixed(1)} PSI — exceeds threshold.`,
        device: deviceCfg.name, device_id: deviceCfg.serial,
      })
    } else {
      resolveAlerts(deviceCfg.name, `${deviceCfg.name} high pressure`)
    }
    if (anyRelayOn && psi < 5) {
      raiseAlert({
        severity: 'warning', title: `${deviceCfg.name} low pressure during run`,
        description: `CH1 pressure is ${psi.toFixed(1)} PSI while a relay is active — possible flow issue.`,
        device: deviceCfg.name, device_id: deviceCfg.serial,
      }, 15)
    }
  }, [psi, anyRelayOn, !!device]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showGraph) return
    reloadPressure()
    const id = setInterval(reloadPressure, 300_000)
    return () => clearInterval(id)
  }, [showGraph, histRange.from, histRange.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const color = gaugeColor(psi, maxPsi)

  return (
    <Card accent={psi >= maxPsi * 0.86 ? 'red' : psi >= maxPsi * 0.69 ? 'amber' : 'green'} className="cursor-pointer select-none">
      <div onClick={() => setShowGraph(s => !s)}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-headline font-semibold text-sm text-[#1a1c1c]">CH1 Pressure</h2>
          <span className="text-xs text-[#40493d]">{showGraph ? '▲ Hide graph' : '▼ Show graph'}</span>
        </div>
        <PressureGauge psi={psi} maxPsi={maxPsi} />
        <div className="mt-2 text-center">
          <span className="text-xs font-body text-[#40493d]">ADC {smoothedAdc} · 0–{maxPsi} PSI range</span>
        </div>
      </div>

      {showGraph && (
        <div className="mt-4 border-t border-[#e2e2e2] pt-4">
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#40493d]">History</span>
              <div className="flex gap-1">
                {[['1h','1h'],['6h','6h'],['24h','24h'],['7d','7d'],['custom','Custom']].map(([val, label]) => (
                  <button key={val} onClick={e => { e.stopPropagation(); setHistPreset(val) }}
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
                  <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
                    className="w-full bg-[#f3f3f3] rounded px-2 py-1 text-[11px] outline-none border border-[#e2e2e2]" />
                </div>
                <div>
                  <label className="text-[10px] text-[#40493d] block mb-0.5">From</label>
                  <input type="time" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="bg-[#f3f3f3] rounded px-2 py-1 text-[11px] w-24 outline-none border border-[#e2e2e2]" />
                </div>
                <div>
                  <label className="text-[10px] text-[#40493d] block mb-0.5">To</label>
                  <input type="time" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="bg-[#f3f3f3] rounded px-2 py-1 text-[11px] w-24 outline-none border border-[#e2e2e2]" />
                </div>
                <button onClick={e => { e.stopPropagation(); reloadPressure() }}
                  className="px-3 py-1 rounded bg-[#0d631b] text-white text-[10px] font-semibold hover:opacity-90">Go</button>
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
                <YAxis domain={[0, maxPsi]} tick={{ fontSize: 9, fill: '#717975' }} />
                <Tooltip content={<PressureTooltip />} />
                <Line type="monotone" dataKey="psi" name="Pressure" stroke={color} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RelayDevice({ deviceCfg }) {
  const { data: live, connected } = useLiveTelemetry([deviceCfg.stateTopic])
  const { patchOptimistic } = useDeviceData()
  const { names, renameZone } = useZoneNames(deviceCfg.id)
  const [activeTab, setActiveTab] = useState('relays')
  const [busy, setBusy] = useState({})
  const [editingOutput, setEditingOutput] = useState(null)
  const [outputNameInput, setOutputNameInput] = useState('')
  const outputNameRef = useRef(null)

  // History tab
  const [histDate, setHistDate] = useState(() => localDateStr())
  const histDateFrom = new Date(`${histDate}T00:00:00`).toISOString()
  const histDateTo   = new Date(`${histDate}T23:59:59.999`).toISOString()
  const { history, loading: histLoading } = useZoneHistory(null, deviceCfg.id, 200, histDateFrom, histDateTo)

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
  const [schedMode, setSchedMode] = useState('repeat')
  const [schedDays, setSchedDays] = useState([false,false,false,false,false,false,false])
  const [schedStartTime, setSchedStartTime] = useState('06:00')
  const [schedOnceDate, setSchedOnceDate] = useState('')
  const [savingSched, setSavingSched] = useState(false)
  const [schedError, setSchedError] = useState(null)

  // Live device state
  const device = live[deviceCfg.stateTopic] ?? null
  const outputs = Array.from({ length: deviceCfg.outputCount }, (_, i) => device?.[`output${i+1}`]?.value ?? false)
  const inputs  = Array.from({ length: deviceCfg.inputCount  }, (_, i) => device?.[`input${i+1}`]?.value  ?? false)
  // ADC channels — skip the one used by pressure gauge
  const pressureAdcKey = deviceCfg.pressureConfig?.adcKey
  const adcChannels = Array.from({ length: deviceCfg.adcCount }, (_, i) => {
    const key = `adc${i+1}`
    return { key, index: i+1, value: device?.[key]?.value ?? 0, isPresure: key === pressureAdcKey }
  }).filter(ch => !ch.isPresure)

  const anyRelayOn = outputs.some(Boolean)
  const outputsRef = useRef(outputs)
  outputsRef.current = outputs

  // ── Auto-off timer ────────────────────────────────────────────────────────
  // selectedDurations: relay num → minutes (null = manual, no auto-off)
  const [selectedDurations, setSelectedDurations] = useState({})
  const autoOffRef = useRef({}) // relay num → end timestamp (ms)
  const [, setTick] = useState(0) // forces countdown re-render every second

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      for (const [numStr, endTime] of Object.entries(autoOffRef.current)) {
        if (now >= endTime) {
          const n = Number(numStr)
          delete autoOffRef.current[numStr]
          if (outputsRef.current[n - 1]) {
            // Relay is still on — fire auto-off
            relayOff(deviceCfg, n).catch(console.error)
            patchOptimistic(deviceCfg.stateTopic, { [`output${n}`]: { value: false } })
            requestDeviceState(deviceCfg)
          }
        }
      }
      setTick(t => t + 1)
    }, 1000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Offline alert
  useDeviceOffline(deviceCfg.name, deviceCfg.serial, device)

  // Polling (DAC toggle) — only for devices with pollConfig
  useEffect(() => {
    if (!deviceCfg.pollConfig) return
    requestDeviceState(deviceCfg)
    const { idleMs, activeMs } = deviceCfg.pollConfig
    const interval = anyRelayOn ? activeMs : idleMs
    const id = setInterval(() => requestDeviceState(deviceCfg), interval)
    return () => clearInterval(id)
  }, [anyRelayOn, deviceCfg]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial state request on mount
  useEffect(() => { requestDeviceState(deviceCfg) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Groups ────────────────────────────────────────────────────────────────

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
              .filter(m => m.device === deviceCfg.id)
              .sort((a, b) => a.sort_order - b.sort_order),
          }))
          .filter(g => g.members.length > 0)
      )
    }
    setGroupsLoading(false)
  }, [deviceCfg.id])

  useEffect(() => { loadGroups() }, [loadGroups])

  async function createGroup() {
    if (!newGroupName.trim() || newGroupOutputs.length === 0) return
    setAddingGroup(true); setGroupError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data: grp, error: e1 } = await supabase
        .from('zone_groups')
        .insert({ name: newGroupName.trim(), run_mode: 'simultaneous', customer_id: session?.user?.id })
        .select().single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('zone_group_members').insert(
        newGroupOutputs.map((n, i) => ({ group_id: grp.id, zone_num: n, device: deviceCfg.id, duration_min: 30, sort_order: i }))
      )
      if (e2) throw e2
      setNewGroupName(''); setNewGroupOutputs([])
      await loadGroups()
    } catch (err) { setGroupError(err.message ?? 'Failed to create group') }
    setAddingGroup(false)
  }

  async function deleteGroup(groupId) {
    if (!window.confirm('Delete this group?')) return
    await supabase.from('zone_groups').delete().eq('id', groupId)
    loadGroups()
  }

  async function startGroup(group) {
    setGroupBusy(b => ({ ...b, [group.id]: true }))
    for (const m of group.members) await relayOn(deviceCfg, m.zone_num, 'group')
    setGroupBusy(b => ({ ...b, [group.id]: false }))
  }

  async function stopGroup(group) {
    setGroupBusy(b => ({ ...b, [group.id]: true }))
    for (const m of group.members) await relayOff(deviceCfg, m.zone_num)
    setGroupBusy(b => ({ ...b, [group.id]: false }))
  }

  function openEdit(group) {
    setEditName(group.name)
    setEditOutputs(group.members.map(m => m.zone_num))
    setEditDuration(group.members[0]?.duration_min ?? 30)
    setEditingGroup(group)
  }

  async function saveEdit() {
    if (!editName.trim() || editOutputs.length === 0) return
    setSavingEdit(true)
    try {
      await supabase.from('zone_groups').update({ name: editName.trim() }).eq('id', editingGroup.id)
      await supabase.from('zone_group_members').delete().eq('group_id', editingGroup.id).eq('device', deviceCfg.id)
      await supabase.from('zone_group_members').insert(
        editOutputs.map((o, i) => ({ group_id: editingGroup.id, zone_num: o, device: deviceCfg.id, duration_min: editDuration, sort_order: i }))
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
      setSchedStartTime('06:00'); setSchedOnceDate('')
    }
    setSchedError(null); setSchedulingGroup(group)
  }

  async function saveSchedule() {
    if (schedMode === 'repeat' && !schedDays.some(Boolean)) { setSchedError('Select at least one day'); return }
    if (schedMode === 'once' && !schedOnceDate) { setSchedError('Pick a date'); return }
    setSavingSched(true); setSchedError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const dow = schedMode === 'repeat'
        ? schedDays.map((on, i) => on ? (i === 6 ? 0 : i+1) : null).filter(d => d !== null)
        : []
      const fields = {
        days_of_week: dow, start_time: schedStartTime, enabled: true,
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
      setSchedulingGroup(null); await loadGroups()
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

  // ── Relay controls ────────────────────────────────────────────────────────

  function startEdit(n, currentName) {
    setOutputNameInput(currentName)
    setEditingOutput(n)
    setTimeout(() => outputNameRef.current?.select(), 0)
  }

  async function commitRename(n) {
    setEditingOutput(null)
    const trimmed = outputNameInput.trim()
    if (trimmed && trimmed !== (names[n] ?? `Relay ${n}`)) await renameZone(n, trimmed)
  }

  async function handleToggle(n, currentlyOn) {
    setBusy(b => ({ ...b, [n]: true }))
    patchOptimistic(deviceCfg.stateTopic, { [`output${n}`]: { value: !currentlyOn } })
    if (!currentlyOn) {
      // Turning ON — start auto-off timer if a duration is selected
      const dur = selectedDurations[n] !== undefined ? selectedDurations[n] : 30
      if (dur) autoOffRef.current[n] = Date.now() + dur * 60_000
      else delete autoOffRef.current[n]
    } else {
      // Turning OFF manually — cancel any auto-off timer
      delete autoOffRef.current[n]
    }
    try {
      if (currentlyOn) await relayOff(deviceCfg, n)
      else             await relayOn(deviceCfg, n, 'manual')
      requestDeviceState(deviceCfg)
    } catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [n]: false }))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 p-8 md:p-12 bg-[#f8faf9] overflow-auto min-h-screen">
      <PageHeader
        eyebrow={`Device • Serial ${deviceCfg.serial}`}
        title={deviceCfg.name}
        subtitle={`${deviceCfg.outputCount} relays • ${deviceCfg.inputCount} inputs${deviceCfg.adcCount ? ` • ${deviceCfg.adcCount} analog` : ''}`}
        connected={connected}
        actions={<StatusChip status={device ? 'online' : 'offline'} label={device ? 'Online' : 'Offline'} />}
      />

      {/* Tabs */}
      <div className="inline-flex bg-[#f2f4f3] p-1 rounded-full mb-6">
        {[{ id: 'relays', label: 'Relays' }, { id: 'history', label: 'History' }, { id: 'groups', label: 'Programs' }].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeTab === t.id ? 'bg-white shadow-sm text-[#17362e]' : 'text-[#717975] hover:text-[#17362e]'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* ── RELAYS TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'relays' && (
        <div className={`grid grid-cols-1 gap-6 ${deviceCfg.pressureConfig ? 'lg:grid-cols-3' : ''}`}>
          {/* Left panel — pressure gauge + inputs (only for pressure devices) */}
          {deviceCfg.pressureConfig && (
            <div className="space-y-4">
              <PressurePanel deviceCfg={deviceCfg} live={live} anyRelayOn={anyRelayOn} />
              {inputs.length > 0 && (
                <Card>
                  <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">
                    Inputs (DI1–DI{deviceCfg.inputCount})
                  </h3>
                  <div className={`grid ${inputGridCols(inputs.length)} gap-1.5`}>
                    {inputs.map((active, i) => (
                      <div key={i} className={`py-1.5 rounded text-[10px] font-semibold text-center ${
                        active ? 'bg-[#e8f5e9] text-[#0d631b]' : 'bg-[#f3f3f3] text-[#40493d]'
                      }`}>DI{i+1}</div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* Right panel — relay grid + (for non-pressure devices) inputs + ADC */}
          <div className={deviceCfg.pressureConfig ? 'lg:col-span-2' : ''}>
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-3">
              Relays (DO1–DO{deviceCfg.outputCount})
            </h2>
            <div className={`grid ${relayGridCls(deviceCfg.outputCount)} gap-4 mb-6`}>
              {outputs.map((on, i) => {
                const n = i + 1
                const name = names[n] ?? `Relay ${n}`
                return (
                  <Card key={i} accent={on ? 'green' : undefined}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        {editingOutput === n ? (
                          <input ref={outputNameRef} value={outputNameInput}
                            onChange={e => setOutputNameInput(e.target.value)}
                            onBlur={() => commitRename(n)}
                            onKeyDown={e => { if (e.key === 'Enter') commitRename(n); if (e.key === 'Escape') setEditingOutput(null) }}
                            className="font-headline font-bold text-[#1a1c1c] bg-transparent border-b-2 border-[#0d631b] outline-none w-full text-sm"
                            maxLength={32} autoFocus />
                        ) : (
                          <button onClick={() => startEdit(n, name)}
                            className="font-headline font-bold text-[#1a1c1c] hover:text-[#0d631b] transition-colors flex items-center gap-1 group text-sm"
                            title="Click to rename">
                            <span className="truncate">{name}</span>
                            <span className="opacity-0 group-hover:opacity-60 transition-opacity text-xs">✏️</span>
                          </button>
                        )}
                        <p className="text-xs text-[#40493d]">DO{n}</p>
                      </div>
                      <span className={`w-3 h-3 rounded-full mt-0.5 shrink-0 ${on ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
                    </div>
                    <StatusChip status={on ? 'running' : 'offline'} label={on ? 'ON' : 'OFF'} />

                    {/* Duration input — shown when relay is OFF (matches Zones page UX) */}
                    {!on && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <input
                          type="number"
                          min={1}
                          max={240}
                          placeholder="30"
                          value={selectedDurations[n] === null ? '' : (selectedDurations[n] ?? '')}
                          onChange={e => {
                            const v = e.target.value
                            setSelectedDurations(prev => ({ ...prev, [n]: v === '' ? null : Number(v) }))
                          }}
                          className="w-14 bg-[#f3f3f3] rounded-md px-2 py-1 text-xs text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:bg-white transition-all"
                        />
                        <span className="text-[10px] text-[#40493d]">min</span>
                      </div>
                    )}

                    {/* Countdown — shown when relay is ON with auto-off */}
                    {on && autoOffRef.current[n] && (() => {
                      const rem = Math.max(0, autoOffRef.current[n] - Date.now())
                      const min = Math.floor(rem / 60000)
                      const sec = Math.floor((rem % 60000) / 1000)
                      return (
                        <p className="text-[10px] text-center text-[#0d631b] font-semibold mt-1">
                          auto-off {min}:{String(sec).padStart(2,'0')}
                        </p>
                      )
                    })()}

                    <div className="flex gap-1 mt-2">
                      <button onClick={() => handleToggle(n, on)} disabled={!!busy[n] || on}
                        className="flex-1 py-1.5 rounded-md bg-[#0d631b] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">On</button>
                      <button onClick={() => handleToggle(n, on)} disabled={!!busy[n] || !on}
                        className="flex-1 py-1.5 rounded-md bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold hover:bg-[#d5d5d5] disabled:opacity-40 transition-all">Off</button>
                    </div>
                  </Card>
                )
              })}
            </div>

            {/* Inputs + ADC for non-pressure devices (or below relays for all devices) */}
            {!deviceCfg.pressureConfig && (inputs.length > 0 || adcChannels.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {inputs.length > 0 && (
                  <Card>
                    <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">
                      Inputs (DI1–DI{deviceCfg.inputCount})
                    </h3>
                    <div className={`grid ${inputGridCols(inputs.length)} gap-1.5`}>
                      {inputs.map((active, i) => (
                        <div key={i} className={`py-1.5 rounded text-[10px] font-semibold text-center ${
                          active ? 'bg-[#e8f5e9] text-[#0d631b]' : 'bg-[#f3f3f3] text-[#40493d]'
                        }`}>DI{i+1}</div>
                      ))}
                    </div>
                  </Card>
                )}
                {adcChannels.length > 0 && (
                  <Card>
                    <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">
                      Analog ({adcChannels.map(c => `CH${c.index}`).join('–')})
                    </h3>
                    <div className="space-y-3">
                      {adcChannels.map(ch => (
                        <div key={ch.key}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-[#40493d]">CH{ch.index}</span>
                            <span className="font-semibold text-[#1a1c1c]">{ch.value}</span>
                          </div>
                          <div className="h-1.5 bg-[#e2e2e2] rounded-full overflow-hidden">
                            <div className="h-full bg-[#0d631b] rounded-full transition-all"
                              style={{ width: `${Math.min((ch.value / 4095) * 100, 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HISTORY TAB ────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f3f3f3] flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">Relay On/Off Log</h2>
              <p className="text-xs text-[#40493d] mt-0.5">All relay events for the selected day</p>
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
            <div className="px-5 py-10 text-sm text-[#40493d] text-center">No relay events for this day.</div>
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
                  {history.map((row, i) => (
                    <tr key={row.id} className={`hover:bg-[#f9f9f9] transition-colors ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}>
                      <td className="px-5 py-3 font-semibold text-[#1a1c1c]">
                        {names[row.zone_num] ?? `Relay ${row.zone_num}`}
                        <span className="ml-1.5 text-[10px] text-[#40493d] font-normal">DO{row.zone_num}</span>
                      </td>
                      <td className="px-4 py-3 text-[#40493d] text-xs">{fmtTime(row.started_at)}</td>
                      <td className="px-4 py-3 text-[#40493d] text-xs">{fmtTime(row.ended_at)}</td>
                      <td className="px-4 py-3 text-[#40493d] text-xs">{fmtDuration(row.duration_min)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          row.source === 'schedule' ? 'bg-[#00639a]/10 text-[#00639a]' : 'bg-[#f3f3f3] text-[#40493d]'
                        }`}>{row.source ?? 'manual'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── GROUPS TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'groups' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-1">Programs</h2>
            {groupsLoading ? (
              <p className="text-sm text-[#40493d]">Loading groups…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-[#40493d]">No programs yet. Create one on the right.</p>
            ) : groups.map(group => {
              const anyOn = group.members.some(m => outputs[m.zone_num - 1])
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
                        {group.members.map(m => names[m.zone_num] ?? `Relay ${m.zone_num}`).join(', ')} · {group.members[0]?.duration_min ?? 30}m each
                      </p>
                      {schedSummary ? (
                        <div className="flex items-center gap-2 mt-1">
                          <p className={`text-xs ${sched.enabled ? 'text-[#00639a]' : 'text-[#40493d]/50 line-through'}`}>{schedSummary}</p>
                          <button onClick={() => toggleScheduleEnabled(sched)}
                            className={`relative inline-flex w-7 h-4 rounded-full transition-colors shrink-0 ${sched.enabled ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}>
                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${sched.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-[#40493d]/50 mt-1">No schedule</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      <button onClick={() => openEdit(group)} className="px-2 py-1 rounded text-xs text-[#40493d] hover:bg-[#f3f3f3]">Edit</button>
                      <button onClick={() => openSchedule(group)} className="px-2 py-1 rounded text-xs text-[#00639a] font-semibold hover:bg-[#00639a]/10">Schedule</button>
                      <button onClick={() => startGroup(group)} disabled={!!groupBusy[group.id]}
                        className="px-3 py-1.5 rounded-lg bg-[#0d631b] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40">
                        {groupBusy[group.id] ? '…' : 'Start'}</button>
                      <button onClick={() => stopGroup(group)} disabled={!!groupBusy[group.id]}
                        className="px-3 py-1.5 rounded-lg bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold hover:bg-[#d5d5d5] disabled:opacity-40">Stop</button>
                      <button onClick={() => deleteGroup(group.id)}
                        className="px-2 py-1.5 rounded-lg text-[#ba1a1a] text-xs font-semibold hover:bg-[#ba1a1a]/10">✕</button>
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
              <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                placeholder="Group name" className={`w-full ${inputCls}`} />
              <div>
                <p className="text-xs font-semibold text-[#40493d] mb-2">Select relays:</p>
                <div className={`grid gap-1.5 ${relayGridCls(deviceCfg.outputCount)}`}>
                  {Array.from({ length: deviceCfg.outputCount }, (_, i) => i + 1).map(n => (
                    <button key={n}
                      onClick={() => setNewGroupOutputs(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])}
                      className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        newGroupOutputs.includes(n) ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'
                      }`}>{names[n] ?? `R${n}`}</button>
                  ))}
                </div>
              </div>
              {groupError && <p className="text-xs text-[#ba1a1a]">{groupError}</p>}
              <button onClick={createGroup} disabled={addingGroup || !newGroupName.trim() || newGroupOutputs.length === 0}
                className="w-full py-2 rounded-xl gradient-primary text-white text-sm font-semibold shadow-fab hover:opacity-90 disabled:opacity-40">
                {addingGroup ? 'Creating…' : 'Create Program'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT GROUP MODAL ─────────────────────────────────────────────── */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditingGroup(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="font-headline font-bold text-base text-[#1a1c1c] mb-4">Edit Program</h2>
            <div className="space-y-3">
              <input value={editName} onChange={e => setEditName(e.target.value)} className={`w-full ${inputCls}`} placeholder="Group name" />
              <div>
                <p className="text-xs font-semibold text-[#40493d] mb-2">Relays:</p>
                <div className={`grid gap-1.5 ${relayGridCls(deviceCfg.outputCount)}`}>
                  {Array.from({ length: deviceCfg.outputCount }, (_, i) => i + 1).map(n => (
                    <button key={n}
                      onClick={() => setEditOutputs(prev => prev.includes(n) ? prev.filter(o => o !== n) : [...prev, n])}
                      className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        editOutputs.includes(n) ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'
                      }`}>{names[n] ?? `R${n}`}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#40493d] mb-2">Duration (minutes):</p>
                <input type="number" min={1} max={240} value={editDuration}
                  onChange={e => setEditDuration(Number(e.target.value))} className={`w-full ${inputCls}`} />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditingGroup(null)} className="flex-1 py-2 rounded-xl bg-[#f3f3f3] text-sm font-semibold text-[#40493d] hover:bg-[#e8e8e8]">Cancel</button>
                <button onClick={saveEdit} disabled={savingEdit || !editName.trim() || editOutputs.length === 0}
                  className="flex-1 py-2 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90">
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SCHEDULE MODAL ───────────────────────────────────────────────── */}
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
                <button onClick={saveSchedule} disabled={savingSched}
                  className="flex-1 py-2 rounded-xl gradient-primary text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90">
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

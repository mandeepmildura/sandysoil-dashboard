import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useZoneNames } from '../hooks/useZoneNames'
import { useScheduleRules } from '../hooks/useScheduleRules'
import { useAlerts } from '../hooks/useAlerts'
import { zoneOn, zoneOff, allZonesOff, startBackwash } from '../lib/commands'
import { KCS_DEVICES } from '../config/devices'
import { supabase } from '../lib/supabase'
import {
  fmtLastRun,
  bucketPressureBars,
  upcomingSchedules,
  diffPsi as computeDiffPsi,
} from '../lib/dashboard'

const IRR_TOPIC        = 'farm/irrigation1/status'
const ZONE_STATE_TOPIC = 'farm/irrigation1/zone/+/state'
const PRESSURE_TOPIC   = 'farm/filter1/pressure'
const BACKWASH_TOPIC   = 'farm/filter1/backwash/state'
const B16M_TOPIC       = 'B16M/CCBA97071FD8/STATE'
const A6V3_TOPIC       = 'A6v3/8CBFEA03002C/STATE'
const SIM_TOPIC        = 'farm/irrigation1/sim/pressure'
const TOPICS = [IRR_TOPIC, ZONE_STATE_TOPIC, PRESSURE_TOPIC, BACKWASH_TOPIC, B16M_TOPIC, A6V3_TOPIC, SIM_TOPIC]

// Shared palette (matches Pressure page)
const C_DARK     = '#17362e'
const C_MUTED    = '#717975'
const C_OUTLINE  = '#c1c8c4'
const C_SURFACE  = '#f2f4f3'
const C_BG       = '#f8faf9'
const C_PRIMARY  = '#0d631b'

const CARD_SHADOW = 'shadow-[0px_12px_32px_rgba(25,28,28,0.04)]'

function Icon({ name, className = '' }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}

export default function Dashboard() {
  const { data, connected } = useLiveTelemetry(TOPICS)
  const { names } = useZoneNames()
  const { groupSchedules } = useScheduleRules()
  const { alerts } = useAlerts()
  const [busy, setBusy] = useState({})
  const [lastRuns, setLastRuns] = useState({})
  const [pressureBars, setPressureBars] = useState([])

  async function handleZoneToggle(id, currentlyOn) {
    setBusy(b => ({ ...b, [id]: true }))
    try { currentlyOn ? await zoneOff(id) : await zoneOn(id, 30) }
    catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [id]: false }))
  }

  useEffect(() => {
    async function load() {
      // Only need enough rows to cover 8 distinct zones; 24 handles repeats.
      const { data: rows } = await supabase
        .from('zone_history')
        .select('zone_num, ended_at')
        .eq('device', 'irrigation1')
        .not('ended_at', 'is', null)
        .order('ended_at', { ascending: false })
        .limit(24)
      if (!rows) return
      const map = {}
      for (const r of rows) if (r.zone_num != null && !map[r.zone_num]) map[r.zone_num] = r.ended_at
      setLastRuns(map)
    }
    load()
  }, [])

  useEffect(() => {
    async function load() {
      // 30 bars × 2 samples/bar is plenty for the sparkline; 60 was 2× what's needed.
      const { data: rows } = await supabase
        .from('pressure_log')
        .select('supply_psi')
        .not('supply_psi', 'is', null)
        .order('ts', { ascending: false })
        .limit(30)
      setPressureBars(bucketPressureBars(rows?.map(r => r.supply_psi)))
    }
    load()
  }, [])

  const irr      = data[IRR_TOPIC]      ?? null
  const pressure = data[PRESSURE_TOPIC] ?? null
  const b16m     = data[B16M_TOPIC]     ?? null
  const a6v3     = data[A6V3_TOPIC]     ?? null
  const sim      = data[SIM_TOPIC]      ?? null

  const zoneOverrides = {}
  Object.entries(data).forEach(([topic, payload]) => {
    const m = topic.match(/^farm\/irrigation1\/zone\/(\d+)\/state$/)
    if (m) zoneOverrides[Number(m[1])] = payload
  })
  const baseZones = irr?.zones ?? Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}`, on: false, state: 'off' }))
  const zones = baseZones.map(z => zoneOverrides[z.id] ? { ...z, ...zoneOverrides[z.id] } : z)

  const supplyPsi   = sim?.supply_psi ?? irr?.supply_psi ?? '—'
  const activeCount = zones.filter(z => z.on).length
  const inletPsi    = pressure?.inlet_psi ?? '—'
  const outletPsi   = pressure?.outlet_psi ?? '—'
  const diffPsi     = computeDiffPsi(pressure)
  const diffPct     = (typeof diffPsi === 'number') ? Math.min(100, (diffPsi / 20) * 100) : 0

  const now = new Date()
  const subtitleDate = now.toLocaleDateString('en-AU', {
    timeZone: 'Australia/Melbourne', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
  })

  const upcoming = useMemo(() => upcomingSchedules(groupSchedules, now), [groupSchedules, now])

  const devices = [
    { label: 'Irrigation Controller', online: irr?.online === true, to: '/zones' },
    ...KCS_DEVICES.map(d => ({
      label: d.name,
      online: d.id === 'a6v3' ? !!a6v3 : d.id === 'b16m' ? !!b16m : false,
      to:    d.path,
    })),
  ]

  const critical = (alerts ?? [])
    .filter(a => !a.acknowledged && (a.severity === 'fault' || a.severity === 'critical' || a.severity === 'error'))
    .slice(0, 2)
  const warnings = (alerts ?? [])
    .filter(a => !a.acknowledged && a.severity === 'warning')
    .slice(0, 2 - critical.length)

  const onlineNow = irr?.online === true
  const diffTone = (typeof diffPsi === 'number' && diffPsi < 8) ? 'good' : diffPsi != null ? 'warn' : 'muted'

  return (
    <div className="flex-1 p-8 md:p-12 bg-[#f8faf9] overflow-auto min-h-screen">

      {/* Page header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#717975] mb-2">Farm Operations</p>
          <h1 className="text-4xl font-extrabold text-[#17362e] tracking-tight">Farm Overview</h1>
          <p className="text-sm text-[#717975] mt-1">{subtitleDate}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-[#c1c8c4]'}`} />
            <span className="text-xs font-semibold text-[#717975]">{connected ? 'Live' : 'Connecting…'}</span>
          </div>
          <button
            onClick={() => allZonesOff().catch(console.error)}
            disabled={activeCount === 0}
            className="px-5 py-2.5 rounded-full border border-[#c1c8c4] text-sm font-bold text-[#17362e] hover:bg-[#f2f4f3] transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            All Zones Off
          </button>
          <Link
            to="/calendar"
            className="px-5 py-2.5 rounded-full text-white text-sm font-bold shadow-lg shadow-[#17362e]/20"
            style={{ background: 'linear-gradient(135deg, #17362e 0%, #2e4d44 100%)' }}
          >
            View Schedule
          </Link>
        </div>
      </div>

      {/* Vitals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <VitalsTile
          label="Supply PSI"
          value={supplyPsi}
          icon="compress"
          trendLabel={onlineNow ? 'Device online' : 'Device offline'}
          trendColor={onlineNow ? 'text-emerald-600' : 'text-[#717975]'}
          badge={onlineNow}
          badgeLabel={onlineNow ? 'LIVE' : null}
        />
        <VitalsTile
          label="Filter Inlet"
          value={inletPsi}
          icon="input"
          trendLabel="Filter inlet"
          trendColor="text-[#717975]"
        />
        <VitalsTile
          label="Filter Outlet"
          value={outletPsi}
          icon="output"
          trendLabel={typeof outletPsi === 'number' && outletPsi < 30 ? 'Low pressure alert' : 'Normal'}
          trendColor={typeof outletPsi === 'number' && outletPsi < 30 ? 'text-[#ba1a1a]' : 'text-[#717975]'}
        />
        <VitalsTile
          label="Active Zones"
          value={String(activeCount)}
          unit={`/ ${zones.length}`}
          icon="water_drop"
          trendLabel={activeCount > 0 ? `${activeCount} running` : 'Idle'}
          trendColor={activeCount > 0 ? 'text-emerald-600' : 'text-[#717975]'}
          badge={activeCount > 0}
          badgeLabel={activeCount > 0 ? 'RUNNING' : null}
        />
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left: Zone grid + trend chart */}
        <div className="col-span-12 lg:col-span-8 space-y-6">

          {/* Zone management */}
          <div className={`bg-white rounded-xl ${CARD_SHADOW} overflow-hidden`}>
            <div className="px-8 py-5 border-b border-[#f2f4f3] flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-extrabold text-[#17362e] tracking-tight">Zone Management</h2>
                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 rounded-full">
                  <span className={`w-2 h-2 rounded-full ${activeCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-[#c1c8c4]'}`} />
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">
                    {activeCount > 0 ? `${activeCount} Active` : 'All Idle'}
                  </span>
                </div>
              </div>
              <Link to="/zones" className="text-xs font-bold text-[#17362e] hover:underline">
                Manage →
              </Link>
            </div>
            <div className="p-6 grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {zones.map(zone => (
                <ZoneCard
                  key={zone.id}
                  zone={zone}
                  name={names[zone.id] ?? zone.name}
                  busy={!!busy[zone.id]}
                  lastRun={lastRuns[zone.id]}
                  onToggle={() => handleZoneToggle(zone.id, zone.on)}
                />
              ))}
            </div>
          </div>

          {/* System health trend */}
          <div className={`bg-white rounded-xl ${CARD_SHADOW} overflow-hidden`}>
            <div className="px-8 py-5 border-b border-[#f2f4f3] flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-[#17362e] tracking-tight">System Health Trend</h2>
                <p className="text-xs text-[#717975]">Supply pressure — last hour</p>
              </div>
              <Link to="/pressure" className="px-4 py-1.5 rounded-full border border-[#c1c8c4] text-xs font-bold text-[#17362e] hover:bg-[#f2f4f3] transition-colors">
                Full Analysis →
              </Link>
            </div>
            <div className="p-8">
              {pressureBars.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-sm text-[#717975]">
                  No pressure data recorded yet.
                </div>
              ) : (
                <div className="h-40 flex items-end gap-1.5">
                  {pressureBars.map((h, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-t transition-all ${i === pressureBars.length - 1 ? 'bg-[#17362e]' : 'bg-[#2e4d44]/30'}`}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="col-span-12 lg:col-span-4 space-y-6">

          {/* Filter station */}
          <div className={`bg-white rounded-xl p-7 ${CARD_SHADOW} relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-3 opacity-[0.06] pointer-events-none">
              <Icon name="filter_alt" className="text-7xl text-[#17362e]" />
            </div>
            <div className="flex items-center gap-3 mb-5 relative">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-700 shrink-0">
                <Icon name="filter_alt" className="text-xl" />
              </div>
              <div className="min-w-0">
                <h3 className="font-extrabold text-[#17362e] text-base leading-tight">Filter Station</h3>
                <p className="text-[11px] text-[#717975]">Inlet {inletPsi} • Outlet {outletPsi} PSI</p>
              </div>
            </div>
            <div className="bg-[#f2f4f3] rounded-lg p-4 mb-5">
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#717975]">Differential</span>
                <span className={`text-lg font-extrabold tracking-tight ${
                  diffTone === 'good' ? 'text-emerald-700'
                  : diffTone === 'warn' ? 'text-[#e65100]'
                  : 'text-[#c1c8c4]'
                }`}>
                  {diffPsi != null ? `${diffPsi}` : '—'}
                  {diffPsi != null && <span className="text-[11px] font-semibold text-[#c1c8c4] ml-1">psi</span>}
                </span>
              </div>
              <div className="w-full bg-white h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${diffTone === 'warn' ? 'bg-[#e65100]' : 'bg-emerald-500'}`}
                  style={{ width: `${diffPct}%` }}
                />
              </div>
              <p className="text-[10px] text-[#717975] mt-2">
                {diffTone === 'good' ? 'Optimized range' : diffTone === 'warn' ? 'Clogging — consider backwash' : 'No sensor data'}
              </p>
            </div>
            <button
              onClick={() => startBackwash().catch(console.error)}
              className="w-full py-3.5 rounded-full text-white text-sm font-extrabold tracking-wide shadow-lg shadow-[#17362e]/20 transition-transform active:scale-95"
              style={{ background: 'linear-gradient(135deg, #17362e 0%, #2e4d44 100%)' }}
            >
              MANUAL BACKWASH
            </button>
          </div>

          {/* Upcoming schedule */}
          <div className={`bg-white rounded-xl p-7 ${CARD_SHADOW}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-extrabold text-[#17362e] text-base flex items-center gap-2">
                <Icon name="event" className="text-lg text-[#717975]" />
                Upcoming Schedule
              </h3>
              <Link to="/calendar" className="text-[10px] font-bold text-[#17362e] uppercase tracking-widest hover:underline">All</Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-xs text-[#717975]">No schedules configured yet.</p>
            ) : (
              <div className="space-y-4">
                {upcoming.map(s => (
                  <div key={s.id} className="flex gap-4 items-center">
                    <div className="flex flex-col items-center w-11 shrink-0 py-1.5 bg-[#f2f4f3] rounded-lg">
                      <span className="text-[9px] font-extrabold uppercase text-[#717975] tracking-widest">{s.month}</span>
                      <span className="text-lg font-extrabold text-[#17362e] leading-none">{s.day}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#17362e] truncate">{s.name}</p>
                      <p className="text-xs text-[#717975]">
                        {s.time || '—'}{s.durationMin ? ` • ${s.durationMin} mins` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Device health */}
          <div className={`bg-white rounded-xl p-7 ${CARD_SHADOW}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-extrabold text-[#17362e] text-base flex items-center gap-2">
                <Icon name="developer_board" className="text-lg text-[#717975]" />
                Device Health
              </h3>
              <span className="text-[10px] font-bold text-[#717975] uppercase tracking-widest">
                {devices.filter(d => d.online).length}/{devices.length} online
              </span>
            </div>
            <div className="space-y-1">
              {devices.map(d => (
                <Link
                  key={d.label}
                  to={d.to}
                  className="flex items-center gap-3 px-3 py-2.5 -mx-3 rounded-lg hover:bg-[#f2f4f3] transition-colors group"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${d.online ? 'bg-emerald-500 shadow-[0_0_6px_rgba(5,150,105,0.5)]' : 'bg-[#c1c8c4]'}`} />
                  <span className="flex-1 text-sm font-bold text-[#17362e] truncate">{d.label}</span>
                  <span className={`text-[10px] font-extrabold uppercase tracking-widest ${d.online ? 'text-emerald-700' : 'text-[#717975]'}`}>
                    {d.online ? 'Online' : 'Offline'}
                  </span>
                  <Icon name="chevron_right" className="text-base text-[#c1c8c4] group-hover:text-[#717975] transition-colors" />
                </Link>
              ))}
            </div>
          </div>

          {/* Critical alerts */}
          <div className={`bg-white rounded-xl p-7 ${CARD_SHADOW}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-extrabold text-[#17362e] text-base flex items-center gap-2">
                <Icon name="warning_amber" className={`text-lg ${critical.length > 0 ? 'text-[#ba1a1a]' : 'text-[#717975]'}`} />
                Critical Alerts
              </h3>
              <Link to="/alerts" className="text-[10px] font-bold text-[#17362e] uppercase tracking-widest hover:underline">All</Link>
            </div>
            {critical.length === 0 && warnings.length === 0 ? (
              <div className="text-center py-4">
                <Icon name="check_circle" className="text-3xl text-emerald-500 mb-2" />
                <p className="text-xs text-[#717975]">All systems healthy</p>
              </div>
            ) : (
              <div className="space-y-3">
                {critical.map(a => <AlertRow key={a.id} alert={a} tone="error" />)}
                {warnings.map(a => <AlertRow key={a.id} alert={a} tone="warning" />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function VitalsTile({ label, value, unit = 'psi', icon, trendLabel, trendColor, badge, badgeLabel }) {
  return (
    <div className={`bg-white p-7 rounded-xl ${CARD_SHADOW} relative overflow-hidden group`}>
      <div className="absolute top-0 right-0 p-3 opacity-[0.07] group-hover:opacity-[0.13] transition-opacity pointer-events-none">
        <Icon name={icon} className="text-6xl text-[#17362e]" />
      </div>
      <div className="flex items-start justify-between mb-4 relative">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#717975]">{label}</p>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-5xl font-extrabold text-[#17362e] tracking-tighter leading-none">{value}</span>
        <span className="text-sm font-semibold text-[#c1c8c4]">{unit}</span>
      </div>
      <div className={`mt-4 flex items-center gap-2 ${trendColor}`}>
        {badge && badgeLabel ? (
          <span className="text-[10px] font-extrabold uppercase tracking-widest bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full">
            {badgeLabel}
          </span>
        ) : (
          <span className="text-xs font-bold">{trendLabel}</span>
        )}
      </div>
    </div>
  )
}

function ZoneCard({ zone, name, busy, lastRun, onToggle }) {
  const on = zone.on
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-label={on ? `Stop ${name}` : `Start ${name}`}
      className={`text-left bg-[#f2f4f3] rounded-xl p-4 relative overflow-hidden transition-all disabled:opacity-50 hover:shadow-md ${
        on ? 'ring-2 ring-[#17362e]/80 bg-white' : 'hover:bg-white'
      }`}
    >
      {/* Top bar */}
      <div className={`absolute top-0 left-0 w-full h-[3px] ${on ? 'bg-[#17362e]' : 'bg-[#c1c8c4]'}`} />

      <div className="flex justify-between items-start mb-3">
        <span className={`font-extrabold text-sm truncate ${on ? 'text-[#17362e]' : 'text-[#17362e]/80'}`}>
          {name}
        </span>
        <span className={`w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors ${on ? 'bg-emerald-500' : 'bg-[#c1c8c4]'}`}>
          <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
        </span>
      </div>
      <p className="text-[9px] text-[#717975] font-bold uppercase tracking-widest">Runtime</p>
      <p className={`font-extrabold text-xl tracking-tight leading-tight ${on ? 'text-emerald-700' : 'text-[#c1c8c4]'}`}>
        {on ? '—:—' : '--:--'}
      </p>
      <p className="text-[10px] text-[#717975] mt-1.5">Last run: {fmtLastRun(lastRun)}</p>
    </button>
  )
}

function AlertRow({ alert, tone }) {
  const isError = tone === 'error'
  return (
    <div className={`p-3.5 rounded-xl flex gap-3 items-start ${isError ? 'bg-red-50' : 'bg-orange-50'}`}>
      <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
        isError ? 'bg-[#ba1a1a] shadow-[0_0_6px_rgba(186,26,26,0.5)]' : 'bg-orange-500 shadow-[0_0_6px_rgba(234,88,12,0.5)]'
      }`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[#17362e] truncate">{alert.title ?? alert.kind ?? 'Alert'}</p>
        {(alert.message || alert.description) && (
          <p className="text-[11px] text-[#717975] mt-0.5 line-clamp-2">{alert.message ?? alert.description}</p>
        )}
        <span className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest ${
          isError ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'
        }`}>
          {isError ? 'Critical' : 'Warning'}
        </span>
      </div>
    </div>
  )
}

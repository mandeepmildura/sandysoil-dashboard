import { useState, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useZoneNames } from '../hooks/useZoneNames'
import { useScheduleRules } from '../hooks/useScheduleRules'
import { useAlerts } from '../hooks/useAlerts'
import { useAuth } from '../hooks/useAuth'
import { useMyDevice } from '../hooks/useMyDevice'
import { usePressureHistory } from '../hooks/usePressureHistory'
import { topicsForPrefix } from '../lib/topics'
import { zoneOn, zoneOff, allZonesOff, startBackwash } from '../lib/commands'
import { KCS_DEVICES } from '../config/devices'
import { supabase } from '../lib/supabase'
import { isAdmin } from '../lib/role'
import PressureChart from '../components/PressureChart'
import {
  fmtLastRun,
  upcomingSchedules,
  diffPsi as computeDiffPsi,
} from '../lib/dashboard'

const PRESSURE_TOPIC         = 'farm/filter1/pressure'
const BACKWASH_TOPIC         = 'farm/filter1/backwash/state'
const B16M_TOPIC             = 'B16M/CCBA97071FD8/STATE'
const A6V3_TOPIC             = 'A6v3/8CBFEA03002C/STATE'
const BACKWASH_THRESHOLD_PSI = 8   // must match filter-bridge BACKWASH_TRIGGER_PSI
const BACKWASH_SCALE_PSI     = 20  // bar max — threshold sits at 40% of scale

// Severity / state palette — matches v2 design system
const T = {
  ink:    '#0e1f1a',
  ink2:   '#3b4a44',
  ink3:   '#7a8580',
  green1: '#0d4d20',
  green2: '#1f7a37',
  green3: '#e8f3eb',
  warn:   '#c25700',
  warn2:  '#fdf2e6',
  danger: '#a8281e',
  danger2:'#fce8e6',
  line:   '#e4e9e6',
  surface:'#fafbfa',
}

function Icon({ name, className = '', style }) {
  return <span className={`material-symbols-outlined ${className}`} style={style}>{name}</span>
}

export default function Dashboard() {
  const { device: myDevice, mqttPrefix } = useMyDevice()
  const t = useMemo(() => topicsForPrefix(mqttPrefix), [mqttPrefix])
  const TOPICS = useMemo(
    () => [t.status, t.zoneStateWildcard, PRESSURE_TOPIC, BACKWASH_TOPIC, B16M_TOPIC, A6V3_TOPIC, t.simPressure],
    [t]
  )
  const { data, connected } = useLiveTelemetry(TOPICS)
  const { names } = useZoneNames()
  const { groupSchedules } = useScheduleRules()
  const { alerts } = useAlerts()
  const { session } = useAuth()
  const admin = isAdmin(session)
  const [busy, setBusy] = useState({})
  const [lastRuns, setLastRuns] = useState({})
  const [activeZones, setActiveZones] = useState([])
  const [, forceTick] = useState(0)
  const { data: pressureHistory } = usePressureHistory(24)

  // 1-second tick for live elapsed/remaining counters on running zones
  useEffect(() => {
    const id = setInterval(() => forceTick(x => x + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Track when zones turned on (for live elapsed counter)
  const onSinceRef = useRef({})

  async function handleZoneToggle(id, currentlyOn) {
    setBusy(b => ({ ...b, [id]: true }))
    try { currentlyOn ? await zoneOff(id, { prefix: mqttPrefix }) : await zoneOn(id, 30, 'manual', { prefix: mqttPrefix }) }
    catch (e) { console.error(e) }
    setBusy(b => ({ ...b, [id]: false }))
  }

  useEffect(() => {
    async function load() {
      const { data: rows } = await supabase
        .from('zone_history')
        .select('zone_num, ended_at')
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
    function fetchActive() {
      supabase
        .from('zone_history')
        .select('zone_num, device, started_at')
        .eq('device', 'irrigation1')
        .is('ended_at', null)
        .order('started_at')
        .then(({ data }) => setActiveZones(data ?? []))
    }
    fetchActive()
    const interval = setInterval(fetchActive, 30_000)
    return () => clearInterval(interval)
  }, [])

  const irr      = data[t.status]      ?? null
  const pressure = data[PRESSURE_TOPIC] ?? null
  const b16m     = data[B16M_TOPIC]    ?? null
  const a6v3     = data[A6V3_TOPIC]    ?? null
  const sim      = data[t.simPressure] ?? null

  // Per-zone state overlay (filtered to user's prefix to avoid wildcard cross-talk)
  const zoneStateRe = useMemo(
    () => new RegExp(`^${mqttPrefix.replace(/\//g, '\\/')}\\/zone\\/(\\d+)\\/state$`),
    [mqttPrefix]
  )
  const zoneOverrides = {}
  Object.entries(data).forEach(([topic, payload]) => {
    const m = topic.match(zoneStateRe)
    if (m) zoneOverrides[Number(m[1])] = payload
  })
  const baseZones = irr?.zones ?? Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}`, on: false, state: 'off' }))
  const zones = baseZones.map(z => zoneOverrides[z.id] ? { ...z, ...zoneOverrides[z.id] } : z)

  // Track zone "on since" for elapsed timer
  const now = Date.now()
  for (const z of zones) {
    if (z.on && !onSinceRef.current[z.id]) onSinceRef.current[z.id] = now
    if (!z.on && onSinceRef.current[z.id]) delete onSinceRef.current[z.id]
  }

  const supplyPsi   = sim?.supply_psi ?? irr?.supply_psi ?? null
  const activeCount = zones.filter(z => z.on).length
  const onlineNow   = irr?.online === true
  const upcoming    = useMemo(() => upcomingSchedules(groupSchedules, new Date()), [groupSchedules])
  const inletPsi    = pressure?.inlet_psi ?? null
  const outletPsi   = pressure?.outlet_psi ?? null
  const diffPsi     = computeDiffPsi(pressure)
  const diffPct     = (typeof diffPsi === 'number') ? Math.min(100, (diffPsi / BACKWASH_SCALE_PSI) * 100) : 0

  // ── Status banner state machine ──────────────────────────────
  // Priority: critical alerts > offline > running > healthy
  const criticalAlerts = (alerts ?? []).filter(a =>
    !a.acknowledged && (a.severity === 'fault' || a.severity === 'critical' || a.severity === 'error')
  )
  const warningAlerts = (alerts ?? []).filter(a => !a.acknowledged && a.severity === 'warning')

  let bannerState
  if (criticalAlerts.length > 0 || (irr && !onlineNow)) {
    bannerState = 'problem'
  } else if (activeCount > 0) {
    bannerState = 'running'
  } else if (warningAlerts.length > 0) {
    bannerState = 'warning'
  } else {
    bannerState = 'healthy'
  }

  const subtitleDate = new Date().toLocaleDateString('en-AU', {
    timeZone: 'Australia/Melbourne', weekday: 'long', day: 'numeric', month: 'short',
  })

  const adminDevices = admin ? KCS_DEVICES.map(d => ({
    label: d.name,
    online: d.id === 'a6v3' ? !!a6v3 : d.id === 'b16m' ? !!b16m : false,
    to:    d.path,
  })) : []

  return (
    <div className="flex-1 overflow-auto min-h-screen" style={{ background: T.surface, color: T.ink }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-5 lg:py-8">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: T.ink3 }}>{subtitleDate}</p>
            <h1 className="font-headline font-extrabold text-2xl sm:text-3xl lg:text-4xl tracking-tight mt-1" style={{ color: T.ink }}>
              Farm Overview
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full" style={{ background: connected ? T.green3 : T.line }}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'animate-pulse' : ''}`} style={{ background: connected ? T.green2 : T.ink3 }} />
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: connected ? T.green1 : T.ink3 }}>
                {connected ? 'Live' : 'Connecting…'}
              </span>
            </div>
            <button
              onClick={() => allZonesOff({ prefix: mqttPrefix }).catch(console.error)}
              disabled={activeCount === 0}
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full border text-[11px] sm:text-xs font-bold disabled:opacity-40 transition-opacity"
              style={{ borderColor: T.line, color: T.ink }}
            >
              All Zones Off
            </button>
          </div>
        </div>

        {/* ── Status banner ───────────────────────────────────── */}
        <StatusBanner
          state={bannerState}
          activeCount={activeCount}
          totalZones={zones.length}
          supplyPsi={supplyPsi}
          onlineNow={onlineNow}
          upcoming={upcoming}
          lastRunAt={Object.values(lastRuns)[0]}
          criticalAlerts={criticalAlerts}
          mqttPrefix={mqttPrefix}
          activeZones={zones.filter(z => z.on)}
          onSinceRef={onSinceRef}
        />

        {/* Running zones strip — DB-backed active zone list */}
        {activeZones.length > 0 && (
          <div style={{ background: '#f0f7f2', border: '1px solid #c8e0d0', borderRadius: 10, padding: '0.75rem 1rem', marginTop: '0.75rem' }}>
            {activeZones.map(z => {
              const elapsedMin = Math.round((Date.now() - new Date(z.started_at).getTime()) / 60_000)
              return (
                <div key={z.zone_num} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', color: '#1a3d28', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>Zone {z.zone_num}</span>
                  <span style={{ color: '#7a8580' }}>running · {elapsedMin} min</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Mobile-only: extra-prominent stop button when zones are running */}
        {activeCount > 0 && (
          <button
            onClick={() => allZonesOff({ prefix: mqttPrefix }).catch(console.error)}
            className="sm:hidden mt-3 w-full py-4 rounded-2xl text-white text-base font-extrabold tracking-wide shadow-lg active:scale-[0.99] transition-transform"
            style={{ background: T.danger, boxShadow: `0 10px 30px -10px ${T.danger}66` }}
            aria-label="Stop all zones"
          >
            Stop all zones
          </button>
        )}

        {/* ── Main grid ─────────────────────────────────────── */}
        <div className="grid grid-cols-12 gap-4 lg:gap-6 mt-5 lg:mt-7">

          {/* LEFT — zones grid + pressure trend */}
          <div className="col-span-12 lg:col-span-8 space-y-4 lg:space-y-6">

            {/* Zones grid */}
            <section className="bg-white rounded-2xl overflow-hidden border" style={{ borderColor: T.line }}>
              <header className="px-4 sm:px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: T.line }}>
                <div>
                  <h2 className="font-headline text-base lg:text-lg font-bold tracking-tight" style={{ color: T.ink }}>Zones</h2>
                  <p className="text-[11px]" style={{ color: T.ink3 }}>Tap a zone to start a 30-minute run</p>
                </div>
                <Link to="/zones" className="text-[11px] font-bold uppercase tracking-widest hover:underline" style={{ color: T.green1 }}>
                  Manage →
                </Link>
              </header>
              <div className="p-3 sm:p-5 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                {zones.map(z => (
                  <ZoneCard
                    key={z.id}
                    zone={z}
                    name={names[z.id] ?? z.name}
                    busy={!!busy[z.id]}
                    lastRun={lastRuns[z.id]}
                    onSinceMs={onSinceRef.current[z.id]}
                    isPump={myDevice?.pump_zone_num === z.id}
                    onToggle={() => handleZoneToggle(z.id, z.on)}
                  />
                ))}
              </div>
            </section>

            {/* Pressure trend */}
            <section className="bg-white rounded-2xl overflow-hidden border" style={{ borderColor: T.line }}>
              <header className="px-4 sm:px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: T.line }}>
                <div>
                  <h2 className="font-headline text-base lg:text-lg font-bold tracking-tight" style={{ color: T.ink }}>
                    Supply pressure · 24 h
                  </h2>
                  <p className="text-[11px]" style={{ color: T.ink3 }}>
                    {supplyPsi != null ? `Now ${supplyPsi} PSI` : 'No live reading'}
                  </p>
                </div>
                <Link to="/pressure" className="text-[11px] font-bold uppercase tracking-widest hover:underline" style={{ color: T.green1 }}>
                  Full →
                </Link>
              </header>
              <div className="p-4 sm:p-6">
                {pressureHistory.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-sm" style={{ color: T.ink3 }}>
                    No pressure data recorded yet.
                  </div>
                ) : (
                  <PressureChart
                    data={pressureHistory}
                    currentPsi={typeof supplyPsi === 'number' ? supplyPsi : null}
                    lowThreshold={15}
                  />
                )}
              </div>
            </section>
          </div>

          {/* RIGHT — sidebar */}
          <div className="col-span-12 lg:col-span-4 space-y-4 lg:space-y-6">

            <FilterCard inletPsi={inletPsi} outletPsi={outletPsi} diffPsi={diffPsi} diffPct={diffPct} />

            <UpcomingCard upcoming={upcoming} />

            {admin && adminDevices.length > 0 && (
              <DeviceHealthCard devices={[
                { label: 'SSA-V8 controller', online: onlineNow, sublabel: irr?.fw ? `v${irr.fw}` : null },
                ...adminDevices.map(d => ({ label: d.label, online: d.online, to: d.to })),
              ]} />
            )}

            <AlertsCard critical={criticalAlerts.slice(0, 2)} warnings={warningAlerts.slice(0, 2 - criticalAlerts.slice(0, 2).length)} />

          </div>
        </div>
      </div>
    </div>
  )
}

// ── Status banner ────────────────────────────────────────────────
function StatusBanner({ state, activeCount, totalZones, supplyPsi, onlineNow, upcoming, lastRunAt, criticalAlerts, activeZones, onSinceRef }) {
  const cfg = {
    healthy: {
      bg: `linear-gradient(135deg, ${T.green1} 0%, ${T.green2} 100%)`,
      icon: 'check_circle',
      eyebrow: 'System status',
      title: 'Everything healthy',
      sub: `${totalZones} zones idle${supplyPsi != null ? ` · Pressure ${supplyPsi} PSI` : ''}${onlineNow ? ' · Controller online' : ''}`,
    },
    running: {
      bg: `linear-gradient(135deg, ${T.green2} 0%, #3aa358 100%)`,
      icon: 'water_drop',
      eyebrow: 'Running now',
      title: `${activeCount} ${activeCount === 1 ? 'zone' : 'zones'} watering`,
      sub: `${supplyPsi != null ? `Pressure ${supplyPsi} PSI · ` : ''}Auto-stops at end of timer`,
    },
    warning: {
      bg: `linear-gradient(135deg, ${T.warn} 0%, #d96a1f 100%)`,
      icon: 'warning_amber',
      eyebrow: 'Attention needed',
      title: 'Warning',
      sub: 'Check active alerts below',
    },
    problem: {
      bg: `linear-gradient(135deg, ${T.danger} 0%, #c93a30 100%)`,
      icon: 'priority_high',
      eyebrow: 'System status',
      title: criticalAlerts && criticalAlerts.length > 0
        ? (criticalAlerts[0].title ?? 'Critical alert')
        : 'Controller offline',
      sub: criticalAlerts && criticalAlerts.length > 0
        ? (criticalAlerts[0].description ?? 'See alerts for details')
        : 'No data from controller — check Wi-Fi or power',
    },
  }[state]

  return (
    <div
      className="rounded-2xl p-5 sm:p-6 lg:p-7 text-white relative overflow-hidden"
      style={{ background: cfg.bg }}
    >
      <div className="absolute top-0 right-0 opacity-10 pointer-events-none">
        <Icon name={cfg.icon} style={{ fontSize: 180 }} />
      </div>
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">{cfg.eyebrow}</p>
        <p className="font-headline text-xl sm:text-2xl lg:text-3xl font-extrabold mt-1">{cfg.title}</p>
        <p className="text-sm text-white/85 mt-1.5">{cfg.sub}</p>

        {state === 'running' && activeZones && activeZones.length > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {activeZones.slice(0, 6).map(z => {
              const startMs = onSinceRef?.current?.[z.id]
              const elapsedSec = startMs ? Math.floor((Date.now() - startMs) / 1000) : null
              const min = elapsedSec != null ? Math.floor(elapsedSec / 60) : null
              const sec = elapsedSec != null ? elapsedSec % 60 : null
              return (
                <div key={z.id} className="px-3 py-2 rounded-lg bg-white/15 backdrop-blur-sm">
                  <p className="text-[10px] uppercase tracking-widest text-white/70">Zone {z.id}</p>
                  <p className="text-sm font-bold mt-0.5">
                    {min != null ? `${min}m ${String(sec).padStart(2, '0')}s` : '— —'}
                  </p>
                </div>
              )
            })}
          </div>
        )}

        {state === 'healthy' && (lastRunAt || upcoming.length > 0) && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:max-w-md">
            {lastRunAt && (
              <div className="px-3 py-2 rounded-lg bg-white/15 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-widest text-white/70">Last run</p>
                <p className="text-sm font-bold mt-0.5">{fmtLastRun(lastRunAt)}</p>
              </div>
            )}
            {upcoming.length > 0 && (
              <div className="px-3 py-2 rounded-lg bg-white/15 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-widest text-white/70">Next run</p>
                <p className="text-sm font-bold mt-0.5 truncate">{upcoming[0].time} · {upcoming[0].name}</p>
              </div>
            )}
          </div>
        )}

        {state === 'problem' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="mailto:mandeep@freshoz.com?subject=Controller%20offline"
              className="inline-block px-4 py-2.5 rounded-xl bg-white/20 backdrop-blur-sm text-white font-bold text-sm hover:bg-white/30 transition-colors"
            >
              Message support
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Zone card ────────────────────────────────────────────────────
function ZoneCard({ zone, name, busy, lastRun, onSinceMs, isPump, onToggle }) {
  const on = zone.on
  const elapsedSec = onSinceMs ? Math.floor((Date.now() - onSinceMs) / 1000) : null
  const min = elapsedSec != null ? Math.floor(elapsedSec / 60) : null
  const sec = elapsedSec != null ? elapsedSec % 60 : null

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-label={on ? `Stop ${name}` : `Start ${name}`}
      className="text-left p-3 sm:p-4 rounded-xl border transition-all disabled:opacity-50 active:scale-[0.99] min-h-[88px]"
      style={{
        background: on ? '#fff' : T.surface,
        borderColor: on ? T.green1 : T.line,
        borderWidth: on ? 2 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: T.ink3 }}>Zone {zone.id}</p>
          <p className="text-sm font-bold truncate" style={{ color: T.ink }}>
            {name}
            {isPump && (
              <span style={{ background: '#0d4d20', color: 'white', borderRadius: 4, padding: '1px 6px', fontSize: '0.6rem', fontWeight: 700, marginLeft: 4 }}>PUMP</span>
            )}
          </p>
        </div>
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${on ? 'animate-pulse' : ''}`}
          style={{ background: on ? T.green2 : T.line, boxShadow: on ? `0 0 8px ${T.green2}` : undefined }}
        />
      </div>
      {on ? (
        <p className="text-[11px] font-semibold" style={{ color: T.green1 }}>
          {min != null ? `Running · ${min}m ${String(sec).padStart(2, '0')}s` : 'Running'}
        </p>
      ) : (
        <p className="text-[11px]" style={{ color: T.ink3 }}>
          Last run · {fmtLastRun(lastRun)}
        </p>
      )}
    </button>
  )
}

// ── Filter card ──────────────────────────────────────────────────
function FilterCard({ inletPsi, outletPsi, diffPsi, diffPct }) {
  const tone = (typeof diffPsi === 'number' && diffPsi < 8) ? 'good' : diffPsi != null ? 'warn' : 'muted'
  const toneColor = tone === 'good' ? T.green2 : tone === 'warn' ? T.warn : T.ink3

  return (
    <section className="bg-white rounded-2xl p-5 border" style={{ borderColor: T.line }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: T.green3, color: T.green1 }}>
          <Icon name="filter_alt" style={{ fontSize: 20 }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-headline text-sm font-bold" style={{ color: T.ink }}>Filter station</h3>
          <p className="text-[10px]" style={{ color: T.ink3 }}>
            Inlet {inletPsi ?? '—'} · Outlet {outletPsi ?? '—'} PSI
          </p>
        </div>
        {diffPsi != null && (
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0"
            style={{ background: tone === 'good' ? T.green3 : T.warn2, color: toneColor }}
          >
            {tone === 'good' ? 'Clean' : 'Watch'}
          </span>
        )}
      </div>
      <div className="rounded-lg p-3 mb-3" style={{ background: T.surface }}>
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.ink3 }}>Differential</span>
          <span className="font-headline text-lg font-bold" style={{ color: toneColor }}>
            {diffPsi != null ? diffPsi : '—'} <span className="text-[11px] font-medium" style={{ color: T.ink3 }}>psi</span>
          </span>
        </div>
        <div className="w-full h-1.5 rounded-full" style={{ background: '#fff' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${diffPct}%`, background: toneColor }} />
        </div>
        <p className="text-[10px] mt-2" style={{ color: T.ink3 }}>Backwash threshold: {BACKWASH_THRESHOLD_PSI} psi</p>
      </div>
      <button
        onClick={() => startBackwash().catch(console.error)}
        className="w-full py-2.5 rounded-lg border text-sm font-semibold hover:bg-gray-50 transition-colors"
        style={{ borderColor: T.line, color: T.ink }}
      >
        Manual backwash
      </button>
    </section>
  )
}

// ── Upcoming card ────────────────────────────────────────────────
function UpcomingCard({ upcoming }) {
  return (
    <section className="bg-white rounded-2xl p-5 border" style={{ borderColor: T.line }}>
      <h3 className="font-headline text-sm font-bold mb-4 flex items-center justify-between" style={{ color: T.ink }}>
        Upcoming
        <Link to="/calendar" className="text-[10px] font-bold uppercase tracking-widest hover:underline" style={{ color: T.green1 }}>All</Link>
      </h3>
      {upcoming.length === 0 ? (
        <p className="text-xs" style={{ color: T.ink3 }}>No schedules configured yet.</p>
      ) : (
        <div className="space-y-3">
          {upcoming.map(s => (
            <div key={s.id} className="flex gap-3 items-center">
              <div className="w-11 shrink-0 py-1.5 rounded-lg flex flex-col items-center" style={{ background: T.surface }}>
                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: T.ink3 }}>{s.month}</span>
                <span className="font-headline text-base font-extrabold leading-none" style={{ color: T.ink }}>{s.day}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: T.ink }}>{s.name}</p>
                <p className="text-xs" style={{ color: T.ink3 }}>
                  {s.time || '—'}{s.durationMin ? ` · ${s.durationMin} min` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Device health card (admin only) ─────────────────────────────
function DeviceHealthCard({ devices }) {
  return (
    <section className="bg-white rounded-2xl p-5 border" style={{ borderColor: T.line }}>
      <h3 className="font-headline text-sm font-bold mb-4" style={{ color: T.ink }}>Device health</h3>
      <div className="space-y-2">
        {devices.map(d => {
          const Wrapper = d.to ? Link : 'div'
          return (
            <Wrapper
              key={d.label}
              {...(d.to ? { to: d.to } : {})}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
              style={{ background: T.surface }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.online ? T.green2 : T.line }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate" style={{ color: T.ink }}>{d.label}</p>
                {d.sublabel && <p className="text-[10px]" style={{ color: T.ink3 }}>{d.sublabel}</p>}
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: d.online ? T.green1 : T.ink3 }}>
                {d.online ? 'Online' : 'Offline'}
              </span>
            </Wrapper>
          )
        })}
      </div>
    </section>
  )
}

// ── Alerts card ──────────────────────────────────────────────────
function AlertsCard({ critical, warnings }) {
  const empty = critical.length === 0 && warnings.length === 0
  return (
    <section className="bg-white rounded-2xl p-5 border" style={{ borderColor: T.line }}>
      <h3 className="font-headline text-sm font-bold mb-4 flex items-center justify-between" style={{ color: T.ink }}>
        Active alerts
        <Link to="/alerts" className="text-[10px] font-bold uppercase tracking-widest hover:underline" style={{ color: T.green1 }}>All</Link>
      </h3>
      {empty ? (
        <div className="text-center py-3">
          <Icon name="check_circle" style={{ fontSize: 28, color: T.green2 }} />
          <p className="text-xs mt-1" style={{ color: T.ink3 }}>All systems healthy</p>
        </div>
      ) : (
        <div className="space-y-2">
          {critical.map(a => <AlertRow key={a.id} alert={a} tone="danger" />)}
          {warnings.map(a => <AlertRow key={a.id} alert={a} tone="warn" />)}
        </div>
      )}
    </section>
  )
}

function AlertRow({ alert, tone }) {
  const isDanger = tone === 'danger'
  return (
    <div
      className="p-3 rounded-xl flex gap-3 items-start"
      style={{ background: isDanger ? T.danger2 : T.warn2 }}
    >
      <span
        className="mt-1 w-2 h-2 rounded-full shrink-0"
        style={{ background: isDanger ? T.danger : T.warn }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold truncate" style={{ color: T.ink }}>
          {alert.title ?? alert.kind ?? 'Alert'}
        </p>
        {(alert.message || alert.description) && (
          <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: T.ink3 }}>
            {alert.message ?? alert.description}
          </p>
        )}
      </div>
    </div>
  )
}

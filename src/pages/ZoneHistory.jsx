import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'

const ZONES = [1, 2, 3, 4, 5, 6, 7, 8]
const ZONE_META = {
  1: 'North Block',
  2: 'South Block',
  3: 'Upper Orchard',
  4: 'Lower Orchard',
  5: 'East Rows',
  6: 'West Rows',
  7: 'Nursery',
  8: 'Fallow',
}
const TIME_MARKERS = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00']
const SOURCE_COLORS = {
  manual: { bar: 'from-[#17362e] to-[#2e4d44]', soft: 'bg-[#dce8e3]', badge: 'bg-[#c7eade] text-[#17362e]' },
  schedule: { bar: 'from-[#2e4d44] to-[#45655b]', soft: 'bg-[#d9e9ed]', badge: 'bg-[#cfe6f2] text-[#304047]' },
  program: { bar: 'from-[#5c3c1a] to-[#8a5e2c]', soft: 'bg-[#f1e2d0]', badge: 'bg-[#f4dfca] text-[#5c3c1a]' },
}

function Icon({ name, className = '' }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}

function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dy}`
}

function fmtDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yest = new Date(today)
  yest.setDate(yest.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function minutesFromMidnight(isoStr) {
  const d = new Date(isoStr)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

function timeStrToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

function fmtDur(min) {
  if (!min || min < 1) return '< 1 min'
  const rounded = Math.round(min)
  if (rounded < 60) return `${rounded} min`
  const h = Math.floor(rounded / 60)
  const r = rounded % 60
  return r > 0 ? `${h}h ${r}m` : `${h}h`
}

function fmtTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
}

function pct(numerator, denominator) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 100)
}

export default function ZoneHistory() {
  const [dateStr, setDateStr] = useState(toDateStr(new Date()))
  const dateInputRef = useRef(null)
  const [history, setHistory] = useState([])
  const [scheduled, setScheduled] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const load = useCallback(async (ds) => {
    setLoading(true)
    const dayStart = new Date(`${ds}T00:00:00`).toISOString()
    const dayEnd = new Date(`${ds}T23:59:59`).toISOString()
    const dow = new Date(`${ds}T00:00:00`).getDay()

    try {
      const { data: runs } = await supabase
        .from('zone_history')
        .select('id, zone_num, started_at, ended_at, duration_min, source')
        .gte('started_at', dayStart)
        .lte('started_at', dayEnd)
        .order('started_at', { ascending: true })
      if (runs) setHistory(runs)

      const { data: schedules } = await supabase
        .from('group_schedules')
        .select('group_id, label, start_time, days_of_week, enabled, zone_groups(name, run_mode)')

      const { data: members } = await supabase
        .from('zone_group_members')
        .select('group_id, zone_num, duration_min, sort_order')
        .order('sort_order')

      if (schedules && members) {
        const planned = []
        schedules
          .filter((s) => s.enabled !== false && s.days_of_week?.includes(dow))
          .forEach((s) => {
            const zoneMembers = members
              .filter((m) => m.group_id === s.group_id)
              .sort((a, b) => a.sort_order - b.sort_order)
            const runMode = s.zone_groups?.run_mode ?? 'sequential'
            const startMin = timeStrToMinutes(s.start_time)
            let offsetMin = 0

            zoneMembers.forEach((zm) => {
              planned.push({
                id: `sched-${s.group_id}-${zm.zone_num}-${offsetMin}`,
                group_id: s.group_id,
                zone_num: zm.zone_num,
                start_min: startMin + (runMode === 'sequential' ? offsetMin : 0),
                duration_min: zm.duration_min,
                label: s.zone_groups?.name ?? s.label ?? 'Program',
                start_time: s.start_time,
              })
              if (runMode === 'sequential') offsetMin += zm.duration_min
            })
          })
        setScheduled(planned)
      }
    } catch (e) {
      console.error(e)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    load(dateStr)
  }, [dateStr, load])

  const byZone = useMemo(() => {
    const groups = {}
    ZONES.forEach((z) => { groups[z] = [] })
    history.forEach((run) => { if (groups[run.zone_num]) groups[run.zone_num].push(run) })
    return groups
  }, [history])

  const scheduledByZone = useMemo(() => {
    const groups = {}
    ZONES.forEach((z) => { groups[z] = [] })
    scheduled.forEach((slot) => { if (groups[slot.zone_num]) groups[slot.zone_num].push(slot) })
    return groups
  }, [scheduled])

  const totalActualMins = history.reduce((sum, run) => {
    if (run.duration_min) return sum + Number(run.duration_min)
    if (run.started_at && run.ended_at) return sum + (new Date(run.ended_at) - new Date(run.started_at)) / 60000
    return sum
  }, 0)
  const totalScheduledMins = scheduled.reduce((sum, slot) => sum + Number(slot.duration_min || 0), 0)
  const activeRuns = history.filter((run) => !run.ended_at)
  const activeZoneCount = new Set(activeRuns.map((run) => run.zone_num)).size
  const zonesUsed = new Set(history.map((run) => run.zone_num)).size
  const manualRuns = history.filter((run) => (run.source ?? 'manual').toLowerCase() === 'manual').length
  const programRuns = history.filter((run) => (run.source ?? '').toLowerCase() === 'program').length
  const scheduleRuns = history.filter((run) => (run.source ?? '').toLowerCase() === 'schedule').length
  const completionRate = pct(history.length, scheduled.length || history.length || 1)
  const onPlanDelta = totalActualMins - totalScheduledMins
  const now = new Date()
  const isToday = dateStr === toDateStr(now)
  const nowLeft = `${((now.getHours() * 60 + now.getMinutes()) / 1440) * 100}%`

  const incidentLogs = useMemo(() => {
    const items = []
    activeRuns.forEach((run) => {
      items.push({
        id: `active-${run.id}`,
        tone: 'green',
        icon: 'water_drop',
        title: `Zone ${run.zone_num} currently running`,
        timestamp: fmtTime(run.started_at),
        description: `${ZONE_META[run.zone_num]} has an active cycle that started at ${fmtTime(run.started_at)}.`,
        actionPrimary: 'Monitor',
        actionSecondary: 'View run',
        payload: run,
      })
    })

    history.filter((run) => (run.source ?? '').toLowerCase() === 'manual').slice(-2).reverse().forEach((run) => {
      items.push({
        id: `manual-${run.id}`,
        tone: 'amber',
        icon: 'tune',
        title: `Manual intervention on Zone ${run.zone_num}`,
        timestamp: fmtTime(run.started_at),
        description: `${ZONE_META[run.zone_num]} was started manually for ${fmtDur(run.duration_min || 0)}.`,
        actionPrimary: 'Inspect',
        actionSecondary: 'Dismiss',
        payload: run,
      })
    })

    scheduled.filter((slot) => Number(slot.duration_min) >= 90).slice(0, 2).forEach((slot) => {
      items.push({
        id: `scheduled-${slot.id}`,
        tone: 'slate',
        icon: 'schedule',
        title: `Extended cycle scheduled for Zone ${slot.zone_num}`,
        timestamp: slot.start_time.slice(0, 5),
        description: `${slot.label} reserves ${fmtDur(slot.duration_min)} for ${ZONE_META[slot.zone_num]}.`,
        actionPrimary: 'Review',
        actionSecondary: 'Ignore',
        payload: slot,
      })
    })

    return items.slice(0, 4)
  }, [activeRuns, history, scheduled])

  const recentActivity = [...history].sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, 6)

  function prevDay() {
    const d = new Date(`${dateStr}T00:00:00`)
    d.setDate(d.getDate() - 1)
    setDateStr(toDateStr(d))
  }

  function nextDay() {
    const d = new Date(`${dateStr}T00:00:00`)
    d.setDate(d.getDate() + 1)
    setDateStr(toDateStr(d))
  }

  return (
    <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top_right,_rgba(126,193,254,0.18),_transparent_28%),linear-gradient(180deg,_#f6faf7_0%,_#eef4f0_100%)]">
      <div className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-8 xl:px-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.28em] text-[#45655b]">History And Schedule</p>
            <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[#17362e] md:text-4xl">Zone timeline and irrigation activity</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#4c616c]">
              Review actual runs, compare them against planned cycles, and spot manual interventions for {fmtDateLabel(dateStr).toLowerCase()}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-[1.5rem] border border-white/70 bg-white/80 p-2 shadow-[0_16px_40px_rgba(25,28,28,0.06)] backdrop-blur">
            <button onClick={prevDay} className="flex h-10 w-10 items-center justify-center rounded-xl text-[#17362e] transition-colors hover:bg-[#f2f4f3]">
              <Icon name="chevron_left" />
            </button>
            <button onClick={() => dateInputRef.current?.showPicker()} className="flex items-center gap-3 rounded-xl bg-[#f7faf8] px-4 py-2.5 text-left shadow-sm ring-1 ring-[#dce4df]">
              <Icon name="calendar_month" className="text-[#17362e]" />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#717975]">Selected Day</p>
                <p className="text-sm font-bold text-[#17362e]">{fmtDateLabel(dateStr)}</p>
              </div>
            </button>
            <input ref={dateInputRef} type="date" value={dateStr} onChange={(e) => e.target.value && setDateStr(e.target.value)} className="pointer-events-none absolute h-0 w-0 opacity-0" />
            <button onClick={nextDay} className="flex h-10 w-10 items-center justify-center rounded-xl text-[#17362e] transition-colors hover:bg-[#f2f4f3]">
              <Icon name="chevron_right" />
            </button>
          </div>
        </div>

        <section className="mb-8 grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-white/90 p-6 shadow-[0_18px_40px_rgba(25,28,28,0.06)] xl:col-span-2">
            <div className="absolute inset-y-0 right-0 w-56 bg-[radial-gradient(circle_at_center,_rgba(23,54,46,0.08),_transparent_68%)]" />
            <div className="relative">
              <p className="mb-4 text-[11px] font-black uppercase tracking-[0.24em] text-[#717975]">Daily Runtime Summary</p>
              <div className="flex flex-col gap-5 md:flex-row md:items-end md:gap-10">
                <div>
                  <p className="text-sm text-[#717975]">Actual irrigation</p>
                  <p className="font-headline text-4xl font-extrabold tracking-tight text-[#17362e]">{fmtDur(totalActualMins)}</p>
                </div>
                <div className="hidden h-14 w-px bg-[#dbe3de] md:block" />
                <div>
                  <p className="text-sm text-[#717975]">Planned runtime</p>
                  <p className="font-headline text-4xl font-extrabold tracking-tight text-[#2e4d44]">{fmtDur(totalScheduledMins)}</p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-full bg-[#e4f3e7] px-3 py-1 text-xs font-bold text-[#0d631b]">{zonesUsed} active zones</span>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${onPlanDelta <= 0 ? 'bg-[#edf7ef] text-[#0d631b]' : 'bg-[#ffede8] text-[#a24710]'}`}>
                  {onPlanDelta === 0 ? 'Exactly on plan' : `${onPlanDelta > 0 ? '+' : '-'}${fmtDur(Math.abs(onPlanDelta))} vs plan`}
                </span>
                <span className="rounded-full bg-[#ecf2f5] px-3 py-1 text-xs font-bold text-[#304047]">{history.length} recorded runs</span>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] bg-[#17362e] p-6 text-white shadow-[0_18px_44px_rgba(23,54,46,0.22)]">
            <p className="mb-4 text-[11px] font-black uppercase tracking-[0.24em] text-[#a4cabc]">Operational Snapshot</p>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-headline text-4xl font-extrabold">{activeZoneCount}</p>
                <p className="text-sm text-[#b9d2ca]">Zones currently running</p>
              </div>
              <Icon name="water_drop" className="text-5xl text-[#8fc5b4]" />
            </div>
            <div className="mt-8 space-y-3 border-t border-white/10 pt-5">
              <div className="flex items-center justify-between text-sm"><span className="text-[#b9d2ca]">Schedule coverage</span><span className="font-bold">{completionRate}%</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-[#b9d2ca]">Manual starts</span><span className="font-bold">{manualRuns}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-[#b9d2ca]">Program runs</span><span className="font-bold">{programRuns + scheduleRuns}</span></div>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-headline text-2xl font-extrabold tracking-tight text-[#17362e]">Zone timeline</h2>
              <p className="text-sm text-[#4c616c]">Historical runs and scheduled windows aligned on a single day view.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.16em]">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-2 text-[#17362e] ring-1 ring-[#dbe3de]"><span className="h-3 w-3 rounded-sm bg-[#dce8e3] ring-1 ring-[#9fb7af]" />Completed</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-2 text-[#45655b] ring-1 ring-[#dbe3de]"><span className="h-3 w-3 rounded-sm border border-dashed border-[#45655b] bg-[#d9e9ed]" />Planned</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-2 text-[#0d631b] ring-1 ring-[#dbe3de]"><span className="h-3 w-3 rounded-sm bg-[#0d631b]" />Active</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-white/60 bg-[#f7faf8] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_20px_40px_rgba(25,28,28,0.05)]">
            <div className="border-b border-[#dbe3de] bg-white/90">
              <div className="flex min-w-[980px]">
                <div className="w-44 shrink-0 border-r border-[#dbe3de] p-4">
                  <span className="text-[11px] font-black uppercase tracking-[0.22em] text-[#717975]">Zone</span>
                </div>
                <div className="flex-1 px-4 py-4">
                  <div className="grid grid-cols-7 text-[11px] font-black uppercase tracking-[0.2em] text-[#717975]">
                    {TIME_MARKERS.map((label) => <span key={label} className="text-center">{label}</span>)}
                  </div>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex h-64 items-center justify-center text-sm font-medium text-[#717975]">Loading timeline...</div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[980px]">
                  {ZONES.map((zoneNum) => {
                    const runs = byZone[zoneNum]
                    const plans = scheduledByZone[zoneNum]
                    const hasContent = runs.length > 0 || plans.length > 0

                    return (
                      <div key={zoneNum} className="flex border-b border-[#dbe3de]/80 last:border-b-0">
                        <div className="flex w-44 shrink-0 items-center gap-3 border-r border-[#dbe3de] bg-white/70 p-4">
                          <div className={`h-9 w-1.5 rounded-full ${hasContent ? 'bg-[#0d631b]' : 'bg-[#cdd7d2]'}`} />
                          <div>
                            <p className="text-sm font-extrabold text-[#17362e]">Zone {String(zoneNum).padStart(2, '0')}</p>
                            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#717975]">{ZONE_META[zoneNum]}</p>
                          </div>
                        </div>

                        <div className="relative flex-1 px-4 py-4">
                          <div className="absolute inset-y-0 left-4 right-4 grid grid-cols-6">
                            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="border-r border-[#dbe3de]/70" />)}
                          </div>

                          {isToday && (
                            <div className="absolute inset-y-0 z-20" style={{ left: `calc(${nowLeft} + 1rem)` }}>
                              <div className="relative h-full w-px bg-[#0d631b]/40">
                                <span className="absolute -left-5 top-2 rounded-full bg-[#0d631b] px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white">Now</span>
                              </div>
                            </div>
                          )}

                          <div className="relative h-14 rounded-2xl bg-white/45">
                            {plans.map((slot) => {
                              const left = Math.min((slot.start_min / 1440) * 100, 99)
                              const width = Math.max((slot.duration_min / 1440) * 100, 0.8)
                              return (
                                <button
                                  key={slot.id}
                                  onClick={() => setSelected({ ...slot, _type: 'schedule' })}
                                  className="absolute top-2 h-10 rounded-xl border border-dashed border-[#45655b] bg-[#d9e9ed]/70 px-3 text-left shadow-sm transition-transform hover:-translate-y-0.5"
                                  style={{ left: `${left}%`, width: `${width}%` }}
                                  title={`${slot.label} scheduled at ${slot.start_time.slice(0, 5)}`}
                                >
                                  <span className="block truncate text-[10px] font-black uppercase tracking-[0.14em] text-[#304047]">{fmtDur(slot.duration_min)} planned</span>
                                </button>
                              )
                            })}

                            {runs.map((run) => {
                              const startMin = minutesFromMidnight(run.started_at)
                              const durationMin = run.duration_min
                                ? Number(run.duration_min)
                                : run.ended_at
                                  ? (new Date(run.ended_at) - new Date(run.started_at)) / 60000
                                  : Math.max((Date.now() - new Date(run.started_at).getTime()) / 60000, 1)
                              const left = Math.min((startMin / 1440) * 100, 99)
                              const width = Math.max((durationMin / 1440) * 100, 0.8)
                              const source = (run.source ?? 'manual').toLowerCase()
                              const palette = SOURCE_COLORS[source] ?? SOURCE_COLORS.manual
                              const isRunning = !run.ended_at
                              return (
                                <button
                                  key={run.id}
                                  onClick={() => setSelected({ ...run, _type: 'run' })}
                                  className={`absolute top-2 z-10 h-10 rounded-xl bg-gradient-to-r ${palette.bar} px-3 text-left text-white shadow-lg transition-transform hover:-translate-y-0.5 ${isRunning ? 'ring-2 ring-[#9fd4bc]' : ''}`}
                                  style={{ left: `${left}%`, width: `${width}%` }}
                                  title={`Zone ${run.zone_num} ${fmtDur(durationMin)}`}
                                >
                                  <span className="block truncate text-[10px] font-black uppercase tracking-[0.14em]">{isRunning ? 'active running' : fmtDur(durationMin)}</span>
                                </button>
                              )
                            })}

                            {!hasContent && <div className="absolute inset-0 flex items-center px-4"><p className="text-xs font-medium italic text-[#95a09a]">No activity scheduled for this zone.</p></div>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-5 border-t border-[#dbe3de] bg-white/80 px-5 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-[#717975]">
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#17362e]" />Manual</span>
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#45655b]" />Scheduled Source</span>
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#8a5e2c]" />Program</span>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <div className="space-y-4 xl:col-span-3">
            <h3 className="font-headline text-lg font-extrabold uppercase tracking-[0.18em] text-[#17362e]">Recent incident logs</h3>
            {incidentLogs.length === 0 ? (
              <div className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 text-sm text-[#717975] shadow-[0_14px_36px_rgba(25,28,28,0.05)]">
                No anomalies or active cycles were detected for this day.
              </div>
            ) : incidentLogs.map((item) => {
              const toneStyles = {
                green: { border: 'border-[#0d631b]', icon: 'bg-[#e4f3e7] text-[#0d631b]', primary: 'bg-[#17362e] text-white' },
                amber: { border: 'border-[#d67b2a]', icon: 'bg-[#fff1e5] text-[#a24710]', primary: 'bg-[#a24710] text-white' },
                slate: { border: 'border-[#8aa2ad]', icon: 'bg-[#eef4f7] text-[#304047]', primary: 'bg-[#304047] text-white' },
              }[item.tone]

              return (
                <div key={item.id} className={`rounded-[1.75rem] border-l-4 ${toneStyles.border} bg-white/95 p-6 shadow-[0_14px_36px_rgba(25,28,28,0.05)]`}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start">
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${toneStyles.icon}`}>
                      <Icon name={item.icon} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <h4 className="text-base font-bold text-[#1a1c1c]">{item.title}</h4>
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#717975]">{item.timestamp}</span>
                      </div>
                      <p className="mt-2 text-sm text-[#4c616c]">{item.description}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button onClick={() => setSelected({ ...item.payload, _type: item.payload.started_at ? 'run' : 'schedule' })} className={`rounded-full px-4 py-2 text-xs font-bold ${toneStyles.primary}`}>
                          {item.actionPrimary}
                        </button>
                        <button className="rounded-full bg-[#eef2ef] px-4 py-2 text-xs font-bold text-[#4c616c]">{item.actionSecondary}</button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="space-y-4 xl:col-span-2">
            <h3 className="font-headline text-lg font-extrabold uppercase tracking-[0.18em] text-[#17362e]">Analysis summary</h3>

            <div className="rounded-[1.75rem] border border-white/70 bg-white/95 p-6 shadow-[0_16px_36px_rgba(25,28,28,0.05)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#717975]">Schedule adherence</p>
                  <p className="mt-2 font-headline text-4xl font-extrabold text-[#17362e]">{completionRate}%</p>
                </div>
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#0d631b] border-t-transparent" />
              </div>

              <div className="mt-6 space-y-4">
                <MetricRow label="Scheduled slots" value={`${history.length} / ${scheduled.length || history.length}`} fill={completionRate} />
                <MetricRow label="Manual interventions" value={`${manualRuns} runs`} fill={pct(manualRuns, history.length || 1)} tint="amber" />
                <MetricRow label="Program-led execution" value={`${programRuns + scheduleRuns} runs`} fill={pct(programRuns + scheduleRuns, history.length || 1)} tint="slate" />
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/70 bg-[#f7faf8] p-6 shadow-[0_16px_36px_rgba(25,28,28,0.05)]">
              <div className="mb-4 flex items-center justify-between">
                <h4 className="font-headline text-lg font-extrabold text-[#17362e]">Recent activity</h4>
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#717975]">{fmtDateLabel(dateStr)}</span>
              </div>
              {recentActivity.length === 0 ? (
                <p className="text-sm text-[#717975]">No recorded runs for this day.</p>
              ) : (
                <div className="space-y-3">
                  {recentActivity.map((run) => {
                    const source = (run.source ?? 'manual').toLowerCase()
                    const palette = SOURCE_COLORS[source] ?? SOURCE_COLORS.manual
                    const isRunning = !run.ended_at
                    const duration = run.duration_min
                      ? Number(run.duration_min)
                      : run.ended_at
                        ? (new Date(run.ended_at) - new Date(run.started_at)) / 60000
                        : Math.max((Date.now() - new Date(run.started_at).getTime()) / 60000, 1)

                    return (
                      <button key={run.id} onClick={() => setSelected({ ...run, _type: 'run' })} className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 text-left transition-colors hover:bg-[#eef2ef]">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${palette.soft}`}>
                            <Icon name={isRunning ? 'water_drop' : 'check_circle'} className={source === 'program' ? 'text-[#8a5e2c]' : source === 'schedule' ? 'text-[#45655b]' : 'text-[#17362e]'} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-[#17362e]">Zone {run.zone_num}</p>
                            <p className="text-xs text-[#717975]">{fmtTime(run.started_at)} · {isRunning ? 'Running' : fmtDur(duration)}</p>
                          </div>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${palette.badge}`}>{source}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-[0_24px_60px_rgba(25,28,28,0.2)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#717975]">{selected._type === 'schedule' ? 'Scheduled cycle' : 'Run detail'}</p>
                <h2 className="font-headline text-2xl font-extrabold text-[#17362e]">Zone {selected.zone_num}</h2>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-full bg-[#eef2ef] p-2 text-[#4c616c]">
                <Icon name="close" />
              </button>
            </div>

            <div className="space-y-3">
              {selected._type === 'schedule' ? (
                <>
                  <DetailRow label="Program" value={selected.label ?? 'Program'} />
                  <DetailRow label="Start time" value={selected.start_time?.slice(0, 5) ?? '—'} />
                  <DetailRow label="Duration" value={fmtDur(selected.duration_min)} />
                  <DetailRow label="Zone label" value={ZONE_META[selected.zone_num]} />
                </>
              ) : (
                <>
                  <DetailRow label="Started" value={fmtTime(selected.started_at)} />
                  <DetailRow label="Ended" value={selected.ended_at ? fmtTime(selected.ended_at) : 'Still running'} />
                  <DetailRow label="Duration" value={fmtDur(selected.duration_min || (selected.ended_at ? (new Date(selected.ended_at) - new Date(selected.started_at)) / 60000 : 0))} />
                  <DetailRow label="Source" value={selected.source ?? 'manual'} />
                  <DetailRow label="Zone label" value={ZONE_META[selected.zone_num]} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricRow({ label, value, fill, tint = 'green' }) {
  const barColor = { green: 'bg-[#0d631b]', amber: 'bg-[#a24710]', slate: 'bg-[#304047]' }[tint]
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-[#4c616c]">{label}</span>
        <span className="font-bold text-[#17362e]">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e6ece8]">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(fill, 100)}%` }} />
      </div>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-[#f4f7f5] px-4 py-3">
      <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#717975]">{label}</span>
      <span className="text-sm font-bold text-[#17362e] capitalize">{value}</span>
    </div>
  )
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const ZONES = [1, 2, 3, 4, 5, 6, 7, 8]

const TIME_LABELS = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '23:59']
const SOURCE_COLORS = {
  manual:   { bar: 'from-[#17362e] to-[#2e4d44]', badge: 'bg-[#c7eade] text-[#17362e]' },
  schedule: { bar: 'from-[#2e4d44] to-[#45655b]', badge: 'bg-[#cfe6f2] text-[#4c616c]' },
  program:  { bar: 'from-[#482823] to-[#623e38]', badge: 'bg-[#ffdad4] text-[#482823]' },
}

function Icon({ name, className = '' }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}

function toDateStr(d) {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dy}`
}

function fmtDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const yest  = new Date(today - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString())  return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function minutesFromMidnight(isoStr) {
  const d = new Date(isoStr)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

function fmtDur(min) {
  if (!min || min < 1) return '< 1 min'
  const m = Math.round(min)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return r > 0 ? `${h}h ${r}m` : `${h}h`
}

export default function ZoneHistory() {
  const [dateStr,  setDateStr]  = useState(toDateStr(new Date()))
  const dateInputRef = useRef(null)
  const [history,  setHistory]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null) // { zone_num, started_at, duration_min, source }

  const load = useCallback(async (ds) => {
    setLoading(true)
    const dayStart = new Date(ds + 'T00:00:00').toISOString()
    const dayEnd   = new Date(ds + 'T23:59:59').toISOString()
    try {
      const { data, error } = await supabase
        .from('zone_history')
        .select('id, zone_num, started_at, ended_at, duration_min, source')
        .gte('started_at', dayStart)
        .lte('started_at', dayEnd)
        .order('started_at', { ascending: true })
      if (!error && data) setHistory(data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load(dateStr) }, [dateStr, load])

  // Group history by zone
  const byZone = {}
  ZONES.forEach(z => { byZone[z] = [] })
  history.forEach(h => { if (byZone[h.zone_num]) byZone[h.zone_num].push(h) })

  // Stats
  const totalMins   = history.filter(h => h.duration_min).reduce((s, h) => s + Number(h.duration_min), 0)
  const activeZones = new Set(history.map(h => h.zone_num)).size
  const runCount    = history.length

  // Recent log entries (last 5, newest first)
  const recentLog = [...history].reverse().slice(0, 5)

  function prevDay() {
    const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() - 1); setDateStr(toDateStr(d))
  }
  function nextDay() {
    const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + 1)
    if (d <= new Date()) setDateStr(toDateStr(d))
  }
  const isToday = dateStr === toDateStr(new Date())

  return (
    <div className="flex-1 p-8 md:p-10 bg-[#f8faf9] overflow-auto">

      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-8">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-[#17362e]">Zone Activity History</h1>
          <p className="text-sm font-medium text-[#414845] mt-1">Irrigation run history across all zones.</p>
        </div>
        {/* Date nav */}
        <div className="flex items-center gap-2 bg-[#f2f4f3] p-2 rounded-2xl">
          <button onClick={prevDay} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-white transition-colors text-[#17362e]">
            <Icon name="chevron_left" />
          </button>
          <button
            onClick={() => dateInputRef.current?.showPicker()}
            className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl shadow-sm cursor-pointer"
          >
            <Icon name="calendar_month" className="text-sm text-[#17362e]" />
            <span className="text-xs font-bold text-[#17362e]">{fmtDateLabel(dateStr)}</span>
          </button>
          <input
            ref={dateInputRef}
            type="date"
            value={dateStr}
            onChange={e => e.target.value && setDateStr(e.target.value)}
            className="absolute opacity-0 pointer-events-none w-0 h-0"
          />
          <button onClick={nextDay}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-white transition-colors text-[#17362e]">
            <Icon name="chevron_right" />
          </button>
        </div>
      </div>

      {/* Gantt chart */}
      <div className="bg-[#f2f4f3] rounded-3xl p-6 md:p-8 shadow-sm mb-8">
        {loading ? (
          <div className="h-48 flex items-center justify-center text-sm text-[#717975]">Loading…</div>
        ) : (
          <div className="flex">
            {/* Zone labels */}
            <div className="w-20 shrink-0 flex flex-col pt-8 pr-4 gap-0">
              {ZONES.map(z => (
                <div key={z} className="h-8 flex items-center mb-4">
                  <span className="text-xs font-bold text-[#17362e]">Zone {z}</span>
                </div>
              ))}
            </div>

            {/* Chart area */}
            <div className="flex-1 min-w-0">
              {/* X-axis labels */}
              <div className="flex justify-between border-b border-[#c1c8c4]/30 pb-2 mb-2">
                {TIME_LABELS.map(t => (
                  <span key={t} className="text-[10px] font-bold text-[#717975] uppercase tracking-widest">{t}</span>
                ))}
              </div>

              {/* Zone rows */}
              <div className="space-y-4">
                {ZONES.map(z => (
                  <div key={z} className="h-8 w-full bg-[#eceeed]/50 rounded-full relative overflow-visible group">
                    {byZone[z].map(run => {
                      const startMin = minutesFromMidnight(run.started_at)
                      const durMin   = run.duration_min
                        ? Number(run.duration_min)
                        : run.ended_at
                          ? (new Date(run.ended_at) - new Date(run.started_at)) / 60000
                          : 30
                      const left  = Math.min((startMin / 1440) * 100, 99)
                      const width = Math.max((durMin / 1440) * 100, 0.5)
                      const colors = SOURCE_COLORS[(run.source ?? 'manual').toLowerCase()] ?? SOURCE_COLORS.manual
                      return (
                        <button
                          key={run.id}
                          onClick={() => setSelected(run)}
                          className={`absolute h-full rounded-full bg-gradient-to-r ${colors.bar} shadow-md hover:scale-y-125 hover:z-10 transition-transform`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`Zone ${z}: ${fmtDur(durMin)}`}
                        />
                      )
                    })}
                    {byZone[z].length === 0 && (
                      <div className="absolute inset-0 flex items-center pl-3">
                        <span className="text-[10px] text-[#c1c8c4] font-semibold">No runs</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">

        {/* KPI card */}
        <div className="bg-white p-8 rounded-[2rem] shadow-[0px_12px_32px_rgba(25,28,28,0.04)]">
          <div className="flex justify-between items-start mb-6">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#717975]">Daily Summary</span>
            <div className="bg-[#17362e] p-1.5 rounded-lg">
              <Icon name="bar_chart" className="text-[#accec2] text-sm" />
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-5xl font-extrabold tracking-tight text-[#17362e]">{fmtDur(totalMins)}</span>
            <span className="text-sm font-bold text-[#717975] block">Total run time</span>
          </div>
          <div className="mt-8 pt-6 border-t border-[#e1e3e2]/50 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-[#717975] font-medium">Zones used</span>
              <span className="font-bold text-[#17362e]">{activeZones} / 8</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#717975] font-medium">Total runs</span>
              <span className="font-bold text-[#17362e]">{runCount}</span>
            </div>
          </div>
        </div>

        {/* System log */}
        <div className="md:col-span-2 bg-[#f2f4f3] rounded-[2rem] p-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-[#17362e]">Run Log</h3>
            <span className="text-xs font-bold text-[#717975]">{fmtDateLabel(dateStr)}</span>
          </div>

          {loading ? (
            <p className="text-sm text-[#717975]">Loading…</p>
          ) : recentLog.length === 0 ? (
            <p className="text-sm text-[#717975] text-center py-6">No runs recorded for this day.</p>
          ) : (
            <div className="space-y-3">
              {recentLog.map(h => {
                const src    = (h.source ?? 'manual').toLowerCase()
                const colors = SOURCE_COLORS[src] ?? SOURCE_COLORS.manual
                const isOpen = !h.ended_at
                return (
                  <button
                    key={h.id}
                    onClick={() => setSelected(h)}
                    className="w-full flex items-center justify-between p-4 bg-white rounded-2xl hover:bg-[#eceeed] transition-colors text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${colors.bar} flex items-center justify-center`}>
                        <Icon name={isOpen ? 'water_drop' : 'check_circle'} className="text-white text-sm" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#17362e]">Zone {h.zone_num}</p>
                        <p className="text-xs text-[#717975]">
                          {new Date(h.started_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                          {h.duration_min ? ` · ${fmtDur(h.duration_min)}` : isOpen ? ' · Running' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${colors.badge}`}>{src}</span>
                      <Icon name="chevron_right" className="text-[#c1c8c4] text-sm" />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Run detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-3xl shadow-2xl p-7 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-headline font-extrabold text-lg text-[#17362e]">Zone {selected.zone_num} Run</h2>
              <button onClick={() => setSelected(null)} className="text-[#717975] hover:text-[#17362e]">
                <Icon name="close" />
              </button>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Started',  value: new Date(selected.started_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
                { label: 'Ended',    value: selected.ended_at ? new Date(selected.ended_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Still running' },
                { label: 'Duration', value: fmtDur(selected.duration_min) },
                { label: 'Source',   value: selected.source ?? 'manual' },
              ].map(r => (
                <div key={r.label} className="flex justify-between bg-[#f2f4f3] rounded-xl px-4 py-3">
                  <span className="text-xs font-semibold text-[#717975]">{r.label}</span>
                  <span className="text-xs font-bold text-[#17362e] capitalize">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

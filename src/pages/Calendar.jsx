import { useState } from 'react'
import StatusChip from '../components/StatusChip'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DATES = [17, 18, 19, 20, 21, 22, 23]

const EVENTS = [
  { day: 0, start: 6,  duration: 0.5, zone: 'Zone 1', color: '#0d631b' },
  { day: 0, start: 6.5,duration: 0.75,zone: 'Zone 2', color: '#2e7d32' },
  { day: 0, start: 7.5,duration: 1,   zone: 'Zone 3', color: '#0d631b' },
  { day: 1, start: 6,  duration: 0.5, zone: 'Zone 1', color: '#0d631b' },
  { day: 1, start: 6.5,duration: 0.75,zone: 'Zone 2', color: '#2e7d32' },
  { day: 2, start: 6,  duration: 1.5, zone: 'Zone 4', color: '#00639a' },
  { day: 2, start: 7.5,duration: 0.5, zone: 'Backwash',color: '#00639a' },
  { day: 3, start: 6,  duration: 0.5, zone: 'Zone 1', color: '#0d631b' },
  { day: 4, start: 6,  duration: 2,   zone: 'Zone 5', color: '#2e7d32' },
  { day: 5, start: 7,  duration: 1,   zone: 'Zone 6', color: '#0d631b' },
  { day: 6, start: 6,  duration: 0.5, zone: 'Zone 1', color: '#0d631b' },
]

const TODAY_SCHEDULE = [
  { time: '06:00', zone: 'Zone 1 — North Block', duration: '30 min', status: 'completed' },
  { time: '06:30', zone: 'Zone 2 — South Block', duration: '45 min', status: 'completed' },
  { time: '07:30', zone: 'Zone 3 — East Row',    duration: '60 min', status: 'running' },
  { time: '09:00', zone: 'Zone 6 — Orchard B',   duration: '60 min', status: 'upcoming' },
  { time: '10:30', zone: 'Backwash',              duration: '15 min', status: 'upcoming' },
]

const HOURS = Array.from({ length: 16 }, (_, i) => i + 5) // 5am–8pm

export default function Calendar() {
  const [view, setView] = useState('week')

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Irrigation Calendar</h1>
        <div className="flex items-center gap-2">
          {['week', 'day'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-body font-medium transition-colors capitalize ${
                view === v ? 'bg-[#0d631b] text-white' : 'text-[#40493d] hover:bg-[#f3f3f3]'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* Calendar grid */}
        <div className="col-span-3 bg-[#ffffff] rounded-xl shadow-card overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-8 border-b border-[#f3f3f3]">
            <div className="p-3 text-xs text-[#40493d] font-body" />
            {DAYS.map((d, i) => (
              <div key={d} className={`p-3 text-center ${i === 3 ? 'bg-[#0d631b]/5' : ''}`}>
                <p className="text-xs text-[#40493d] font-body">{d}</p>
                <p className={`text-lg font-headline font-bold ${i === 3 ? 'text-[#0d631b]' : 'text-[#1a1c1c]'}`}>{DATES[i]}</p>
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div className="overflow-y-auto max-h-96">
            {HOURS.map(hour => (
              <div key={hour} className="grid grid-cols-8 border-b border-[#f3f3f3]/50 min-h-[48px]">
                <div className="p-2 text-[10px] text-[#40493d] font-body text-right pr-3 pt-1">
                  {`${String(hour).padStart(2, '0')}:00`}
                </div>
                {DAYS.map((_, dayIdx) => {
                  const eventsInSlot = EVENTS.filter(e => e.day === dayIdx && Math.floor(e.start) === hour)
                  return (
                    <div key={dayIdx} className={`relative border-l border-[#f3f3f3]/50 p-1 ${dayIdx === 3 ? 'bg-[#0d631b]/[0.02]' : ''}`}>
                      {eventsInSlot.map((e, ei) => (
                        <div
                          key={ei}
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-body font-medium text-white mb-0.5 truncate"
                          style={{ backgroundColor: e.color, opacity: 0.9 }}
                        >
                          {e.zone}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Today's schedule */}
        <div className="space-y-4">
          <div className="bg-[#ffffff] rounded-xl shadow-card p-4 accent-green">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Today — Mon 20</h2>
            <div className="space-y-2">
              {TODAY_SCHEDULE.map((s, i) => (
                <div key={i} className={`rounded-lg p-3 ${s.status === 'running' ? 'bg-[#0d631b]/5' : s.status === 'completed' ? 'bg-[#f3f3f3]' : 'bg-[#f9f9f9]'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-body font-semibold text-[#1a1c1c]">{s.time}</span>
                    <StatusChip status={s.status} />
                  </div>
                  <p className="text-[11px] text-[#40493d]">{s.zone}</p>
                  <p className="text-[10px] text-[#40493d]">{s.duration}</p>
                </div>
              ))}
            </div>
          </div>

          <button className="w-full gradient-primary text-white font-body font-semibold text-sm py-3 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
            + Add Schedule
          </button>
          <button className="w-full bg-[#e2e2e2] text-[#1a1c1c] font-body font-semibold text-sm py-3 rounded-xl hover:bg-[#e8e8e8] transition-colors">
            Run Zone Now
          </button>
        </div>
      </div>
    </div>
  )
}

// src/components/DayTimeline.jsx

function toPercent(timeStr) {
  if (!timeStr) return 0
  const hhmm = timeStr.slice(0, 5)
  const [h, m] = hhmm.split(':').map(Number)
  return ((h * 60 + m) / 1440) * 100
}

function durationPercent(min) {
  return (min / 1440) * 100
}

export default function DayTimeline({ actual, programs, selectedDate }) {
  const dayOfWeek = new Date(selectedDate + 'T12:00:00').getDay()

  const scheduledPrograms = programs.filter(p =>
    p.schedule?.days_of_week?.includes(dayOfWeek) && p.schedule?.enabled
  )

  if (scheduledPrograms.length === 0 && actual.length === 0) {
    return (
      <div style={{ background: '#f8faf9', border: '1px solid #e4e9e6', borderRadius: 12, padding: '1rem', marginBottom: '1rem', fontSize: '0.75rem', color: '#7a8580', textAlign: 'center' }}>
        No irrigation scheduled for this day
      </div>
    )
  }

  return (
    <div style={{ background: '#f8faf9', border: '1px solid #e4e9e6', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: '#7a8580', marginBottom: 6, paddingLeft: 68 }}>
        {['12am','3am','6am','9am','12pm','3pm','6pm','9pm'].map(t => <span key={t}>{t}</span>)}
      </div>

      {scheduledPrograms.map(p => {
        const startPct = toPercent(p.schedule.start_time)
        const durPct   = durationPercent(p.duration_min ?? 30)

        const actualRuns = actual.filter(a => {
          const aStart = new Date(a.started_at)
          const pStart = new Date(`${selectedDate}T${p.schedule.start_time}`)
          return Math.abs(aStart.getTime() - pStart.getTime()) < 5 * 60_000
        })
        const hasActual = actualRuns.length > 0

        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#7a8580', width: 60, flexShrink: 0, textAlign: 'right' }}>
              {p.name.toUpperCase().slice(0, 8)}
            </span>
            <div style={{ flex: 1, background: '#e4e9e6', borderRadius: 3, height: 20, position: 'relative' }}>
              <div style={{ position: 'absolute', left: `${startPct}%`, width: `${durPct}%`, height: '100%', background: '#c8e0d0', borderRadius: 3, border: '1.5px dashed #2e7d32' }} />
              {hasActual && (
                <div style={{ position: 'absolute', left: `${startPct}%`, width: `${durPct}%`, height: '100%', background: '#2e7d32', borderRadius: 3, opacity: 0.85, display: 'flex', alignItems: 'center', paddingLeft: 6 }}>
                  <span style={{ fontSize: '0.55rem', color: 'white', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {p.schedule.start_time?.slice(0, 5)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 12, marginTop: '0.75rem', paddingTop: '0.6rem', borderTop: '1px solid #e4e9e6', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 10, background: '#2e7d32', borderRadius: 2 }} />
          <span style={{ fontSize: '0.65rem', color: '#5a756b' }}>Actual</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 10, background: '#c8e0d0', borderRadius: 2, border: '1.5px dashed #2e7d32' }} />
          <span style={{ fontSize: '0.65rem', color: '#5a756b' }}>Planned</span>
        </div>
      </div>
    </div>
  )
}

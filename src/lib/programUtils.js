// src/lib/programUtils.js

export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Returns true if schedules a and b overlap in time on any shared day.
 * @param {{ start_time: string, duration_min: number, days_of_week: number[] }} a
 * @param {{ start_time: string, duration_min: number, days_of_week: number[] }} b
 */
export function schedulesOverlap(a, b) {
  const sharedDay = a.days_of_week.some(d => b.days_of_week.includes(d))
  if (!sharedDay) return false
  const aStart = toMin(a.start_time), aEnd = aStart + a.duration_min
  const bStart = toMin(b.start_time), bEnd = bStart + b.duration_min
  return aStart < bEnd && bStart < aEnd
}

export function fmtDuration(min) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

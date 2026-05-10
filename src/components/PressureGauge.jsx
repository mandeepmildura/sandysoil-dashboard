import { gaugeColor } from '../lib/relayDevice'

/**
 * Shared semi-circular pressure gauge.
 *
 * Used by:
 *   - RelayDevice (A6v3) — full-size in the left panel
 *   - PressureAnalysis (customer Pressure page) — top of page
 *   - Zones page header (small, inline) — pass `size="sm"`
 */
export default function PressureGauge({ psi, maxPsi = 100, size = 'md' }) {
  const R = 70, cx = 90, cy = 90
  const startAngle = 210, totalArc = 240
  const clamped = Math.min(Math.max(psi ?? 0, 0), maxPsi)
  const fillArc = (clamped / maxPsi) * totalArc
  const color = gaugeColor(clamped, maxPsi)

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

  const widthCls = size === 'sm' ? 'w-[120px]' : size === 'lg' ? 'max-w-[280px] w-full' : 'max-w-[220px] w-full mx-auto'

  return (
    <svg viewBox="0 0 180 110" className={widthCls}>
      <path d={arcPath(startAngle, totalArc)} fill="none" stroke="#e2e2e2" strokeWidth="10" strokeLinecap="round" />
      {fillArc > 0 && (
        <path d={arcPath(startAngle, fillArc)} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      )}
      <text x={polar(startAngle, R+14)[0]} y={polar(startAngle, R+14)[1]} textAnchor="middle" fontSize="8" fill="#40493d">0</text>
      <text x={polar(-30, R+14)[0]} y={polar(-30, R+14)[1]} textAnchor="middle" fontSize="8" fill="#40493d">{maxPsi}</text>
      <text x={cx} y={cy-4} textAnchor="middle" fontSize="22" fontWeight="700" fill={color} fontFamily="sans-serif">
        {clamped.toFixed(1)}
      </text>
      <text x={cx} y={cy+12} textAnchor="middle" fontSize="10" fill="#40493d" fontFamily="sans-serif">PSI</text>
    </svg>
  )
}

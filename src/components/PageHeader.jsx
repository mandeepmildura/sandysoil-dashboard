/**
 * Consistent page header across Dashboard, Zones, Calendar, Alerts, Pressure, Devices.
 * Visual language matches the Pressure-page style:
 *   - Eyebrow label (uppercase, wide tracking, muted)
 *   - Big extrabold title in #17362e
 *   - Optional subtitle / live indicator / right-slot actions
 */
export default function PageHeader({ eyebrow, title, subtitle, connected, actions }) {
  return (
    <div className="flex justify-between items-end mb-8 gap-6">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#717975] mb-2">{eyebrow}</p>
        )}
        <h1 className="text-4xl font-extrabold text-[#17362e] tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[#717975] mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {connected !== undefined && (
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-[#c1c8c4]'}`} />
            <span className="text-xs font-semibold text-[#717975]">{connected ? 'Live' : 'Connecting…'}</span>
          </div>
        )}
        {actions}
      </div>
    </div>
  )
}

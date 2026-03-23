import StatusChip from './StatusChip'

export default function VitalsStrip({ vitals }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {vitals.map(({ label, value, unit, status, statusLabel }) => (
        <div key={label} className="bg-[#ffffff] rounded-xl shadow-card p-4">
          <p className="text-xs font-body text-[#40493d] uppercase tracking-data mb-1">{label}</p>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-headline font-bold text-[#1a1c1c] leading-none">{value}</span>
            <span className="text-sm text-[#40493d] mb-0.5">{unit}</span>
          </div>
          {status && (
            <div className="mt-2">
              <StatusChip status={status} label={statusLabel} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

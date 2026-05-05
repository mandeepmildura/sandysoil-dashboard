import { useEffect, useMemo, useState } from 'react'
import { useLmwBooking } from '../hooks/useLmwBooking'

/**
 * Book-water modal. Submits to the lmw-place-order edge function and
 * calls onPlaced({ receipt_no, est_ml }) when LMW returns a receipt.
 *
 * The estimated ML is computed client-side using the same formula the
 * edge function uses (hours × L/s × 3.6 / 1000) so the user sees the
 * draw before they commit.
 */
export default function BookWaterModal({ open, onClose, onPlaced, available_ml }) {
  const { placeOrder, submitting, error } = useLmwBooking()

  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('07:00')
  const [hours, setHours]         = useState(12)
  const [flowLps, setFlowLps]     = useState(15)
  const [shift, setShift]         = useState(1)

  // Default start date to tomorrow (LMW typically requires ≥ 1 h notice
  // and orders are usually scheduled the next day).
  useEffect(() => {
    if (open && !startDate) {
      const t = new Date(Date.now() + 24 * 3_600_000)
      setStartDate(t.toISOString().slice(0, 10))
    }
  }, [open, startDate])

  const estMl = useMemo(() => {
    const h = Number(hours) || 0
    const f = Number(flowLps) || 0
    return +(h * f * 3.6 / 1000).toFixed(3)
  }, [hours, flowLps])

  const overAllocation = available_ml != null && estMl > Number(available_ml)

  if (!open) return null

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      const start_at_local = `${startDate}T${startTime}:00`
      const result = await placeOrder({
        start_at_local,
        hours: Number(hours),
        flow_lps: Number(flowLps),
        shift_no: Number(shift),
      })
      onPlaced?.(result)
      onClose?.()
    } catch {
      // error state is rendered below
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-7"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-xl font-extrabold text-[#17362e]">Book water</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#717975] hover:text-[#17362e] text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-[#717975] mb-5">Times are in Australia/Melbourne.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input
                type="date"
                required
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10)}
                className="w-full border border-[#d8ddda] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#46a358]"
              />
            </Field>
            <Field label="Start time">
              <input
                type="time"
                required
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full border border-[#d8ddda] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#46a358]"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration (hours)">
              <input
                type="number"
                min="1" max="168" step="1" required
                value={hours}
                onChange={e => setHours(e.target.value)}
                className="w-full border border-[#d8ddda] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#46a358]"
              />
            </Field>
            <Field label="Flow rate (L/s)">
              <input
                type="number"
                min="1" max="200" step="1" required
                value={flowLps}
                onChange={e => setFlowLps(e.target.value)}
                className="w-full border border-[#d8ddda] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#46a358]"
              />
            </Field>
          </div>

          <Field label="Shift">
            <select
              value={shift}
              onChange={e => setShift(e.target.value)}
              className="w-full border border-[#d8ddda] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#46a358]"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </Field>

          <div className="flex items-center justify-between bg-[#f4f8f5] rounded-md px-4 py-3">
            <span className="text-xs uppercase tracking-widest font-bold text-[#717975]">Estimated draw</span>
            <span className={`text-lg font-extrabold tabular-nums ${overAllocation ? 'text-[#b91c1c]' : 'text-[#17362e]'}`}>
              {estMl.toFixed(3)} ML
            </span>
          </div>

          {overAllocation && (
            <p className="text-xs text-[#b91c1c]">
              Order exceeds available balance ({Number(available_ml).toFixed(3)} ML).
            </p>
          )}

          {error && (
            <p className="text-sm text-[#b91c1c] bg-[#fdecec] rounded-md px-3 py-2">
              {error.message || String(error)}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 rounded-md border border-[#d8ddda] text-sm font-bold text-[#40493d] hover:bg-[#f4f8f5] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || overAllocation}
              className="flex-1 px-4 py-2.5 rounded-md bg-gradient-to-r from-[#0d631b] to-[#46a358] text-white text-sm font-bold disabled:opacity-50"
            >
              {submitting ? 'Placing…' : 'Place order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-widest font-bold text-[#717975] mb-1">{label}</span>
      {children}
    </label>
  )
}

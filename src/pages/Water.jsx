import { useMemo, useState } from 'react'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import BookWaterModal from '../components/BookWaterModal'
import { useLmwAllocation } from '../hooks/useLmwAllocation'
import { useLmwOrders } from '../hooks/useLmwOrders'
import { useLmwMeterReadings } from '../hooks/useLmwMeterReadings'

const TZ = 'Australia/Melbourne'

const fmtMl = (v) => v == null ? '—' : `${Number(v).toFixed(3)} ML`
const fmtDate = (iso) => new Date(iso).toLocaleString('en-AU', {
  timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false,
})
const fmtDateOnly = (s) => new Date(s).toLocaleDateString('en-AU', { timeZone: TZ })

/**
 * Water page — Lower Murray Water account at a glance.
 *
 * Phase 1 is read-only: shows allocation, season usage, and upcoming
 * orders fetched by the lmw-sync edge function. Future phases will add
 * "Book missing windows" CTAs and direct order management here.
 */
export default function Water() {
  const { allocation, loading: allocLoading, reload: reloadAllocation } = useLmwAllocation()
  const { orders, loading: ordersLoading, reload: reloadOrders } = useLmwOrders()
  const { readings, loading: readingsLoading, totalAct, totalEst } = useLmwMeterReadings({ days: 365 })
  const [bookOpen, setBookOpen] = useState(false)

  const lastSync = allocation?.snapshot_at
  const period1Pct = useMemo(() => {
    if (!allocation?.period1_limit_ml) return 0
    return Math.min(100, (Number(allocation.period1_used_ml ?? 0) / Number(allocation.period1_limit_ml)) * 100)
  }, [allocation])

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          eyebrow="Lower Murray Water"
          title="Water"
          subtitle={lastSync ? `Last synced ${fmtDate(lastSync)}` : 'Awaiting first sync'}
        />
        <button
          type="button"
          onClick={() => setBookOpen(true)}
          className="px-4 py-2.5 rounded-md bg-gradient-to-r from-[#0d631b] to-[#46a358] text-white text-sm font-bold shadow-sm hover:opacity-90"
        >
          Book water
        </button>
      </div>

      <BookWaterModal
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        onPlaced={() => { reloadOrders(); reloadAllocation() }}
        available_ml={allocation?.available_ml}
      />

      {/* ── Allocation ─────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <Stat label="ABA Balance"   value={fmtMl(allocation?.aba_balance_ml)}  loading={allocLoading} accent="green" />
        <Stat label="Available"     value={fmtMl(allocation?.available_ml)}    loading={allocLoading} />
        <Stat label="Tradable"      value={fmtMl(allocation?.tradable_ml)}     loading={allocLoading} />
      </section>

      {/* ── Periods ────────────────────────────────────────── */}
      {allocation && (allocation.period1_limit_ml || allocation.period2_limit_ml) && (
        <Card className="mb-8">
          <h2 className="text-sm uppercase tracking-widest font-bold text-[#717975] mb-4">Outlet Delivery Share</h2>
          <PeriodBar
            label={`Period 1 — ends ${allocation.period1_end ? fmtDateOnly(allocation.period1_end) : '—'}`}
            used={allocation.period1_used_ml}
            limit={allocation.period1_limit_ml}
          />
          <PeriodBar
            label={`Period 2 — ends ${allocation.period2_end ? fmtDateOnly(allocation.period2_end) : '—'}`}
            used={allocation.period2_used_ml}
            limit={allocation.period2_limit_ml}
            className="mt-3"
          />
        </Card>
      )}

      {/* ── Season usage ───────────────────────────────────── */}
      <Card className="mb-8">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-sm uppercase tracking-widest font-bold text-[#717975]">Season usage to date</h2>
          {!readingsLoading && totalEst > 0 && (
            <span className="text-xs text-[#717975]">
              {((totalAct / totalEst) * 100).toFixed(0)}% of estimate
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-[#717975] mb-1">Actual</p>
            <p className="text-3xl font-extrabold text-[#17362e]">{totalAct.toFixed(2)} <span className="text-base font-normal text-[#717975]">ML</span></p>
          </div>
          <div>
            <p className="text-xs text-[#717975] mb-1">Estimate (orders)</p>
            <p className="text-3xl font-extrabold text-[#717975]">{totalEst.toFixed(2)} <span className="text-base font-normal text-[#717975]">ML</span></p>
          </div>
        </div>
      </Card>

      {/* ── Upcoming orders ────────────────────────────────── */}
      <Card>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm uppercase tracking-widest font-bold text-[#717975]">Upcoming orders</h2>
          {!ordersLoading && <span className="text-xs text-[#717975]">{orders.length} order{orders.length === 1 ? '' : 's'}</span>}
        </div>
        {ordersLoading ? (
          <p className="text-sm text-[#717975]">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-[#717975]">No upcoming orders. Run a sync or place orders at Lower Murray Water.</p>
        ) : (
          <div className="overflow-x-auto -mx-7 -mb-7">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-[#717975] border-b border-[#e6ebe8]">
                  <th className="px-7 py-3 font-bold">Start</th>
                  <th className="px-3 py-3 font-bold">End</th>
                  <th className="px-3 py-3 font-bold text-right">Hours</th>
                  <th className="px-3 py-3 font-bold text-right">L/s</th>
                  <th className="px-3 py-3 font-bold text-right">ML</th>
                  <th className="px-7 py-3 font-bold">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b border-[#f1f4f2] last:border-0">
                    <td className="px-7 py-3 font-medium text-[#17362e]">{fmtDate(o.start_at)}</td>
                    <td className="px-3 py-3 text-[#40493d]">{fmtDate(o.end_at)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{Number(o.hours).toFixed(0)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{o.flow_lps}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{Number(o.est_ml ?? 0).toFixed(3)}</td>
                    <td className="px-7 py-3 font-mono text-xs text-[#717975]">{o.receipt_no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value, loading, accent }) {
  return (
    <Card accent={accent}>
      <p className="text-xs uppercase tracking-widest font-bold text-[#717975] mb-1">{label}</p>
      <p className="text-3xl font-extrabold text-[#17362e]">
        {loading ? <span className="text-[#c1c8c4]">…</span> : value}
      </p>
    </Card>
  )
}

function PeriodBar({ label, used, limit, className = '' }) {
  const u = Number(used ?? 0)
  const l = Number(limit ?? 0)
  const pct = l > 0 ? Math.min(100, (u / l) * 100) : 0
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-1.5 text-sm">
        <span className="font-medium text-[#17362e]">{label}</span>
        <span className="text-[#40493d] tabular-nums">{u.toFixed(3)} / {l.toFixed(3)} ML</span>
      </div>
      <div className="h-2 bg-[#eef3f0] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#0d631b] to-[#46a358] rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Sandy Soil Automations — LMW Sync (Phase 1.5: read-only + status reconcile)
 * Supabase Edge Function — invoked every 30 min via pg_cron
 *
 * What it does (per enabled lmw_credentials row):
 *   1. Log in to Lower Murray Water
 *   2. Fetch Assessment.asp     → upsert lmw_allocation snapshot
 *   3. Fetch OrderHistory.asp   → upsert lmw_orders for this season
 *      Then fetch SRWA_OrderWater.asp → reconcile statuses:
 *        - end_at < now  → completed
 *        - end_at >= now and receipt missing from Current Orders → cancelled
 *   4. Fetch MeterReadings.asp  → upsert lmw_meter_readings
 *   5. Update last_login on the credentials row
 *
 * Failures are logged to lmw_booking_log so we can debug without re-running.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { lmwLogin, lmwGet } from './lib/lmw-client.ts'
import {
  parseAssessment,
  parseOrderHistory,
  parseMeterReadings,
  parseCurrentOrderReceipts,
} from './lib/parsers.ts'

export const CRON_EXPR = '*/30 * * * *'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TIMEZONE             = Deno.env.get('TIMEZONE') ?? 'Australia/Melbourne'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

type CredRow = {
  id: string
  user_id: string
  outlet_no: string
  pin: string
}

Deno.serve(async (req) => {
  try {
    let onlyUserId: string | null = null
    try {
      const body = await req.json()
      onlyUserId = body?.user_id ?? null
    } catch { /* empty body is fine */ }

    const credsQuery = supabase
      .from('lmw_credentials')
      .select('id, user_id, outlet_no, pin')
      .eq('enabled', true)
    if (onlyUserId) credsQuery.eq('user_id', onlyUserId)

    const { data: creds, error: credsErr } = await credsQuery
    if (credsErr) throw credsErr

    const results: Array<Record<string, unknown>> = []
    for (const cred of (creds ?? []) as CredRow[]) {
      results.push(await syncOne(cred))
    }

    return new Response(
      JSON.stringify({ ok: true, count: results.length, results }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[lmw-sync] error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

async function syncOne(cred: CredRow): Promise<Record<string, unknown>> {
  const { user_id, outlet_no } = cred
  const result: Record<string, unknown> = { outlet_no, user_id }

  try {
    const session = await lmwLogin(outlet_no, cred.pin)

    // Allocation
    try {
      const html = await lmwGet(session, '/Assessment.asp')
      const alloc = parseAssessment(html)
      const { error } = await supabase.from('lmw_allocation').insert({
        user_id, outlet_no, ...alloc,
      })
      if (error) throw error
      result.allocation = 'ok'
    } catch (e) {
      result.allocation = `error: ${String(e).slice(0, 200)}`
      await logFailure(user_id, outlet_no, 'sync', `allocation: ${e}`)
    }

    // Orders
    try {
      const html = await lmwGet(session, '/OrderHistory.asp')
      const orders = parseOrderHistory(html)
      result.orders_parsed = orders.length
      let upserted = 0
      for (const o of orders) {
        const startUtc = melbourneToUtc(o.start_at)
        const endUtc   = new Date(new Date(startUtc).getTime() + o.hours * 3_600_000).toISOString()
        const { error } = await supabase.from('lmw_orders').upsert({
          user_id, outlet_no,
          receipt_no: o.receipt_no,
          start_at:   startUtc,
          end_at:     endUtc,
          hours:      o.hours,
          flow_lps:   o.flow_lps,
          shift_no:   o.shift_no,
          est_ml:     o.est_ml,
          source:     'lmw',
          synced_at:  new Date().toISOString(),
        }, { onConflict: 'outlet_no,receipt_no' })
        if (!error) upserted++
      }
      result.orders_upserted = upserted

      // Reconcile statuses by reading the "Current orders" table on Place An Order
      const orderPageHtml = await lmwGet(session, '/SRWA_OrderWater.asp')
      const activeReceipts = parseCurrentOrderReceipts(orderPageHtml)
      result.active_receipts_seen = activeReceipts.size

      const nowIso = new Date().toISOString()

      // a) Anything fully in the past becomes 'completed' (regardless of source)
      const { error: completedErr, count: completedCount } = await supabase
        .from('lmw_orders')
        .update({ status: 'completed', synced_at: nowIso }, { count: 'exact' })
        .eq('outlet_no', outlet_no)
        .lt('end_at', nowIso)
        .neq('status', 'completed')
      if (completedErr) throw completedErr
      result.orders_marked_completed = completedCount ?? 0

      // b) Future/in-progress orders not in active set → cancelled
      //    Only run if we actually saw active receipts (empty set could mean parser miss)
      if (activeReceipts.size > 0) {
        const { data: futureOrders } = await supabase
          .from('lmw_orders')
          .select('id, receipt_no')
          .eq('outlet_no', outlet_no)
          .gte('end_at', nowIso)
          .neq('status', 'cancelled')
        const stale = (futureOrders ?? []).filter(o => !activeReceipts.has(o.receipt_no))
        if (stale.length > 0) {
          const { error: cancelErr } = await supabase
            .from('lmw_orders')
            .update({ status: 'cancelled', synced_at: nowIso })
            .in('id', stale.map(o => o.id))
          if (cancelErr) throw cancelErr
        }
        result.orders_marked_cancelled = stale.length
      } else {
        result.orders_marked_cancelled = 'skipped (empty active set)'
      }
    } catch (e) {
      result.orders = `error: ${String(e).slice(0, 200)}`
      await logFailure(user_id, outlet_no, 'sync', `orders: ${e}`)
    }

    // Meter readings
    try {
      const html = await lmwGet(session, '/MeterReadings.asp')
      const readings = parseMeterReadings(html)
      result.readings_parsed = readings.length
      let upserted = 0
      for (const r of readings) {
        const { error } = await supabase.from('lmw_meter_readings').upsert({
          user_id, outlet_no,
          reading_date:  r.reading_date,
          meter_reading: r.meter_reading,
          act_usage_ml:  r.act_usage_ml,
          est_usage_ml:  r.est_usage_ml,
          synced_at:     new Date().toISOString(),
        }, { onConflict: 'outlet_no,reading_date' })
        if (!error) upserted++
      }
      result.readings_upserted = upserted
    } catch (e) {
      result.readings = `error: ${String(e).slice(0, 200)}`
      await logFailure(user_id, outlet_no, 'sync', `readings: ${e}`)
    }

    await supabase.from('lmw_credentials').update({
      last_login: new Date().toISOString(),
      last_error: null,
    }).eq('id', cred.id)

    result.ok = true
  } catch (e) {
    result.ok = false
    result.error = String(e).slice(0, 300)
    await supabase.from('lmw_credentials').update({
      last_error: String(e).slice(0, 500),
    }).eq('id', cred.id)
    await logFailure(user_id, outlet_no, 'login_failed', String(e))
  }

  return result
}

async function logFailure(user_id: string, outlet_no: string, action: string, message: string) {
  await supabase.from('lmw_booking_log').insert({
    user_id, outlet_no, action, ok: false, message: message.slice(0, 1000),
  })
}

function melbourneToUtc(localIso: string): string {
  const m = localIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return new Date(localIso).toISOString()
  const [, y, mo, d, h, mi, s] = m
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  const tzOffsetMs = getTimezoneOffsetMs(new Date(asUtc), TIMEZONE)
  return new Date(asUtc - tzOffsetMs).toISOString()
}

function getTimezoneOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(dtf.formatToParts(date).map(p => [p.type, p.value]))
  const tzAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return tzAsUtc - date.getTime()
}

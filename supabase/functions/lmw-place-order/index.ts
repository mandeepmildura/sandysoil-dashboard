/**
 * Sandy Soil Automations — LMW Place Order
 * Supabase Edge Function — invoked from the dashboard "Book water" form.
 *
 * Flow:
 *   1. Verify the caller's JWT and resolve their lmw_credentials row
 *   2. Log in to Lower Murray Water
 *   3. GET /SRWA_OrderWater.asp to harvest the form (action URL + hidden
 *      inputs like ASP session state) so the POST mirrors a real browser
 *   4. POST the order with user-supplied start_at / hours / flow_lps / shift
 *   5. Parse the response for the new receipt number
 *   6. Insert into lmw_orders with source='dashboard' and log the attempt
 *
 * Request body (JSON):
 *   {
 *     "start_at_local": "2026-05-10T07:00:00",   // Australia/Melbourne local time
 *     "hours":          12,
 *     "flow_lps":       15,
 *     "shift_no":       1                          // optional, defaults to 1
 *   }
 *
 * Response (JSON):
 *   { "ok": true,  "receipt_no": "1234567", "order_id": "<uuid>", "est_ml": 0.648 }
 *   { "ok": false, "error": "<message>" }
 *
 * Failures always write a row to lmw_booking_log so we can audit / debug.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { lmwLogin, lmwGet, lmwPost } from './lmw-client.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TIMEZONE             = Deno.env.get('TIMEZONE') ?? 'Australia/Melbourne'

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Body = {
  start_at_local?: string
  hours?: number
  flow_lps?: number
  shift_no?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // ── Auth ────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'Missing Authorization header' }, 401)

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ ok: false, error: 'Invalid session' }, 401)

    // ── Validate body ───────────────────────────────────────
    const body: Body = await req.json().catch(() => ({}))
    const { start_at_local, hours, flow_lps } = body
    const shift_no = body.shift_no ?? 1

    const validation = validateBooking({ start_at_local, hours, flow_lps, shift_no })
    if (validation) return json({ ok: false, error: validation }, 400)

    // ── Look up the user's LMW credentials (service role bypasses RLS) ──
    const { data: cred, error: credErr } = await admin
      .from('lmw_credentials')
      .select('id, outlet_no, pin, enabled')
      .eq('user_id', user.id)
      .eq('enabled', true)
      .maybeSingle()
    if (credErr) throw credErr
    if (!cred) return json({ ok: false, error: 'No LMW credentials configured for this account' }, 400)

    // ── Optional sanity check: enough water available ───────
    const startUtcIso = melbourneToUtc(start_at_local!)
    const endUtcIso   = new Date(new Date(startUtcIso).getTime() + (hours! * 3_600_000)).toISOString()
    const estMl       = +(hours! * flow_lps! * 3.6 / 1000).toFixed(3)

    const { data: alloc } = await admin
      .from('lmw_allocation')
      .select('available_ml, snapshot_at')
      .eq('user_id', user.id)
      .eq('outlet_no', cred.outlet_no)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (alloc && Number(alloc.available_ml ?? 0) < estMl) {
      return json({
        ok: false,
        error: `Insufficient water: order needs ${estMl} ML, available ${alloc.available_ml} ML`,
      }, 400)
    }

    // ── Place the order on LMW ──────────────────────────────
    const result = await placeOrder({
      outlet_no: cred.outlet_no,
      pin:       cred.pin,
      start_at_local: start_at_local!,
      hours:     hours!,
      flow_lps:  flow_lps!,
      shift_no,
    })

    if (!result.ok) {
      await logAttempt({
        user_id: user.id, outlet_no: cred.outlet_no, action: 'place', ok: false,
        start_at: startUtcIso, hours, flow_lps,
        message: result.error, raw_response: result.raw_response,
      })
      return json({ ok: false, error: result.error }, 502)
    }

    // ── Insert into lmw_orders ──────────────────────────────
    const { data: inserted, error: insErr } = await admin
      .from('lmw_orders')
      .insert({
        user_id:    user.id,
        outlet_no:  cred.outlet_no,
        receipt_no: result.receipt_no,
        start_at:   startUtcIso,
        end_at:     endUtcIso,
        hours:      hours!,
        flow_lps:   flow_lps!,
        shift_no,
        est_ml:     estMl,
        status:     'active',
        source:     'dashboard',
      })
      .select('id')
      .single()
    if (insErr) {
      // Order placed at LMW but local insert failed; the next sync will pick it up.
      await logAttempt({
        user_id: user.id, outlet_no: cred.outlet_no, action: 'place', ok: true,
        receipt_no: result.receipt_no, start_at: startUtcIso, hours, flow_lps,
        message: `placed at LMW; local insert failed: ${insErr.message}`,
      })
      return json({ ok: true, receipt_no: result.receipt_no, est_ml: estMl, warning: 'Local insert failed; will reconcile on next sync.' })
    }

    await logAttempt({
      user_id: user.id, outlet_no: cred.outlet_no, action: 'place', ok: true,
      receipt_no: result.receipt_no, start_at: startUtcIso, hours, flow_lps,
      message: `placed via dashboard, est ${estMl} ML`,
    })

    return json({ ok: true, receipt_no: result.receipt_no, order_id: inserted.id, est_ml: estMl })
  } catch (err) {
    console.error('[lmw-place-order]', err)
    return json({ ok: false, error: String(err).slice(0, 500) }, 500)
  }
})

// ─────────────────────────────────────────────────────────────
// LMW order form submission
// ─────────────────────────────────────────────────────────────

type PlaceArgs = {
  outlet_no: string
  pin: string
  start_at_local: string  // ISO without timezone, Australia/Melbourne
  hours: number
  flow_lps: number
  shift_no: number
}

type PlaceResult =
  | { ok: true;  receipt_no: string }
  | { ok: false; error: string; raw_response?: string }

async function placeOrder(args: PlaceArgs): Promise<PlaceResult> {
  const session = await lmwLogin(args.outlet_no, args.pin)

  // Fetch the order form to harvest the action URL + hidden inputs (ASP
  // session state, anti-CSRF). This mirrors what a browser submits.
  const formHtml = await lmwGet(session, '/SRWA_OrderWater.asp')
  const form = parseForm(formHtml)
  if (!form) {
    return { ok: false, error: 'Could not locate order form on /SRWA_OrderWater.asp', raw_response: formHtml.slice(0, 25000) }
  }

  // Build the POST body. Hidden inputs come straight from the form HTML;
  // visible inputs are overwritten with our user-supplied values.
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(form.hidden)) params.set(k, v)

  const dt = parseLocalIso(args.start_at_local)
  if (!dt) return { ok: false, error: `Invalid start_at_local: ${args.start_at_local}` }

  const map = pickFieldMap(form.fieldNames)
  params.set(map.startDate, `${pad(dt.day)}/${pad(dt.month)}/${dt.year}`)
  params.set(map.startTime, `${pad(dt.hour)}:${pad(dt.minute)}`)
  params.set(map.hours,     String(args.hours))
  params.set(map.flow,      String(args.flow_lps))
  params.set(map.shift,     String(args.shift_no))
  if (map.submit) params.set(map.submit, 'Place Order')

  const postRes = await lmwPost(session, form.action, params)
  const respHtml = postRes.body

  const receiptMatch =
    respHtml.match(/Receipt\s*(?:No|Number)?[:\s#]*([0-9]{5,8})/i) ??
    respHtml.match(/Order\s*(?:placed|confirmed)[^0-9]{0,40}([0-9]{5,8})/i)
  if (receiptMatch) {
    return { ok: true, receipt_no: receiptMatch[1] }
  }

  // Diagnostic: surface what we sent and what we found, so we can fix
  // the field mapping without another round trip.
  const errMatch = respHtml.match(/<(?:span|div|p)[^>]*(?:error|alert|warning)[^>]*>([\s\S]{0,300}?)</i)
  const visibleErr = errMatch ? stripTags(errMatch[1]).trim() : null
  const diag = [
    `action=${form.action}`,
    `hidden=[${Object.keys(form.hidden).join(',')}]`,
    `fields=[${form.fieldNames.join(',')}]`,
    `picked=${JSON.stringify(map)}`,
    `httpStatus=${postRes.status}`,
  ].join(' ')

  return {
    ok: false,
    error: visibleErr
      ? `${visibleErr} | ${diag}`
      : `Order submitted but no receipt was returned (form fields may need adjustment). ${diag}`,
    // Capture a wider window so the form HTML lands in the log.
    raw_response: extractFormRegion(respHtml) || respHtml.slice(0, 25000),
  }
}

// ─────────────────────────────────────────────────────────────
// Form parsing helpers
// ─────────────────────────────────────────────────────────────

type ParsedForm = { action: string; hidden: Record<string, string>; fieldNames: string[] }

function parseForm(html: string): ParsedForm | null {
  // Find the form whose action mentions the order page
  const formMatch =
    html.match(/<form[^>]*action="([^"]*OrderWater[^"]*)"[^>]*>([\s\S]*?)<\/form>/i) ??
    html.match(/<form[^>]*>([\s\S]*?)<\/form>/i)
  if (!formMatch) return null

  let action: string
  let body: string
  if (formMatch.length === 3) { action = formMatch[1]; body = formMatch[2] }
  else                        { action = '/SRWA_OrderWater.asp'; body = formMatch[1] }
  if (!action.startsWith('/')) action = '/' + action

  const hidden: Record<string, string> = {}
  const fieldNames: string[] = []

  const inputRe = /<input\b([^>]*)>/gi
  let m: RegExpExecArray | null
  while ((m = inputRe.exec(body)) !== null) {
    const attrs = parseAttrs(m[1])
    if (!attrs.name) continue
    fieldNames.push(attrs.name)
    if ((attrs.type ?? 'text').toLowerCase() === 'hidden') {
      hidden[attrs.name] = attrs.value ?? ''
    }
  }
  // Selects (e.g. shift) — capture name so we know it exists
  const selectRe = /<select\b([^>]*)>/gi
  while ((m = selectRe.exec(body)) !== null) {
    const attrs = parseAttrs(m[1])
    if (attrs.name) fieldNames.push(attrs.name)
  }

  return { action, hidden, fieldNames }
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(\w+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) out[m[1].toLowerCase()] = m[2]
  return out
}

/** Map of *visible* form field names → keys we recognise. Adjust here if LMW renames a field. */
function pickFieldMap(fieldNames: string[]): {
  startDate: string; startTime: string; hours: string; flow: string; shift: string; submit: string | null
} {
  const find = (...candidates: RegExp[]) => {
    for (const c of candidates) {
      const hit = fieldNames.find(n => c.test(n))
      if (hit) return hit
    }
    return ''
  }
  return {
    startDate: find(/^date$/i, /start.*date/i, /^startdate$/i, /^stdate$/i)  || 'StartDate',
    startTime: find(/^time$/i, /start.*time/i, /^starttime$/i, /^sttime$/i)  || 'StartTime',
    hours:     find(/^hours?$/i, /duration/i, /^hrs$/i)                      || 'Hours',
    flow:      find(/^flow/i, /lps/i, /rate/i)                               || 'Flow',
    shift:     find(/^shift/i)                                               || 'Shift',
    submit:    find(/^(submit|place|order|btn)/i) || null,
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
}

/**
 * Pull a window centred on the order form so the booking log captures
 * the structurally-relevant HTML (form + inputs + selects) rather than
 * the page header.
 */
function extractFormRegion(html: string): string | null {
  const m =
    html.match(/<form[\s\S]{0,25000}?<\/form>/i) ??
    html.match(/Place\s+An?\s*Order[\s\S]{0,25000}/i)
  return m ? m[0].slice(0, 25000) : null
}

// ─────────────────────────────────────────────────────────────
// Validation, time, and logging helpers
// ─────────────────────────────────────────────────────────────

function validateBooking({ start_at_local, hours, flow_lps, shift_no }: {
  start_at_local?: string; hours?: number; flow_lps?: number; shift_no: number
}): string | null {
  if (!start_at_local || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(start_at_local))
    return 'start_at_local must be ISO YYYY-MM-DDTHH:mm (Australia/Melbourne local time)'
  if (typeof hours !== 'number' || hours <= 0 || hours > 168)
    return 'hours must be a number between 0 and 168'
  if (typeof flow_lps !== 'number' || flow_lps <= 0 || flow_lps > 200)
    return 'flow_lps must be a number between 0 and 200'
  if (!Number.isInteger(shift_no) || shift_no < 1 || shift_no > 4)
    return 'shift_no must be an integer 1–4'

  // Reject orders in the past or starting < 1 h from now
  const startUtc = new Date(melbourneToUtc(start_at_local)).getTime()
  if (startUtc < Date.now() + 60 * 60 * 1000)
    return 'start_at must be at least 1 hour from now'
  return null
}

type LogArgs = {
  user_id: string
  outlet_no: string
  action: string
  ok: boolean
  receipt_no?: string
  start_at?: string
  hours?: number
  flow_lps?: number
  message: string
  raw_response?: string
}

async function logAttempt(args: LogArgs) {
  await admin.from('lmw_booking_log').insert({
    user_id:      args.user_id,
    outlet_no:    args.outlet_no,
    action:       args.action,
    receipt_no:   args.receipt_no ?? null,
    start_at:     args.start_at ?? null,
    hours:        args.hours ?? null,
    flow_lps:     args.flow_lps ?? null,
    ok:           args.ok,
    message:      args.message.slice(0, 1000),
    raw_response: args.raw_response?.slice(0, 30000) ?? null,
  })
}

function pad(n: number) { return String(n).padStart(2, '0') }

function parseLocalIso(s: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  return {
    year:   +m[1], month: +m[2], day:    +m[3],
    hour:   +m[4], minute: +m[5],
  }
}

function melbourneToUtc(localIso: string): string {
  const m = localIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return new Date(localIso).toISOString()
  const [, y, mo, d, h, mi, s] = m
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? '0'))
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

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

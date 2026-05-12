/**
 * LMW HTML parsers.
 *
 * The LMW pages are classic-ASP server-rendered tables with predictable
 * structure. We use regex-based extraction rather than a full DOM parser
 * because:
 *   1. Edge function cold-start is faster
 *   2. The HTML structure is stable (no JS rendering)
 *   3. Each parser is small and testable in isolation
 *
 * If any LMW page changes layout, the parser for that page returns
 * partial/null data. The lmw-sync function logs raw HTML to
 * lmw_booking_log on parse errors so we can iterate quickly.
 */

// ─────── Assessment.asp ──────────────────────────────────────

export type Allocation = {
  aba_id: string | null
  carryover_ml: number | null
  seasonal_alloc_ml: number | null
  trade_in_ml: number | null
  trade_out_ml: number | null
  water_use_ml: number | null
  aba_balance_ml: number | null
  available_ml: number | null
  tradable_ml: number | null
}

export function parseAssessment(html: string): Allocation {
  const text = htmlToText(html)
  const num = (label: string) => extractNumber(text, label)

  const abaIdMatch = text.match(/Summary for ([A-Z0-9]+)/)
  const aba_id = abaIdMatch ? abaIdMatch[1] : null

  return {
    aba_id,
    carryover_ml:      num('Net Carryover at July 1'),
    seasonal_alloc_ml: num('Seasonal allocation issued'),
    trade_in_ml:       num('Trade in'),
    trade_out_ml:      num('Trade out'),
    water_use_ml:      num('Water use'),
    aba_balance_ml:    num('ABA Balance'),
    available_ml:      num('Available Balance'),
    tradable_ml:       num('Tradable Balance'),
  }
}

// ─────── OrderHistory.asp ────────────────────────────────────

export type OrderRow = {
  ordered_at: string
  start_at: string
  hours: number
  flow_lps: number
  est_ml: number
  shift_no: number
  receipt_no: string
}

export function parseOrderHistory(html: string): OrderRow[] {
  const rows: OrderRow[] = []
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m: RegExpExecArray | null
  while ((m = trRegex.exec(html)) !== null) {
    const tdMatches = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(t => stripTags(t[1]).trim())
    if (tdMatches.length !== 7) continue
    const [orderedRaw, startRaw, hoursStr, flowStr, estStr, shiftStr, receipt] = tdMatches
    if (!/^\d{2}\/\d{2}\/\d{4}/.test(orderedRaw)) continue
    if (!/^\d+$/.test(receipt)) continue
    const ordered_at = parseLmwDate(orderedRaw)
    const start_at   = parseLmwDate(startRaw)
    if (!ordered_at || !start_at) continue
    rows.push({
      ordered_at, start_at,
      hours:    parseFloat(hoursStr) || 0,
      flow_lps: parseInt(flowStr, 10) || 0,
      est_ml:   parseFloat(estStr) || 0,
      shift_no: parseInt(shiftStr, 10) || 1,
      receipt_no: receipt,
    })
  }
  return rows
}

// ─────── MeterReadings.asp ───────────────────────────────────

export type MeterReadingRow = {
  reading_date: string
  meter_reading: number
  act_usage_ml: number | null
  est_usage_ml: number | null
}

export function parseMeterReadings(html: string): MeterReadingRow[] {
  const rows: MeterReadingRow[] = []
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m: RegExpExecArray | null
  while ((m = trRegex.exec(html)) !== null) {
    const tds = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(t => stripTags(t[1]).trim())
    if (tds.length !== 4) continue
    const [dateRaw, readingStr, actStr, estStr] = tds
    const dateMatch = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
    if (!dateMatch) continue
    const dd = dateMatch[1], mm = dateMatch[2], yy = dateMatch[3]
    const yyyy = parseInt(yy, 10) >= 70 ? `19${yy}` : `20${yy}`
    rows.push({
      reading_date: `${yyyy}-${mm}-${dd}`,
      meter_reading: parseFloat(readingStr),
      act_usage_ml: actStr === '' ? null : parseFloat(actStr),
      est_usage_ml: estStr === '' ? null : parseFloat(estStr),
    })
  }
  return rows
}

// ─────── SRWA_OrderWater.asp — "Current orders" ─────────────

/**
 * Extract receipt numbers from the "Current orders for outlet …" table on
 * the Place An Order page. These are the truly-active orders — Order
 * History keeps cancelled rows too, so we need this set to reconcile.
 */
export function parseCurrentOrderReceipts(html: string): Set<string> {
  const receipts = new Set<string>()
  const idx = html.indexOf('Current orders for outlet')
  if (idx === -1) return receipts
  const section = html.slice(idx)
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m: RegExpExecArray | null
  while ((m = trRegex.exec(section)) !== null) {
    const tds = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(t => stripTags(t[1]).trim())
    if (tds.length < 8) continue
    for (const cell of tds) {
      if (/^\d{5,8}$/.test(cell)) {
        receipts.add(cell)
        break
      }
    }
  }
  return receipts
}

// ─────── default1.asp — portal home notices ──────────────────

export type Notice = {
  text: string
}

/**
 * Parse dismissible notice banners from the LMW portal home page.
 *
 * The classic-ASP home page shows pink alert rows with a dismiss link
 * next to each notice. We detect rows that contain a dismiss signal
 * (× / &times; / href to a dismiss/notice URL) and extract the text.
 *
 * If that yields nothing we fall back to coloured table cells
 * (bgcolor with a reddish/pinkish hex) as a secondary signal.
 */
export function parseNotices(html: string): Notice[] {
  const notices: Notice[] = []
  const seen = new Set<string>()

  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')

  const isDismissSignal = (s: string) =>
    /[×✕]|&times;|&#215;/i.test(s) ||
    /href\s*=\s*["'][^"']*(?:dismiss|notice)[^"']*["']/i.test(s)

  const addIfNovel = (rawInner: string) => {
    const text = stripTags(rawInner)
      .replace(/&times;|&#215;/g, '')
      .replace(/[×✕]/g, '')
      .replace(/\b(?:close|dismiss)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length < 10 || seen.has(text)) return
    seen.add(text)
    notices.push({ text })
  }

  // Primary: <tr> elements that contain a dismiss signal
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let m: RegExpExecArray | null
  while ((m = trRe.exec(clean)) !== null) {
    if (isDismissSignal(m[1])) addIfNovel(m[1])
  }

  // Secondary fallback: <td> or <table> with a pinkish bgcolor attribute
  if (notices.length === 0) {
    const pinkRe = /bgcolor\s*=\s*["']?\s*#?(?:FF[89A-Fa-f][0-9A-Fa-f]{2}[0-9A-Fa-f]{2}|FFB\w{3}|FFA\w{3}|FF8\w{3}|pink|salmon)/i
    const cellRe = /<(?:td|th|table)[^>]*>([\s\S]*?)<\/(?:td|th|table)>/gi
    while ((m = cellRe.exec(clean)) !== null) {
      if (pinkRe.test(m[0].slice(0, 120))) addIfNovel(m[1])
    }
  }

  return notices
}

// ─────── helpers ─────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
}

function extractNumber(text: string, label: string): number | null {
  const re = new RegExp(`${escapeRegExp(label)}[^0-9-]*(-?[0-9]+\\.?[0-9]*)`)
  const m = text.match(re)
  return m ? parseFloat(m[1]) : null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseLmwDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2}):?(\d{1,2})?\s*(AM|PM)?$/i)
  if (!m) return null
  const [, dd, mm, yyyy, hhStr, minStr, secStr, ampm] = m
  let hh = parseInt(hhStr, 10)
  if (ampm) {
    const u = ampm.toUpperCase()
    if (u === 'PM' && hh < 12) hh += 12
    if (u === 'AM' && hh === 12) hh = 0
  }
  const ss = parseInt(secStr ?? '0', 10) || 0
  const min = parseInt(minStr, 10) || 0
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/**
 * Sandy Soil Automations — Scheduled Program Runner
 * Supabase Edge Function — invoked every minute via pg_cron
 *
 * What it does:
 *  1. Finds group_schedules that are enabled and due to run right now
 *  2. Walks the automation steps (on / delay / off) and calculates fire_at
 *     for each actionable step using cumulative delay offsets
 *  3. Inserts pending steps into program_queue
 *  4. The run-program-queue function fires steps when their fire_at arrives
 *
 * This two-step approach supports long delays (e.g. 2 h between ON and OFF)
 * that would exceed a single edge function invocation window.
 *
 * Setup:
 *  supabase functions deploy run-schedules
 *
 *  Then in Supabase SQL Editor, enable pg_cron and schedule both functions:
 *
 *  SELECT cron.schedule(
 *    'run-irrigation-schedules',
 *    '* * * * *',
 *    $$
 *      SELECT net.http_post(
 *        url     := 'https://YOUR_PROJECT.supabase.co/functions/v1/run-schedules',
 *        headers := jsonb_build_object(
 *          'Content-Type',  'application/json',
 *          'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
 *        ),
 *        body    := '{}'::jsonb
 *      );
 *    $$
 *  );
 *
 *  SELECT cron.schedule(
 *    'run-program-queue',
 *    '* * * * *',
 *    $$
 *      SELECT net.http_post(
 *        url     := 'https://YOUR_PROJECT.supabase.co/functions/v1/run-program-queue',
 *        headers := jsonb_build_object(
 *          'Content-Type',  'application/json',
 *          'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
 *        ),
 *        body    := '{}'::jsonb
 *      );
 *    $$
 *  );
 *
 * Required Edge Function secrets:
 *   SUPABASE_URL            — auto-set
 *   SUPABASE_SERVICE_ROLE_KEY — auto-set
 *   TIMEZONE                — IANA name, e.g. "Australia/Melbourne"
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { expandSteps, type Step } from './lib/expandSteps.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TIMEZONE             = Deno.env.get('TIMEZONE') ?? 'Australia/Melbourne'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Get local time parts using the IANA timezone (handles DST automatically)
function localTimeParts() {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  const hhmm = `${parts.hour.padStart(2, '0')}:${parts.minute.padStart(2, '0')}`
  const dow  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)
  return { hhmm, dow }
}

function currentHHMM(): string { return localTimeParts().hhmm }
function currentDOW():  number { return localTimeParts().dow }

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function schedulesOverlap(
  a: { start_time: string; duration_min: number; days_of_week: number[] },
  b: { start_time: string; duration_min: number; days_of_week: number[] },
): boolean {
  const sharedDay = a.days_of_week.some(d => b.days_of_week.includes(d))
  if (!sharedDay) return false
  const aStart = toMin(a.start_time), aEnd = aStart + a.duration_min
  const bStart = toMin(b.start_time), bEnd = bStart + b.duration_min
  return aStart < bEnd && bStart < aEnd
}

function isBackToBack(aEndMin: number, bStartMin: number): boolean {
  return Math.abs(bStartMin - aEndMin) < 2
}

Deno.serve(async (_req) => {
  try {
    const now = currentHHMM()
    const dow = currentDOW()

    console.log(`[run-schedules] checking at ${now} DOW=${dow} (tz=${TIMEZONE})`)

    // Today's date in local timezone (YYYY-MM-DD)
    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())

    const { data: schedules, error: schedErr } = await supabase
      .from('group_schedules')
      .select(`
        id,
        group_id,
        label,
        days_of_week,
        start_time,
        run_once_date,
        zone_groups (
          id,
          name,
          run_mode,
          duration_min,
          farm_devices (
            mqtt_base_topic,
            device_id,
            pump_zone_num
          ),
          zone_group_members (
            zone_num,
            duration_min,
            sort_order,
            step_type,
            delay_min,
            device
          )
        )
      `)
      .eq('enabled', true)
      .filter('start_time', 'gte', `${now}:00`)
      .filter('start_time', 'lt',  `${now}:59`)
    if (schedErr) throw schedErr

    const due = (schedules ?? []).filter(s =>
      s.run_once_date
        ? s.run_once_date === todayLocal
        : Array.isArray(s.days_of_week) && s.days_of_week.includes(dow)
    )

    const results: string[] = []

    for (const sched of due) {
      const group = sched.zone_groups as {
        id: string
        name: string
        run_mode: string
        duration_min: number | null
        zone_group_members: Step[]
        farm_devices: { mqtt_base_topic: string | null, device_id: string, pump_zone_num: number | null } | null
      } | null

      if (!group) continue

      // Resolve the device's MQTT prefix at queue time so the executor doesn't
      // need to re-query devices later. Falls back to the legacy
      // irrigation controller for any zone_groups row not yet linked to a device.
      const mqttBaseTopic = group.farm_devices?.mqtt_base_topic
        ?? (group.farm_devices?.device_id ? `farm/${group.farm_devices.device_id.toLowerCase()}` : 'farm/irrigation1')

      console.log(`[run-schedules] queuing "${group.name}" → ${mqttBaseTopic} (${(group.zone_group_members ?? []).length} steps)`)

      // Dedup: skip if this group already has unfired steps queued in the last 2 minutes
      // (guards against pg_cron calling us twice in the same minute)
      const dedupSince = new Date(Date.now() - 2 * 60_000).toISOString()
      const { data: existing } = await supabase
        .from('program_queue')
        .select('id')
        .eq('group_id', group.id)
        .is('fired_at', null)
        .gte('created_at', dedupSince)
        .limit(1)
      if (existing?.length) {
        console.log(`[run-schedules] "${group.name}" already queued — skipping duplicate`)
        results.push(`${group.name} → skipped (duplicate)`)
        continue
      }

      // Base time is now — the function runs at the correct minute,
      // so Date.now() is the right fire_at for immediate steps.
      const pumpZoneNum: number | null = group.farm_devices?.pump_zone_num ?? null
      const programDurationMin: number = group.duration_min ?? 30

      // Back-to-back detection: if another due program ends within 2 min of this one starting,
      // suppress pump OFF (pump stays on; next program sends its own pump ON to reset firmware timer)
      let suppressPumpOff = false
      if (pumpZoneNum != null) {
        const thisStartMin = toMin(now)
        for (const other of due) {
          if (other === sched) continue
          const otherGroup = (other as any).zone_groups
          if (!otherGroup) continue
          const otherDur: number = otherGroup.duration_min ?? 30
          const otherEndMin = toMin(other.start_time) + otherDur
          if (isBackToBack(otherEndMin, thisStartMin)) {
            suppressPumpOff = true
            break
          }
        }
      }

      const queueRows = expandSteps(
        group.id,
        group.run_mode,
        (group.zone_group_members ?? []) as Step[],
        Date.now(),
        mqttBaseTopic,
        pumpZoneNum,
        programDurationMin,
        suppressPumpOff,
      )

      // Safety assertion: every ON row in simultaneous mode must have a matching OFF
      if (group.run_mode === 'simultaneous' || !group.run_mode) {
        const onRows  = queueRows.filter(r => r.step_type === 'on')
        const offRows = queueRows.filter(r => r.step_type === 'off')
        const missingOff = onRows.filter(on =>
          !offRows.some(off => off.zone_num === on.zone_num && off.device === on.device)
        )
        if (missingOff.length > 0) {
          console.error(`[run-schedules] ON/OFF mismatch for "${group.name}" zones: ${missingOff.map(r => r.zone_num).join(', ')}`)
          continue
        }
      }

      if (queueRows.length > 0) {
        const { error: qErr } = await supabase.from('program_queue').insert(queueRows)
        if (qErr) throw qErr
        results.push(`${group.name} → ${queueRows.length} step(s) queued`)
      } else {
        results.push(`${group.name} → no actionable steps`)
      }

      // Disable once-only schedules after firing
      if (sched.run_once_date) {
        await supabase.from('group_schedules')
          .update({ enabled: false, run_once_date: null })
          .eq('id', sched.id)
      }
    }

    // Kick the queue executor right now so steps fire immediately rather than waiting
    // for the next minute boundary. Avoids the 1-minute lag between "scheduled" and
    // "MQTT command actually published".
    if (results.length > 0) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/run-program-queue`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
          body: '{}',
        })
      } catch (kickErr) {
        // Non-fatal — pg_cron will pick it up on the next minute as a fallback.
        console.warn('[run-schedules] queue-kick failed (will retry next minute):', kickErr)
      }
    }

    return new Response(
      JSON.stringify({ ok: true, time: now, dow, queued: results }),
      { headers: { 'Content-Type': 'application/json' } }
    )  } catch (err) {
    console.error('[run-schedules] error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})


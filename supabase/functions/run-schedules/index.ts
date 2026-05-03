/**
 * Sandy Soil Automations — Scheduled Program Runner
 * Supabase Edge Function — invoked every minute via pg_cron
 *
 * What it does:
 *  1. Finds group_schedules that are enabled and due to run right now
 *  2. Walks the automation steps (on / delay / off) and calculates fire_at
 *     for each actionable step using cumulative delay offsets
 *  3. Inserts pending steps into program_queue
 *  4. Calls runQueue() inline so any step due in the current minute fires
 *     immediately. Future steps (e.g. an OFF after a 2 h delay) are picked
 *     up by the next pg_cron tick of run-program-queue.
 *
 * The previous version used an HTTP fetch to run-program-queue as a "kick"
 * after queueing. That call wasn't reliably draining the queue inside the
 * same minute, so schedules would land on the device ~1 minute late. Inline
 * execution removes the indirection.
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
 *   SUPABASE_URL              — auto-set
 *   SUPABASE_SERVICE_ROLE_KEY — auto-set
 *   MQTT_USER, MQTT_PASS      — set via `supabase secrets set ...`
 *   TIMEZONE                  — IANA name, e.g. "Australia/Melbourne"
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { expandSteps, type Step } from './lib/expandSteps.ts'
import { pickDueSchedules } from './lib/pickDue.ts'
import { runQueue } from '../_shared/runQueue.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TIMEZONE             = Deno.env.get('TIMEZONE') ?? 'Australia/Melbourne'
const MQTT_HOST            = Deno.env.get('MQTT_HOST') ?? 'eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud'
const MQTT_USER            = Deno.env.get('MQTT_USER')
const MQTT_PASS            = Deno.env.get('MQTT_PASS')

if (!MQTT_USER || !MQTT_PASS) {
  throw new Error('MQTT_USER and MQTT_PASS must be set as Edge Function secrets')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Get local time parts using the IANA timezone (handles DST automatically)
function localTimeParts() {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  // en-AU + hour12:false on some ICU builds returns "24" for midnight; normalise to "00"
  const hh   = parts.hour === '24' ? '00' : parts.hour.padStart(2, '0')
  const hhmm = `${hh}:${parts.minute.padStart(2, '0')}`
  const dow  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)
  return { hhmm, dow }
}

Deno.serve(async (_req) => {
  try {
    const { hhmm: now, dow } = localTimeParts()

    console.log(`[run-schedules] checking at ${now} DOW=${dow} (tz=${TIMEZONE})`)

    // Today's date in local timezone (YYYY-MM-DD)
    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())

    // Fetch every enabled schedule and minute-match in JS. The previous
    // implementation used `start_time >= 'HH:MM:00' AND start_time < 'HH:MM:59'`
    // which both excluded the HH:MM:59 second and was fragile against any
    // schedule stored with sub-second precision. Schedule counts stay small
    // (one row per program), so the cost is negligible.
    const { data: allSchedules, error: schedErr } = await supabase
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
          devices (
            mqtt_topic_base,
            device_id
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
    if (schedErr) throw schedErr

    const due = pickDueSchedules(allSchedules ?? [], now, dow, todayLocal)

    const results: string[] = []

    for (const sched of due) {
      const group = sched.zone_groups as {
        id: string
        name: string
        run_mode: string
        zone_group_members: Step[]
        devices: { mqtt_topic_base: string | null, device_id: string } | null
      } | null

      if (!group) continue

      // Resolve the device's MQTT prefix at queue time so the executor doesn't
      // need to re-query devices later. Falls back to the legacy
      // irrigation controller for any zone_groups row not yet linked to a device.
      const mqttBaseTopic = group.devices?.mqtt_topic_base
        ?? (group.devices?.device_id ? `farm/${group.devices.device_id.toLowerCase()}` : 'farm/irrigation1')

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
      const queueRows = expandSteps(
        group.id,
        group.run_mode,
        (group.zone_group_members ?? []) as Step[],
        Date.now(),
        mqttBaseTopic,
      )

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

    // Fire any steps that are due right now (immediate ON steps for the
    // schedules we just queued, plus anything overdue from a previous run).
    // Inline call — no HTTP fetch — so this runs in the same minute as the
    // scheduled time instead of waiting for the next pg_cron tick.
    let firedNow: string[] = []
    try {
      const result = await runQueue({
        supabase,
        mqttHost: MQTT_HOST,
        mqttUser: MQTT_USER!,
        mqttPass: MQTT_PASS!,
      })
      firedNow = result.fired
    } catch (queueErr) {
      // Non-fatal — pg_cron will retry next minute. Log and let the schedule
      // queueing succeed so it isn't lost.
      console.warn('[run-schedules] inline queue drain failed (will retry next minute):', queueErr)
    }

    return new Response(
      JSON.stringify({ ok: true, time: now, dow, queued: results, fired: firedNow }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    // Supabase errors are plain objects (not Error subclasses), so String(err)
    // produces "[object Object]" which made past failures impossible to debug.
    const msg = err instanceof Error
      ? err.stack ?? err.message
      : err && typeof err === 'object'
        ? JSON.stringify(err)
        : String(err)
    console.error('[run-schedules] error:', msg)
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})

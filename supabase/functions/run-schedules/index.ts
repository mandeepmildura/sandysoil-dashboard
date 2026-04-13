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

type Step = {
  zone_num:    number
  duration_min: number | null
  sort_order:  number
  step_type:   string | null   // 'on' | 'off' | 'delay' — null treated as 'on'
  delay_min:   number | null
  device:      string | null   // 'irrigation1' | 'a6v3' — null treated as 'irrigation1'
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
    const onMessages:  Array<{ topic: string; payload: string }> = []
    const offMessages: Array<{ topic: string; payload: string }> = []
    const historyRows: Array<{ device: string; zone_num: number }> = []
    const offHistory:  Array<{ device: string; zone_num: number }> = []

    for (const sched of due) {
      const group = sched.zone_groups as {
        id: string
        name: string
        run_mode: string
        zone_group_members: Step[]
      } | null

      if (!group) continue

      const steps = [...(group.zone_group_members ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)

      console.log(`[run-schedules] queuing "${group.name}" (${steps.length} steps)`)

      // Parse schedule start time as a Date (today in local time → UTC)
      const [sh, sm] = sched.start_time.split(':').map(Number)
      const now_date = new Date()
      // Build a Date for today at the schedule's local time
      const localStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(now_date)
      // localStr is "YYYY-MM-DD"; combine with schedule time in local TZ
      const scheduleTime = new Date(
        new Date(`${localStr}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`)
          .toLocaleString('en-US', { timeZone: TIMEZONE })
          .replace(/(\d+)\/(\d+)\/(\d+),\s(\d+):(\d+):(\d+)\s(AM|PM)/, (_, mo, da, yr, h, mi, s, ap) => {
            const hr = ap === 'PM' && +h < 12 ? +h + 12 : ap === 'AM' && +h === 12 ? 0 : +h
            return `${yr}-${mo.padStart(2,'0')}-${da.padStart(2,'0')}T${String(hr).padStart(2,'0')}:${mi}:${s}`
          })
      )
      // Fallback: just use UTC-based offset approximation if parsing fails
      const baseMs = isNaN(scheduleTime.getTime()) ? Date.now() : scheduleTime.getTime()

      // Walk steps, accumulating delay offset as a cursor
      let cursorMs = baseMs
      const queueRows: object[] = []

      for (const step of steps) {
        const stepType = step.step_type ?? 'on'

        if (stepType === 'delay') {
          cursorMs += (step.delay_min ?? 0) * 60_000
          continue        }

        // Actionable step: 'on' or 'off'
        queueRows.push({
          group_id:    group.id,
          step_type:   stepType,
          device:      step.device ?? 'irrigation1',
          zone_num:    step.zone_num,
          duration_min: step.duration_min,
          fire_at:     new Date(cursorMs).toISOString(),
        })

        // For irrigation1 sequential 'on' steps: advance cursor by duration so the
        // next step fires after this one completes (backwards-compatible behaviour)
        if (stepType === 'on'
            && (step.device ?? 'irrigation1') === 'irrigation1'
            && group.run_mode === 'sequential') {
          cursorMs += (step.duration_min ?? 0) * 60_000
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

    return new Response(
      JSON.stringify({ ok: true, time: now, dow, queued: results }),
      { headers: { 'Content-Type': 'application/json' } }
    )  } catch (err) {
    console.error('[run-schedules] error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})

function toHHMM(totalMin: number): string {
  return `${String(Math.floor(totalMin / 60) % 24).padStart(2,'0')}:${String(totalMin % 60).padStart(2,'0')}`
}

function mqttMsg(device: string, zoneNum: number, on: boolean, durationMin: number): { topic: string; payload: string } {
  if (device === 'a6v3') {
    return { topic: `A6v3/${A6V3_SERIAL}/SET`, payload: JSON.stringify({ [`output${zoneNum}`]: { value: on } }) }
  } else if (device === 'b16m') {
    return { topic: `B16M/${B16M_SERIAL}/SET`, payload: JSON.stringify({ [`output${zoneNum}`]: { value: on } }) }
  } else {
    return { topic: `farm/irrigation1/zone/${zoneNum}/cmd`, payload: JSON.stringify(on ? { cmd: 'on', duration: durationMin, source: 'schedule' } : { cmd: 'off' }) }
  }
}

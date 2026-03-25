/**
 * Sandy Soil Automations — Scheduled Program Runner
 * Supabase Edge Function — invoked every minute via pg_cron
 *
 * What it does:
 *  1. Finds group_schedules that are enabled and due to run right now
 *  2. Fetches the zone sequence for each matching program
 *  3. Publishes MQTT commands to HiveMQ via HTTP API
 *
 * Setup:
 *  supabase functions deploy run-schedules
 *
 *  Then in Supabase SQL Editor, enable pg_cron and schedule this function:
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
 * Required Edge Function secrets (set in Supabase Dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL        — your project URL (auto-set)
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (auto-set)
 *   MQTT_HOST           — e.g. eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud
 *   MQTT_USER           — e.g. farmcontrol-web
 *   MQTT_PASS           — your MQTT password
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MQTT_HOST               = Deno.env.get('MQTT_HOST')!
const MQTT_USER               = Deno.env.get('MQTT_USER')!
const MQTT_PASS               = Deno.env.get('MQTT_PASS')!

// IANA timezone name — handles daylight saving automatically
// Set this in Supabase Dashboard → Edge Functions → Secrets as TIMEZONE
// e.g. "Australia/Melbourne" for VIC/Mildura (auto-switches AEST↔AEDT)
const TIMEZONE = Deno.env.get('TIMEZONE') ?? 'UTC'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// HiveMQ Cloud HTTP API — publish an MQTT message
async function mqttPublish(topic: string, payload: unknown): Promise<void> {
  const url = `https://${MQTT_HOST}/api/v1/mqtt/publish`
  const body = JSON.stringify({
    topic,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    qos: 1,
  })
  const creds = btoa(`${MQTT_USER}:${MQTT_PASS}`)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Basic ${creds}`,
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MQTT publish failed (${res.status}): ${text}`)
  }
}

// Get local time parts using the IANA timezone (handles DST automatically)
function localTimeParts() {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE,
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  const hhmm = `${parts.hour.padStart(2, '0')}:${parts.minute.padStart(2, '0')}`
  const dow  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)
  return { hhmm, dow }
}

function currentHHMM(): string { return localTimeParts().hhmm }
function currentDOW():  number { return localTimeParts().dow }

Deno.serve(async (_req) => {
  try {
    const now    = currentHHMM()
    const dow    = currentDOW()

    console.log(`[run-schedules] checking at ${now} DOW=${dow} (tz=${TIMEZONE})`)

    // Find enabled schedules whose start_time matches this minute
    // and today's DOW is in days_of_week
    const { data: schedules, error: schedErr } = await supabase
      .from('group_schedules')
      .select(`
        id,
        group_id,
        label,
        days_of_week,
        start_time,
        zone_groups (
          id,
          name,
          run_mode,
          zone_group_members (
            zone_num,
            duration_min,
            sort_order
          )
        )
      `)
      .eq('enabled', true)
      // Match start_time at the minute level (e.g. "06:00:00" → "06:00")
      .filter('start_time', 'gte', `${now}:00`)
      .filter('start_time', 'lt',  `${now}:59`)

    if (schedErr) throw schedErr

    const due = (schedules ?? []).filter(s =>
      Array.isArray(s.days_of_week) && s.days_of_week.includes(dow)
    )

    console.log(`[run-schedules] ${due.length} schedule(s) due`)

    const results: string[] = []

    for (const sched of due) {
      const group = sched.zone_groups as {
        id: string
        name: string
        run_mode: string
        zone_group_members: { zone_num: number; duration_min: number; sort_order: number }[]
      } | null

      if (!group) continue

      const zones = [...(group.zone_group_members ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)

      console.log(`[run-schedules] running "${group.name}" (${zones.length} zones, ${group.run_mode})`)

      if (group.run_mode === 'sequential') {
        // Each zone has a calculated start time = schedule start + cumulative offset.
        // The cron runs every minute so this naturally handles sequencing without a queue.
        const [sh, sm] = sched.start_time.split(':').map(Number)
        let offsetMin = 0
        for (const z of zones) {
          const totalMin  = sh * 60 + sm + offsetMin
          const zoneHHMM  = `${String(Math.floor(totalMin / 60) % 24).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`
          if (zoneHHMM === now) {
            await mqttPublish(`farm/irrigation1/zone/${z.zone_num}/cmd`, {
              cmd: 'on', duration: z.duration_min, source: 'schedule',
            })
            await supabase.from('zone_history').insert({
              zone_num: z.zone_num, started_at: new Date().toISOString(), source: 'schedule',
            })
            results.push(`${group.name} → Zone ${z.zone_num} started (sequential offset ${offsetMin}min)`)
          }
          offsetMin += z.duration_min
        }
      } else {
        // Parallel: start all zones simultaneously
        for (const z of zones) {
          await mqttPublish(`farm/irrigation1/zone/${z.zone_num}/cmd`, {
            cmd: 'on', duration: z.duration_min, source: 'schedule',
          })
          await supabase.from('zone_history').insert({
            zone_num: z.zone_num, started_at: new Date().toISOString(), source: 'schedule',
          })
        }
        results.push(`${group.name} → ${zones.length} zone(s) started (parallel)`)
      }
    }

    return new Response(
      JSON.stringify({ ok: true, time: now, dow, ran: results }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[run-schedules] error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

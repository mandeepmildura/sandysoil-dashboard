/**
 * Sandy Soil Automations — Scheduled Program Runner
 * Supabase Edge Function — invoked every minute via pg_cron
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

function localTimeParts() {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  const hh   = parts.hour === '24' ? '00' : parts.hour.padStart(2, '0')
  const hhmm = `${hh}:${parts.minute.padStart(2, '0')}`
  const dow  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)
  return { hhmm, dow }
}

Deno.serve(async (_req) => {
  try {
    const { hhmm: now, dow } = localTimeParts()

    console.log(`[run-schedules] checking at ${now} DOW=${dow} (tz=${TIMEZONE})`)

    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())

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

      const mqttBaseTopic = group.devices?.mqtt_topic_base
        ?? (group.devices?.device_id ? `farm/${group.devices.device_id.toLowerCase()}` : 'farm/irrigation1')

      console.log(`[run-schedules] queuing "${group.name}" → ${mqttBaseTopic} (${(group.zone_group_members ?? []).length} steps)`)

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

      if (sched.run_once_date) {
        await supabase.from('group_schedules')
          .update({ enabled: false, run_once_date: null })
          .eq('id', sched.id)
      }
    }

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
      const qmsg = queueErr instanceof Error
        ? queueErr.stack ?? queueErr.message
        : queueErr && typeof queueErr === 'object'
          ? JSON.stringify(queueErr)
          : String(queueErr)
      console.warn('[run-schedules] inline queue drain failed (will retry next minute):', qmsg)
    }

    return new Response(
      JSON.stringify({ ok: true, time: now, dow, queued: results, fired: firedNow }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error
      ? err.stack ?? err.message
      : err && typeof err === 'object'
        ? JSON.stringify(err)
        : String(err)
    console.error('[run-schedules] error:', msg)
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})

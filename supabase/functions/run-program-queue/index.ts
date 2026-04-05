/**
 * Sandy Soil Automations — Program Queue Executor
 * Supabase Edge Function — invoked every minute via pg_cron
 *
 * What it does:
 *  1. Queries program_queue for rows where fire_at <= now() AND fired_at IS NULL
 *  2. For each pending step, publishes the appropriate MQTT command
 *  3. Marks each step as fired (sets fired_at = now())
 *
 * This is the companion to run-schedules: run-schedules populates the queue,
 * this function fires the steps at the right time — including delayed OFF
 * commands that arrive hours after the initial ON.
 *
 * Supported devices:
 *  - irrigation1  → farm/irrigation1/zone/{N}/cmd  {cmd:'on'|'off', duration, source}
 *  - a6v3         → A6v3/8CBFEA03002C/SET          {output{N}: {value: true|false}}
 *
 * Required Edge Function secrets:
 *   SUPABASE_URL              — auto-set
 *   SUPABASE_SERVICE_ROLE_KEY — auto-set
 *   MQTT_HOST                 — e.g. eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud
 *   MQTT_USER                 — MQTT username
 *   MQTT_PASS                 — MQTT password
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MQTT_HOST            = Deno.env.get('MQTT_HOST')!
const MQTT_USER            = Deno.env.get('MQTT_USER')!
const MQTT_PASS            = Deno.env.get('MQTT_PASS')!

const A6V3_SET_TOPIC = 'A6v3/8CBFEA03002C/SET'

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

type QueueRow = {
  id:           string
  group_id:     string | null
  step_type:    string   // 'on' | 'off'
  device:       string   // 'irrigation1' | 'a6v3'
  zone_num:     number
  duration_min: number | null
  fire_at:      string
}

Deno.serve(async (_req) => {
  try {
    const now = new Date().toISOString()
    console.log(`[run-program-queue] checking at ${now}`)

    const { data: due, error: fetchErr } = await supabase
      .from('program_queue')
      .select('*')
      .lte('fire_at', now)
      .is('fired_at', null)

    if (fetchErr) throw fetchErr

    const rows = (due ?? []) as QueueRow[]
    console.log(`[run-program-queue] ${rows.length} step(s) due`)

    const fired: string[] = []
    const errors: string[] = []

    for (const step of rows) {
      try {
        if (step.device === 'a6v3') {
          // A6v3: relay on or off
          await mqttPublish(A6V3_SET_TOPIC, {
            [`output${step.zone_num}`]: { value: step.step_type === 'on' },
          })
        } else {
          // irrigation1 (default)
          if (step.step_type === 'on') {
            await mqttPublish(`farm/irrigation1/zone/${step.zone_num}/cmd`, {
              cmd:      'on',
              duration: step.duration_min,
              source:   'schedule',
            })
            // Log zone run to zone_history
            await supabase.from('zone_history').insert({
              zone_num:   step.zone_num,
              started_at: new Date().toISOString(),
              source:     'schedule',
            })
          } else {
            await mqttPublish(`farm/irrigation1/zone/${step.zone_num}/cmd`, { cmd: 'off' })
          }
        }

        // Mark this step as fired
        await supabase
          .from('program_queue')
          .update({ fired_at: new Date().toISOString() })
          .eq('id', step.id)

        fired.push(`${step.device} zone/relay ${step.zone_num} → ${step.step_type}`)
      } catch (stepErr) {
        console.error(`[run-program-queue] step ${step.id} failed:`, stepErr)
        errors.push(String(stepErr))
      }
    }

    return new Response(
      JSON.stringify({ ok: true, fired, errors }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[run-program-queue] error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

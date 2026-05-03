/**
 * Sandy Soil Automations — Program Queue Executor
 * Supabase Edge Function — invoked every minute via pg_cron
 *
 * Thin wrapper around the shared runQueue() helper. The actual draining and
 * MQTT publish logic lives in ../_shared/runQueue.ts so run-schedules can
 * call it inline (avoiding a 1-minute lag between queueing and firing).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runQueue } from '../_shared/runQueue.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MQTT_HOST = Deno.env.get('MQTT_HOST') ?? 'eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud'
const MQTT_USER = Deno.env.get('MQTT_USER')
const MQTT_PASS = Deno.env.get('MQTT_PASS')

if (!MQTT_USER || !MQTT_PASS) {
  throw new Error('MQTT_USER and MQTT_PASS must be set as Edge Function secrets')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function raiseAlert(title: string, description: string, severity: string): Promise<void> {
  try {
    await supabase.from('device_alerts').insert({
      severity, title, description,
      device: 'scheduler', device_id: '', acknowledged: false,
    })
  } catch (_) { /* non-critical */ }
}

Deno.serve(async (_req) => {
  try {
    const result = await runQueue({
      supabase,
      mqttHost: MQTT_HOST,
      mqttUser: MQTT_USER!,
      mqttPass: MQTT_PASS!,
    })

    if (result.fired.length > 0) {
      await raiseAlert('Schedule fired', `Fired: ${result.fired.join(', ')}`, 'info')
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = String(err)
    console.error('[run-program-queue] fatal:', msg)
    await raiseAlert('Queue executor error', msg, 'fault')
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// Nightly pressure_log downsampling to hourly buckets.
// Called via pg_cron at 2am daily.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (_req) => {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString()

    const { error: aggErr } = await supabase.rpc('downsample_pressure_log', { cutoff_ts: cutoff })
    if (aggErr) throw aggErr

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('[pressure-downsample]', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})

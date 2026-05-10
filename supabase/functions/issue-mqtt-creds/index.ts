/**
 * Sandy Soil Automations — Per-customer MQTT credential issuer
 * Supabase Edge Function — invoked by the dashboard at app start.
 *
 * Goal: replace the bundled VITE_MQTT_USER / VITE_MQTT_PASS that every
 * visitor can extract from the JS bundle with short-lived per-customer
 * credentials scoped to that customer's topic prefix.
 *
 * ── How the dashboard calls it ─────────────────────────────────────────
 *   POST /functions/v1/issue-mqtt-creds
 *   Authorization: Bearer <user's Supabase JWT>
 *
 *   →  200 { host, port, username, password, topicPrefix, expiresAt }
 *   →  401 if no user
 *   →  403 if user has no farm/device assigned
 *
 * ── Two backends (toggle via MQTT_CREDS_MODE env var) ──────────────────
 *   "shared"   — returns the existing shared HiveMQ creds. No security
 *                improvement on its own, but the dashboard is now wired to
 *                request them dynamically. Use during the transition.
 *   "hivemq"   — calls the HiveMQ Cloud Console REST API to mint a
 *                per-customer credential with topic ACLs. Set
 *                HIVEMQ_API_TOKEN + HIVEMQ_CLUSTER_ID.
 *
 * Until "hivemq" mode is wired up (HiveMQ Cloud's API + ACL scheme is
 * subscription-tier-dependent), the function defaults to "shared" so the
 * dashboard works immediately. Switch the mode env var the moment you've
 * configured per-customer users in HiveMQ.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MQTT_HOST            = Deno.env.get('MQTT_HOST') ?? 'eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud'
const MODE                 = (Deno.env.get('MQTT_CREDS_MODE') ?? 'shared').toLowerCase()

// Shared (transitional) creds — pulled from the same env vars the edge
// functions use, never from the client bundle. Once MODE = "hivemq",
// these become unused.
const SHARED_USER = Deno.env.get('MQTT_USER')
const SHARED_PASS = Deno.env.get('MQTT_PASS')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST')    return json(405, { error: 'method_not_allowed' })

  // 1. Authenticate the calling user via their Supabase JWT.
  const authz = req.headers.get('Authorization') ?? ''
  const jwt   = authz.startsWith('Bearer ') ? authz.slice(7) : ''
  if (!jwt) return json(401, { error: 'missing_token' })

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
  if (userErr || !userData.user) return json(401, { error: 'invalid_token' })
  const userId = userData.user.id
  const email  = userData.user.email ?? ''

  // 2. Resolve the user's device → topic prefix.
  // Admin: gets the legacy prefix as a fallback so they can still see the
  // existing customer's unit. Customer: must have a farm + device.
  const isAdmin = email.toLowerCase() === 'mandeep@freshoz.com'
  let topicPrefix: string

  if (isAdmin) {
    topicPrefix = 'farm/+'   // admin can subscribe to any device
  } else {
    const { data: rows, error: devErr } = await supabase
      .from('farms')
      .select('farm_devices(mqtt_base_topic, device_id)')
      .eq('owner_id', userId)
      .limit(1)
    if (devErr) return json(500, { error: 'lookup_failed', detail: devErr.message })
    const device = rows?.[0]?.farm_devices?.[0]
    if (!device) return json(403, { error: 'no_device_assigned' })
    if (!device.mqtt_base_topic && !device.device_id) {
      return json(403, { error: 'device_not_provisioned' })
    }
    topicPrefix = device.mqtt_base_topic
      ?? `farm/${String(device.device_id).toLowerCase()}`
  }

  // 3. Mint creds based on MODE.
  if (MODE === 'shared') {
    if (!SHARED_USER || !SHARED_PASS) {
      return json(500, { error: 'shared_creds_not_configured' })
    }
    return json(200, {
      mode:        'shared',
      host:        MQTT_HOST,
      port:        8884,
      username:    SHARED_USER,
      password:    SHARED_PASS,
      topicPrefix,
      // Shared creds don't expire on their own — refresh hourly anyway.
      expiresAt:   new Date(Date.now() + 60 * 60_000).toISOString(),
      warning:     'shared_creds — every customer gets the same broker user. Switch MQTT_CREDS_MODE=hivemq after wiring per-customer users in HiveMQ Cloud.',
    })
  }

  if (MODE === 'hivemq') {
    // TODO: call HiveMQ Cloud Console REST API to either mint a session
    // credential or look up a pre-provisioned per-customer user, and return
    // it. Schema in the response stays the same so the client doesn't care
    // which mode is active.
    //
    // Implementation notes for whoever wires this up:
    //   - HIVEMQ_API_TOKEN: API token from HiveMQ Cloud Console
    //   - HIVEMQ_CLUSTER_ID: the cluster's id
    //   - For each user, set ACL: subscribe + publish on `<topicPrefix>/#`
    //   - Suggest 1h short-lived password rotation; cache in Postgres so
    //     repeated calls within the window return the same value
    return json(501, {
      error: 'hivemq_mode_not_implemented',
      detail: 'Set up HIVEMQ_API_TOKEN and per-customer ACLs, then complete the hivemq branch in this function.',
    })
  }

  return json(500, { error: 'unknown_mode', mode: MODE })
})

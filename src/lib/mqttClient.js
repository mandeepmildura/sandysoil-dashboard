import mqtt from 'mqtt'
import { mqttMatch } from './mqttMatch'
import { supabase } from './supabase'

/**
 * MQTT client with credential resolution at runtime.
 *
 * Two paths:
 *   1. PRODUCTION — fetches per-session creds from the issue-mqtt-creds
 *      Edge Function. Each customer gets creds scoped to their topic prefix
 *      so a leaked client bundle can't spy on or control other farms.
 *
 *   2. DEV / FALLBACK — if VITE_MQTT_USER / VITE_MQTT_PASS are set in
 *      env, we use them directly. This keeps `vite dev` and CI-style
 *      smoke runs working without a Supabase session. Production builds
 *      should NOT set these env vars.
 *
 * Either way, the dashboard never sees the creds in the published bundle
 * once the Edge Function path is in use.
 */

const HOST_FALLBACK = import.meta.env.VITE_MQTT_HOST
const USER_FALLBACK = import.meta.env.VITE_MQTT_USER
const PASS_FALLBACK = import.meta.env.VITE_MQTT_PASS

let _client    = null
let _pending   = null
let _credsPromise = null
const _subs    = new Map() // topic → Set of callbacks
const _cache   = new Map() // topic → last payload (persists across page navigation)

async function fetchCreds() {
  // Cache for 50 minutes — Edge Function returns 60-min creds
  if (_credsPromise) return _credsPromise

  _credsPromise = (async () => {
    // Try the Edge Function first.
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (token) {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/issue-mqtt-creds`
        const res = await fetch(url, {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type':  'application/json',
          },
        })
        if (res.ok) {
          const j = await res.json()
          if (j?.username && j?.password && j?.host) {
            return { host: j.host, user: j.username, pass: j.password }
          }
        } else {
          console.warn('[mqttClient] issue-mqtt-creds returned', res.status)
        }
      }
    } catch (err) {
      console.warn('[mqttClient] failed to fetch issued creds:', err)
    }

    // Fallback to bundled VITE env (dev only — should NOT be set in prod).
    if (USER_FALLBACK && PASS_FALLBACK) {
      console.warn('[mqttClient] using bundled VITE_MQTT_* fallback — only acceptable in dev')
      return { host: HOST_FALLBACK, user: USER_FALLBACK, pass: PASS_FALLBACK }
    }

    throw new Error('No MQTT credentials available — sign in or set VITE_MQTT_* in dev')
  })()

  // Clear the cache on rejection so the next call can retry instead of
  // returning a permanently poisoned rejected Promise.
  _credsPromise.catch(() => { _credsPromise = null })

  // Refresh creds periodically so a long-lived tab eventually rotates.
  setTimeout(() => { _credsPromise = null }, 50 * 60_000)

  return _credsPromise
}

async function getClient() {
  if (_client?.connected) return _client
  if (_pending) return _pending

  _pending = (async () => {
    const { host, user, pass } = await fetchCreds()
    return new Promise((resolve, reject) => {
      const c = mqtt.connect(`wss://${host}:8884/mqtt`, {
        username:        user,
        password:        pass,
        clientId:        `sandysoil-dash-${Math.random().toString(16).slice(2, 8)}`,
        clean:           true,
        reconnectPeriod: 3000,
      })

      c.on('connect', () => {
        _client  = c
        _pending = null
        // Re-subscribe to all active topics after reconnect
        for (const topic of _subs.keys()) c.subscribe(topic)
        resolve(c)
      })

      c.on('message', (topic, buf) => {
        let payload
        try { payload = JSON.parse(buf.toString()) }
        catch { payload = buf.toString() }

        _cache.set(topic, payload)

        // Exact match
        const exact = _subs.get(topic)
        if (exact) exact.forEach(cb => cb(payload, topic))

        // Wildcard match (e.g. 'farm/+/zone/+/state')
        for (const [pattern, cbs] of _subs.entries()) {
          if ((pattern.includes('+') || pattern.includes('#')) && mqttMatch(pattern, topic)) {
            cbs.forEach(cb => cb(payload, topic))
          }
        }
      })

      c.on('error',  (err) => { _pending = null; reject(err) })
      c.on('close',  ()    => { _client = null })
    })
  })()

  return _pending
}

/** Subscribe to a topic. Returns an unsubscribe function. */
export async function mqttSubscribe(topic, callback) {
  const c = await getClient()
  if (!_subs.has(topic)) {
    _subs.set(topic, new Set())
    c.subscribe(topic)
  }
  _subs.get(topic).add(callback)
  return () => {
    const set = _subs.get(topic)
    if (!set) return
    set.delete(callback)
    if (set.size === 0) {
      _subs.delete(topic)
      _client?.unsubscribe(topic)
    }
  }
}

/** Publish a message. */
export async function mqttPublish(topic, payload, qos = 1) {
  const c = await getClient()
  const msg = typeof payload === 'object' ? JSON.stringify(payload) : String(payload)
  return new Promise((resolve, reject) => {
    c.publish(topic, msg, { qos }, err => (err ? reject(err) : resolve()))
  })
}

/** Returns all cached topic payloads as a plain object { topic: payload } */
export function getMqttCache() {
  return Object.fromEntries(_cache)
}

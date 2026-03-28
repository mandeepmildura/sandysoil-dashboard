import mqtt from 'mqtt'

const HOST = import.meta.env.VITE_MQTT_HOST
const USER = import.meta.env.VITE_MQTT_USER
const PASS = import.meta.env.VITE_MQTT_PASS

let _client    = null
let _pending   = null
const _subs    = new Map() // topic → Set of callbacks
const _cache   = new Map() // topic → last payload (persists across page navigation)

function getClient() {
  if (_client?.connected) return Promise.resolve(_client)
  if (_pending) return _pending

  _pending = new Promise((resolve, reject) => {
    const c = mqtt.connect(`wss://${HOST}:8884/mqtt`, {
      username:        USER,
      password:        PASS,
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

      // Wildcard match (e.g. 'farm/irrigation1/zone/+/state')
      for (const [pattern, cbs] of _subs.entries()) {
        if (pattern.includes('+') && mqttMatch(pattern, topic)) {
          cbs.forEach(cb => cb(payload, topic))
        }
      }
    })

    c.on('error',  (err) => { _pending = null; reject(err) })
    c.on('close',  ()    => { _client = null })
  })

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

/** Simple MQTT wildcard matcher for single-level '+' wildcards */
function mqttMatch(pattern, topic) {
  const p = pattern.split('/')
  const t = topic.split('/')
  if (p.length !== t.length) return false
  return p.every((seg, i) => seg === '+' || seg === t[i])
}

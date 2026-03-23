import mqtt from 'mqtt'

const HOST = import.meta.env.VITE_MQTT_HOST
const USER = import.meta.env.VITE_MQTT_USER
const PASS = import.meta.env.VITE_MQTT_PASS

let _client = null
let _pending = null

/**
 * Returns a connected mqtt.js client (singleton).
 * Connects on first call via WSS port 8884.
 */
function getClient() {
  if (_client?.connected) return Promise.resolve(_client)
  if (_pending) return _pending

  _pending = new Promise((resolve, reject) => {
    const c = mqtt.connect(`wss://${HOST}:8884/mqtt`, {
      username:  USER,
      password:  PASS,
      clientId:  `sandysoil-dash-${Math.random().toString(16).slice(2, 8)}`,
      clean:     true,
      reconnectPeriod: 3000,
    })
    c.on('connect', () => {
      _client  = c
      _pending = null
      resolve(c)
    })
    c.on('error', (err) => {
      _pending = null
      reject(err)
    })
    c.on('close', () => {
      _client = null
    })
  })

  return _pending
}

/**
 * Publish a message. Payload can be string or object (auto-serialised).
 */
export async function mqttPublish(topic, payload, qos = 1) {
  const c = await getClient()
  const msg = typeof payload === 'object' ? JSON.stringify(payload) : String(payload)
  return new Promise((resolve, reject) => {
    c.publish(topic, msg, { qos }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

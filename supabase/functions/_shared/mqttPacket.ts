/**
 * Shared MQTT 3.1.1 helpers for the Supabase Edge Functions.
 *
 * Both run-program-queue and log-a6v3-pressure previously kept their own
 * copies of these packet encoders; any drift between copies would break one
 * function silently. Single source of truth, unit tested in Node via
 * Vitest at tests/mqttPacket.test.ts.
 */

// ── Encoders ──────────────────────────────────────────────────────────────────

/** MQTT "Remaining Length" varint encoder (1–4 bytes). */
export function encodeLen(n: number): number[] {
  const out: number[] = []
  do {
    let b = n % 128
    n = Math.floor(n / 128)
    if (n > 0) b |= 128
    out.push(b)
  } while (n > 0)
  return out
}

/** UTF-8 string prefixed with 2-byte big-endian length. */
export function utf8Prefixed(s: string): number[] {
  const b = [...new TextEncoder().encode(s)]
  return [(b.length >> 8) & 0xff, b.length & 0xff, ...b]
}

/**
 * CONNECT packet.
 * Protocol name 'MQTT', level 4, flags: user+pass+clean (0b11000010),
 * keepalive 30 s.
 */
export function buildConnect(user: string, pass: string, clientId: string): Uint8Array {
  const payload = [
    ...utf8Prefixed(clientId),
    ...utf8Prefixed(user),
    ...utf8Prefixed(pass),
  ]
  const varHdr = [0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0b11000010, 0x00, 0x1e]
  const rem = [...varHdr, ...payload]
  return new Uint8Array([0x10, ...encodeLen(rem.length), ...rem])
}

/** PUBLISH packet with QoS 1 (requires packet id + expects PUBACK). */
export function buildPublish(topic: string, payload: string, pid: number): Uint8Array {
  const tp = [...new TextEncoder().encode(topic)]
  const pp = [...new TextEncoder().encode(payload)]
  const rem = [
    (tp.length >> 8) & 0xff, tp.length & 0xff, ...tp,
    (pid >> 8) & 0xff, pid & 0xff,
    ...pp,
  ]
  return new Uint8Array([0x32, ...encodeLen(rem.length), ...rem])
}

/** SUBSCRIBE packet with QoS 0 (fire-and-forget, broker replies SUBACK). */
export function buildSubscribe(topic: string, pid: number): Uint8Array {
  const tp = [...new TextEncoder().encode(topic)]
  const payload = [(tp.length >> 8) & 0xff, tp.length & 0xff, ...tp, 0x00] // requested QoS 0
  const rem = [(pid >> 8) & 0xff, pid & 0xff, ...payload]
  return new Uint8Array([0x82, ...encodeLen(rem.length), ...rem])
}

/** DISCONNECT packet (fixed 2 bytes). */
export function buildDisconnect(): Uint8Array {
  return new Uint8Array([0xe0, 0x00])
}

// ── Decoders ──────────────────────────────────────────────────────────────────

/**
 * Parse a raw MQTT PUBLISH packet into { topic, payload }.
 * Returns null if the packet isn't a PUBLISH or is malformed.
 */
export function parseMqttPublish(data: Uint8Array): { topic: string; payload: string } | null {
  try {
    const type = data[0] >> 4
    if (type !== 3) return null

    // Decode remaining length (up to 4 bytes of varint)
    let offset = 1
    let mult = 1
    let remainLen = 0
    do {
      const b = data[offset++]
      remainLen += (b & 0x7f) * mult
      mult *= 128
    } while (data[offset - 1] & 0x80)

    const topicLen = (data[offset] << 8) | data[offset + 1]
    offset += 2
    const topic = new TextDecoder().decode(data.slice(offset, offset + topicLen))
    offset += topicLen

    // Skip packet ID if QoS > 0
    const qos = (data[0] >> 1) & 0x03
    if (qos > 0) offset += 2

    const payload = new TextDecoder().decode(data.slice(offset))
    return { topic, payload }
  } catch {
    return null
  }
}

// ── A6v3 ADC conversion ─────────────────────────────────────────────────────

/**
 * Convert an A6v3 ADC1 raw reading (0–4095) to PSI (0–`maxPsi`, default 116).
 * Returns a number rounded to 2 decimal places.
 */
export function adcToPsi(adc: number, maxPsi = 116): number {
  return parseFloat(((adc / 4095) * maxPsi).toFixed(2))
}

/**
 * Hand-rolled MQTT 3.1.1 binary packet encoders.
 *
 * Used by run-program-queue to talk to HiveMQ over a raw Deno WebSocket —
 * avoids any npm / Node.js compatibility issues that mqtt.js would bring in.
 *
 * Everything here is pure (input → Uint8Array) so it can be unit tested in
 * Node via Vitest.
 *
 * References:
 *   MQTT 3.1.1 spec: https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html
 */

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

/**
 * PUBLISH packet with QoS 1 (requires packet id + expects PUBACK).
 */
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

/** DISCONNECT packet (fixed 2 bytes). */
export function buildDisconnect(): Uint8Array {
  return new Uint8Array([0xe0, 0x00])
}

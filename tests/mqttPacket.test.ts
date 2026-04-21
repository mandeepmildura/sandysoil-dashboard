import { describe, it, expect } from 'vitest'
import {
  encodeLen,
  utf8Prefixed,
  buildConnect,
  buildPublish,
  buildDisconnect,
} from '../supabase/functions/run-program-queue/lib/mqttPacket.ts'

describe('encodeLen (MQTT remaining-length varint)', () => {
  it('encodes 0 as a single zero byte', () => {
    expect(encodeLen(0)).toEqual([0x00])
  })

  it('encodes 127 as a single byte (top bit clear)', () => {
    expect(encodeLen(127)).toEqual([0x7f])
  })

  it('encodes 128 as two bytes — spec example', () => {
    // 128 → 0x80, 0x01 (continuation bit set on first byte)
    expect(encodeLen(128)).toEqual([0x80, 0x01])
  })

  it('encodes 16383 as two bytes', () => {
    expect(encodeLen(16383)).toEqual([0xff, 0x7f])
  })

  it('encodes 16384 as three bytes', () => {
    expect(encodeLen(16384)).toEqual([0x80, 0x80, 0x01])
  })

  it('encodes 2097151 as three bytes (3-byte max)', () => {
    expect(encodeLen(2097151)).toEqual([0xff, 0xff, 0x7f])
  })

  it('encodes 2097152 as four bytes', () => {
    expect(encodeLen(2097152)).toEqual([0x80, 0x80, 0x80, 0x01])
  })
})

describe('utf8Prefixed', () => {
  it('prepends 2-byte big-endian length to an ASCII string', () => {
    expect(utf8Prefixed('MQTT')).toEqual([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54])
  })

  it('handles the empty string', () => {
    expect(utf8Prefixed('')).toEqual([0x00, 0x00])
  })

  it('encodes multi-byte UTF-8 correctly (length is bytes, not chars)', () => {
    // 'é' is 0xc3 0xa9 in UTF-8 → length 2
    const out = utf8Prefixed('é')
    expect(out.slice(0, 2)).toEqual([0x00, 0x02])
    expect(out.slice(2)).toEqual([0xc3, 0xa9])
  })
})

describe('buildConnect', () => {
  it('starts with 0x10 (CONNECT control byte)', () => {
    const pkt = buildConnect('u', 'p', 'c')
    expect(pkt[0]).toBe(0x10)
  })

  it('contains protocol name MQTT (0x4d 0x51 0x54 0x54) after varint + length prefix', () => {
    const pkt = buildConnect('u', 'p', 'c')
    // After control byte (1) + varint len (1 for this small payload) + 2-byte len prefix 0x00 0x04
    expect(Array.from(pkt.slice(2, 8))).toEqual([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54])
  })

  it('advertises protocol level 4 and connect flags 0xc2 (user+pass+clean)', () => {
    const pkt = buildConnect('u', 'p', 'c')
    // protocol level at offset 8, flags at offset 9
    expect(pkt[8]).toBe(0x04)
    expect(pkt[9]).toBe(0b11000010)
  })

  it('encodes keepalive as 30 seconds (0x00 0x1e)', () => {
    const pkt = buildConnect('u', 'p', 'c')
    expect(pkt[10]).toBe(0x00)
    expect(pkt[11]).toBe(0x1e)
  })

  it('includes clientId, username, password in that order at the tail', () => {
    const pkt = buildConnect('usr', 'pwd', 'id')
    // After the 10-byte variable header, payload = [len-id id] [len-usr usr] [len-pwd pwd]
    const payload = Array.from(pkt.slice(12))
    expect(payload).toEqual([
      0x00, 0x02, 0x69, 0x64,                         // "id"
      0x00, 0x03, 0x75, 0x73, 0x72,                   // "usr"
      0x00, 0x03, 0x70, 0x77, 0x64,                   // "pwd"
    ])
  })
})

describe('buildPublish', () => {
  it('starts with 0x32 (PUBLISH, QoS 1, no DUP, no RETAIN)', () => {
    const pkt = buildPublish('a/b', 'x', 1)
    expect(pkt[0]).toBe(0x32)
  })

  it('encodes topic, packet-id, and payload in order', () => {
    const pkt = buildPublish('a/b', 'hi', 0x0102)
    // control(1) + remLen(1) = header = 2 bytes
    const body = Array.from(pkt.slice(2))
    expect(body).toEqual([
      0x00, 0x03, 0x61, 0x2f, 0x62,   // "a/b"
      0x01, 0x02,                     // packet id 0x0102
      0x68, 0x69,                     // "hi"
    ])
  })

  it('computes the remaining-length varint correctly', () => {
    const pkt = buildPublish('t', 'payload', 1)
    // rem = 2 + 1 (topic) + 2 (pid) + 7 (payload) = 12
    expect(pkt[1]).toBe(12)
    // total buffer = 1 (control) + 1 (varint) + 12 = 14
    expect(pkt.length).toBe(14)
  })

  it('splits remaining-length across 2 bytes when payload is > 127', () => {
    const pkt = buildPublish('t', 'x'.repeat(200), 1)
    // rem = 2 + 1 + 2 + 200 = 205 → encodes as 0xcd 0x01
    expect(pkt[1]).toBe(0xcd)
    expect(pkt[2]).toBe(0x01)
  })

  it('round-trips big-endian packet ids', () => {
    const pkt = buildPublish('t', '', 0xabcd)
    // Layout: [control 0x32] [remLen] [topicLen hi] [topicLen lo] ['t'] [pid hi] [pid lo]
    expect(Array.from(pkt.slice(5, 7))).toEqual([0xab, 0xcd])
  })
})

describe('buildDisconnect', () => {
  it('is the fixed 2-byte DISCONNECT packet', () => {
    expect(Array.from(buildDisconnect())).toEqual([0xe0, 0x00])
  })
})

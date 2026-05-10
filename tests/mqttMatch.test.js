import { describe, it, expect } from 'vitest'
import { mqttMatch } from '../src/lib/mqttMatch'

describe('mqttMatch', () => {
  it('matches an exact literal topic', () => {
    expect(mqttMatch('farm/irrigation1/status', 'farm/irrigation1/status')).toBe(true)
  })

  it('rejects a different literal topic', () => {
    expect(mqttMatch('farm/irrigation1/status', 'farm/filter1/status')).toBe(false)
  })

  it('rejects topics with a different segment count (no-wildcard)', () => {
    expect(mqttMatch('a/b', 'a/b/c')).toBe(false)
    expect(mqttMatch('a/b/c', 'a/b')).toBe(false)
  })

  it('matches a single-level + wildcard', () => {
    expect(mqttMatch('farm/irrigation1/zone/+/state', 'farm/irrigation1/zone/3/state')).toBe(true)
  })

  it('rejects when the wildcard segment is split by another slash', () => {
    // '+' must not cross levels
    expect(mqttMatch('farm/irrigation1/zone/+/state', 'farm/irrigation1/zone/3/extra/state')).toBe(false)
  })

  it('allows + at any position including the first and last', () => {
    expect(mqttMatch('+/b/c', 'x/b/c')).toBe(true)
    expect(mqttMatch('a/+/c', 'a/y/c')).toBe(true)
    expect(mqttMatch('a/b/+', 'a/b/z')).toBe(true)
  })

  it('supports multiple + wildcards in the same pattern', () => {
    expect(mqttMatch('+/b/+', 'x/b/z')).toBe(true)
    expect(mqttMatch('+/b/+', 'x/c/z')).toBe(false)
  })

  it('rejects mismatched non-wildcard segment even when other segments are wildcards', () => {
    expect(mqttMatch('farm/+/status', 'farm/filter1/pressure')).toBe(false)
  })

  it('handles empty-segment edge cases (same number of empties)', () => {
    // Empty topics should still compare by segment count
    expect(mqttMatch('', '')).toBe(true)
    expect(mqttMatch('', 'a')).toBe(false)
  })
})

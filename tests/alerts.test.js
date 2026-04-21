import { describe, it, expect, beforeEach, vi } from 'vitest'

// Supabase mock shared between raiseAlert / resolveAlerts
const rec = { existing: [], inserts: [], updates: [], selectFilters: {} }

function makeInsert() {
  return vi.fn((row) => {
    rec.inserts.push(row)
    return Promise.resolve({ error: null })
  })
}

function makeSelectChain() {
  const chain = {
    eq:    vi.fn((col, v) => { rec.selectFilters[col] = v; return chain }),
    gte:   vi.fn((col, v) => { rec.selectFilters[`${col}__gte`] = v; return chain }),
    limit: vi.fn(() => Promise.resolve({ data: rec.existing, error: null })),
  }
  return chain
}

function makeUpdateChain() {
  let patch
  const chain = {
    eq: vi.fn((col, v) => {
      rec.updates.push({ col, v, patch })
      return Promise.resolve({ error: null })
    }),
  }
  return { chain, setPatch: (p) => { patch = p } }
}

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: makeInsert(),
      select: () => makeSelectChain(),
      update: (patch) => {
        const u = makeUpdateChain()
        u.setPatch(patch)
        // Chain: update().eq().eq().eq()
        let lastPatch = patch
        const chain = {
          eq: vi.fn(function handler(col, v) {
            rec.updates.push({ col, v, patch: lastPatch })
            return { eq: handler, then: (cb) => cb({ error: null }) }
          }),
        }
        return chain
      },
    }),
  },
}))

import { raiseAlert, resolveAlerts } from '../src/lib/alerts'

beforeEach(() => {
  rec.existing = []
  rec.inserts.length = 0
  rec.updates.length = 0
  rec.selectFilters = {}
})

describe('raiseAlert', () => {
  it('inserts a new alert when no matching unacknowledged row exists', async () => {
    rec.existing = []
    await raiseAlert({
      severity: 'fault', title: 'A6v3 offline',
      description: 'No MQTT message from A6v3.', device: 'A6v3', device_id: '8CBF...',
    })
    expect(rec.inserts).toHaveLength(1)
    expect(rec.inserts[0]).toMatchObject({
      severity: 'fault',
      title: 'A6v3 offline',
      device: 'A6v3',
      device_id: '8CBF...',
      acknowledged: false,
    })
  })

  it('defaults severity to warning and blanks out missing fields', async () => {
    rec.existing = []
    await raiseAlert({ title: 'mystery' })
    expect(rec.inserts[0]).toMatchObject({
      severity: 'warning',
      title: 'mystery',
      description: '',
      device: '',
      device_id: '',
      acknowledged: false,
    })
  })

  it('dedupes: skips insert when a matching unacked row is inside the window', async () => {
    rec.existing = [{ id: 'dup-1' }]
    await raiseAlert({ severity: 'fault', title: 'A6v3 offline', device: 'A6v3' })
    expect(rec.inserts).toHaveLength(0)
  })

  it('filters existing by device + title + acknowledged=false', async () => {
    rec.existing = []
    await raiseAlert({ title: 'mytitle', device: 'mydev' })
    expect(rec.selectFilters.device).toBe('mydev')
    expect(rec.selectFilters.title).toBe('mytitle')
    expect(rec.selectFilters.acknowledged).toBe(false)
  })

  it('honours custom dedup window (15 min cutoff)', async () => {
    rec.existing = []
    const before = Date.now()
    await raiseAlert({ title: 'X', device: 'd' }, 15)
    const after = Date.now()
    const cutoff = Date.parse(rec.selectFilters['created_at__gte'])
    expect(cutoff).toBeGreaterThanOrEqual(before - 15 * 60_000)
    expect(cutoff).toBeLessThanOrEqual(after   - 15 * 60_000 + 50)
  })

  it('swallows errors so a failed dedup lookup does not crash the caller', async () => {
    // Re-mock supabase.from to throw
    const { supabase } = await import('../src/lib/supabase')
    const original = supabase.from
    supabase.from = () => { throw new Error('boom') }
    await expect(raiseAlert({ title: 'x' })).resolves.toBeUndefined()
    supabase.from = original
  })
})

describe('resolveAlerts', () => {
  it('issues an update against device + title + acknowledged=false', async () => {
    await resolveAlerts('A6v3', 'A6v3 offline')
    // Three .eq() calls feed into the chain
    const cols = rec.updates.map(u => u.col)
    expect(cols).toEqual(['device', 'title', 'acknowledged'])
    const byCol = Object.fromEntries(rec.updates.map(u => [u.col, u.v]))
    expect(byCol.device).toBe('A6v3')
    expect(byCol.title).toBe('A6v3 offline')
    expect(byCol.acknowledged).toBe(false)
    // And the patch is { acknowledged: true }
    expect(rec.updates[0].patch).toEqual({ acknowledged: true })
  })
})

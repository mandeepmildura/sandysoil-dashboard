// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'

// ── Mock commands ───────────────────────────────────────────────────────────
const zoneOn = vi.fn(() => Promise.resolve())

vi.mock('../src/lib/commands', () => ({
  zoneOn: (...args) => zoneOn(...args),
}))

// ── Mock supabase ──────────────────────────────────────────────────────────
// Exposes tableData[name] so each test can set what from(name).select() resolves to.
const tableData = {}
const inserts   = []

function makeBuilder(name) {
  const builder = {
    select: () => builder,
    eq:     () => builder,
    is:     () => builder,
    gte:    () => builder,
    order:  () => builder,
    limit:  () => builder,
    insert: vi.fn((rows) => {
      const list = Array.isArray(rows) ? rows : [rows]
      for (const r of list) inserts.push({ table: name, row: r })
      return Promise.resolve({ error: null })
    }),
    upsert: vi.fn(() => Promise.resolve({ error: null })),
    then(resolve, reject) {
      return Promise.resolve({ data: tableData[name] ?? [], error: null }).then(resolve, reject)
    },
  }
  return builder
}

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (name) => makeBuilder(name),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'u1' } } } })),
    },
  },
}))

import Calendar from '../src/pages/Calendar'

// ── Shared test data ───────────────────────────────────────────────────────
// 2026-04-21 is a Tuesday → JS getDay() === 2 (the DB convention).
const TODAY_DB_DOW = 2

const IRR_GROUP = {
  id:       'g-irr',
  name:     'Morning Irrigation',
  run_mode: 'sequential',
}
const IRR_MEMBERS = [
  { group_id: 'g-irr', zone_num: 1, duration_min: 15, sort_order: 0, device: 'irrigation1' },
  { group_id: 'g-irr', zone_num: 3, duration_min: 20, sort_order: 1, device: 'irrigation1' },
]
const IRR_SCHEDULE = {
  group_id:     'g-irr',
  label:        'Morning',
  days_of_week: [TODAY_DB_DOW],  // runs today
  start_time:   '06:00:00',
  enabled:      true,
}

const A6V3_GROUP = {
  id:       'g-a6v3',
  name:     'Drip Program',
  run_mode: 'parallel',
}
const A6V3_MEMBERS = [
  { group_id: 'g-a6v3', zone_num: 2, duration_min: 30, sort_order: 0, device: 'a6v3' },
]
const A6V3_SCHEDULE = {
  group_id:     'g-a6v3',
  label:        'Drip',
  days_of_week: [TODAY_DB_DOW],
  start_time:   '18:00:00',
  enabled:      true,
}

// ── Setup ──────────────────────────────────────────────────────────────────
beforeAll(() => {
  // Freeze "now" to Tue 2026-04-21 14:30 local.
  // Only fake Date — leave setTimeout real so waitFor's polling loop works.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 3, 21, 14, 30, 0))
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  cleanup()
  zoneOn.mockClear()
  for (const k of Object.keys(tableData)) delete tableData[k]
  inserts.length = 0
})

// Find the sidebar card (not the grid cells) for a given program name.
// The sidebar renders a <button> that contains both the start time and the
// program name; grid cells only contain the name alone.
function findSidebarButton(programName, startTime) {
  const buttons = screen.getAllByRole('button')
  return buttons.find(
    b => b.textContent?.includes(programName) && b.textContent?.includes(startTime)
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('<Calendar />', () => {
  it('shows a loading message before the schedule data resolves', () => {
    render(<Calendar />)
    expect(screen.getAllByText(/Loading schedules…/i).length).toBeGreaterThan(0)
  })

  it('renders today\'s programs in the sidebar once loaded', async () => {
    tableData.zone_groups         = [IRR_GROUP, A6V3_GROUP]
    tableData.zone_group_members  = [...IRR_MEMBERS, ...A6V3_MEMBERS]
    tableData.group_schedules     = [IRR_SCHEDULE, A6V3_SCHEDULE]

    render(<Calendar />)

    await waitFor(() => {
      expect(findSidebarButton('Morning Irrigation', '06:00')).toBeTruthy()
      expect(findSidebarButton('Drip Program', '18:00')).toBeTruthy()
    })
  })

  it('opens the event modal when a sidebar program is clicked', async () => {
    tableData.zone_groups         = [IRR_GROUP]
    tableData.zone_group_members  = IRR_MEMBERS
    tableData.group_schedules     = [IRR_SCHEDULE]

    render(<Calendar />)

    await waitFor(() => expect(findSidebarButton('Morning Irrigation', '06:00')).toBeTruthy())
    fireEvent.click(findSidebarButton('Morning Irrigation', '06:00'))

    expect(await screen.findByRole('button', { name: /Run Now/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Close$/ })).toBeTruthy()
    // Sequential mode label is rendered
    expect(screen.getByText(/sequential/i)).toBeTruthy()
  })

  it('inserts sequential program_queue steps for irrigation zones when "Run Now" is clicked', async () => {
    tableData.zone_groups         = [IRR_GROUP]
    tableData.zone_group_members  = IRR_MEMBERS
    tableData.group_schedules     = [IRR_SCHEDULE]

    render(<Calendar />)

    await waitFor(() => expect(findSidebarButton('Morning Irrigation', '06:00')).toBeTruthy())
    fireEvent.click(findSidebarButton('Morning Irrigation', '06:00'))
    fireEvent.click(await screen.findByRole('button', { name: /Run Now/i }))

    await waitFor(() => {
      expect(inserts.filter(i => i.table === 'program_queue')).toHaveLength(2)
    })

    const rows = inserts.filter(i => i.table === 'program_queue')
    // sort_order 0: zone 1, 15 min, fires immediately
    expect(rows[0].row).toMatchObject({ group_id: 'g-irr', step_type: 'on', device: 'irrigation1', zone_num: 1, duration_min: 15 })
    expect(new Date(rows[0].row.fire_at).getTime()).toBe(Date.now())
    // sort_order 1: zone 3, 20 min, fires after zone 1 completes (15 min offset)
    expect(rows[1].row).toMatchObject({ group_id: 'g-irr', step_type: 'on', device: 'irrigation1', zone_num: 3, duration_min: 20 })
    expect(new Date(rows[1].row.fire_at).getTime()).toBe(Date.now() + 15 * 60_000)
    // No direct MQTT calls — sequencing is handled by run-program-queue
    expect(zoneOn).not.toHaveBeenCalled()
  })

  it('inserts an on step and an explicit off step for a6v3 zones when "Run Now" is clicked', async () => {
    tableData.zone_groups         = [A6V3_GROUP]
    tableData.zone_group_members  = A6V3_MEMBERS
    tableData.group_schedules     = [A6V3_SCHEDULE]

    render(<Calendar />)

    await waitFor(() => expect(findSidebarButton('Drip Program', '18:00')).toBeTruthy())
    fireEvent.click(findSidebarButton('Drip Program', '18:00'))
    fireEvent.click(await screen.findByRole('button', { name: /Run Now/i }))

    await waitFor(() => {
      expect(inserts.filter(i => i.table === 'program_queue')).toHaveLength(2)
    })

    const rows = inserts.filter(i => i.table === 'program_queue')
    // on step fires immediately
    expect(rows[0].row).toMatchObject({ group_id: 'g-a6v3', step_type: 'on', device: 'a6v3', zone_num: 2, duration_min: 30 })
    expect(new Date(rows[0].row.fire_at).getTime()).toBe(Date.now())
    // off step fires after 30 min (A6v3 firmware has no auto-off)
    expect(rows[1].row).toMatchObject({ group_id: 'g-a6v3', step_type: 'off', device: 'a6v3', zone_num: 2 })
    expect(new Date(rows[1].row.fire_at).getTime()).toBe(Date.now() + 30 * 60_000)
    // No direct MQTT calls
    expect(zoneOn).not.toHaveBeenCalled()
  })

  it('opens Run Zone modal from the sidebar and fires zoneOn on Start', async () => {
    render(<Calendar />)

    // Wait for initial load so the layout is stable
    await waitFor(() => expect(screen.queryAllByText(/Loading schedules…/i).length).toBe(0))

    fireEvent.click(screen.getByRole('button', { name: /Run Zone Now/i }))

    // Modal title "Run Zone Now" is rendered as h2
    expect(await screen.findByRole('heading', { name: /Run Zone Now/i })).toBeTruthy()

    // Pick zone 3 and 45 min
    const selects = document.querySelectorAll('select')
    fireEvent.change(selects[0], { target: { value: '3' } })
    fireEvent.change(selects[1], { target: { value: '45' } })

    fireEvent.click(screen.getByRole('button', { name: /Start Zone/i }))

    await waitFor(() => expect(zoneOn).toHaveBeenCalledWith(
      3, 45, 'manual', { prefix: 'farm/irrigation1', device: 'irrigation1' }
    ))
  })
})

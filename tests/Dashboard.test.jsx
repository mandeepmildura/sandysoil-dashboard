// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mock commands ──────────────────────────────────────────────────────────
const zoneOn        = vi.fn(() => Promise.resolve())
const zoneOff       = vi.fn(() => Promise.resolve())
const allZonesOff   = vi.fn(() => Promise.resolve())
const startBackwash = vi.fn(() => Promise.resolve())

vi.mock('../src/lib/commands', () => ({
  zoneOn:        (...args) => zoneOn(...args),
  zoneOff:       (...args) => zoneOff(...args),
  allZonesOff:   (...args) => allZonesOff(...args),
  startBackwash: (...args) => startBackwash(...args),
}))

// ── Mock hooks (keeps the test isolated from MQTT + Supabase) ──────────────
let telemetryData = {}
let telemetryConnected = true

vi.mock('../src/hooks/useLiveTelemetry', () => ({
  useLiveTelemetry: () => ({ data: telemetryData, connected: telemetryConnected }),
}))

vi.mock('../src/hooks/useZoneNames', () => ({
  useZoneNames: () => ({ names: {}, renameZone: vi.fn() }),
}))

let groupSchedulesData = []
vi.mock('../src/hooks/useScheduleRules', () => ({
  useScheduleRules: () => ({ zoneSchedules: [], groupSchedules: groupSchedulesData, loading: false }),
}))

let alertsData = []
vi.mock('../src/hooks/useAlerts', () => ({
  useAlerts: () => ({ alerts: alertsData, loading: false, reload: vi.fn(), acknowledge: vi.fn(), dismiss: vi.fn() }),
}))

// ── Mock Supabase (Dashboard pulls last-runs + pressure history) ───────────
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        eq:     () => builder,
        not:    () => builder,
        order:  () => builder,
        limit:  () => Promise.resolve({ data: [], error: null }),
      }
      return builder
    },
  },
}))

import Dashboard from '../src/pages/Dashboard'

const renderPage = () => render(<MemoryRouter><Dashboard /></MemoryRouter>)

// ── Setup ──────────────────────────────────────────────────────────────────
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 3, 21, 14, 30, 0))
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  cleanup()
  zoneOn.mockClear()
  zoneOff.mockClear()
  allZonesOff.mockClear()
  telemetryData = {}
  telemetryConnected = true
  groupSchedulesData = []
  alertsData = []
})

// ── Tests ──────────────────────────────────────────────────────────────────
describe('<Dashboard />', () => {
  it('renders the Farm Overview heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /Farm Overview/i })).toBeTruthy()
  })

  it('shows "Live" when the telemetry connection is up', () => {
    telemetryConnected = true
    renderPage()
    expect(screen.getByText('Live')).toBeTruthy()
  })

  it('shows "Connecting…" when the telemetry connection is down', () => {
    telemetryConnected = false
    renderPage()
    expect(screen.getByText(/Connecting/)).toBeTruthy()
  })

  it('disables the All Zones Off button when no zones are on', () => {
    telemetryData = {
      'farm/irrigation1/status': {
        online: true,
        zones: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}`, on: false, state: 'off' })),
      },
    }
    renderPage()
    const btn = screen.getByRole('button', { name: /All Zones Off/i })
    expect(btn.disabled).toBe(true)
  })

  it('enables All Zones Off when at least one zone is on, and fires allZonesOff on click', () => {
    telemetryData = {
      'farm/irrigation1/status': {
        online: true,
        zones: [
          { id: 1, name: 'Zone 1', on: true, state: 'manual' },
          ...Array.from({ length: 7 }, (_, i) => ({ id: i + 2, name: `Zone ${i + 2}`, on: false, state: 'off' })),
        ],
      },
    }
    renderPage()
    const btn = screen.getByRole('button', { name: /All Zones Off/i })
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(allZonesOff).toHaveBeenCalledTimes(1)
  })

  it('reflects overlaid per-zone state topics on top of the base status', () => {
    telemetryData = {
      'farm/irrigation1/status': {
        online: true,
        zones: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}`, on: false, state: 'off' })),
      },
      // A per-zone update flips zone 4 on — it should override the base zone
      'farm/irrigation1/zone/4/state': { zone: 4, name: 'Zone 4', on: true, state: 'manual' },
    }
    renderPage()
    // Once at least one zone is on, the "All Zones Off" button becomes enabled
    const btn = screen.getByRole('button', { name: /All Zones Off/i })
    expect(btn.disabled).toBe(false)
  })
})

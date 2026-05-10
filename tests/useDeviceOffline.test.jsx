// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const raiseAlert    = vi.fn(() => Promise.resolve())
const resolveAlerts = vi.fn(() => Promise.resolve())

vi.mock('../src/lib/alerts', () => ({
  raiseAlert:    (...args) => raiseAlert(...args),
  resolveAlerts: (...args) => resolveAlerts(...args),
}))

import { useDeviceOffline } from '../src/hooks/useDeviceOffline'

const FIVE_MIN = 5 * 60_000

beforeEach(() => {
  // Only fake the timer APIs the hook uses. Faking microtasks
  // (queueMicrotask / process.nextTick) hangs React's render flushing
  // inside @testing-library/react's renderHook on Windows + happy-dom.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  raiseAlert.mockClear()
  resolveAlerts.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDeviceOffline', () => {
  it('does nothing while lastMessage is null (initial mount)', () => {
    renderHook(() => useDeviceOffline('A6v3', 'SN', null))
    act(() => { vi.advanceTimersByTime(FIVE_MIN + 1_000) })
    expect(raiseAlert).not.toHaveBeenCalled()
    expect(resolveAlerts).not.toHaveBeenCalled()
  })

  it('raises an offline alert after timeoutMs of silence from the first message', () => {
    const { rerender } = renderHook(
      ({ msg }) => useDeviceOffline('A6v3', 'SN', msg),
      { initialProps: { msg: null } },
    )

    // First real message arrives → timer starts
    rerender({ msg: { seq: 1 } })

    // Just before timeout: no alert yet
    act(() => { vi.advanceTimersByTime(FIVE_MIN - 1) })
    expect(raiseAlert).not.toHaveBeenCalled()

    // Cross the threshold
    act(() => { vi.advanceTimersByTime(2) })
    expect(raiseAlert).toHaveBeenCalledTimes(1)

    const [payload, dedup] = raiseAlert.mock.calls[0]
    expect(payload).toMatchObject({
      severity:  'fault',
      title:     'A6v3 offline',
      device:    'A6v3',
      device_id: 'SN',
    })
    expect(payload.description).toContain('A6v3')
    expect(payload.description).toContain('SN')
    expect(payload.description).toContain('5 min')
    expect(dedup).toBe(60)
  })

  it('resets the timer every time a new message arrives', () => {
    const { rerender } = renderHook(
      ({ msg }) => useDeviceOffline('A6v3', 'SN', msg),
      { initialProps: { msg: null } },
    )

    rerender({ msg: { seq: 1 } })
    act(() => { vi.advanceTimersByTime(FIVE_MIN - 10) })

    // New message arrives just before the timeout would fire
    rerender({ msg: { seq: 2 } })

    // Advance past the original deadline — should NOT fire, because the
    // timer got reset by the new message
    act(() => { vi.advanceTimersByTime(20) })
    expect(raiseAlert).not.toHaveBeenCalled()

    // Advance the full window from the new message — now it fires
    act(() => { vi.advanceTimersByTime(FIVE_MIN) })
    expect(raiseAlert).toHaveBeenCalledTimes(1)
  })

  it('calls resolveAlerts exactly once when the device comes back online', () => {
    const { rerender } = renderHook(
      ({ msg }) => useDeviceOffline('A6v3', 'SN', msg),
      { initialProps: { msg: null } },
    )

    // First message → timer starts → times out → device marked offline
    rerender({ msg: { seq: 1 } })
    act(() => { vi.advanceTimersByTime(FIVE_MIN + 1) })
    expect(raiseAlert).toHaveBeenCalledTimes(1)

    // A new message arrives → recovery
    rerender({ msg: { seq: 2 } })
    expect(resolveAlerts).toHaveBeenCalledTimes(1)
    expect(resolveAlerts).toHaveBeenCalledWith('A6v3', 'A6v3 offline')

    // Subsequent messages while online should NOT re-resolve
    rerender({ msg: { seq: 3 } })
    rerender({ msg: { seq: 4 } })
    expect(resolveAlerts).toHaveBeenCalledTimes(1)
  })

  it('does not call resolveAlerts on normal traffic (never went offline)', () => {
    const { rerender } = renderHook(
      ({ msg }) => useDeviceOffline('A6v3', 'SN', msg),
      { initialProps: { msg: null } },
    )

    rerender({ msg: { seq: 1 } })
    rerender({ msg: { seq: 2 } })
    rerender({ msg: { seq: 3 } })

    expect(raiseAlert).not.toHaveBeenCalled()
    expect(resolveAlerts).not.toHaveBeenCalled()
  })

  it('honours a custom timeoutMs', () => {
    const { rerender } = renderHook(
      ({ msg }) => useDeviceOffline('B16M', 'SN2', msg, 30_000),
      { initialProps: { msg: null } },
    )

    rerender({ msg: { seq: 1 } })

    // Default (5 min) would not fire at 40 s; custom 30 s should
    act(() => { vi.advanceTimersByTime(30_001) })
    expect(raiseAlert).toHaveBeenCalledTimes(1)

    const [payload] = raiseAlert.mock.calls[0]
    // description rounds ms → minutes: 30 000 ms = 1 min
    expect(payload.description).toContain('1 min')
    expect(payload.title).toBe('B16M offline')
    expect(payload.device_id).toBe('SN2')
  })

  it('clears the pending timer on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ msg }) => useDeviceOffline('A6v3', 'SN', msg),
      { initialProps: { msg: null } },
    )

    rerender({ msg: { seq: 1 } })
    unmount()

    act(() => { vi.advanceTimersByTime(FIVE_MIN * 2) })
    expect(raiseAlert).not.toHaveBeenCalled()
  })
})

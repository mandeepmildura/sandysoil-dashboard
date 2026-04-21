import { describe, it, expect } from 'vitest'
import {
  localDateStr,
  fmtTime,
  fmtDuration,
  relayGridCls,
  inputGridCols,
  gaugeColor,
} from '../src/lib/relayDevice'

describe('localDateStr', () => {
  it('formats as YYYY-MM-DD with zero-padded month and day', () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')   // Jan 5
    expect(localDateStr(new Date(2026, 11, 31))).toBe('2026-12-31') // Dec 31
  })

  it('defaults to today', () => {
    expect(localDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('fmtTime (RelayDevice flavour — "D/M HH:MM")', () => {
  it('returns em-dash for null / empty', () => {
    expect(fmtTime(null)).toBe('—')
    expect(fmtTime('')).toBe('—')
  })

  it('formats a timestamp with zero-padded hours and minutes but unpadded day/month', () => {
    // Use a constructor so TZ is local — avoids UTC shifts in CI
    const iso = new Date(2026, 3, 5, 7, 3, 0).toISOString()
    expect(fmtTime(iso)).toBe('5/4 07:03')
  })
})

describe('fmtDuration (decimal-minutes flavour)', () => {
  it('renders em-dash for null / undefined / non-finite', () => {
    expect(fmtDuration(null)).toBe('—')
    expect(fmtDuration(undefined)).toBe('—')
    expect(fmtDuration('not a number')).toBe('—')
  })

  it('renders sub-minute values as seconds (rounded)', () => {
    expect(fmtDuration(0.5)).toBe('30s')
    expect(fmtDuration(0.25)).toBe('15s')
    expect(fmtDuration(0.999)).toBe('60s')
  })

  it('renders 1+ min with one decimal place', () => {
    expect(fmtDuration(1)).toBe('1.0 min')
    expect(fmtDuration(2.345)).toBe('2.3 min')
  })

  it('accepts numeric strings (postgres returns numbers as strings via rest)', () => {
    expect(fmtDuration('5')).toBe('5.0 min')
  })
})

describe('relayGridCls', () => {
  it('uses a wider grid as the output count grows', () => {
    expect(relayGridCls(4)).toContain('xl:grid-cols-3')
    expect(relayGridCls(6)).toContain('xl:grid-cols-3')
    expect(relayGridCls(8)).toContain('xl:grid-cols-4')
    expect(relayGridCls(16)).toContain('sm:grid-cols-4')
  })
})

describe('inputGridCols', () => {
  it('uses 3 cols for up to 6 inputs, 4 cols above', () => {
    expect(inputGridCols(6)).toBe('grid-cols-3')
    expect(inputGridCols(7)).toBe('grid-cols-4')
    expect(inputGridCols(16)).toBe('grid-cols-4')
  })
})

describe('gaugeColor', () => {
  const MAX = 116

  it('returns green under ~69% of maxPsi', () => {
    expect(gaugeColor(0, MAX)).toBe('#0d631b')
    expect(gaugeColor(50, MAX)).toBe('#0d631b')
  })

  it('returns orange in the 69%–86% band', () => {
    expect(gaugeColor(MAX * 0.7, MAX)).toBe('#e65c00')
    expect(gaugeColor(MAX * 0.85, MAX)).toBe('#e65c00')
  })

  it('returns red at 86% and above', () => {
    expect(gaugeColor(MAX * 0.86, MAX)).toBe('#ba1a1a')
    expect(gaugeColor(MAX, MAX)).toBe('#ba1a1a')
  })

  it('scales thresholds with a different maxPsi', () => {
    // maxPsi=50 → warn at 34.5, hi at 43
    expect(gaugeColor(30, 50)).toBe('#0d631b')
    expect(gaugeColor(40, 50)).toBe('#e65c00')
    expect(gaugeColor(45, 50)).toBe('#ba1a1a')
  })
})

import { describe, it, expect } from 'vitest'
import {
  relayGridCls,
  inputGridCols,
  gaugeColor,
} from '../src/lib/relayDevice'

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

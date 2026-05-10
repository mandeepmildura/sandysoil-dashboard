# A6v3 Pressure Graph Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the A6v3 CH1 pressure chart from a hidden 160px toggle inside the gauge card to a permanent full-width "CH1 Pressure History" panel below the relay grid, with gradient fill, a high-alert reference line, and a Min/Max/Avg stats strip.

**Architecture:** Split the current `PressurePanel` component in `RelayDevice.jsx` into two sibling components — `PressureGaugeCard` (sidebar, gauge + alerts, unchanged visually) and `PressureHistoryPanel` (full-width below relay grid, always visible). `RelayDevice` computes a raw `livePsi`/`liveColor` for the panel badge. A new `computePressureStats` pure helper in `pressureBuckets.js` drives the stats strip.

**Tech Stack:** React, Recharts (`AreaChart`, `Area`, `ReferenceLine`, `linearGradient`), Vitest, Tailwind CSS

---

## File Map

| File | Change |
|------|--------|
| `src/lib/pressureBuckets.js` | Add `computePressureStats` export |
| `src/lib/pressureBuckets.test.js` | Create — unit tests for `computePressureStats` |
| `src/pages/RelayDevice.jsx` | Refactor `PressurePanel` → `PressureGaugeCard` + `PressureHistoryPanel`; update recharts imports; wire render |

---

## Task 1: Add `computePressureStats` to `pressureBuckets.js` (TDD)

**Files:**
- Modify: `src/lib/pressureBuckets.js`
- Create: `src/lib/pressureBuckets.test.js`

- [ ] **Step 1: Create the failing test file**

Create `src/lib/pressureBuckets.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { computePressureStats } from './pressureBuckets'

describe('computePressureStats', () => {
  it('returns null for empty data', () => {
    expect(computePressureStats([])).toBeNull()
  })

  it('returns null when all psi values are null', () => {
    expect(computePressureStats([{ psi: null }, { psi: null }])).toBeNull()
  })

  it('computes min, max, avg from clean data', () => {
    const data = [{ psi: 10 }, { psi: 20 }, { psi: 30 }]
    const result = computePressureStats(data)
    expect(result.min).toBe(10)
    expect(result.max).toBe(30)
    expect(result.avg).toBeCloseTo(20)
  })

  it('ignores null psi entries', () => {
    const data = [{ psi: 10 }, { psi: null }, { psi: 30 }]
    const result = computePressureStats(data)
    expect(result.min).toBe(10)
    expect(result.max).toBe(30)
    expect(result.avg).toBeCloseTo(20)
  })
})
```

- [ ] **Step 2: Run the test — expect it to fail**

```bash
npm test -- pressureBuckets
```

Expected output: `computePressureStats is not a function` (or similar import error).

- [ ] **Step 3: Implement `computePressureStats` in `pressureBuckets.js`**

Append to the bottom of `src/lib/pressureBuckets.js`:

```js
/**
 * Compute min, max, avg PSI from bucketed A6v3 history rows.
 * Returns null when there is no valid data.
 *
 * @param {Array<{psi: number|null}>} data
 * @returns {{ min: number, max: number, avg: number } | null}
 */
export function computePressureStats(data) {
  const vals = data.map(d => d.psi).filter(v => v != null)
  if (!vals.length) return null
  return {
    min: Math.min(...vals),
    max: Math.max(...vals),
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
  }
}
```

- [ ] **Step 4: Run the test — expect it to pass**

```bash
npm test -- pressureBuckets
```

Expected output: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pressureBuckets.js src/lib/pressureBuckets.test.js
git commit -m "feat: add computePressureStats helper to pressureBuckets"
```

---

## Task 2: Update recharts imports and add `computePressureStats` import in `RelayDevice.jsx`

**Files:**
- Modify: `src/pages/RelayDevice.jsx` (lines 11–12)

- [ ] **Step 1: Replace the recharts import line**

Current (line 11):
```js
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
```

Replace with:
```js
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
```

- [ ] **Step 2: Add `computePressureStats` import**

After the existing `import { relayGridCls, inputGridCls, gaugeColor } from '../lib/relayDevice'` line, add:

```js
import { computePressureStats } from '../lib/pressureBuckets'
```

- [ ] **Step 3: Verify the file still compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: no errors referencing `LineChart` or `computePressureStats`.

---

## Task 3: Extract `PressureGaugeCard` from `PressurePanel`

**Files:**
- Modify: `src/pages/RelayDevice.jsx` — replace the `PressurePanel` function (lines 48–196)

- [ ] **Step 1: Replace `PressurePanel` with `PressureGaugeCard`**

Delete the entire `PressurePanel` function (lines 48–196) and replace with this leaner component. It keeps the gauge, EMA smoothing, and alert logic — dropping only the graph toggle.

```jsx
function PressureGaugeCard({ deviceCfg, live, anyRelayOn }) {
  const { adcKey, maxPsi } = deviceCfg.pressureConfig
  const device = live[deviceCfg.stateTopic] ?? null
  const adcRaw = device?.[adcKey]?.value ?? 0

  const smoothedAdcRef = useRef(null)
  if (adcRaw > 0 || smoothedAdcRef.current === null) {
    smoothedAdcRef.current = smoothedAdcRef.current === null
      ? adcRaw
      : smoothedAdcRef.current * 0.8 + adcRaw * 0.2
  }
  const smoothedAdc = Math.round(smoothedAdcRef.current ?? adcRaw)
  const psi = (smoothedAdc / 4095) * maxPsi
  const color = gaugeColor(psi, maxPsi)

  useEffect(() => {
    if (!device) return
    const highThreshold = maxPsi * 0.86
    if (psi >= highThreshold) {
      raiseAlert({
        severity: 'fault', title: `${deviceCfg.name} high pressure`,
        description: `CH1 pressure is ${psi.toFixed(1)} PSI — exceeds threshold.`,
        device: deviceCfg.name, device_id: deviceCfg.serial,
      })
    } else {
      resolveAlerts(deviceCfg.name, `${deviceCfg.name} high pressure`)
    }
    if (anyRelayOn && psi < 5) {
      raiseAlert({
        severity: 'warning', title: `${deviceCfg.name} low pressure during run`,
        description: `CH1 pressure is ${psi.toFixed(1)} PSI while a relay is active — possible flow issue.`,
        device: deviceCfg.name, device_id: deviceCfg.serial,
      }, 15)
    }
  }, [psi, anyRelayOn, !!device]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card accent={psi >= maxPsi * 0.86 ? 'red' : psi >= maxPsi * 0.69 ? 'amber' : 'green'}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-headline font-semibold text-sm text-[#1a1c1c]">CH1 Pressure</h2>
      </div>
      <PressureGauge psi={psi} maxPsi={maxPsi} />
      <div className="mt-2 text-center">
        <span className="text-xs font-body text-[#40493d]">ADC {smoothedAdc} · 0–{maxPsi} PSI range</span>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Verify build still passes**

```bash
npm run build 2>&1 | head -30
```

Expected: no errors.

---

## Task 4: Build `PressureHistoryPanel`

**Files:**
- Modify: `src/pages/RelayDevice.jsx` — add new component after `PressureGaugeCard`

- [ ] **Step 1: Add `PressureHistoryPanel` immediately after `PressureGaugeCard`**

Insert this component after the closing `}` of `PressureGaugeCard`:

```jsx
function PressureHistoryPanel({ deviceCfg, livePsi, liveColor }) {
  const { maxPsi } = deviceCfg.pressureConfig
  const highThreshold = maxPsi * 0.86

  const [histPreset, setHistPreset] = useState('6h')
  const [customDate, setCustomDate] = useState(() => localDateStr())
  const [customFrom, setCustomFrom] = useState('05:00')
  const [customTo, setCustomTo] = useState('07:00')
  const [rangeTick, setRangeTick] = useState(0)

  useEffect(() => {
    if (histPreset === 'custom') return
    const id = setInterval(() => setRangeTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [histPreset])

  const histRange = useMemo(() => {
    if (histPreset === 'custom') {
      return {
        from: new Date(`${customDate}T${customFrom}:00`).toISOString(),
        to:   new Date(`${customDate}T${customTo}:00`).toISOString(),
      }
    }
    const hours = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 }[histPreset] ?? 6
    const now = Date.now()
    return {
      from: new Date(now - hours * 3_600_000).toISOString(),
      to:   new Date(now).toISOString(),
    }
  }, [histPreset, customDate, customFrom, customTo, rangeTick])

  const { data: pressureHistory, loading, reload } = useA6v3PressureHistory(histRange.from, histRange.to)

  useEffect(() => {
    reload()
    const id = setInterval(reload, 300_000)
    return () => clearInterval(id)
  }, [histRange.from, histRange.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = computePressureStats(pressureHistory)
  const liveLabel = typeof livePsi === 'number' ? livePsi.toFixed(1) : '—'

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden"
      style={{ borderTop: `3px solid ${liveColor}` }}>

      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-headline font-bold text-base text-[#1a1c1c]">CH1 Pressure History</h2>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
            style={{ background: `${liveColor}1a`, color: liveColor }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: liveColor }} />
            {liveLabel} PSI
          </span>
        </div>
        <div className="flex items-center gap-1 bg-[#f3f3f3] p-1 rounded-lg">
          {[['1h','1h'],['6h','6h'],['24h','24h'],['7d','7d'],['custom','Custom']].map(([val, label]) => (
            <button key={val} onClick={() => setHistPreset(val)}
              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${
                histPreset === val ? 'bg-white shadow-sm text-[#1a1c1c]' : 'text-[#717975] hover:text-[#1a1c1c]'
              }`}>{label}</button>
          ))}
        </div>
      </div>

      {/* Custom range picker */}
      {histPreset === 'custom' && (
        <div className="px-6 pb-3 flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-[10px] text-[#40493d] block mb-0.5">Date</label>
            <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
              className="bg-[#f3f3f3] rounded px-2 py-1 text-xs outline-none border border-[#e2e2e2]" />
          </div>
          <div>
            <label className="text-[10px] text-[#40493d] block mb-0.5">From</label>
            <input type="time" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="bg-[#f3f3f3] rounded px-2 py-1 text-xs w-24 outline-none border border-[#e2e2e2]" />
          </div>
          <div>
            <label className="text-[10px] text-[#40493d] block mb-0.5">To</label>
            <input type="time" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="bg-[#f3f3f3] rounded px-2 py-1 text-xs w-24 outline-none border border-[#e2e2e2]" />
          </div>
          <button onClick={reload}
            className="px-3 py-1 rounded bg-[#0d631b] text-white text-[10px] font-semibold hover:opacity-90">Go</button>
        </div>
      )}

      {/* Chart */}
      <div className="px-6 pb-4">
        {loading ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-[#40493d]">Loading…</div>
        ) : pressureHistory.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-[#40493d]">No data for this range</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={pressureHistory} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="a6v3PressureGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={liveColor} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={liveColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="" vertical={false} stroke="#f2f4f3" />
              <XAxis dataKey="time"
                tick={{ fontSize: 9, fill: '#717975', fontFamily: 'Manrope', fontWeight: 600 }}
                interval={Math.max(1, Math.floor(pressureHistory.length / 8))} />
              <YAxis domain={[0, maxPsi]}
                tick={{ fontSize: 9, fill: '#717975', fontFamily: 'Manrope', fontWeight: 600 }} />
              <Tooltip content={<PressureTooltip />} />
              <ReferenceLine y={highThreshold} stroke="#ba1a1a" strokeDasharray="4 2"
                label={{ value: '⚠ High alert', position: 'insideTopRight', fontSize: 9, fill: '#ba1a1a' }} />
              <Area type="monotone" dataKey="psi" name="Pressure"
                stroke={liveColor} strokeWidth={2.5} dot={false}
                fill="url(#a6v3PressureGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-3 bg-[#f3f3f3]">
          {[['Min', stats.min], ['Max', stats.max], ['Avg', stats.avg]].map(([label, val], i) => (
            <div key={label} className={`px-4 py-4 text-center ${i < 2 ? 'border-r border-[#e2e2e2]' : ''}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#717975] mb-1">{label}</p>
              <p className="font-headline text-2xl font-extrabold text-[#1a1c1c] leading-none">
                {val.toFixed(1)}{' '}
                <span className="text-xs font-normal text-[#717975]">PSI</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build 2>&1 | head -30
```

Expected: no errors.

---

## Task 5: Wire `PressureGaugeCard` + `PressureHistoryPanel` into `RelayDevice` render

**Files:**
- Modify: `src/pages/RelayDevice.jsx` — inside `RelayDevice` function

- [ ] **Step 1: Compute `livePsi` and `liveColor` in `RelayDevice`**

Directly after the existing line `const device = live[deviceCfg.stateTopic] ?? null` (around line 238), add:

```js
const pressureAdcRaw = deviceCfg.pressureConfig
  ? (device?.[deviceCfg.pressureConfig.adcKey]?.value ?? 0)
  : 0
const livePsi = deviceCfg.pressureConfig
  ? (pressureAdcRaw / 4095) * deviceCfg.pressureConfig.maxPsi
  : 0
const liveColor = deviceCfg.pressureConfig
  ? gaugeColor(livePsi, deviceCfg.pressureConfig.maxPsi)
  : '#0d631b'
```

- [ ] **Step 2: Replace the Relays tab JSX**

Find the Relays tab block (starts with `{activeTab === 'relays' && (`). Replace the entire block with:

```jsx
{activeTab === 'relays' && (
  <div className="space-y-6">
    {/* Gauge + relay grid */}
    <div className={`grid grid-cols-1 gap-6 ${deviceCfg.pressureConfig ? 'lg:grid-cols-3' : ''}`}>
      {/* Left — pressure gauge + digital inputs */}
      {deviceCfg.pressureConfig && (
        <div className="space-y-4">
          <PressureGaugeCard deviceCfg={deviceCfg} live={live} anyRelayOn={anyRelayOn} />
          {inputs.length > 0 && (
            <Card>
              <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">
                Inputs (DI1–DI{deviceCfg.inputCount})
              </h3>
              <div className={`grid ${inputGridCols(inputs.length)} gap-1.5`}>
                {inputs.map((active, i) => (
                  <div key={i} className={`py-1.5 rounded text-[10px] font-semibold text-center ${
                    active ? 'bg-[#e8f5e9] text-[#0d631b]' : 'bg-[#f3f3f3] text-[#40493d]'
                  }`}>DI{i+1}</div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Right — relay grid */}
      <div className={deviceCfg.pressureConfig ? 'lg:col-span-2' : ''}>
        <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-3">
          Relays (DO1–DO{deviceCfg.outputCount})
        </h2>
        <div className={`grid ${relayGridCls(deviceCfg.outputCount)} gap-4 mb-6`}>
          {outputs.map((on, i) => {
            const n = i + 1
            const name = names[n] ?? `Relay ${n}`
            return (
              <Card key={i} accent={on ? 'green' : undefined}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    {editingOutput === n ? (
                      <input ref={outputNameRef} value={outputNameInput}
                        onChange={e => setOutputNameInput(e.target.value)}
                        onBlur={() => commitRename(n)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(n); if (e.key === 'Escape') setEditingOutput(null) }}
                        className="font-headline font-bold text-[#1a1c1c] bg-transparent border-b-2 border-[#0d631b] outline-none w-full text-sm"
                        maxLength={32} autoFocus />
                    ) : (
                      <button onClick={() => startEdit(n, name)}
                        className="font-headline font-bold text-[#1a1c1c] hover:text-[#0d631b] transition-colors flex items-center gap-1 group text-sm"
                        title="Click to rename">
                        <span className="truncate">{name}</span>
                        <span className="opacity-0 group-hover:opacity-60 transition-opacity text-xs">✏️</span>
                      </button>
                    )}
                    <p className="text-xs text-[#40493d]">DO{n}</p>
                  </div>
                  <span className={`w-3 h-3 rounded-full mt-0.5 shrink-0 ${on ? 'bg-[#0d631b] animate-pulse' : 'bg-[#e2e2e2]'}`} />
                </div>
                <StatusChip status={on ? 'running' : 'offline'} label={on ? 'ON' : 'OFF'} />

                {!on && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <input
                      type="number" min={1} max={240} placeholder="30"
                      value={selectedDurations[n] === null ? '' : (selectedDurations[n] ?? '')}
                      onChange={e => {
                        const v = e.target.value
                        setSelectedDurations(prev => ({ ...prev, [n]: v === '' ? null : Number(v) }))
                      }}
                      className="w-14 bg-[#f3f3f3] rounded-md px-2 py-1 text-xs text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:bg-white transition-all"
                    />
                    <span className="text-[10px] text-[#40493d]">min</span>
                  </div>
                )}

                {on && autoOffRef.current[n] && (() => {
                  const rem = Math.max(0, autoOffRef.current[n] - Date.now())
                  const min = Math.floor(rem / 60000)
                  const sec = Math.floor((rem % 60000) / 1000)
                  return (
                    <p className="text-[10px] text-center text-[#0d631b] font-semibold mt-1">
                      auto-off {min}:{String(sec).padStart(2,'0')}
                    </p>
                  )
                })()}

                <div className="flex gap-1 mt-2">
                  <button onClick={() => handleToggle(n, on)} disabled={!!busy[n] || on}
                    className="flex-1 py-1.5 rounded-md bg-[#0d631b] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">On</button>
                  <button onClick={() => handleToggle(n, on)} disabled={!!busy[n] || !on}
                    className="flex-1 py-1.5 rounded-md bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold hover:bg-[#d5d5d5] disabled:opacity-40 transition-all">Off</button>
                </div>
              </Card>
            )
          })}
        </div>

        {/* Inputs + ADC for non-pressure devices */}
        {!deviceCfg.pressureConfig && (inputs.length > 0 || adcChannels.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {inputs.length > 0 && (
              <Card>
                <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">
                  Inputs (DI1–DI{deviceCfg.inputCount})
                </h3>
                <div className={`grid ${inputGridCols(inputs.length)} gap-1.5`}>
                  {inputs.map((active, i) => (
                    <div key={i} className={`py-1.5 rounded text-[10px] font-semibold text-center ${
                      active ? 'bg-[#e8f5e9] text-[#0d631b]' : 'bg-[#f3f3f3] text-[#40493d]'
                    }`}>DI{i+1}</div>
                  ))}
                </div>
              </Card>
            )}
            {adcChannels.length > 0 && (
              <Card>
                <h3 className="font-headline font-semibold text-xs text-[#40493d] uppercase mb-3">
                  Analog ({adcChannels.map(c => `CH${c.index}`).join('–')})
                </h3>
                <div className="space-y-3">
                  {adcChannels.map(ch => (
                    <div key={ch.key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[#40493d]">CH{ch.index}</span>
                        <span className="font-semibold text-[#1a1c1c]">{ch.value}</span>
                      </div>
                      <div className="h-1.5 bg-[#e2e2e2] rounded-full overflow-hidden">
                        <div className="h-full bg-[#0d631b] rounded-full transition-all"
                          style={{ width: `${Math.min((ch.value / 4095) * 100, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Full-width pressure history panel */}
    {deviceCfg.pressureConfig && (
      <PressureHistoryPanel deviceCfg={deviceCfg} livePsi={livePsi} liveColor={liveColor} />
    )}
  </div>
)}
```

- [ ] **Step 3: Run the dev server and visually verify**

```bash
npm run dev
```

Navigate to the A6v3 device page (`/a6v3` or whichever route). Confirm:
- Gauge card still shows in left sidebar with colour-coded accent
- Full-width "CH1 Pressure History" panel appears below the relay grid
- Time-range pills switch the chart range
- "Custom" preset shows the date/time inputs
- Stats strip shows Min/Max/Avg (or is hidden when no data)
- High-alert dashed red reference line is visible on the chart

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass (including the 4 new `computePressureStats` tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/RelayDevice.jsx
git commit -m "feat: promote A6v3 pressure chart to full-width history panel with gradient, alert line, and stats"
```

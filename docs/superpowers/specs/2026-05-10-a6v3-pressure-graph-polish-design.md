# A6v3 Pressure Graph Polish — Design Spec
Date: 2026-05-10

## Goal
Replace the hidden, collapsible 160px pressure chart inside the CH1 Pressure card on the RelayDevice page with a prominent full-width "CH1 Pressure History" panel that gives operators meaningful at-a-glance insight.

## Current State
- `PressurePanel` in `RelayDevice.jsx` renders a single card with a gauge + a toggle that shows a 160px `LineChart`
- Graph is hidden by default behind "▼ Show graph"
- No reference lines, no stats summary
- Uses `useA6v3PressureHistory(from, to)` → `bucketA6v3` (5-min buckets)

## Design Decisions
- **Layout**: Graph moves out of the toggle and into a new full-width card below the relay grid (always visible)
- **Gauge card**: unchanged — stays in the left sidebar of the relay grid layout
- **No relay-on shading** — not relevant to the A6v3 use case

## New Panel — CH1 Pressure History Card

### Header
- Title: "CH1 Pressure History" (Manrope 700)
- Live badge: pulsing green dot + current PSI value, colour-coded by `gaugeColor(psi, maxPsi)`
- Time-range segmented control: 1h · 6h (default) · 24h · 7d · Custom

### Chart
- Height: 260px
- Recharts `LineChart`, single `psi` line, stroke colour from `gaugeColor(psi, maxPsi)`, strokeWidth 2.5, no dots
- Area fill: `LinearGradient` from `rgba(13,99,27,0.15)` → transparent below the line
- High-alert `ReferenceLine` at `maxPsi * 0.86`, dashed red, labeled "High alert"
- Horizontal grid lines only (`CartesianGrid vertical={false}`)
- Custom tooltip matching existing `PressureTooltip` style

### Stats Strip
- Three equal tiles at the bottom: **Min · Max · Avg** PSI for the selected range
- Computed from `pressureHistory` data
- Background tonal shift to `#f3f3f3` (no divider lines)
- Label: Inter 600 10px uppercase `#717975`; Value: Manrope 800 24px `#1a1c1c`; unit "PSI" Inter 400 11px

### Card Style
- White card, `rounded-xl`, shadow matching rest of page
- 3px `#0d631b` top accent bar
- Always visible — no toggle

## Component Restructure
Split `PressurePanel` into two components:
- **`PressureGaugeCard`** — gauge + alerts logic (sidebar, unchanged visually)
- **`PressureHistoryPanel`** — full-width history card (new)

Both remain in `RelayDevice.jsx` (no new files needed given their size). `RelayDevice` renders:
```
Relays tab:
  [left col] PressureGaugeCard + Inputs
  [right 2 cols] Relay grid
  [full width, below] PressureHistoryPanel   ← new
```

## Files Changed
- `src/pages/RelayDevice.jsx` — split PressurePanel, add PressureHistoryPanel below relay grid

## Out of Scope
- Relay-on shading
- Dark mode
- Export CSV for A6v3 history

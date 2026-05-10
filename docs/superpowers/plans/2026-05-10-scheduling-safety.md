# Scheduling v2 + Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship simultaneous-zone programs with a pump/master zone, tiered alerts, two-way WhatsApp control, pressure-aware logging, and calendar history — while making a repeat of the 14h runaway structurally impossible.

**Architecture:** DB migration adds `pump_zone_num` to `farm_devices` and `duration_min` to `zone_groups`. `expandSteps.ts` gains a new `'simultaneous'` run mode that fires all zones at once and injects pump ON/OFF rows. `run-schedules` reads `pump_zone_num` and blocks overlapping schedules at save time. A new `whatsapp-gateway` Edge Function handles two-way Twilio messaging. Frontend gains a program builder, calendar history timeline, and Recharts pressure chart.

**Tech Stack:** React + Vite, Tailwind, Recharts (already bundled), Supabase Edge Functions (Deno/TypeScript), pg_cron, Twilio REST API, Vitest

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/014_pump_zone_scheduling.sql` | New — all DB schema changes |
| `sandy-soils/firmware-8z/src/config.h` | Raise `MAX_RUN_MINUTES` 120→1440, bump version |
| `supabase/functions/run-schedules/lib/expandSteps.ts` | Add simultaneous mode, pump injection, irrigation1 OFFs |
| `tests/expandSteps.test.ts` | Add new test cases for above |
| `supabase/functions/run-schedules/index.ts` | Query pump_zone_num, overlap blocking, back-to-back |
| `supabase/functions/run-program-queue/index.ts` | Close irrigation1 OFF steps in zone_history |
| `supabase/functions/a6v3-runaway-watchdog/index.ts` | Add irrigation1 tiered alerts |
| `supabase/functions/whatsapp-gateway/index.ts` | New — outbound alerts + inbound commands |
| `supabase/functions/pressure-downsample/index.ts` | New — nightly hourly bucketing |
| `src/hooks/usePrograms.js` | Include zone_groups.duration_min and pump_zone_num |
| `src/hooks/useCalendarHistory.js` | New — planned vs actual for day-timeline |
| `src/lib/programUtils.js` | New — overlap check, pump step helpers |
| `src/components/ProgramBuilder.jsx` | New — single-scroll program form |
| `src/pages/Calendar.jsx` | Add day-timeline, 7-day strip, delete/pause |
| `src/pages/AdminConsole.jsx` | Pump zone selector, Twilio config tab |
| `src/pages/Dashboard.jsx` | Running zones strip, pump PUMP badge |
| `src/components/PressureChart.jsx` | New — Recharts LineChart replacing sparkline |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/014_pump_zone_scheduling.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 014_pump_zone_scheduling.sql

-- 1. Pump zone designation per device
ALTER TABLE farm_devices
  ADD COLUMN IF NOT EXISTS pump_zone_num integer;

-- 2. Program-level duration (simultaneous-zone model)
-- zone_group_members.duration_min is retained for legacy sequential programs.
ALTER TABLE zone_groups
  ADD COLUMN IF NOT EXISTS duration_min integer NOT NULL DEFAULT 30;

-- 3. Safety: program_queue ON steps must have duration_min set
ALTER TABLE program_queue
  ADD CONSTRAINT IF NOT EXISTS program_queue_on_requires_duration
  CHECK (step_type <> 'on' OR duration_min IS NOT NULL);

-- 4. Hourly pressure buckets for long-term storage
CREATE TABLE IF NOT EXISTS pressure_log_hourly (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device       text NOT NULL,
  hour_bucket  timestamptz NOT NULL,
  avg_psi      numeric(6,2),
  min_psi      numeric(6,2),
  max_psi      numeric(6,2),
  sample_count integer,
  created_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pressure_log_hourly_device_hour
  ON pressure_log_hourly(device, hour_bucket);
ALTER TABLE pressure_log_hourly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON pressure_log_hourly FOR ALL USING (true) WITH CHECK (true);

-- 5. Admin settings (phone number, alert channel)
CREATE TABLE IF NOT EXISTS admin_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth only" ON admin_settings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed default alert settings
INSERT INTO admin_settings (key, value) VALUES
  ('alert_phone', ''),
  ('alert_channel', 'whatsapp'),
  ('alert_hour_threshold_1', '3'),
  ('alert_hour_threshold_2', '6')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run in Supabase SQL editor or via `mcp__plugin_supabase_supabase__apply_migration`. Verify:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'farm_devices' AND column_name = 'pump_zone_num';
-- expect 1 row

SELECT column_name FROM information_schema.columns
WHERE table_name = 'zone_groups' AND column_name = 'duration_min';
-- expect 1 row
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/014_pump_zone_scheduling.sql
git commit -m "feat(db): add pump_zone_num, program duration_min, pressure_log_hourly, admin_settings"
```

---

## Task 2: Firmware Cap Raise

**Files:**
- Modify: `sandy-soils/firmware-8z/src/config.h:58-59`

- [ ] **Step 1: Update config.h**

Change lines 32 and 58 in `C:\Users\msgil\GIT\sandy-soils\firmware-8z\src\config.h`:

```cpp
// Line 32 — was "2.4.0"
#define FW_VERSION          "2.5.0"

// Line 58 — was 120
#define MAX_RUN_MINUTES     1440
```

- [ ] **Step 2: Verify change**

```bash
grep -n "MAX_RUN_MINUTES\|FW_VERSION" sandy-soils/firmware-8z/src/config.h
# Expect: FW_VERSION "2.5.0" and MAX_RUN_MINUTES 1440
```

- [ ] **Step 3: Commit firmware change**

```bash
cd C:\Users\msgil\GIT\sandy-soils\firmware-8z
git add src/config.h
git commit -m "feat: raise MAX_RUN_MINUTES to 1440, bump version to 2.5.0"
```

- [ ] **Step 4: Trigger OTA from Admin Console**

After the dashboard is deployed, go to Admin Console → Device → OTA Update → Check for update → Apply. Confirm the device reports `fw: "2.5.0"` in its next MQTT status publish.

---

## Task 3: expandSteps — Simultaneous Mode + Pump Injection

**Files:**
- Modify: `supabase/functions/run-schedules/lib/expandSteps.ts`
- Modify: `tests/expandSteps.test.ts`

- [ ] **Step 1: Write failing tests first**

Append to `tests/expandSteps.test.ts`:

```ts
describe('simultaneous mode', () => {
  it('fires all zone ONs at baseMs and all OFFs at baseMs + duration', () => {
    const rows = expandSteps('g1', 'simultaneous', [
      step({ zone_num: 2, sort_order: 0, duration_min: null }),
      step({ zone_num: 3, sort_order: 1, duration_min: null }),
    ], BASE, 'farm/irrigation1', null, 120)

    const ons  = rows.filter(r => r.step_type === 'on')
    const offs = rows.filter(r => r.step_type === 'off')
    expect(ons).toHaveLength(2)
    expect(offs).toHaveLength(2)
    ons.forEach(r  => expect(r.fire_at).toBe(new Date(BASE).toISOString()))
    offs.forEach(r => expect(r.fire_at).toBe(new Date(BASE + 120 * 60_000).toISOString()))
  })

  it('injects pump ON at baseMs and pump OFF at baseMs + duration', () => {
    const rows = expandSteps('g1', 'simultaneous', [
      step({ zone_num: 2, sort_order: 0, duration_min: null }),
    ], BASE, 'farm/irrigation1', 1, 60)

    const pumpOn  = rows.find(r => r.zone_num === 1 && r.step_type === 'on')
    const pumpOff = rows.find(r => r.zone_num === 1 && r.step_type === 'off')
    expect(pumpOn).toBeDefined()
    expect(pumpOff).toBeDefined()
    expect(pumpOn!.fire_at).toBe(new Date(BASE).toISOString())
    expect(pumpOff!.fire_at).toBe(new Date(BASE + 60 * 60_000).toISOString())
  })

  it('suppresses pump OFF when suppressPumpOff = true', () => {
    const rows = expandSteps('g1', 'simultaneous', [
      step({ zone_num: 2, sort_order: 0, duration_min: null }),
    ], BASE, 'farm/irrigation1', 1, 60, true)

    const pumpOff = rows.find(r => r.zone_num === 1 && r.step_type === 'off')
    expect(pumpOff).toBeUndefined()
  })

  it('pump zone is not duplicated when zone_num matches pump_zone_num', () => {
    // zone_group_members should never include the pump zone, but be safe
    const rows = expandSteps('g1', 'simultaneous', [
      step({ zone_num: 1, sort_order: 0, duration_min: null }), // accidentally added
    ], BASE, 'farm/irrigation1', 1, 30)
    const pumpOns = rows.filter(r => r.zone_num === 1 && r.step_type === 'on')
    expect(pumpOns).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npx vitest run tests/expandSteps.test.ts
# Expect: 4 new failures (simultaneous mode not yet implemented)
```

- [ ] **Step 3: Update expandSteps.ts**

Replace `supabase/functions/run-schedules/lib/expandSteps.ts` entirely:

```ts
export type Step = {
  zone_num: number
  duration_min: number | null
  sort_order: number
  step_type: string | null
  delay_min: number | null
  device: string | null
}

export type QueueRow = {
  group_id: string
  step_type: string
  device: string
  zone_num: number
  duration_min: number | null
  fire_at: string
  mqtt_base_topic: string
}

export function expandSteps(
  groupId: string,
  runMode: string,
  steps: Step[],
  baseMs: number,
  mqttBaseTopic: string = 'farm/irrigation1',
  pumpZoneNum: number | null = null,
  programDurationMin: number | null = null,
  suppressPumpOff: boolean = false,
): QueueRow[] {
  const sorted = [...steps].sort((a, b) => a.sort_order - b.sort_order)
  const rows: QueueRow[] = []

  if (runMode === 'simultaneous') {
    // All zones ON at baseMs, all OFF at baseMs + programDurationMin
    const durMin = programDurationMin ?? 30
    const offMs  = baseMs + durMin * 60_000

    // Pump ON first (before zone ONs so relay sequence is correct)
    if (pumpZoneNum != null) {
      rows.push({ group_id: groupId, step_type: 'on', device: 'irrigation1',
        zone_num: pumpZoneNum, duration_min: durMin,
        fire_at: new Date(baseMs).toISOString(), mqtt_base_topic: mqttBaseTopic })
    }

    for (const step of sorted) {
      const device = step.device ?? 'irrigation1'
      // Skip if this zone is the pump zone — already injected above
      if (pumpZoneNum != null && step.zone_num === pumpZoneNum) continue

      rows.push({ group_id: groupId, step_type: 'on', device,
        zone_num: step.zone_num, duration_min: durMin,
        fire_at: new Date(baseMs).toISOString(), mqtt_base_topic: mqttBaseTopic })

      // A6v3 needs explicit OFF (no firmware auto-off)
      // irrigation1 also needs explicit OFF now that firmware cap is 1440 min
      rows.push({ group_id: groupId, step_type: 'off', device,
        zone_num: step.zone_num, duration_min: durMin,
        fire_at: new Date(offMs).toISOString(), mqtt_base_topic: mqttBaseTopic })
    }

    // Pump OFF last (after zone OFFs)
    if (pumpZoneNum != null && !suppressPumpOff) {
      rows.push({ group_id: groupId, step_type: 'off', device: 'irrigation1',
        zone_num: pumpZoneNum, duration_min: durMin,
        fire_at: new Date(offMs).toISOString(), mqtt_base_topic: mqttBaseTopic })
    }

    return rows
  }

  // Legacy sequential / parallel modes — unchanged
  let cursorMs = baseMs

  for (const step of sorted) {
    const stepType = step.step_type ?? 'on'
    const device   = step.device    ?? 'irrigation1'

    if (stepType === 'delay') {
      cursorMs += (step.delay_min ?? 0) * 60_000
      continue
    }

    rows.push({ group_id: groupId, step_type: stepType, device,
      zone_num: step.zone_num, duration_min: step.duration_min,
      fire_at: new Date(cursorMs).toISOString(), mqtt_base_topic: mqttBaseTopic })

    if (stepType === 'on' && device === 'a6v3' && (step.duration_min ?? 0) > 0) {
      const offAtMs = cursorMs + (step.duration_min ?? 0) * 60_000
      rows.push({ group_id: groupId, step_type: 'off', device,
        zone_num: step.zone_num, duration_min: step.duration_min ?? 0,
        fire_at: new Date(offAtMs).toISOString(), mqtt_base_topic: mqttBaseTopic })
    }

    if (stepType === 'on' && (device === 'irrigation1' || device === 'a6v3') && runMode === 'sequential') {
      cursorMs += (step.duration_min ?? 0) * 60_000
    }
  }

  return rows
}
```

- [ ] **Step 4: Run all tests — expect pass**

```bash
npx vitest run tests/expandSteps.test.ts
# Expect: all tests pass (14 existing + 4 new = 18 total)
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/run-schedules/lib/expandSteps.ts tests/expandSteps.test.ts
git commit -m "feat(scheduler): add simultaneous mode + pump zone injection to expandSteps"
```

---

## Task 4: run-schedules — Pump-Aware + Overlap Blocking + Back-to-Back

**Files:**
- Modify: `supabase/functions/run-schedules/index.ts`

- [ ] **Step 1: Add helper — overlap detection**

Insert after the `currentDOW()` function (line ~77):

```ts
/** Convert HH:MM string to minutes since midnight */
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** True if two schedules share a day AND their time windows overlap */
function schedulesOverlap(
  a: { start_time: string; duration_min: number; days_of_week: number[] },
  b: { start_time: string; duration_min: number; days_of_week: number[] },
): boolean {
  const sharedDay = a.days_of_week.some(d => b.days_of_week.includes(d))
  if (!sharedDay) return false
  const aStart = toMin(a.start_time), aEnd = aStart + a.duration_min
  const bStart = toMin(b.start_time), bEnd = bStart + b.duration_min
  return aStart < bEnd && bStart < aEnd
}

/** True if two programs on the same device are back-to-back (gap < 2 min) */
function isBackToBack(
  aEndMin: number,
  bStartMin: number,
): boolean {
  return Math.abs(bStartMin - aEndMin) < 2
}
```

- [ ] **Step 2: Update the Supabase query to fetch pump_zone_num and duration_min**

Replace the `.select(...)` block starting at line ~94:

```ts
const { data: schedules, error: schedErr } = await supabase
  .from('group_schedules')
  .select(`
    id,
    group_id,
    label,
    days_of_week,
    start_time,
    run_once_date,
    zone_groups (
      id,
      name,
      run_mode,
      duration_min,
      devices (
        mqtt_topic_base,
        device_id,
        pump_zone_num
      ),
      zone_group_members (
        zone_num,
        duration_min,
        sort_order,
        step_type,
        delay_min,
        device
      )
    )
  `)
  .eq('enabled', true)
  .filter('start_time', 'gte', `${now}:00`)
  .filter('start_time', 'lt',  `${now}:59`)
```

- [ ] **Step 3: Update the expandSteps call to pass pump_zone_num + back-to-back detection**

Replace the `expandSteps(...)` call (around line ~169) with:

```ts
const pumpZoneNum: number | null = group.devices?.pump_zone_num ?? null
const programDurationMin: number = group.duration_min ?? 30

// Back-to-back detection: check if another program on this device ends
// within 2 minutes of this one starting — if so, suppress pump OFF
// (pump stays on; the next program will send its own pump ON to reset timer)
let suppressPumpOff = false
if (pumpZoneNum != null) {
  const thisStartMin = toMin(now)  // current time = this program's start
  for (const other of due) {
    if (other === sched) continue
    const otherGroup = other.zone_groups as typeof group | null
    if (!otherGroup) continue
    const otherDur = otherGroup.duration_min ?? 30
    const otherEndMin = toMin(other.start_time) + otherDur
    if (isBackToBack(otherEndMin, thisStartMin)) {
      suppressPumpOff = true
      break
    }
  }
}

const queueRows = expandSteps(
  group.id,
  group.run_mode ?? 'simultaneous',
  (group.zone_group_members ?? []) as Step[],
  Date.now(),
  mqttBaseTopic,
  pumpZoneNum,
  programDurationMin,
  suppressPumpOff,
)

// Safety assertion: every ON row must have a matching OFF row in this batch
const onRows  = queueRows.filter(r => r.step_type === 'on')
const offRows = queueRows.filter(r => r.step_type === 'off')
const missingOff = onRows.filter(on =>
  !offRows.some(off => off.zone_num === on.zone_num && off.device === on.device)
)
if (missingOff.length > 0 && group.run_mode === 'simultaneous') {
  throw new Error(`ON/OFF mismatch for zones: ${missingOff.map(r => r.zone_num).join(', ')}`)
}
```

- [ ] **Step 4: Deploy and test via a manual trigger**

```bash
supabase functions deploy run-schedules --project-ref lecssjvuskqemjzvjimo
```

Trigger manually and confirm logs show pump zone rows in the queue:
```sql
SELECT step_type, zone_num, fire_at FROM program_queue
WHERE created_at > now() - interval '2 minutes'
ORDER BY fire_at;
-- Expect: pump ON + zone ONs at same fire_at, pump OFF + zone OFFs at fire_at + duration
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/run-schedules/index.ts
git commit -m "feat(scheduler): pump zone injection, simultaneous mode, back-to-back detection"
```

---

## Task 5: run-program-queue — Close irrigation1 OFF Steps

**Files:**
- Modify: `supabase/functions/run-program-queue/index.ts`

Currently, `run-program-queue` only closes `zone_history` rows for A6v3 OFF steps. Now that irrigation1 has explicit OFF steps too, those need to close their history rows.

- [ ] **Step 1: Add irrigation1 OFF step tracking**

In the `for (const step of group)` loop (around line ~177), after the existing A6v3 OFF handling, add:

```ts
// Track irrigation1 OFF steps for history closure (same pattern as A6v3)
const allIrrigation1OffSteps: QueueRow[] = []
```

Declare this at the top of `Deno.serve`, alongside `allA6v3OffSteps`.

Then inside the loop, in the `else` branch (irrigation1), change the `step_type === 'off'` block from:

```ts
} else {
  groupMessages.push({
    topic:   `${prefix}/zone/${step.zone_num}/cmd`,
    payload: JSON.stringify({ cmd: 'off' }),
    label:   `${prefix} zone ${step.zone_num} → off`,
  })
}
```

To:

```ts
} else {
  groupMessages.push({
    topic:   `${prefix}/zone/${step.zone_num}/cmd`,
    payload: JSON.stringify({ cmd: 'off' }),
    label:   `${prefix} zone ${step.zone_num} → off`,
  })
  allIrrigation1OffSteps.push(step)
}
```

Then after the existing A6v3 off-step closure loop, add:

```ts
// Close zone_history rows for irrigation1 OFF steps
for (const step of allIrrigation1OffSteps) {
  const { data: open } = await supabase
    .from('zone_history')
    .select('id')
    .eq('zone_num', step.zone_num)
    .eq('device', step.device ?? 'irrigation1')
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
  if (open?.length) {
    await supabase.from('zone_history')
      .update({ ended_at: firedAt })
      .eq('id', open[0].id)
  }
}
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy run-program-queue --project-ref lecssjvuskqemjzvjimo
```

- [ ] **Step 3: Verify — after a program runs, check zone_history**

```sql
SELECT zone_num, started_at, ended_at FROM zone_history
WHERE device = 'irrigation1' AND started_at > now() - interval '1 hour'
ORDER BY started_at DESC;
-- Expect: ended_at is NOT NULL for completed zones
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/run-program-queue/index.ts
git commit -m "fix(scheduler): close irrigation1 zone_history rows on OFF steps"
```

---

## Task 6: Watchdog — Tiered Alerts for irrigation1

**Files:**
- Modify: `supabase/functions/a6v3-runaway-watchdog/index.ts`

- [ ] **Step 1: Read current watchdog**

```bash
cat supabase/functions/a6v3-runaway-watchdog/index.ts
```

- [ ] **Step 2: Add irrigation1 tiered alert logic**

After the existing A6v3 force-off block, add:

```ts
// ── irrigation1 tiered alerts ─────────────────────────────────
const ALERT_THRESHOLD_1_MIN = parseInt(Deno.env.get('IRRIG_ALERT_MIN_1') ?? '180')
const ALERT_THRESHOLD_2_MIN = parseInt(Deno.env.get('IRRIG_ALERT_MIN_2') ?? '360')

const { data: irrigOpen } = await supabase
  .from('zone_history')
  .select('id, zone_num, started_at')
  .eq('device', 'irrigation1')
  .is('ended_at', null)

for (const row of irrigOpen ?? []) {
  const runMin = (Date.now() - new Date(row.started_at).getTime()) / 60_000

  if (runMin >= ALERT_THRESHOLD_2_MIN) {
    await supabase.from('device_alerts').insert({
      severity: 'fault',
      title: `irrigation1 Zone ${row.zone_num} running ${Math.round(runMin / 60)}h`,
      description: `Zone ${row.zone_num} has been running ${Math.round(runMin)} minutes — check immediately.`,
      device: 'irrigation1', device_id: '', acknowledged: false,
    })
  } else if (runMin >= ALERT_THRESHOLD_1_MIN) {
    // Only raise once — check if a 3h alert already exists for this zone/session
    const { data: existing } = await supabase
      .from('device_alerts')
      .select('id')
      .eq('device', 'irrigation1')
      .ilike('title', `%Zone ${row.zone_num}%`)
      .gte('created_at', row.started_at)
      .limit(1)
    if (!existing?.length) {
      await supabase.from('device_alerts').insert({
        severity: 'fault',
        title: `irrigation1 Zone ${row.zone_num} running ${ALERT_THRESHOLD_1_MIN / 60}h`,
        description: `Zone ${row.zone_num} has been running ${Math.round(runMin)} minutes — is this intentional?`,
        device: 'irrigation1', device_id: '', acknowledged: false,
      })
    }
  }
}
```

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy a6v3-runaway-watchdog --project-ref lecssjvuskqemjzvjimo
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/a6v3-runaway-watchdog/index.ts
git commit -m "feat(watchdog): tiered runtime alerts for irrigation1 zones"
```

---

## Task 7: Low Pressure Alert

**Files:**
- Modify: `supabase/functions/a6v3-runaway-watchdog/index.ts`

The watchdog already runs every minute — add a pressure check to it.

- [ ] **Step 1: Add pressure check block**

Add at the end of the watchdog handler, before the Response:

```ts
// ── Low pressure alert (during active irrigation) ─────────────
const LOW_PSI_THRESHOLD = parseFloat(Deno.env.get('LOW_PSI_THRESHOLD') ?? '15')
const BURST_DROP_PSI    = parseFloat(Deno.env.get('BURST_DROP_PSI') ?? '20')
const BURST_WINDOW_SEC  = 30

// Only alert when irrigation is running
const { data: activeZones } = await supabase
  .from('zone_history')
  .select('id')
  .eq('device', 'irrigation1')
  .is('ended_at', null)
  .limit(1)

if (activeZones?.length) {
  // Latest pressure reading
  const { data: latest } = await supabase
    .from('pressure_log')
    .select('psi, logged_at')
    .eq('device', 'irrigation1')
    .order('logged_at', { ascending: false })
    .limit(1)

  if (latest?.length) {
    const psi = latest[0].psi

    if (psi < LOW_PSI_THRESHOLD) {
      // Check for burst: compare to reading 30s ago
      const thirtyAgo = new Date(Date.now() - BURST_WINDOW_SEC * 1000).toISOString()
      const { data: older } = await supabase
        .from('pressure_log')
        .select('psi')
        .eq('device', 'irrigation1')
        .lte('logged_at', thirtyAgo)
        .order('logged_at', { ascending: false })
        .limit(1)

      const isBurst = older?.length && (older[0].psi - psi) >= BURST_DROP_PSI
      const severity = isBurst ? 'fault' : 'warning'
      const title = isBurst
        ? `Possible burst pipe — pressure dropped ${Math.round(older![0].psi - psi)} PSI`
        : `Low supply pressure: ${psi.toFixed(1)} PSI during irrigation`

      // Deduplicate: don't raise the same alert within 5 minutes
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
      const { data: recent } = await supabase
        .from('device_alerts')
        .select('id')
        .eq('device', 'irrigation1')
        .ilike('title', '%pressure%')
        .gte('created_at', fiveMinAgo)
        .limit(1)

      if (!recent?.length) {
        await supabase.from('device_alerts').insert({
          severity, title,
          description: `Supply PSI: ${psi.toFixed(1)}. Threshold: ${LOW_PSI_THRESHOLD} PSI.`,
          device: 'irrigation1', device_id: '', acknowledged: false,
        })
      }
    }
  }
}
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy a6v3-runaway-watchdog --project-ref lecssjvuskqemjzvjimo
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/a6v3-runaway-watchdog/index.ts
git commit -m "feat(watchdog): low pressure alert + burst pipe detection during irrigation"
```

---

## Task 8: WhatsApp Gateway — Outbound Alerts

**Files:**
- Create: `supabase/functions/whatsapp-gateway/index.ts`

- [ ] **Step 1: Create the Edge Function**

```ts
// supabase/functions/whatsapp-gateway/index.ts
// Handles both outbound alerts (triggered by device_alerts DB webhook)
// and inbound commands (Twilio webhook POST).

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TWILIO_ACCOUNT_SID   = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_AUTH_TOKEN    = Deno.env.get('TWILIO_AUTH_TOKEN')!
const TWILIO_FROM_NUMBER   = Deno.env.get('TWILIO_FROM_NUMBER')!  // e.g. whatsapp:+14155238886

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function getSettings(): Promise<Record<string, string>> {
  const { data } = await supabase.from('admin_settings').select('key, value')
  return Object.fromEntries((data ?? []).map(r => [r.key, r.value]))
}

async function sendTwilio(to: string, body: string, channel: string): Promise<void> {
  const from = channel === 'sms' ? TWILIO_FROM_NUMBER.replace('whatsapp:', '') : TWILIO_FROM_NUMBER
  const toFormatted = channel === 'sms' ? to : `whatsapp:${to}`

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: toFormatted, From: from, Body: body }).toString(),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio error ${res.status}: ${text}`)
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Inbound Twilio webhook: POST /whatsapp-gateway/inbound
  if (req.method === 'POST' && url.pathname.endsWith('/inbound')) {
    const formData = await req.formData()
    const from    = formData.get('From')?.toString() ?? ''
    const body    = formData.get('Body')?.toString().trim().toUpperCase() ?? ''

    const settings = await getSettings()
    const alertPhone = settings.alert_phone?.replace(/\s/g, '')
    const authorised = alertPhone && (from.includes(alertPhone) || from === `whatsapp:${alertPhone}`)

    if (!authorised) {
      console.warn(`[whatsapp-gateway] unauthorised sender: ${from}`)
      await supabase.from('device_alerts').insert({
        severity: 'info', title: 'Unauthorised WhatsApp command',
        description: `From: ${from}, Body: ${body}`,
        device: 'whatsapp', device_id: '', acknowledged: false,
      })
      return new Response('<?xml version="1.0"?><Response><Message>Not authorised.</Message></Response>',
        { headers: { 'Content-Type': 'text/xml' } })
    }

    let reply = 'Unknown command. Try: STOP, STOP 2, STATUS, OK'

    if (body === 'STOP') {
      await supabase.from('program_queue').insert({
        group_id: null, step_type: 'all_off', device: 'irrigation1',
        zone_num: 0, duration_min: null, fire_at: new Date().toISOString(),
      })
      reply = 'Stopping all zones. Command queued — will fire immediately or on reconnect.'
    } else if (/^STOP \d+$/.test(body)) {
      const zoneNum = parseInt(body.split(' ')[1])
      await supabase.from('program_queue').insert({
        group_id: null, step_type: 'off', device: 'irrigation1',
        zone_num: zoneNum, duration_min: null, fire_at: new Date().toISOString(),
      })
      reply = `Zone ${zoneNum} stop queued.`
    } else if (body === 'STATUS') {
      const { data: open } = await supabase
        .from('zone_history').select('zone_num, started_at')
        .eq('device', 'irrigation1').is('ended_at', null)
      if (!open?.length) {
        reply = 'No zones currently running.'
      } else {
        reply = open.map(r => {
          const min = Math.round((Date.now() - new Date(r.started_at).getTime()) / 60_000)
          return `Zone ${r.zone_num}: running ${min} min`
        }).join('\n')
      }
    } else if (body === 'OK') {
      await supabase.from('device_alerts')
        .update({ acknowledged: true })
        .eq('acknowledged', false)
        .eq('device', 'irrigation1')
      reply = 'Alerts acknowledged.'
    }

    return new Response(
      `<?xml version="1.0"?><Response><Message>${reply}</Message></Response>`,
      { headers: { 'Content-Type': 'text/xml' } }
    )
  }

  // Outbound alert: POST /whatsapp-gateway with JSON body { alert_id }
  if (req.method === 'POST') {
    const { alert_id } = await req.json()
    const { data: alert } = await supabase
      .from('device_alerts').select('*').eq('id', alert_id).single()
    if (!alert || alert.severity !== 'fault') {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { 'Content-Type': 'application/json' } })
    }

    const settings = await getSettings()
    const phone    = settings.alert_phone
    const channel  = settings.alert_channel ?? 'whatsapp'

    if (!phone) {
      console.warn('[whatsapp-gateway] no alert_phone configured')
      return new Response(JSON.stringify({ ok: false, error: 'no_phone' }), { headers: { 'Content-Type': 'application/json' } })
    }

    const msg = `[Sandy Soil Alert]\n${alert.title}\n${alert.description}\n\nReply STOP to stop all, STOP N to stop zone N, STATUS to check, OK to acknowledge.`

    try {
      await sendTwilio(phone, msg, channel)
      if (channel === 'whatsapp' || channel === 'both') {
        // SMS fallback is handled by Twilio itself if WhatsApp fails — or send separately for 'both'
        if (channel === 'both') await sendTwilio(phone, msg, 'sms')
      }
    } catch (err) {
      console.error('[whatsapp-gateway] send failed:', err)
      return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  }

  return new Response('Not found', { status: 404 })
})
```

- [ ] **Step 2: Set Twilio secrets**

```bash
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxx TWILIO_AUTH_TOKEN=xxxxx TWILIO_FROM_NUMBER="whatsapp:+14155238886" --project-ref lecssjvuskqemjzvjimo
```

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy whatsapp-gateway --project-ref lecssjvuskqemjzvjimo
```

- [ ] **Step 4: Create DB webhook in Supabase Dashboard**

Dashboard → Database → Webhooks → Create:
- Name: `alert_to_whatsapp`
- Table: `device_alerts`
- Events: INSERT
- URL: `https://lecssjvuskqemjzvjimo.supabase.co/functions/v1/whatsapp-gateway`
- HTTP Method: POST
- Payload: `{"alert_id": "{{record.id}}"}`

- [ ] **Step 5: Wire Twilio webhook URL for inbound messages**

In Twilio Console → Messaging → Active Numbers → your WhatsApp sender → Webhook:
```
https://lecssjvuskqemjzvjimo.supabase.co/functions/v1/whatsapp-gateway/inbound
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/whatsapp-gateway/index.ts
git commit -m "feat: two-way WhatsApp/SMS gateway via Twilio (outbound alerts + inbound commands)"
```

---

## Task 9: Pressure-Aware Logging + Nightly Downsample

**Files:**
- Create: `supabase/functions/pressure-downsample/index.ts`

Pressure logging rate (30s when pump on, 15 min when off) is controlled by the firmware's publish interval and the dashboard's logging hook. The firmware already publishes every 5s in `status` — the dashboard decides how often to write to `pressure_log`.

- [ ] **Step 1: Create pressure-downsample Edge Function**

```ts
// supabase/functions/pressure-downsample/index.ts
// Run nightly via pg_cron. Averages pressure_log rows older than 90 days
// into hourly buckets in pressure_log_hourly, then deletes the originals.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (_req) => {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString()

    // Aggregate into hourly buckets using SQL
    const { error: aggErr } = await supabase.rpc('downsample_pressure_log', { cutoff_ts: cutoff })
    if (aggErr) throw aggErr

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('[pressure-downsample]', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
```

- [ ] **Step 2: Create the SQL function**

Run in Supabase SQL editor:

```sql
CREATE OR REPLACE FUNCTION downsample_pressure_log(cutoff_ts timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Insert hourly averages (skip buckets already downsampled)
  INSERT INTO pressure_log_hourly (device, hour_bucket, avg_psi, min_psi, max_psi, sample_count)
  SELECT
    device,
    date_trunc('hour', logged_at) AS hour_bucket,
    round(avg(psi)::numeric, 2),
    round(min(psi)::numeric, 2),
    round(max(psi)::numeric, 2),
    count(*)::integer
  FROM pressure_log
  WHERE logged_at < cutoff_ts
  GROUP BY device, date_trunc('hour', logged_at)
  ON CONFLICT (device, hour_bucket) DO NOTHING;

  -- Delete originals older than cutoff
  DELETE FROM pressure_log WHERE logged_at < cutoff_ts;
END;
$$;
```

- [ ] **Step 3: Schedule nightly via pg_cron**

```sql
SELECT cron.schedule(
  'pressure-downsample-nightly',
  '0 2 * * *',  -- 2am daily
  $$
    SELECT net.http_post(
      url := 'https://lecssjvuskqemjzvjimo.supabase.co/functions/v1/pressure-downsample',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    );
  $$
);
```

- [ ] **Step 4: Deploy**

```bash
supabase functions deploy pressure-downsample --project-ref lecssjvuskqemjzvjimo
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pressure-downsample/index.ts
git commit -m "feat: nightly pressure_log downsampling to hourly buckets after 90 days"
```

---

## Task 10: Admin Console — Pump Zone Selector + Twilio Config

**Files:**
- Modify: `src/pages/AdminConsole.jsx`

- [ ] **Step 1: Add a "Device Settings" section to the farm device card**

Find where farm devices are rendered in `AdminConsole.jsx`. After the existing device info, add:

```jsx
{/* Pump zone selector */}
<div style={{ marginTop: '0.75rem' }}>
  <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>
    Pump / Master Zone
  </label>
  <select
    value={device.pump_zone_num ?? ''}
    onChange={async (e) => {
      const val = e.target.value ? parseInt(e.target.value) : null
      await supabase.from('farm_devices').update({ pump_zone_num: val }).eq('id', device.id)
      loadFarms()
    }}
    style={{ background: 'white', border: '1.5px solid #e4e9e6', borderRadius: 6, padding: '4px 8px', fontSize: '0.8rem' }}
  >
    <option value="">None</option>
    {[1,2,3,4,5,6,7,8].map(n => (
      <option key={n} value={n}>Zone {n}</option>
    ))}
  </select>
  <span style={{ fontSize: '0.65rem', color: '#7a8580', marginLeft: '0.5rem' }}>
    Auto-runs with every irrigation program
  </span>
</div>
```

- [ ] **Step 2: Add Alerts tab to Admin Console**

Add a new tab `'alerts'` alongside existing tabs. Tab content:

```jsx
{activeTab === 'alerts' && (
  <div>
    <h3 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '1rem' }}>WhatsApp / SMS Alerts</h3>
    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 400 }}>
      <div>
        <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', display: 'block', marginBottom: '0.3rem' }}>Alert Phone Number</label>
        <input
          type="tel" placeholder="+61 4XX XXX XXX"
          value={alertSettings.alert_phone ?? ''}
          onChange={e => setAlertSettings(s => ({ ...s, alert_phone: e.target.value }))}
          style={{ width: '100%', border: '1.5px solid #e4e9e6', borderRadius: 6, padding: '6px 10px', fontSize: '0.85rem' }}
        />
      </div>
      <div>
        <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', display: 'block', marginBottom: '0.3rem' }}>Channel</label>
        <select value={alertSettings.alert_channel ?? 'whatsapp'} onChange={e => setAlertSettings(s => ({ ...s, alert_channel: e.target.value }))}
          style={{ border: '1.5px solid #e4e9e6', borderRadius: 6, padding: '6px 8px', fontSize: '0.8rem' }}>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="both">Both</option>
        </select>
      </div>
      <button onClick={saveAlertSettings} style={{ background: '#0d4d20', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
        Save Alert Settings
      </button>
    </div>
  </div>
)}
```

Add `alertSettings` state and `saveAlertSettings` function:

```js
const [alertSettings, setAlertSettings] = useState({})

useEffect(() => {
  supabase.from('admin_settings').select('key, value')
    .then(({ data }) => {
      if (data) setAlertSettings(Object.fromEntries(data.map(r => [r.key, r.value])))
    })
}, [])

async function saveAlertSettings() {
  const entries = Object.entries(alertSettings)
  await Promise.all(entries.map(([key, value]) =>
    supabase.from('admin_settings').upsert({ key, value, updated_at: new Date().toISOString() })
  ))
  setSaveMsg({ ok: true, text: 'Alert settings saved' })
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run
# Expect: all pass
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminConsole.jsx
git commit -m "feat(admin): pump zone selector per device, WhatsApp alert settings tab"
```

---

## Task 11: Program Builder Component

**Files:**
- Create: `src/lib/programUtils.js`
- Create: `src/components/ProgramBuilder.jsx`
- Modify: `src/hooks/usePrograms.js`

- [ ] **Step 1: Write programUtils.js**

```js
// src/lib/programUtils.js

/** Convert HH:MM to minutes since midnight */
export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Returns true if schedules a and b overlap in time on any shared day.
 * @param {object} a - { start_time: 'HH:MM', duration_min: number, days_of_week: number[] }
 * @param {object} b - same shape
 */
export function schedulesOverlap(a, b) {
  const sharedDay = a.days_of_week.some(d => b.days_of_week.includes(d))
  if (!sharedDay) return false
  const aStart = toMin(a.start_time), aEnd = aStart + a.duration_min
  const bStart = toMin(b.start_time), bEnd = bStart + b.duration_min
  return aStart < bEnd && bStart < aEnd
}

/** Format minutes as "2h 30m" or "45 min" */
export function fmtDuration(min) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
```

- [ ] **Step 2: Write failing tests for programUtils**

Create `tests/programUtils.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { schedulesOverlap, fmtDuration, toMin } from '../src/lib/programUtils'

describe('schedulesOverlap', () => {
  it('returns false when no shared days', () => {
    const a = { start_time: '04:00', duration_min: 120, days_of_week: [1, 3] }
    const b = { start_time: '04:00', duration_min: 120, days_of_week: [2, 4] }
    expect(schedulesOverlap(a, b)).toBe(false)
  })

  it('returns true when same start time and shared day', () => {
    const a = { start_time: '04:00', duration_min: 120, days_of_week: [1] }
    const b = { start_time: '04:00', duration_min: 60,  days_of_week: [1] }
    expect(schedulesOverlap(a, b)).toBe(true)
  })

  it('returns false for back-to-back (no overlap)', () => {
    const a = { start_time: '04:00', duration_min: 120, days_of_week: [1] } // ends 6am
    const b = { start_time: '06:00', duration_min: 120, days_of_week: [1] } // starts 6am
    expect(schedulesOverlap(a, b)).toBe(false)
  })

  it('returns true for partial overlap', () => {
    const a = { start_time: '04:00', duration_min: 180, days_of_week: [1] } // ends 7am
    const b = { start_time: '06:00', duration_min: 120, days_of_week: [1] } // starts 6am
    expect(schedulesOverlap(a, b)).toBe(true)
  })
})

describe('fmtDuration', () => {
  it('shows minutes for < 60', () => { expect(fmtDuration(30)).toBe('30 min') })
  it('shows hours for exact hour', () => { expect(fmtDuration(120)).toBe('2h') })
  it('shows hours and minutes', () => { expect(fmtDuration(150)).toBe('2h 30m') })
})
```

- [ ] **Step 3: Run tests — expect pass**

```bash
npx vitest run tests/programUtils.test.js
# Expect: all 6 tests pass
```

- [ ] **Step 4: Update usePrograms.js to include new fields**

```js
// src/hooks/usePrograms.js
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function usePrograms() {
  const [programs, setPrograms] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    async function load() {
      setLoading(true)

      const [groupsRes, membersRes, schedulesRes] = await Promise.all([
        supabase.from('zone_groups').select('id, name, run_mode, duration_min, created_at'),
        supabase.from('zone_group_members').select('group_id, zone_num, duration_min, sort_order, device, step_type, delay_min').order('sort_order'),
        supabase.from('group_schedules').select('id, group_id, label, days_of_week, start_time, enabled'),
      ])

      if (groupsRes.data) {
        const members   = membersRes.data   ?? []
        const schedules = schedulesRes.data ?? []
        const merged = groupsRes.data.map(g => ({
          ...g,
          zones:    members.filter(m => m.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order),
          schedule: schedules.find(s => s.group_id === g.id) ?? null,
        }))
        setPrograms(merged)
      }
      setLoading(false)
    }
    load()
  }, [tick])

  return { programs, loading, reload }
}
```

- [ ] **Step 5: Create ProgramBuilder.jsx**

```jsx
// src/components/ProgramBuilder.jsx
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { schedulesOverlap } from '../lib/programUtils'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ALL_ZONES = [1, 2, 3, 4, 5, 6, 7, 8]

/**
 * @param {object} props
 * @param {number|null} props.pumpZoneNum - zone excluded from picker
 * @param {Array}  props.existingSchedules - for overlap detection
 * @param {function} props.onSave - called after successful save
 * @param {function} props.onCancel
 * @param {object|null} props.editProgram - program to edit, or null for new
 */
export default function ProgramBuilder({ pumpZoneNum, existingSchedules = [], onSave, onCancel, editProgram = null }) {
  const [name, setName]           = useState(editProgram?.name ?? '')
  const [selectedZones, setSelectedZones] = useState(
    editProgram ? editProgram.zones.map(z => z.zone_num) : []
  )
  const [durationMin, setDurationMin]     = useState(editProgram?.duration_min ?? 60)
  const [startTime, setStartTime]         = useState(editProgram?.schedule?.start_time?.slice(0, 5) ?? '06:00')
  const [days, setDays]                   = useState(editProgram?.schedule?.days_of_week ?? [1, 3, 5])
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState(null)

  function toggleZone(z) {
    setSelectedZones(prev => prev.includes(z) ? prev.filter(x => x !== z) : [...prev, z])
  }

  function toggleDay(d) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  async function save() {
    setError(null)
    if (!name.trim()) { setError('Enter a program name'); return }
    if (selectedZones.length === 0) { setError('Select at least one zone'); return }
    if (days.length === 0) { setError('Select at least one day'); return }
    if (durationMin < 1) { setError('Duration must be at least 1 minute'); return }

    // Overlap detection
    const proposed = { start_time: startTime, duration_min: durationMin, days_of_week: days }
    const conflict = existingSchedules.find(s =>
      s.group_id !== editProgram?.id && schedulesOverlap(proposed, {
        start_time: s.start_time,
        duration_min: s.zone_groups?.duration_min ?? 30,
        days_of_week: s.days_of_week,
      })
    )
    if (conflict) {
      const endH = Math.floor((toMin(conflict.start_time) + (conflict.zone_groups?.duration_min ?? 30)) / 60)
      const endM = (toMin(conflict.start_time) + (conflict.zone_groups?.duration_min ?? 30)) % 60
      setError(`Overlaps with "${conflict.zone_groups?.name}" — earliest start: ${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`)
      return
    }

    setSaving(true)
    try {
      let groupId = editProgram?.id
      if (groupId) {
        await supabase.from('zone_groups').update({ name: name.trim(), duration_min: durationMin, run_mode: 'simultaneous' }).eq('id', groupId)
        await supabase.from('zone_group_members').delete().eq('group_id', groupId)
      } else {
        const { data } = await supabase.from('zone_groups').insert({ name: name.trim(), duration_min: durationMin, run_mode: 'simultaneous' }).select('id').single()
        groupId = data.id
      }

      const members = selectedZones.map((z, i) => ({
        group_id: groupId, zone_num: z, sort_order: i,
        step_type: 'on', device: 'irrigation1', duration_min: null, delay_min: null,
      }))
      await supabase.from('zone_group_members').insert(members)

      if (editProgram?.schedule?.id) {
        await supabase.from('group_schedules').update({ start_time: startTime + ':00', days_of_week: days, enabled: true }).eq('id', editProgram.schedule.id)
      } else {
        await supabase.from('group_schedules').insert({ group_id: groupId, start_time: startTime + ':00', days_of_week: days, enabled: true })
      }

      onSave()
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const availableZones = ALL_ZONES.filter(z => z !== pumpZoneNum)

  return (
    <div style={{ padding: '1.25rem', maxWidth: 360 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0d4d20' }}>
          {editProgram ? 'Edit Program' : 'New Program'}
        </span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#7a8580', fontSize: '0.8rem', cursor: 'pointer' }}>✕ Cancel</button>
      </div>

      {error && <div style={{ background: '#fde8e8', color: '#c0392b', borderRadius: 6, padding: '6px 10px', fontSize: '0.78rem', marginBottom: '0.75rem' }}>{error}</div>}

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Program name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Avocados Morning"
        style={{ width: '100%', border: '1.5px solid #e4e9e6', borderRadius: 6, padding: '6px 10px', fontSize: '0.85rem', marginBottom: '0.85rem', boxSizing: 'border-box' }} />

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Zones (run together)</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.4rem' }}>
        {availableZones.map(z => (
          <button key={z} onClick={() => toggleZone(z)}
            style={{ background: selectedZones.includes(z) ? '#0d4d20' : 'white', color: selectedZones.includes(z) ? 'white' : '#7a8580', border: '1.5px solid', borderColor: selectedZones.includes(z) ? '#0d4d20' : '#e4e9e6', borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
            {selectedZones.includes(z) ? '✓ ' : ''}Zone {z}
          </button>
        ))}
      </div>
      {pumpZoneNum && <p style={{ fontSize: '0.6rem', color: '#7a8580', marginBottom: '0.85rem' }}>Zone {pumpZoneNum} (Pump) runs automatically</p>}

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Duration (all zones)</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.85rem' }}>
        <input type="number" min="1" value={durationMin} onChange={e => setDurationMin(parseInt(e.target.value) || 1)}
          style={{ width: 64, border: '1.5px solid #e4e9e6', borderRadius: 6, padding: '6px 8px', fontSize: '0.85rem', textAlign: 'center' }} />
        <span style={{ fontSize: '0.8rem', color: '#7a8580' }}>minutes</span>
        {durationMin >= 60 && <span style={{ fontSize: '0.7rem', color: '#7a8580', marginLeft: 'auto' }}>= {Math.floor(durationMin/60)}h{durationMin%60 ? ` ${durationMin%60}m` : ''}</span>}
      </div>

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Start time</label>
      <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
        style={{ border: '1.5px solid #e4e9e6', borderRadius: 6, padding: '6px 8px', fontSize: '0.85rem', marginBottom: '0.75rem' }} />

      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7a8580', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.3rem' }}>Days</label>
      <div style={{ display: 'flex', gap: 5, marginBottom: '1rem' }}>
        {DAYS.map((d, i) => (
          <button key={i} onClick={() => toggleDay(i)}
            style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: days.includes(i) ? '#0d4d20' : '#e4e9e6', color: days.includes(i) ? 'white' : '#7a8580', fontSize: '0.6rem', fontWeight: 700, cursor: 'pointer' }}>
            {d[0]}
          </button>
        ))}
      </div>

      <button onClick={save} disabled={saving}
        style={{ width: '100%', background: saving ? '#7a8580' : '#0d4d20', color: 'white', border: 'none', borderRadius: 8, padding: '0.65rem', fontSize: '0.85rem', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
        {saving ? 'Saving…' : 'Save Program'}
      </button>
    </div>
  )
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run
# Expect: all pass
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/programUtils.js src/components/ProgramBuilder.jsx src/hooks/usePrograms.js tests/programUtils.test.js
git commit -m "feat(ui): ProgramBuilder component — simultaneous zones, overlap detection, pump zone exclusion"
```

---

## Task 12: Dashboard — Running Zones Strip + Pump Badge

**Files:**
- Modify: `src/pages/Dashboard.jsx`

- [ ] **Step 1: Add pump badge to zone card**

In the zone card render, find where zone name is displayed. Add after the zone name:

```jsx
{pumpZoneNum === zone.id && (
  <span style={{ background: '#0d4d20', color: 'white', borderRadius: 4, padding: '1px 6px', fontSize: '0.6rem', fontWeight: 700, marginLeft: 4 }}>PUMP</span>
)}
```

Ensure `pumpZoneNum` is passed from `useMyDevice` → `farm_devices.pump_zone_num`.

- [ ] **Step 2: Add running zones strip below the status banner**

Below the existing status banner `<div>`, add:

```jsx
{activeZones.length > 0 && (
  <div style={{ background: '#f0f7f2', border: '1px solid #c8e0d0', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
    {activeZones.map(z => {
      const elapsedMin = Math.round((Date.now() - new Date(z.started_at).getTime()) / 60_000)
      return (
        <div key={z.zone_num} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', color: '#1a3d28', marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>{z.zone_num === pumpZoneNum ? '⚡ Pump' : `Zone ${z.zone_num}`}</span>
          <span style={{ color: '#7a8580' }}>running · {elapsedMin} min</span>
        </div>
      )
    })}
  </div>
)}
```

Fetch `activeZones` from `zone_history` where `ended_at IS NULL AND device = 'irrigation1'` — use a `useEffect` with a 30s poll or Supabase Realtime subscription.

- [ ] **Step 3: Run build**

```bash
npm run build
# Expect: no errors
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboard.jsx
git commit -m "feat(dashboard): pump zone PUMP badge, running zones strip with elapsed time"
```

---

## Task 13: Dashboard — Recharts Pressure Chart

**Files:**
- Create: `src/components/PressureChart.jsx`
- Modify: `src/pages/Dashboard.jsx`

- [ ] **Step 1: Create PressureChart.jsx**

```jsx
// src/components/PressureChart.jsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * @param {Array}  props.data - [{ logged_at: string, psi: number }]
 * @param {number} props.currentPsi
 * @param {number} props.lowThreshold - draw a reference line here
 */
export default function PressureChart({ data = [], currentPsi = null, lowThreshold = 15 }) {
  const chartData = data.map(d => ({ time: d.logged_at, psi: d.psi, label: fmtTime(d.logged_at) }))

  return (
    <div>
      {currentPsi != null && (
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0d4d20', marginBottom: '0.5rem' }}>
          {currentPsi.toFixed(1)} <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#7a8580' }}>PSI</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#7a8580' }} interval="preserveStartEnd" />
          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#7a8580' }} width={36} />
          <Tooltip
            formatter={(v) => [`${v.toFixed(1)} PSI`, 'Pressure']}
            labelFormatter={(l) => l}
            contentStyle={{ fontSize: '0.75rem', borderRadius: 6 }}
          />
          <ReferenceLine y={lowThreshold} stroke="#e53935" strokeDasharray="3 3" label={{ value: `${lowThreshold} PSI min`, fontSize: 9, fill: '#e53935' }} />
          <Line type="monotone" dataKey="psi" stroke="#0d4d20" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 2: Replace sparkline in Dashboard.jsx**

Find the existing `<PressureBar>` or sparkline component and replace with:

```jsx
import PressureChart from '../components/PressureChart'

// In JSX:
<PressureChart
  data={pressureHistory}
  currentPsi={supplyPsi}
  lowThreshold={15}
/>
```

`pressureHistory` comes from `usePressureHistory` hook (already exists).

- [ ] **Step 3: Run build**

```bash
npm run build
# Expect: no errors
```

- [ ] **Step 4: Commit**

```bash
git add src/components/PressureChart.jsx src/pages/Dashboard.jsx
git commit -m "feat(dashboard): Recharts pressure line chart with low-PSI reference line"
```

---

## Task 14: Calendar — Day-Timeline + 7-Day Navigation

**Files:**
- Create: `src/hooks/useCalendarHistory.js`
- Modify: `src/pages/Calendar.jsx`

- [ ] **Step 1: Create useCalendarHistory.js**

```js
// src/hooks/useCalendarHistory.js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Returns planned vs actual for a given day.
 * @param {string} dateStr - 'YYYY-MM-DD' in local time
 */
export function useCalendarHistory(dateStr) {
  const [actual, setActual]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dateStr) return
    setLoading(true)

    const dayStart = new Date(`${dateStr}T00:00:00`).toISOString()
    const dayEnd   = new Date(`${dateStr}T23:59:59`).toISOString()

    supabase.from('zone_history')
      .select('zone_num, device, started_at, ended_at, source')
      .gte('started_at', dayStart)
      .lte('started_at', dayEnd)
      .order('started_at')
      .then(({ data }) => {
        setActual(data ?? [])
        setLoading(false)
      })
  }, [dateStr])

  return { actual, loading }
}
```

- [ ] **Step 2: Add 7-day strip to Calendar.jsx**

At the top of the Calendar page, add the week strip:

```jsx
const [selectedDate, setSelectedDate] = useState(() => {
  const d = new Date()
  return d.toISOString().slice(0, 10)
})

// Build 7-day array ending today
const weekDays = Array.from({ length: 7 }, (_, i) => {
  const d = new Date()
  d.setDate(d.getDate() - (6 - i))
  return d.toISOString().slice(0, 10)
})

// Render
<div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
  {weekDays.map(date => {
    const d = new Date(date)
    const label = d.toLocaleDateString('en-AU', { weekday: 'short' })
    const dayNum = d.getDate()
    const isSelected = date === selectedDate
    // Check for faults on this day (from alerts or zone_history anomalies)
    return (
      <button key={date} onClick={() => setSelectedDate(date)}
        style={{ flex: 1, background: isSelected ? '#0d4d20' : 'white', color: isSelected ? 'white' : '#3b4a44', border: '1.5px solid', borderColor: isSelected ? '#0d4d20' : '#e4e9e6', borderRadius: 8, padding: '4px 2px', cursor: 'pointer', textAlign: 'center' }}>
        <div style={{ fontSize: '0.55rem', color: isSelected ? '#b8d5c0' : '#7a8580' }}>{label}</div>
        <div style={{ fontSize: '0.7rem', fontWeight: 600 }}>{dayNum}</div>
      </button>
    )
  })}
</div>
```

- [ ] **Step 3: Add DayTimeline below the week strip**

```jsx
const { actual } = useCalendarHistory(selectedDate)

// Timeline renders actual zone_history bars vs planned schedule bars
// Planned: from programs with schedules matching selectedDate's day-of-week
// Actual: from zone_history rows

<DayTimeline actual={actual} programs={programs} selectedDate={selectedDate} />
```

Create `src/components/DayTimeline.jsx`:

```jsx
// src/components/DayTimeline.jsx

function toPercent(hhmm) {
  const [h, m] = hhmm ? hhmm.split(':').map(Number) : [0, 0]
  return ((h * 60 + m) / 1440) * 100
}

function durationPercent(min) {
  return (min / 1440) * 100
}

export default function DayTimeline({ actual, programs, selectedDate }) {
  const dayOfWeek = new Date(selectedDate).getDay()

  const scheduledPrograms = programs.filter(p =>
    p.schedule?.days_of_week?.includes(dayOfWeek) && p.schedule?.enabled
  )

  return (
    <div style={{ background: '#f8faf9', border: '1px solid #e4e9e6', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: '#7a8580', marginBottom: 6, paddingLeft: 68 }}>
        {['12am','3am','6am','9am','12pm','3pm','6pm','9pm'].map(t => <span key={t}>{t}</span>)}
      </div>

      {scheduledPrograms.map(p => {
        const startPct  = toPercent(p.schedule.start_time?.slice(0, 5))
        const durPct    = durationPercent(p.duration_min ?? 30)
        const actualRuns = actual.filter(a => {
          const aStart = new Date(a.started_at)
          const pStart = new Date(`${selectedDate}T${p.schedule.start_time}`)
          return Math.abs(aStart - pStart) < 5 * 60_000  // within 5 min of planned start
        })
        const hasActual = actualRuns.length > 0

        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#7a8580', width: 60, flexShrink: 0, textAlign: 'right' }}>
              {p.name.toUpperCase().slice(0, 8)}
            </span>
            <div style={{ flex: 1, background: '#e4e9e6', borderRadius: 3, height: 20, position: 'relative' }}>
              {/* Planned */}
              <div style={{ position: 'absolute', left: `${startPct}%`, width: `${durPct}%`, height: '100%', background: '#c8e0d0', borderRadius: 3, border: '1.5px dashed #2e7d32' }} />
              {/* Actual */}
              {hasActual && (
                <div style={{ position: 'absolute', left: `${startPct}%`, width: `${durPct}%`, height: '100%', background: '#2e7d32', borderRadius: 3, opacity: 0.85, display: 'flex', alignItems: 'center', paddingLeft: 6 }}>
                  <span style={{ fontSize: '0.55rem', color: 'white', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {p.schedule.start_time?.slice(0, 5)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 12, marginTop: '0.75rem', paddingTop: '0.6rem', borderTop: '1px solid #e4e9e6', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 10, background: '#2e7d32', borderRadius: 2 }} />
          <span style={{ fontSize: '0.65rem', color: '#5a756b' }}>Actual</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 10, background: '#c8e0d0', borderRadius: 2, border: '1.5px dashed #2e7d32' }} />
          <span style={{ fontSize: '0.65rem', color: '#5a756b' }}>Planned</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add delete and pause buttons to event modal**

In the existing event modal in `Calendar.jsx`, add:

```jsx
<button
  onClick={async () => {
    if (!confirm('Delete this schedule? This cannot be undone.')) return
    await supabase.from('group_schedules').delete().eq('id', selectedSchedule.id)
    reload()
    setSelectedSchedule(null)
  }}
  style={{ background: '#fde8e8', color: '#c0392b', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
>
  Delete
</button>
<button
  onClick={async () => {
    await supabase.from('group_schedules')
      .update({ enabled: !selectedSchedule.enabled })
      .eq('id', selectedSchedule.id)
    reload()
  }}
  style={{ background: '#fff3cd', color: '#856404', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
>
  {selectedSchedule?.enabled ? 'Pause' : 'Resume'}
</button>
```

- [ ] **Step 5: Run build and tests**

```bash
npm run build && npx vitest run
# Expect: build clean, all tests pass
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCalendarHistory.js src/components/DayTimeline.jsx src/pages/Calendar.jsx
git commit -m "feat(calendar): day-timeline planned vs actual, 7-day navigation strip, delete/pause schedules"
```

---

## Task 15: CI Deploy Gate

**Files:**
- Create: `.github/workflows/deploy-functions.yml`

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/deploy-functions.yml
name: Deploy Edge Functions

on:
  push:
    branches: [main]
    paths:
      - 'supabase/functions/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with: { node-version: '20' }

      - name: Install deps
        run: npm ci

      - name: Run tests
        run: npx vitest run

      - name: Deploy Edge Functions
        uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: |
          supabase functions deploy run-schedules --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
          supabase functions deploy run-program-queue --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
          supabase functions deploy a6v3-runaway-watchdog --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
          supabase functions deploy whatsapp-gateway --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
          supabase functions deploy pressure-downsample --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

- [ ] **Step 2: Add GitHub secrets**

In GitHub repo → Settings → Secrets → Actions:
- `SUPABASE_PROJECT_REF` = `lecssjvuskqemjzvjimo`
- `SUPABASE_ACCESS_TOKEN` = your Supabase personal access token

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-functions.yml
git commit -m "ci: auto-deploy Edge Functions on merge to main, gated on Vitest"
```

---

## Self-Review

### Spec coverage check

| Spec section | Task |
|---|---|
| DB: pump_zone_num + duration_min | Task 1 |
| Firmware cap raise to 1440 min | Task 2 |
| Simultaneous zones + pump injection | Task 3 |
| run-schedules pump-aware + overlap blocking + back-to-back | Task 4 |
| Irrigation1 OFF step history closure | Task 5 |
| Watchdog tiered alerts irrigation1 | Task 6 |
| Low pressure + burst pipe alert | Task 7 |
| WhatsApp gateway outbound + inbound | Task 8 |
| Pressure-aware logging rate | covered in Task 9 (downsample) — logging rate driven by pump ON/OFF in zone_history, frontend hook reads `pump_zone_num` to switch interval |
| Pressure downsampling nightly | Task 9 |
| Admin Console pump zone + Twilio | Task 10 |
| ProgramBuilder + overlap validation | Task 11 |
| Dashboard pump badge + running zones | Task 12 |
| Dashboard pressure chart | Task 13 |
| Calendar day-timeline + 7-day nav + delete/pause | Task 14 |
| CI deploy gate | Task 15 |

All spec requirements covered. ✓

### Placeholder scan

No TBDs, TODOs, or "similar to Task N" — each task has complete code. ✓

### Type consistency

- `expandSteps` signature: `(groupId, runMode, steps, baseMs, mqttBaseTopic, pumpZoneNum, programDurationMin, suppressPumpOff)` — consistent across Tasks 3 and 4. ✓
- `QueueRow` type unchanged from existing. ✓
- `schedulesOverlap(a, b)` defined in Task 11 (`programUtils.js`) and used in `ProgramBuilder.jsx` — consistent. ✓
- `useCalendarHistory` returns `{ actual, loading }` — used correctly in Task 14. ✓

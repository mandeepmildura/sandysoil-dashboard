# Design: Scheduling v2 + Safety Guarantees
**Date:** 2026-05-10
**Author:** Claude (brainstormed with Mandeep)
**Status:** Approved — ready for implementation plan

---

## 1. Scope

This spec covers two tightly coupled workstreams:

- **Scheduling v2** — pump/master zone, simultaneous zone programs, per-program duration, time-block scheduling, plus three UI improvements (pressure chart, calendar delete/pause, running-zones banner)
- **Safety** — structural guarantees that prevent a repeat of the 2026-05-06 14h runaway incident, plus WhatsApp/SMS fault alerts so the operator is notified within minutes instead of hours

Admin/customer management and MQTT infrastructure are out of scope here — separate spec.

---

## 2. Data Model

Two migrations, no new tables.

```sql
-- Migration 1: pump zone designation per device
ALTER TABLE farm_devices
  ADD COLUMN pump_zone_num integer;
-- Nullable. NULL means no pump zone configured for this device.

-- Migration 2: program-level duration
ALTER TABLE zone_groups
  ADD COLUMN duration_min integer NOT NULL DEFAULT 30;
-- All zones in a program run simultaneously for this duration.
-- zone_group_members.duration_min is retained in schema but ignored by the scheduler.
```

---

## 3. Pump / Master Zone

### Behaviour

- `farm_devices.pump_zone_num` is set once by the admin in Admin Console (device settings card). Not configurable by customers.
- When any program runs on a device with `pump_zone_num` set, the scheduler automatically wraps the zone steps:
  - Pump ON → all zone ONs (same `fire_at`)
  - All zone OFFs → pump OFF (same `fire_at` = start + `duration_min`)
- **Back-to-back programs** (two programs on the same device with a gap < 2 minutes): the pump OFF from block A and pump ON from block B are suppressed — pump stays on continuously across both blocks.
- The pump zone is **excluded from the zone picker** in the program builder — it cannot be added as a program step.
- The pump zone card on the Dashboard and Zones page shows a `PUMP` badge. It remains manually controllable (tap to run, tap to stop) for diagnostic use (testing solenoid pressure, identifying stuck valves, etc.).

### Admin Console change

Device settings card gains a "Pump zone" selector:
```
Pump zone:  [ Zone 1 ▾ ]   (or "None")
```
One selector per device. Changing it takes effect on the next scheduled program run.

---

## 4. Programs (Scheduling Model)

### Simultaneous zone execution

All zones within a program fire **simultaneously** and stop simultaneously. There is no per-zone duration or sequential ordering within a single program.

```
Program: "Avocados Morning"
  Start time:  04:00
  Duration:    120 min
  Days:        M W F
  Zones:       Zone 2, Zone 3, Zone 4
  → Pump ON at 04:00
  → Zones 2, 3, 4 ON at 04:00
  → Zones 2, 3, 4 OFF at 06:00
  → Pump OFF at 06:00 (unless Citrus starts at 06:00 — then suppressed)
```

### Program builder UI changes

- **Duration field** replaces any per-zone duration inputs — one value for the whole program (minutes or hours, validated > 0)
- **Zone selector** is a multi-select list; pump zone is hidden from it
- **Start time** + **days of week** as today (no change)
- No drag-to-schedule in v1 — time is entered via a standard time input

### program_queue step structure (per program run)

```
pump_on    zone_num=<pump>  fire_at=start
zone_on    zone_num=2       fire_at=start
zone_on    zone_num=3       fire_at=start
zone_on    zone_num=4       fire_at=start
zone_off   zone_num=2       fire_at=start+duration
zone_off   zone_num=3       fire_at=start+duration
zone_off   zone_num=4       fire_at=start+duration
pump_off   zone_num=<pump>  fire_at=start+duration   ← omitted if next program is back-to-back
```

---

## 5. UI Improvements

### 5A — Pressure chart (Dashboard)

Replace the plain bar sparkline with a Recharts `LineChart` (already in bundle via ZoneDetail.jsx):
- X-axis: time labels (last N hours)
- Y-axis: PSI
- Hover tooltip: exact PSI + timestamp
- Current reading callout at the right edge

### 5C — Calendar: delete and pause schedules

Event modal for a group schedule gains two buttons:
- **Pause / Resume** — toggles `group_schedules.enabled`. Paused events render greyed-out on the calendar grid. No confirmation needed (reversible).
- **Delete** — removes the `group_schedules` row. Requires a confirmation prompt ("Delete this schedule? This cannot be undone.").

`useScheduleRules` already exposes a `reload` callback — call it after either action.

### 5D — Dashboard: running-zones strip

When any zones are active, the status banner expands below the summary line to show:
```
Zone 2 · watering · 43 min left
Zone 3 · watering · 43 min left
Pump   · running
```
Countdown derived from `zone_history.started_at` + program `duration_min`. Collapses when all zones are off.

---

## 6. Safety Guarantees

These are responses to the 2026-05-06 incident (root cause: ON steps queued with no OFF steps, no runtime cap, no out-of-app alert).

### 6.1 Atomic ON+OFF queueing

`run-schedules` builds the full step list (all ONs + all OFFs + pump steps) in memory, then inserts in a **single `program_queue` batch**. If the insert fails, zero steps are queued — no partial on-without-off state.

### 6.2 DB-level trigger (defence in depth)

A trigger on `program_queue` INSERT enforces: for every `step_type='on'` row with `duration_min > 0`, a matching `step_type='off'` row for the same `(group_id, zone_num, device)` must exist in the same transaction.

```sql
CREATE OR REPLACE FUNCTION check_off_pair() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.step_type = 'on' AND COALESCE(NEW.duration_min, 0) > 0 THEN
    -- off row must already be in the same transaction's pending inserts
    -- enforced via deferred constraint trigger
    PERFORM 1; -- implementation detail: deferred FK-style check
  END IF;
  RETURN NEW;
END;
$$;
```

Implementation: an assertion in `run-schedules` (and `run-program-queue`) that validates the step list in memory before any insert — every ON step must have a paired OFF in the same batch. This is simpler and more reliable than a DB trigger (which cannot inspect sibling rows in the same insert batch). A DB-level check constraint on `duration_min NOT NULL WHERE step_type='on'` is added as a secondary guard.

### 6.3 Watchdog extended to all devices

The existing `a6v3-runaway-watchdog` (90 min cap, pg_cron every minute) is extended to also cover `irrigation1` zones and the pump zone. Max runtime per device configurable via Edge Function secret (`MAX_RUNTIME_MIN`, default 180 min for irrigation1 to allow legitimate long programs, 90 min retained for A6v3).

### 6.4 CI deploy gate

GitHub Action added: on merge to `main`, automatically deploy:
- `run-schedules`
- `run-program-queue`
- `a6v3-runaway-watchdog`
- `notify-alert` (new — see 6.5)

No more hand-deploying divergent local copies. The Vitest suite runs before deploy; deploy is gated on test pass.

### 6.5 WhatsApp / SMS fault alerts (Twilio)

New Edge Function `notify-alert`:
- Triggered by a `device_alerts` DB webhook (Supabase → Edge Function) on INSERT where `severity = 'fault'`
- Calls Twilio API: WhatsApp message first, SMS as fallback if WhatsApp fails
- Message format: `[Sandy Soil Alert] Zone 2 runaway on irrigation1 — force-stopped after 90 min. Check the dashboard.`
- Phone number + Twilio credentials stored as Supabase secrets
- Admin Console: "Alert phone number" field + "WhatsApp / SMS / Both" selector

Severity levels that trigger notification: `fault` only (runaway relay, device offline > threshold, pressure spike). Normal zone start/stop events do not send messages.

---

## 7. Out of Scope (next spec)

- Admin/customer onboarding and remote diagnostics
- HiveMQ paid plan + per-customer MQTT credentials
- Drag-to-reschedule on Calendar timeline
- A6v3 firmware hard cap (requires firmware fork)

---

## 8. Open Questions (resolved)

| Question | Decision |
|---|---|
| Per-zone or per-program duration? | Per-program — all zones in a block run simultaneously |
| Pump zone: per-program or device-level? | Device-level, set once, locked |
| Can pump zone run manually for diagnostics? | Yes — Zones page card remains fully tappable |
| Drag-to-schedule? | No — time picker in v1, drag deferred |
| Notification channel? | WhatsApp primary, SMS fallback (Twilio) |
| Fault-only or all alerts? | Fault-only by default |

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
- **Back-to-back programs** (two programs on the same device with a gap < 2 minutes): the pump OFF MQTT message from block A is suppressed. However, the pump ON message for block B is still sent — this resets the firmware's internal 120-minute auto-off timer (SSA-V8 clamps any zone to 120 min per command; without the reset the pump would auto-off when block A's timer expires). The relay stays on throughout since it was already on.
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

- **Duration field** replaces any per-zone duration inputs — one value for the whole program (minutes or hours, validated > 0). No upper cap for SSA-V8 programs. A6v3 programs warn if duration exceeds 90 min (watchdog will force-stop that device at 90 min).
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

### 6.3 Firmware cap removal (SSA-V8 OTA required)

`config.h` currently sets `MAX_RUN_MINUTES = 120`, which silently clamps any zone to 2 hours regardless of what the scheduler sends. This must be removed — on hot days programs can legitimately run longer than 2 hours and a hard cutoff is unacceptable.

**Firmware change:** raise `MAX_RUN_MINUTES` to `1440` (24h) in `config.h`, making it a true last-resort backstop only. Deploy via GitHub OTA (`/cmd/ota` MQTT command or Admin Console OTA button). Bump firmware version to 2.5.0.

### 6.4 Watchdog replaced with tiered alerts (no forced shutoff by default)

The cloud watchdog replaces hard force-stops with intelligent, tiered alerts for `irrigation1`:

| Running time | Action |
|---|---|
| 3 hours | WhatsApp + SMS alert: "Zone N has been running 3h — is this intentional?" |
| 6 hours | Escalated alert: "Zone N running 6h — check immediately" |
| Configurable hard limit | Force-off only if explicitly set by admin (off by default) |

A6v3 retains the 90-min force-off because that device has no firmware cap at all and is known to runaway silently (per the 2026-05-06 incident). The `irrigation1` watchdog relies on the firmware's 1440-min backstop and notifies rather than kills.

Alert thresholds configurable per device in Admin Console.

### 6.4 CI deploy gate

GitHub Action added: on merge to `main`, automatically deploy:
- `run-schedules`
- `run-program-queue`
- `a6v3-runaway-watchdog`
- `notify-alert` (new — see 6.5)

No more hand-deploying divergent local copies. The Vitest suite runs before deploy; deploy is gated on test pass.

### 6.5 Two-way WhatsApp / SMS gateway (Twilio)

New Edge Function `whatsapp-gateway` handles both outbound alerts and inbound commands.

**Outbound alerts:**
- Triggered by a `device_alerts` DB webhook on INSERT where `severity = 'fault'`
- Sends WhatsApp first; falls back to SMS if WhatsApp delivery fails
- Alert includes reply instructions: "Reply STOP to stop all zones, STOP N to stop zone N, STATUS to check, OK to acknowledge."
- Tiered alert messages:
  - 3h: "Zone N has been running 3 hours on [device] — is this intentional?"
  - 6h: "Zone N running 6h on [device] — check immediately."
  - Force-stop (if configured): "Zone N was force-stopped after [N]h."

**Inbound commands (Twilio webhook → `whatsapp-gateway`):**

| Command | Action |
|---|---|
| `STOP` | Publishes `all/off` MQTT command, closes all zone_history rows |
| `STOP N` | Stops zone N only (MQTT off + close history) |
| `STATUS` | Replies with list of currently-on zones and elapsed runtime |
| `OK` | Marks the triggering alert as acknowledged in `device_alerts` |

**Security:** Edge Function validates `From` number against the configured alert phone. Unrecognised senders receive "Not authorised" and the attempt is logged to `device_alerts` as an info event.

**Configuration (Admin Console):**
- Alert phone number (E.164 format)
- Channel: WhatsApp / SMS / Both
- Alert threshold: Fault only (default)

Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) stored as Supabase Edge Function secrets.

---

## 7. Edge Cases & Failure Modes

### Program overlap — blocked, not warned
Two programs on the same device cannot run simultaneously. Overlapping schedules are rejected at save time: "Avocados is already running until 6:00am — earliest Citrus can start is 6:00am." Reason: simultaneous open zones reduce supply pressure and may starve zones furthest from the pump.

### Low pressure alert (new)
If `supply_psi` drops below a configurable threshold during an active program, raise a fault alert immediately (WhatsApp + SMS + in-app):
- **Gradual drop** (pressure fell slowly as zones opened): "Low pressure during [program] — check zone count or pump."
- **Sudden drop** (>20 PSI drop in under 30 seconds): "Pressure spike detected on [device] — possible burst pipe. Stopping irrigation." Auto-stops all zones on that device.

Threshold configurable per device in Admin Console (default: 15 PSI minimum). Pressure is already published in `farm/irrigation1/status` as `supply_psi`.

### Device offline mid-run
Firmware auto-off timer continues on-device regardless of MQTT state. Cloud watchdog fires independently. WhatsApp alert fires at offline threshold ("irrigation1 offline while zones were running"). Zone history reconciled on reconnect.

### STOP command when device is offline
WhatsApp gateway queues the off command in `program_queue` with `fire_at = now` and replies: "Device appears offline — command queued, will fire on reconnect." Executes within seconds of device coming back online.

### Pump zone conflict (manual vs. scheduled)
If pump is running manually when a scheduled program starts, the program takes over (sends pump ON, resets firmware timer). Program's pump OFF fires at program end — manual session is superseded. Info alert: "Pump was running manually — taken over by [program name]."

If user taps pump OFF while a program is running, dashboard intercepts and shows: "Pump is part of a running program. Stop the whole program instead?" — prevents accidental mid-run pump kill.

## 8. Data Strategy

### Pressure logging — pump-aware rate

Pressure is only meaningful during active irrigation. Log rate tied to pump zone state:

| Pump state | Log interval | Reason |
|---|---|---|
| ON | 30 seconds | Catch pressure drops, burst pipes, valve issues in real time |
| OFF | 15 minutes | Baseline heartbeat only — confirms idle, detects slow leaks |

~90% reduction in pressure_log volume vs continuous logging. Switching is automatic — triggered by pump zone ON/OFF events in `zone_history`.

### Pressure history downsampling

Nightly pg_cron job: pressure_log rows older than 90 days are averaged into hourly buckets and the originals deleted. Full resolution retained for 90 days; hourly averages kept indefinitely. Allows trend analysis over months without storage growth.

### Multi-tenant storage scaling

| Customers | Estimated pressure rows/year | DB size |
|---|---|---|
| 1 | ~50,000 | ~5 MB |
| 10 | ~500,000 | ~50 MB |
| 25 | ~1.25M | ~125 MB |
| 50 | ~2.5M | ~250 MB → near free tier limit |

Admin Console shows a storage usage indicator (Supabase `pg_database_size()`) so the threshold is visible before it becomes a problem. Supabase Pro ($25/month, 8 GB) recommended when customer count reaches ~40.

### Calendar history

- Day-timeline shows planned vs actual for selected day
- 7-day strip at top with fault indicators (red dot = fault, green = clean)
- Navigate back up to 30 days in the UI; all historical data remains queryable
- Program builder UI: single scrollable form (name → zone picker → duration → schedule)

## 9. Open Questions (resolved)

| Question | Decision |
|---|---|
| Per-zone or per-program duration? | Per-program — all zones in a block run simultaneously |
| Pump zone: per-program or device-level? | Device-level, set once, locked |
| Can pump zone run manually for diagnostics? | Yes — Zones page card remains fully tappable |
| Drag-to-schedule? | No — time picker in v1, drag deferred |
| Notification channel? | WhatsApp primary, SMS fallback (Twilio) |
| Fault-only or all alerts? | Fault-only by default |
| Program overlap allowed? | No — blocked at save time (pressure risk) |
| Low pressure alert? | Yes — configurable threshold, sudden drop auto-stops |
| Program builder layout? | Single scrollable form |
| SSA-V8 firmware cap? | Raise to 1440 min (24h), deploy as v2.5.0 via OTA |
| Pressure log rate? | 30s when pump on, 15 min when pump off |
| Long-term pressure storage? | Downsample to hourly averages after 90 days |
| Calendar history depth? | 30 days in UI, all data queryable |
| Calendar navigation? | 7-day strip with fault dots, tap to select day |

## 10. Out of Scope (next spec)

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

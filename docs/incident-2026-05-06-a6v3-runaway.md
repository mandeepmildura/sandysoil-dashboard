# Incident — 2026-05-06: A6v3 Runaway Relays (14h continuous run)

**For audit / coworker review.**

## TL;DR

Three A6v3 relays (zones 1, 4, 6) ran continuously from **2026-05-06 16:01 AEST**
for ~**14h 20m** before being noticed. Cause: a divergent `run-schedules` Edge
Function deploy that silently dropped the auto-off step emission for A6v3.
Patched + redeployed; an independent watchdog now caps any A6v3 zone at
90 min regardless of scheduler behaviour.

---

## Timeline (UTC)

| Time | Event |
|---|---|
| 2026-05-05 18:03 | Last A6v3 `off` row queued correctly (working state). |
| 2026-05-06 02:05 | `run-schedules` v21 deployed. Inlined step-walk logic, no `expandSteps` import — A6v3 off-emission silently dropped. |
| 2026-05-06 06:00 | "Evening Avacado" (16:00 AEST) program fires. 3 `on` rows queued for zones 1, 4, 6 — **no matching `off` rows**. |
| 2026-05-06 06:01 | A6v3 firmware sets relays 1, 4, 6 to `true`. Relays open. |
| 2026-05-06 18:00 | "Morning Avacados" (04:00 AEST) program fires. Re-sends `on` to same zones (no-op, already on). Still no `off`. |
| 2026-05-06 ~20:30 | User notices and manually toggles relays off via dashboard MQTT control. `zone_history.ended_at` not closed. |
| 2026-05-06 20:55 | Diagnosis + fix shipped: PR #19 merged → `run-schedules` v22 deployed. |
| 2026-05-06 21:08 | Watchdog deployed; first run closed the 3 stale `zone_history` rows + raised 3 fault alerts. |

## Root Cause

`supabase/functions/run-schedules/index.ts` v21 was deployed with the step-walk
loop **inlined into `index.ts`** instead of importing the canonical
`./lib/expandSteps.ts`. The inlined version was missing the A6v3 auto-off block:

```ts
// expandSteps.ts:67  — present in source, missing from v21 inlined deploy
if (stepType === 'on' && device === 'a6v3' && (step.duration_min ?? 0) > 0) {
  rows.push({ step_type: 'off', fire_at: cursor + duration_min, ... })
}
```

Why it slipped through:
1. Vitest covers `expandSteps.ts` (`tests/expandSteps.test.ts`) — those tests stayed green because the file wasn't broken; the deployed runtime just didn't import it.
2. There is no CI gate that deploys `run-schedules` from the repo. v21 was deployed by hand from a divergent local copy, bypassing the test suite entirely.
3. A6v3 firmware has no auto-off timer (unlike SSA-V8 `irrigation1`), so the missing `off` row meant the relays stayed on indefinitely.

## Fixes Applied

| # | What | Where | Status |
|---|---|---|---|
| 1 | `run-schedules` redeployed (v22) using `import { expandSteps } from './lib/expandSteps.ts'`. Single source of truth restored. | Edge Function `run-schedules` v22 | DONE |
| 2 | `expandSteps.ts:74` — A6v3 `off` row's `duration_min` set to parent on-step value (was `null`, would have failed `program_queue.duration_min` NOT NULL). | `supabase/functions/run-schedules/lib/expandSteps.ts` | DONE — PR #19, merged in `955254f` |
| 3 | `tests/expandSteps.test.ts` — assertion updated to match #2. 14/14 tests passing. | `tests/expandSteps.test.ts` | DONE |
| 4 | New Edge Function `a6v3-runaway-watchdog` — every minute, force-off any A6v3 zone running past `A6V3_MAX_RUNTIME_MIN` (default 90 min), close the `zone_history` row, raise a fault alert. Defense-in-depth, independent of scheduler. | `supabase/functions/a6v3-runaway-watchdog/index.ts` | DONE — branch `claude/a6v3-runaway-watchdog`, pg_cron jobid 16 active |

## Audit Checklist — for review

Run these to confirm everything is in the state described above:

```sql
-- 1. run-schedules deployed version uses expandSteps (should print v22+):
--    [Supabase Dashboard → Edge Functions → run-schedules → Source]
--    Confirm `import { expandSteps } from './lib/expandSteps.ts'` is present
--    and the inlined step-walk loop is gone.

-- 2. Watchdog cron active:
SELECT jobid, jobname, schedule, command FROM cron.job
WHERE jobname = 'a6v3-runaway-watchdog';
-- Expect: 1 row, schedule '* * * * *', POST to /functions/v1/a6v3-runaway-watchdog

-- 3. No A6v3 zone history rows currently open:
SELECT id, zone_num, started_at, ended_at, source
FROM zone_history WHERE device='a6v3' AND ended_at IS NULL;
-- Expect: 0 rows under steady state. Any open row must be < 90 min old.

-- 4. Off rows are being queued for A6v3 again (should appear after the next
--    scheduled run, e.g. "Morning Avacados" at 04:00 AEST):
SELECT step_type, count(*), max(created_at)
FROM program_queue WHERE device='a6v3' AND created_at > '2026-05-06 21:00:00+00'
GROUP BY step_type;
-- Expect: 'off' count > 0 after the next program runs.

-- 5. Recent fault alerts from the incident:
SELECT created_at, severity, title, description
FROM device_alerts
WHERE device='a6v3' AND created_at > '2026-05-06 21:00:00+00'
ORDER BY created_at DESC;
-- Expect: 3 'A6v3 runaway relay' fault alerts from the watchdog smoke-test.
```

## Outstanding Work (recommended, not yet done)

Ranked by impact:

1. **CI deploy gate** — GitHub Action that runs `supabase functions deploy run-schedules` (and friends) on merge to `main`. Eliminates the "hand-deployed divergent copy" failure mode that caused this. Existing Vitest already covers the off-emission logic.
2. **Schema-level guarantee** — DB trigger on `program_queue` insert: if `device='a6v3' AND step_type='on' AND duration_min > 0`, require a matching `off` row at `fire_at + duration_min` for the same `(group_id, zone_num)` in the same transaction. Defence at the data layer.
3. **Push notification on fault alerts** — wire `device_alerts WHERE severity='fault'` to email/SMS so a runaway is noticed in minutes, not hours. Watchdog catches at 90 min, but the alert is still in-app only.
4. **A6v3 firmware max-on timer** — long-term: fork KCSv3 to add a 2-hour per-relay hard cap regardless of MQTT state. Matches what SSA-V8 firmware already does. Strongest possible guarantee.
5. **Audit existing programs** — any A6v3 program with `duration_min > 90` will trigger the watchdog incorrectly. Flag and review:
   ```sql
   SELECT zg.name, zgm.zone_num, zgm.duration_min
   FROM zone_group_members zgm JOIN zone_groups zg ON zg.id = zgm.group_id
   WHERE zgm.device = 'a6v3' AND zgm.duration_min > 90;
   ```
   If any exist, either trim them or raise `A6V3_MAX_RUNTIME_MIN` (Supabase → Edge Functions → a6v3-runaway-watchdog → Secrets).

## Damage Assessment

- **Water loss**: 14h × 3 relays. Quantify via flow rate × duration; check water meter readings around 2026-05-06 16:00–06:00 AEST window via the LMW integration if applicable.
- **Plant impact**: 14h continuous saturation at 3 zones. Inspect for waterlogging, root rot, runoff erosion. Affected area = whatever is on A6v3 zones 1, 4, 6.
- **No firmware/hardware damage** observed — relays and pump are within design duty cycle.

## Files Touched

- `supabase/functions/run-schedules/lib/expandSteps.ts` — `duration_min` non-null fix
- `tests/expandSteps.test.ts` — assertion update
- `supabase/functions/a6v3-runaway-watchdog/index.ts` — new
- pg_cron job `a6v3-runaway-watchdog` (jobid 16) — new
- Edge Function `run-schedules` v22 — redeployed from canonical source
- Edge Function `a6v3-runaway-watchdog` v2 — newly deployed

## Commits / PRs

- PR #19 (merged): `fix(run-schedules): set non-null duration_min on A6v3 auto-off rows` — `955254f`
- Branch `claude/a6v3-runaway-watchdog`: `feat(a6v3-watchdog): force-off relays running past max runtime cap` — `baae8c0` (not yet merged)

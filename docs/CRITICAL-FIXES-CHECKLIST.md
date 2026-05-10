# Critical Fixes Checklist — Before Customer Install

This is the list of actions **only you can take** (rotating creds, redeploying functions, changing Supabase auth settings). Code changes I've already made in this branch are linked at the end.

Order matters — do them top-to-bottom.

---

## 0. Lock down `main` branch (do first, takes 2 minutes)

GitHub → repo Settings → Branches → Add rule for `main`:
- Require a pull request before merging
- Require approvals: at least 1
- Dismiss stale approvals when new commits are pushed
- Do not allow bypassing the above settings

I've already removed the auto-merge step from `.github/workflows/auto-merge.yml`, but a branch protection rule is the belt-and-braces version.

---

## 1. Rotate the HiveMQ password (URGENT — today)

The password `Zayan@09022022` was in `supabase/functions/run-program-queue/index.ts` line 16 and `supabase/functions/log-a6v3-pressure/index.ts` line 28 as a fallback default. **Anyone who has ever cloned this repo has that password.** I removed the fallback in this branch but the historical commits still contain it.

Steps:

1. **HiveMQ Cloud console** → your cluster → Access Management → user `farmcontrol-web` → set new password.
2. **Update Supabase Edge Function secrets** (replace `<NEW>`):
   ```bash
   npx supabase secrets set \
     MQTT_USER=farmcontrol-web \
     MQTT_PASS='<NEW>' \
     --project-ref lecssjvuskqemjzvjimo
   ```
3. **Redeploy edge functions** so they pick up the new secret:
   ```bash
   npx supabase functions deploy run-schedules     --project-ref lecssjvuskqemjzvjimo
   npx supabase functions deploy run-program-queue --project-ref lecssjvuskqemjzvjimo
   npx supabase functions deploy log-a6v3-pressure --project-ref lecssjvuskqemjzvjimo
   ```
4. **Update Cloudflare Pages env vars**: project → Settings → Environment variables → edit `VITE_MQTT_PASS` for both Production and Preview. Redeploy.
5. **Update your local `.env.local`** so dev still works.
6. **Update the firmware-side credentials** on the SSA-V8 unit that's deployed (NVS via serial config or hotspot setup).
7. **Decide on git history**: the old password is in commits. Either rewrite history with `git filter-repo` (forces all clones to re-pull and breaks any open PRs), or accept that the historical password is leaked forever. Since it's now rotated, leaving history alone is acceptable — just confirm your repo is private and audit collaborator access.

---

## 2. Disable open signup, or gate it (URGENT — before customer #2)

Right now any random person on the internet can create an account at `sandysoil.pages.dev` and — because RLS is `USING (true)` — see every farm and every device. Pick one:

**Option A — admin-invite-only (recommended)**

- Supabase Dashboard → Authentication → Providers → Email → toggle off "Enable Sign Ups"
- Customers can still sign in
- You create accounts via Admin Console → Customers (or the Supabase dashboard's Add User button)

**Option B — keep open signup but require email confirmation + admin-link**

- Supabase Dashboard → Authentication → Settings → "Confirm email" enabled
- Code already creates a `farms` row at signup; you still have to link a device. So unconfirmed/unlinked users see nothing useful. Combined with the Migration 009 RLS below, this is acceptable.

---

## 3. Apply Migration 009 (proper tenant isolation)

I've drafted `supabase/migrations/009_tenant_isolation.sql`. **Read it, then dry-run it on a Supabase preview branch before applying to prod.** It changes RLS from "any authenticated user can do anything" to "users can only see their own farm's data; admins see everything".

Key things to verify after applying:

- Sign in as `mandeep@freshoz.com` → can still see all farms in Admin Console
- Sign in as a customer → only sees their own zones, schedules, history, alerts
- The Edge Functions still work (they use the service-role key, which bypasses RLS)
- The `pressure_log` table — I've left it auth-required but customers can read it. Once you have per-device pressure (`device_id` column on `pressure_log`), tighten this further.

To apply:

```bash
# Test on a branch first
npx supabase db push --linked --include-roles

# Or paste the SQL into Supabase Dashboard → SQL Editor (preview branch)
```

Migration 008 (`open RLS to anon`) needs to be reverted — Migration 009 includes the `DROP POLICY` statements for those.

---

## 4. Per-customer MQTT credentials (URGENT — before customer #2)

Right now every customer's dashboard connects to HiveMQ as `farmcontrol-web` — a single shared user. Even with per-chip topics, a customer can extract those credentials from the JS bundle and subscribe to `farm/+/+` to spy on or control any other customer's device.

**What I've already wired in this branch:**

- New Edge Function `supabase/functions/issue-mqtt-creds/index.ts` issues credentials to authenticated users at runtime.
- `src/lib/mqttClient.js` now calls that function instead of using bundled `VITE_MQTT_*`.
- The function ships in `MQTT_CREDS_MODE=shared` mode by default — it returns the same shared creds, but read from Edge Function env, not the client bundle. **This alone is a meaningful improvement** — visitors can no longer extract creds from sandysoil.pages.dev's JS.

**What you still need to do to actually achieve per-customer isolation:**

1. **Deploy the Edge Function:**
   ```bash
   npx supabase functions deploy issue-mqtt-creds --project-ref lecssjvuskqemjzvjimo
   ```
2. **Set the function's secrets** (it needs to know which shared creds to issue while in transitional mode):
   ```bash
   npx supabase secrets set MQTT_USER=farmcontrol-web MQTT_PASS='<NEW>' --project-ref lecssjvuskqemjzvjimo
   # (these may already be set from step 1 — they're shared with the schedule executor)
   ```
3. **Drop `VITE_MQTT_USER` / `VITE_MQTT_PASS` from Cloudflare Pages production env vars.** Now the production bundle has no creds at all. (Keep them in your local `.env.local` for `vite dev`.)
4. **Verify the dashboard still works** end to end — open it, check the network tab for the `/issue-mqtt-creds` POST, confirm MQTT connects with the issued creds.

5. **(When ready for true isolation) wire the HiveMQ branch:**
   - In HiveMQ Cloud Console, create one user per customer. Set ACLs that restrict each user to publish/subscribe on their own `farm/<chip-id>/#` prefix only.
   - Set Edge Function secrets: `HIVEMQ_API_TOKEN`, `HIVEMQ_CLUSTER_ID`.
   - Toggle `MQTT_CREDS_MODE=hivemq` and complete the TODO branch in `issue-mqtt-creds/index.ts` to look up the right per-customer user (or mint a session credential).

The "shared" mode is acceptable for the first 1-2 customers as long as the per-chip topic refactor (already done — see Wave 1) is in production. The "hivemq" mode is what you want before customer #5.

---

## 5. Per-chip MQTT topics — DONE in this branch

The dashboard and edge functions no longer hard-code `farm/irrigation1`. Wave 1 of this audit replaced every literal with a runtime-resolved prefix from `farm_devices.mqtt_base_topic`. Migration `010_per_chip_mqtt_topic.sql` adds the column and backfills the legacy unit with `farm/irrigation1` so existing behavior is preserved.

**What you need to do:**

1. **Apply migration 010** (after 009):
   ```bash
   npx supabase db push --linked
   ```
2. **Deploy the updated edge functions** (they now read `mqtt_base_topic` from queue rows):
   ```bash
   npx supabase functions deploy run-schedules     --project-ref lecssjvuskqemjzvjimo
   npx supabase functions deploy run-program-queue --project-ref lecssjvuskqemjzvjimo
   ```
3. **Verify the existing customer's unit still works** — its `farm_devices` row should have `mqtt_base_topic = 'farm/irrigation1'` after the backfill. Sign in as them and confirm the Dashboard, Zones, and Schedule pages all load.
4. **For the next customer's SSA-V8**: set `farm_devices.mqtt_base_topic = 'farm/<chip-id>'` when you claim it in the Admin Console. Their device's NVS-stored `cfg.mqtt_base_topic` must match, which is the ESP32 hotspot setup default.

Once you're past customer #1, you can move the legacy unit to its real chip-id prefix (OTA reconfig + update the row) for cleanliness — but it isn't urgent.

---

## 6. Schedule-execution reliability (you've decided to fix in firmware)

Per our chat, schedules will move to local execution on the SSA-V8 firmware. Cloud becomes a sync layer. Notes for the firmware work:

- Persist schedules to NVS so the unit survives reboots
- Skew start times by ±N seconds based on chip-id hash to avoid every customer's zones starting at HH:00:00 (load on shared aquifers / pumps)
- Local clock drift: NTP on Wi-Fi connect; if no internet for >24 h, fall back to RTC
- Sync schedule edits back from Supabase via MQTT command on the existing `farm/<chip>/cmd` topic, with a sequence number so out-of-order MQTT delivery doesn't downgrade a newer schedule
- Keep cloud-side `run-program-queue` as a "missed run" backstop that fires only if the device hasn't reported the run within X minutes of when it should have

I'll add a section in the audit doc with the design.

---

## 7. Smaller items I noticed

- `partition_table.bin` is committed at repo root — looks like a stray firmware artifact. Move to firmware repo or delete.
- `grafana/sandy-soil-dashboard.json` may contain panel queries that reveal table names / structure. Confirm it's safe to be in a public-facing repo (or move to private).
- Two migrations with the same number prefix: `006_multi_device_history.sql` and `006_pressure_and_automations.sql`. Run order is alphabetical so both will apply, but rename one (e.g. `006a_*` and `006b_*`) for clarity.
- The "5 customers" warning banner in Admin Console is good — but the trigger threshold should drop to **2** customers because the per-customer creds work needs to be done before customer #2.

---

## What I've already changed (in this branch)

**Critical safety / security**
- `.github/workflows/auto-merge.yml` — removed auto-merge, kept tests on push and PR
- `supabase/functions/run-program-queue/index.ts` — removed fallback creds, fail fast if missing
- `supabase/functions/log-a6v3-pressure/index.ts` — same
- `src/hooks/useAuth.js` — guarded `VITE_DEV_SKIP_AUTH` against accidental production use
- `src/pages/AdminConsole.jsx` — fixed `owner_id_dummy` typo, added `owner_id` to farms select, dropped multi-tenancy banner threshold from 5 to 2

**Multi-tenancy + reliability (Wave 1)**
- `supabase/migrations/009_tenant_isolation.sql` — proper RLS with `is_admin()` Postgres function
- `supabase/migrations/010_per_chip_mqtt_topic.sql` — `farm_devices.mqtt_base_topic` + `program_queue.mqtt_base_topic`
- `src/lib/topics.js` — new central topic resolver (`topicsForDevice`, `topicsForPrefix`, `prefixForDevice`)
- `src/hooks/useMyDevice.js` — returns `mqttPrefix` resolved from the user's device
- `src/lib/commands.js` — every zone command takes `{ prefix, device }` opts; defaults preserve legacy behavior
- `src/context/DeviceContext.jsx` — subscribes to `farm/+/...` wildcards
- `src/pages/Dashboard.jsx` / `Zones.jsx` / `ZoneDetail.jsx` / `Calendar.jsx` / `Alerts.jsx` / `PressureAnalysis.jsx` / `components/Sidebar.jsx` — all use the runtime-resolved prefix instead of `farm/irrigation1`
- `supabase/functions/run-schedules/index.ts` + `lib/expandSteps.ts` — capture `mqtt_base_topic` at queue time
- `supabase/functions/run-program-queue/index.ts` — publishes to the queued device's prefix, not the hard-coded one
- `supabase/functions/issue-mqtt-creds/index.ts` — new Edge Function that issues per-session MQTT credentials (transitional "shared" mode + scaffold for HiveMQ per-customer mode)
- `src/lib/mqttClient.js` — fetches creds from the Edge Function instead of reading `VITE_MQTT_*` from the bundle

**UI redesign (Wave 4)**
- `src/pages/Dashboard.jsx` — full v2 implementation: status banner, live elapsed counters, mobile-first layout, problem state with support email, palette-token system instead of literal hexes
- `src/components/ErrorBoundary.jsx` — top-level error boundary with support email
- `src/App.jsx` — wraps the app + routes in two error boundaries (one per layer)
- `src/components/BottomNav.jsx` — customers see 4 destinations only (no More menu); "Valves" → "Zones"
- `src/components/Sidebar.jsx` — desktop nav also says "Zones" / "Home"

**Headers + cleanup**
- `public/_headers` — CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy
- `supabase/migrations/006_pressure_and_automations.sql` → `006a_pressure_and_automations.sql` (rename to deconflict ordering)
- `supabase/migrations/006_multi_device_history.sql` → `006b_multi_device_history.sql`
- `docs/design/stitch_*.html` — deprecated, replaced with pointers to `v2_index.html`
- `docs/CRITICAL-FIXES-CHECKLIST.md` — this file
- `docs/sandy_soil_audit_2026_05.docx` — the audit report
- `docs/design/v2_*.html` — redesigned mockups (mobile home, desktop home, admin contractor view, index)

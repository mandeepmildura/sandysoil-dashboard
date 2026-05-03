-- ============================================================
-- 009 — Proper tenant isolation
--
-- Replaces the "USING (true)" RLS policies from migration 001
-- and reverts the anon-write policies from migration 008.
--
-- Model:
--   - Each customer owns one or more farms (farms.owner_id)
--   - Devices belong to a farm (farm_devices.farm_id → farms.id)
--   - Programs/schedules belong to a customer (zone_groups.customer_id, etc.)
--   - Zone history belongs to a device (zone_history.device →
--     farm_devices.device_id, joined to a farm and from there to an owner)
--   - Admin (mandeep@freshoz.com) sees everything
--
-- ⚠ DO NOT APPLY BLIND. This will lock out anyone whose data isn't
-- correctly linked. Verify on a Supabase preview branch first:
--
--   1. Apply this migration on the preview branch
--   2. Sign in as your existing customer account → confirm Dashboard,
--      Zones, Schedule, Alerts all still load with their data
--   3. Sign in as a fresh test account with no farm → confirm "no
--      controller assigned" empty state shows
--   4. Sign in as mandeep@freshoz.com → confirm Admin Console still
--      shows all farms / all devices / all activity
--   5. Run a scheduled program → confirm zone_history is written and
--      the customer can see it
--
-- Only after all five pass on the preview branch should you apply to
-- production.
-- ============================================================


-- ── 0. Helper: is_admin() ───────────────────────────────────
-- Single source of truth for admin checks. Replace the email list with
-- a profiles.is_admin column when it's time to add more admins.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'email') = ANY (ARRAY['mandeep@freshoz.com']),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- ── 1. Revert migration 008's anon-write policies ───────────
DROP POLICY IF EXISTS "zone_history_anon_all"        ON public.zone_history;
DROP POLICY IF EXISTS "pressure_log_anon_all"        ON public.pressure_log;
DROP POLICY IF EXISTS "zone_groups_anon_all"         ON public.zone_groups;
DROP POLICY IF EXISTS "zone_group_members_anon_all"  ON public.zone_group_members;
DROP POLICY IF EXISTS "group_schedules_anon_all"     ON public.group_schedules;
DROP POLICY IF EXISTS "program_queue_anon_all"       ON public.program_queue;


-- ── 2. farms — owner sees own, admin sees all ───────────────
DROP POLICY IF EXISTS "farms_select"  ON public.farms;
DROP POLICY IF EXISTS "farms_insert"  ON public.farms;
DROP POLICY IF EXISTS "farms_update"  ON public.farms;
DROP POLICY IF EXISTS "farms_delete"  ON public.farms;

-- Customer can SELECT their own farm; admin sees all.
-- Note: signup currently creates a farms row owned by the new user.
-- Once admin-invite-only is enabled (see step 2 of CRITICAL-FIXES-CHECKLIST),
-- this insert path moves to the admin instead.
CREATE POLICY "farms_select_own_or_admin" ON public.farms
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin());

CREATE POLICY "farms_insert_self_or_admin" ON public.farms
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());

CREATE POLICY "farms_update_admin_only" ON public.farms
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "farms_delete_admin_only" ON public.farms
  FOR DELETE TO authenticated
  USING (public.is_admin());


-- ── 3. farm_devices — owner sees devices on their farm, admin sees all ───
DROP POLICY IF EXISTS "farm_devices_select" ON public.farm_devices;
DROP POLICY IF EXISTS "farm_devices_all"    ON public.farm_devices;

CREATE POLICY "farm_devices_select_own_or_admin" ON public.farm_devices
  FOR SELECT TO authenticated
  USING (
    public.is_admin() OR
    farm_id IN (SELECT id FROM public.farms WHERE owner_id = auth.uid())
  );

-- Only admin can claim/edit devices (this is what AdminConsole expects).
CREATE POLICY "farm_devices_modify_admin_only" ON public.farm_devices
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 4. zone_groups (programs) — by customer_id ─────────────
DROP POLICY IF EXISTS "zone_groups_select" ON public.zone_groups;
DROP POLICY IF EXISTS "zone_groups_all"    ON public.zone_groups;

-- zone_groups is expected to have a customer_id column from migration 002.
-- If your DB doesn't have it yet, add: ALTER TABLE zone_groups ADD COLUMN customer_id uuid REFERENCES auth.users(id);
CREATE POLICY "zone_groups_select_own_or_admin" ON public.zone_groups
  FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.is_admin());

CREATE POLICY "zone_groups_modify_own_or_admin" ON public.zone_groups
  FOR ALL TO authenticated
  USING (customer_id = auth.uid() OR public.is_admin())
  WITH CHECK (customer_id = auth.uid() OR public.is_admin());


-- ── 5. zone_group_members — via parent group ───────────────
DROP POLICY IF EXISTS "zone_group_members_select" ON public.zone_group_members;
DROP POLICY IF EXISTS "zone_group_members_all"    ON public.zone_group_members;

CREATE POLICY "zone_group_members_select_own_or_admin" ON public.zone_group_members
  FOR SELECT TO authenticated
  USING (
    public.is_admin() OR
    group_id IN (SELECT id FROM public.zone_groups WHERE customer_id = auth.uid())
  );

CREATE POLICY "zone_group_members_modify_own_or_admin" ON public.zone_group_members
  FOR ALL TO authenticated
  USING (
    public.is_admin() OR
    group_id IN (SELECT id FROM public.zone_groups WHERE customer_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin() OR
    group_id IN (SELECT id FROM public.zone_groups WHERE customer_id = auth.uid())
  );


-- ── 6. group_schedules — by customer_id ────────────────────
DROP POLICY IF EXISTS "group_schedules_select" ON public.group_schedules;
DROP POLICY IF EXISTS "group_schedules_all"    ON public.group_schedules;

CREATE POLICY "group_schedules_select_own_or_admin" ON public.group_schedules
  FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.is_admin());

CREATE POLICY "group_schedules_modify_own_or_admin" ON public.group_schedules
  FOR ALL TO authenticated
  USING (customer_id = auth.uid() OR public.is_admin())
  WITH CHECK (customer_id = auth.uid() OR public.is_admin());


-- ── 7. zone_history — via device → farm → owner chain ──────
-- This one's a bit harder because zone_history.device is text (e.g.
-- 'irrigation1', 'a6v3'), not a foreign key. We resolve via farm_devices.device_id.
--
-- During the legacy/per-chip transition, the existing first-customer unit
-- still publishes as 'irrigation1'. As long as farm_devices has a row with
-- device_id='irrigation1' linked to the right farm, the join works.
--
-- Once the per-chip migration completes (see CRITICAL-FIXES-CHECKLIST step 5),
-- the same RLS continues to work because farm_devices.device_id will be the
-- real chip id and zone_history.device will match.

DROP POLICY IF EXISTS "zone_history_select" ON public.zone_history;
DROP POLICY IF EXISTS "zone_history_all"    ON public.zone_history;

CREATE POLICY "zone_history_select_own_or_admin" ON public.zone_history
  FOR SELECT TO authenticated
  USING (
    public.is_admin() OR
    device IN (
      SELECT fd.device_id
      FROM public.farm_devices fd
      JOIN public.farms f ON f.id = fd.farm_id
      WHERE f.owner_id = auth.uid()
    )
  );

-- Authenticated users can insert zone_history (the dashboard does this when
-- they manually start a zone). Service role bypasses RLS, so the edge
-- functions writing schedule-driven history are unaffected.
CREATE POLICY "zone_history_insert_own_or_admin" ON public.zone_history
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin() OR
    device IN (
      SELECT fd.device_id
      FROM public.farm_devices fd
      JOIN public.farms f ON f.id = fd.farm_id
      WHERE f.owner_id = auth.uid()
    )
  );

CREATE POLICY "zone_history_update_own_or_admin" ON public.zone_history
  FOR UPDATE TO authenticated
  USING (
    public.is_admin() OR
    device IN (
      SELECT fd.device_id
      FROM public.farm_devices fd
      JOIN public.farms f ON f.id = fd.farm_id
      WHERE f.owner_id = auth.uid()
    )
  );


-- ── 8. pressure_log — same chain (best-effort, may need device_id col) ──
-- Currently pressure_log doesn't have a device_id column — every reading is
-- treated as global. For now: customers can read all pressure (it's not
-- sensitive on its own); only admin and service role can write.
--
-- TODO: add `device_id` to pressure_log and tighten this once the schema
-- supports per-device pressure logging.

DROP POLICY IF EXISTS "pressure_log_select" ON public.pressure_log;
DROP POLICY IF EXISTS "pressure_log_all"    ON public.pressure_log;

CREATE POLICY "pressure_log_select_authenticated" ON public.pressure_log
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "pressure_log_modify_admin_only" ON public.pressure_log
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 9. device_alerts — same chain ──────────────────────────
DROP POLICY IF EXISTS "device_alerts_select" ON public.device_alerts;
DROP POLICY IF EXISTS "device_alerts_all"    ON public.device_alerts;

CREATE POLICY "device_alerts_select_own_or_admin" ON public.device_alerts
  FOR SELECT TO authenticated
  USING (
    public.is_admin() OR
    device_id IN (
      SELECT fd.device_id
      FROM public.farm_devices fd
      JOIN public.farms f ON f.id = fd.farm_id
      WHERE f.owner_id = auth.uid()
    )
  );

-- Customers can acknowledge their own alerts. Admin can do anything.
CREATE POLICY "device_alerts_update_own_or_admin" ON public.device_alerts
  FOR UPDATE TO authenticated
  USING (
    public.is_admin() OR
    device_id IN (
      SELECT fd.device_id
      FROM public.farm_devices fd
      JOIN public.farms f ON f.id = fd.farm_id
      WHERE f.owner_id = auth.uid()
    )
  );

-- Inserts come from edge functions (service role), not customers.
CREATE POLICY "device_alerts_insert_admin_only" ON public.device_alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "device_alerts_delete_admin_only" ON public.device_alerts
  FOR DELETE TO authenticated
  USING (public.is_admin());


-- ── 10. program_queue — service role only ──────────────────
-- The queue is an internal mechanism for the schedule executor. No customer
-- should be writing here directly. Authenticated reads are useful for
-- "Run Now" status display.
DROP POLICY IF EXISTS "program_queue_anon_all" ON public.program_queue;

CREATE POLICY "program_queue_select_own_or_admin" ON public.program_queue
  FOR SELECT TO authenticated
  USING (
    public.is_admin() OR
    group_id IN (SELECT id FROM public.zone_groups WHERE customer_id = auth.uid())
  );

CREATE POLICY "program_queue_insert_own_or_admin" ON public.program_queue
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin() OR
    group_id IN (SELECT id FROM public.zone_groups WHERE customer_id = auth.uid())
  );

CREATE POLICY "program_queue_modify_admin_only" ON public.program_queue
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "program_queue_delete_admin_only" ON public.program_queue
  FOR DELETE TO authenticated
  USING (public.is_admin());


-- ── 11. zone_schedules — same scoping as group_schedules ───
-- Note: zone_schedules from migration 001 doesn't have a customer_id column.
-- If your usage of zone_schedules is per-zone-on-the-shared-controller, this
-- table effectively becomes admin-only until you add a customer scope.

DROP POLICY IF EXISTS "zone_schedules_select" ON public.zone_schedules;
DROP POLICY IF EXISTS "zone_schedules_all"    ON public.zone_schedules;

CREATE POLICY "zone_schedules_admin_only" ON public.zone_schedules
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

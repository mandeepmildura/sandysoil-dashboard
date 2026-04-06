-- ============================================================
-- 008 — Allow anon role to read/write operational tables
--
-- Context: This is a single-operator farm dashboard. All data
-- (zone runs, pressure logs, schedules) is non-sensitive.
-- Blocking anon writes causes silent failures when the Supabase
-- auth session is missing or expired.
-- ============================================================

-- zone_history
CREATE POLICY "zone_history_anon_all" ON public.zone_history
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- pressure_log
CREATE POLICY "pressure_log_anon_all" ON public.pressure_log
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- zone_groups
CREATE POLICY "zone_groups_anon_all" ON public.zone_groups
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- zone_group_members
CREATE POLICY "zone_group_members_anon_all" ON public.zone_group_members
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- group_schedules
CREATE POLICY "group_schedules_anon_all" ON public.group_schedules
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- program_queue
CREATE POLICY "program_queue_anon_all" ON public.program_queue
  FOR ALL TO anon USING (true) WITH CHECK (true);

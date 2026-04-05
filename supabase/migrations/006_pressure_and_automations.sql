-- ============================================================
-- 006 — Fix pressure_log schema + zone_history PSI snapshot
--       + Tuya-style automation step types + program_queue
-- Safe: uses ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS
-- ============================================================

-- ── 1. pressure_log: add columns referenced by code but absent from schema ──
--       All inserts to these columns have been silently failing since launch.

ALTER TABLE public.pressure_log
  ADD COLUMN IF NOT EXISTS supply_psi    numeric,
  ADD COLUMN IF NOT EXISTS a6v3_ch1_psi numeric,
  ADD COLUMN IF NOT EXISTS simulated     boolean DEFAULT false;

-- Backfill: existing rows get simulated=false explicitly
UPDATE public.pressure_log SET simulated = false WHERE simulated IS NULL;

-- ── 2. zone_history: snapshot PSI values at zone trigger time ───────────────

ALTER TABLE public.zone_history
  ADD COLUMN IF NOT EXISTS supply_psi_start numeric,
  ADD COLUMN IF NOT EXISTS a6v3_psi_start   numeric;

-- ── 3. zone_group_members: Tuya-style explicit step type ────────────────────
--       step_type: 'on' (default, backwards-compatible) | 'off' | 'delay'
--       delay_min: populated when step_type='delay', NULL otherwise

ALTER TABLE public.zone_group_members
  ADD COLUMN IF NOT EXISTS step_type text    DEFAULT 'on',
  ADD COLUMN IF NOT EXISTS delay_min integer;

-- ── 4. program_queue: steps waiting to fire at a future time ────────────────
--       Populated by run-schedules edge function.
--       Consumed (fired + marked) by run-program-queue edge function.

CREATE TABLE IF NOT EXISTS public.program_queue (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id     uuid        REFERENCES public.zone_groups(id) ON DELETE CASCADE,
  step_type    text        NOT NULL,      -- 'on' | 'off'
  device       text        NOT NULL,      -- 'irrigation1' | 'a6v3'
  zone_num     integer     NOT NULL,
  duration_min integer,
  fire_at      timestamptz NOT NULL,
  fired_at     timestamptz,
  created_at   timestamptz DEFAULT now()
);

-- Partial index for efficient pending-step queries
CREATE INDEX IF NOT EXISTS program_queue_pending_idx
  ON public.program_queue (fire_at)
  WHERE fired_at IS NULL;

ALTER TABLE public.program_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_authed" ON public.program_queue
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

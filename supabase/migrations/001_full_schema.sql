-- ============================================================
-- Sandy Soil Automations — Full Supabase Schema & RLS
-- Run this in: Supabase Dashboard → SQL Editor → Run
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS)
-- ============================================================

-- ── 1. FARMS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farms (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text        NOT NULL,
  location    text,
  status      text        DEFAULT 'offline',
  owner_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "farms_select"  ON public.farms;
DROP POLICY IF EXISTS "farms_insert"  ON public.farms;
DROP POLICY IF EXISTS "farms_update"  ON public.farms;
DROP POLICY IF EXISTS "farms_delete"  ON public.farms;

-- All authenticated users can see all farms (admin console needs this)
CREATE POLICY "farms_select" ON public.farms
  FOR SELECT TO authenticated USING (true);

-- Any authenticated user can add a farm
CREATE POLICY "farms_insert" ON public.farms
  FOR INSERT TO authenticated WITH CHECK (true);

-- Only owner or any authenticated user can update (single-tenant install)
CREATE POLICY "farms_update" ON public.farms
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "farms_delete" ON public.farms
  FOR DELETE TO authenticated USING (true);


-- ── 2. FARM DEVICES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_devices (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  farm_id     uuid        REFERENCES public.farms(id) ON DELETE CASCADE,
  device_id   text        NOT NULL,
  model       text,
  type        text,
  firmware    text,
  status      text        DEFAULT 'offline',
  last_seen   timestamptz,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.farm_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "farm_devices_select" ON public.farm_devices;
DROP POLICY IF EXISTS "farm_devices_all"    ON public.farm_devices;

CREATE POLICY "farm_devices_select" ON public.farm_devices
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "farm_devices_all" ON public.farm_devices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 3. ZONE GROUPS (Programs) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zone_groups (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text        NOT NULL,
  run_mode    text        DEFAULT 'sequential',
  device_id   uuid        REFERENCES public.farm_devices(id) ON DELETE SET NULL,
  owner_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

-- Fix: make device_id nullable (removes NOT NULL constraint if it exists)
ALTER TABLE public.zone_groups ALTER COLUMN device_id DROP NOT NULL;

ALTER TABLE public.zone_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zone_groups_select" ON public.zone_groups;
DROP POLICY IF EXISTS "zone_groups_all"    ON public.zone_groups;

CREATE POLICY "zone_groups_select" ON public.zone_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "zone_groups_all" ON public.zone_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 4. ZONE GROUP MEMBERS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zone_group_members (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id    uuid        NOT NULL REFERENCES public.zone_groups(id) ON DELETE CASCADE,
  zone_num    int         NOT NULL CHECK (zone_num BETWEEN 1 AND 8),
  duration_min int        NOT NULL DEFAULT 30,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.zone_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zone_group_members_select" ON public.zone_group_members;
DROP POLICY IF EXISTS "zone_group_members_all"    ON public.zone_group_members;

CREATE POLICY "zone_group_members_select" ON public.zone_group_members
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "zone_group_members_all" ON public.zone_group_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 5. GROUP SCHEDULES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_schedules (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id      uuid        NOT NULL REFERENCES public.zone_groups(id) ON DELETE CASCADE,
  label         text,
  days_of_week  int[]       DEFAULT '{}',  -- 0=Sun, 1=Mon … 6=Sat
  start_time    time        NOT NULL,
  enabled       boolean     DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.group_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group_schedules_select" ON public.group_schedules;
DROP POLICY IF EXISTS "group_schedules_all"    ON public.group_schedules;

CREATE POLICY "group_schedules_select" ON public.group_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "group_schedules_all" ON public.group_schedules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 6. ZONE SCHEDULES (per-zone, simpler than group) ─────────
CREATE TABLE IF NOT EXISTS public.zone_schedules (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_num      int         NOT NULL CHECK (zone_num BETWEEN 1 AND 8),
  label         text,
  days_of_week  int[]       DEFAULT '{}',
  start_time    time        NOT NULL,
  duration_min  int         NOT NULL DEFAULT 30,
  enabled       boolean     DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.zone_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zone_schedules_select" ON public.zone_schedules;
DROP POLICY IF EXISTS "zone_schedules_all"    ON public.zone_schedules;

CREATE POLICY "zone_schedules_select" ON public.zone_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "zone_schedules_all" ON public.zone_schedules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 7. ZONE HISTORY ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zone_history (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_num      int         NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  duration_min  numeric     GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NOT NULL
    THEN ROUND(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60.0, 1)
    ELSE NULL END
  ) STORED,
  source        text        DEFAULT 'manual',  -- 'manual' | 'schedule' | 'program'
  created_at    timestamptz DEFAULT now()
);

-- If zone_history already exists without the generated column, add it safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'zone_history' AND column_name = 'duration_min'
    AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.zone_history ADD COLUMN duration_min numeric
      GENERATED ALWAYS AS (
        CASE WHEN ended_at IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60.0, 1)
        ELSE NULL END
      ) STORED;
  END IF;
END $$;

ALTER TABLE public.zone_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zone_history_select" ON public.zone_history;
DROP POLICY IF EXISTS "zone_history_all"    ON public.zone_history;

CREATE POLICY "zone_history_select" ON public.zone_history
  FOR SELECT TO authenticated USING (true);

-- Allow inserts from authenticated users and service role (for device bridge)
CREATE POLICY "zone_history_all" ON public.zone_history
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS zone_history_zone_num_idx  ON public.zone_history (zone_num);
CREATE INDEX IF NOT EXISTS zone_history_started_at_idx ON public.zone_history (started_at DESC);


-- ── 8. PRESSURE LOG ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pressure_log (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  inlet_psi   numeric,
  outlet_psi  numeric,
  diff_psi    numeric,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.pressure_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pressure_log_select" ON public.pressure_log;
DROP POLICY IF EXISTS "pressure_log_all"    ON public.pressure_log;

CREATE POLICY "pressure_log_select" ON public.pressure_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "pressure_log_all" ON public.pressure_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS pressure_log_ts_idx ON public.pressure_log (ts DESC);


-- ── 9. DEVICE ALERTS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_alerts (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  severity      text        NOT NULL DEFAULT 'warning', -- 'fault' | 'warning' | 'info'
  title         text        NOT NULL,
  description   text,
  device        text,        -- human-readable device name
  device_id     text,        -- machine device identifier
  acknowledged  boolean     DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.device_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_alerts_select" ON public.device_alerts;
DROP POLICY IF EXISTS "device_alerts_all"    ON public.device_alerts;

CREATE POLICY "device_alerts_select" ON public.device_alerts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "device_alerts_all" ON public.device_alerts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 10. REALTIME – enable for live updates ───────────────────
-- Run in Supabase Dashboard → Database → Replication if not already done:
-- ALTER PUBLICATION supabase_realtime ADD TABLE zone_history;
-- ALTER PUBLICATION supabase_realtime ADD TABLE device_alerts;


-- ── 11. SEED: default farm & device (KC868 controller) ───────
-- Inserts a default farm and device so zone_groups can reference it.
-- Skip if a farm/device already exists.
DO $$
DECLARE
  v_farm_id   uuid;
  v_device_id uuid;
BEGIN
  -- Create default farm if none exists
  IF NOT EXISTS (SELECT 1 FROM public.farms LIMIT 1) THEN
    INSERT INTO public.farms (id, name, location, status)
    VALUES (gen_random_uuid(), 'Sandy Soil Farm', 'Mildura, VIC', 'online')
    RETURNING id INTO v_farm_id;
  ELSE
    SELECT id INTO v_farm_id FROM public.farms LIMIT 1;
  END IF;

  -- Create default device if none exists
  IF NOT EXISTS (SELECT 1 FROM public.farm_devices LIMIT 1) THEN
    INSERT INTO public.farm_devices (id, farm_id, device_id, model, type, firmware, status)
    VALUES (gen_random_uuid(), v_farm_id, 'KC868-001', 'KC868-A8v3', 'Irrigation Controller', 'v2.3.1', 'online')
    RETURNING id INTO v_device_id;

    -- Backfill any zone_groups that have NULL device_id
    UPDATE public.zone_groups SET device_id = v_device_id WHERE device_id IS NULL;
  END IF;
END $$;

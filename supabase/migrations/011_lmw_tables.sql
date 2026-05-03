-- ============================================================
-- 011 — Lower Murray Water (LMW) integration tables
--
-- Phase 1: read-only mirror of the user's LMW account so the
-- dashboard can show allocation, orders, and meter usage without
-- the user having to open the LMW website.
--
-- Future phases (not in this migration):
--   - lmw-place-order / lmw-cancel-order edge functions
--   - lmw-rolling-bookings cron
--   - dashboard CTAs for "Book missing windows"
--
-- All tables are scoped per-customer via user_id and follow the
-- same is_admin() pattern as 009_tenant_isolation.sql.
--
-- ⚠ The lmw_credentials.pin column is plaintext for v1. RLS
--   restricts reads to the row owner + admin; service_role
--   (used by the edge function) bypasses RLS. Switch to
--   pgsodium-encrypted-at-rest in a follow-up migration before
--   onboarding additional customers.
-- ============================================================


-- ── 1. lmw_credentials ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lmw_credentials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outlet_no   text NOT NULL,
  pin         text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  last_login  timestamptz,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, outlet_no)
);

ALTER TABLE public.lmw_credentials ENABLE ROW LEVEL SECURITY;

-- User can see their own creds; admin sees all
CREATE POLICY "lmw_credentials_select_own_or_admin" ON public.lmw_credentials
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Only admin can insert/update/delete (PIN is sensitive)
CREATE POLICY "lmw_credentials_modify_admin_only" ON public.lmw_credentials
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 2. lmw_orders ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lmw_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outlet_no    text NOT NULL,
  receipt_no   text NOT NULL,
  start_at     timestamptz NOT NULL,    -- order start in UTC
  end_at       timestamptz NOT NULL,    -- start + hours
  hours        numeric NOT NULL,
  flow_lps     integer NOT NULL,
  shift_no     integer NOT NULL DEFAULT 1,
  est_ml       numeric,
  status       text NOT NULL DEFAULT 'active', -- active | running | completed | cancelled
  source       text NOT NULL DEFAULT 'lmw',    -- lmw | dashboard | auto
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_no, receipt_no)
);

CREATE INDEX IF NOT EXISTS lmw_orders_user_start_idx
  ON public.lmw_orders (user_id, start_at);

CREATE INDEX IF NOT EXISTS lmw_orders_outlet_start_idx
  ON public.lmw_orders (outlet_no, start_at);

ALTER TABLE public.lmw_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lmw_orders_select_own_or_admin" ON public.lmw_orders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Writes come from the lmw-sync edge function (service_role); customers
-- can also create orders via lmw-place-order in a future phase.
CREATE POLICY "lmw_orders_modify_admin_only" ON public.lmw_orders
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 3. lmw_allocation ───────────────────────────────────────
-- One row per (user_id, outlet_no, snapshot_at). Latest row is
-- the "current" balance.
CREATE TABLE IF NOT EXISTS public.lmw_allocation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outlet_no          text NOT NULL,
  aba_id             text,
  carryover_ml       numeric,
  seasonal_alloc_ml  numeric,
  trade_in_ml        numeric,
  trade_out_ml       numeric,
  water_use_ml       numeric,
  aba_balance_ml     numeric,
  available_ml       numeric,
  tradable_ml        numeric,
  period1_limit_ml   numeric,
  period1_used_ml    numeric,
  period1_end        date,
  period2_limit_ml   numeric,
  period2_used_ml    numeric,
  period2_end        date,
  raw_html           text,                    -- snapshot for debugging parser drift
  snapshot_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lmw_allocation_user_outlet_snap_idx
  ON public.lmw_allocation (user_id, outlet_no, snapshot_at DESC);

ALTER TABLE public.lmw_allocation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lmw_allocation_select_own_or_admin" ON public.lmw_allocation
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "lmw_allocation_modify_admin_only" ON public.lmw_allocation
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 4. lmw_meter_readings ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lmw_meter_readings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outlet_no     text NOT NULL,
  reading_date  date NOT NULL,
  meter_reading numeric NOT NULL,
  act_usage_ml  numeric,
  est_usage_ml  numeric,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_no, reading_date)
);

CREATE INDEX IF NOT EXISTS lmw_meter_user_date_idx
  ON public.lmw_meter_readings (user_id, reading_date DESC);

ALTER TABLE public.lmw_meter_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lmw_meter_select_own_or_admin" ON public.lmw_meter_readings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "lmw_meter_modify_admin_only" ON public.lmw_meter_readings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 5. lmw_booking_log ──────────────────────────────────────
-- Audit trail for any write action against LMW (place / cancel)
-- and for sync runs that wrote to lmw_orders. Use this to
-- diagnose parser drift, failed bookings, and to satisfy "what
-- happened?" questions.
CREATE TABLE IF NOT EXISTS public.lmw_booking_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outlet_no    text,
  action       text NOT NULL,            -- sync | place | cancel | login_failed | parse_error
  receipt_no   text,
  start_at     timestamptz,
  hours        numeric,
  flow_lps     integer,
  http_status  integer,
  ok           boolean,
  message      text,
  raw_response text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lmw_booking_log_user_created_idx
  ON public.lmw_booking_log (user_id, created_at DESC);

ALTER TABLE public.lmw_booking_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lmw_booking_log_select_own_or_admin" ON public.lmw_booking_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "lmw_booking_log_insert_admin_only" ON public.lmw_booking_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());


-- ── 6. updated_at trigger for lmw_credentials ───────────────
CREATE OR REPLACE FUNCTION public.lmw_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lmw_credentials_set_updated_at ON public.lmw_credentials;
CREATE TRIGGER lmw_credentials_set_updated_at
  BEFORE UPDATE ON public.lmw_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.lmw_set_updated_at();

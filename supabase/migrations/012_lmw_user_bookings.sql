-- ============================================================
-- 012 — LMW user-initiated bookings
--
-- Phase 2: customers can place water orders from the dashboard.
--
-- The lmw-place-order edge function runs as service_role and
-- bypasses RLS, so the new policies here exist for the rare case
-- a future flow inserts directly from the client. Reads stay
-- scoped per-user; writes are gated to source='dashboard' rows
-- on the user's own outlet.
-- ============================================================

-- Allow the row owner to INSERT a booking-log row about themselves
DROP POLICY IF EXISTS "lmw_booking_log_insert_admin_only" ON public.lmw_booking_log;

CREATE POLICY "lmw_booking_log_insert_own_or_admin" ON public.lmw_booking_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- Allow the row owner to INSERT a dashboard-sourced order on their
-- own outlet. Once placed, only admin / service_role may modify it.
DROP POLICY IF EXISTS "lmw_orders_modify_admin_only" ON public.lmw_orders;

CREATE POLICY "lmw_orders_insert_own_dashboard_or_admin" ON public.lmw_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      user_id = auth.uid()
      AND source = 'dashboard'
      AND EXISTS (
        SELECT 1 FROM public.lmw_credentials c
        WHERE c.user_id = auth.uid()
          AND c.outlet_no = lmw_orders.outlet_no
          AND c.enabled = true
      )
    )
  );

CREATE POLICY "lmw_orders_update_admin_only" ON public.lmw_orders
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "lmw_orders_delete_admin_only" ON public.lmw_orders
  FOR DELETE TO authenticated
  USING (public.is_admin());

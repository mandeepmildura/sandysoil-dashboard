-- 017 — LMW portal notices
-- The lmw-sync edge function parses dismissible notice banners from the
-- LMW portal home page on every sync run. Each run clears the prior set
-- and inserts fresh ones so the table always reflects the current portal
-- state. The Water page reads these and shows them as pink alert banners.

CREATE TABLE IF NOT EXISTS public.lmw_notices (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outlet_no   text        NOT NULL,
  notice_text text        NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lmw_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lmw_notices_read_own" ON public.lmw_notices
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Edge function runs as service_role, so no explicit insert policy needed
-- (service_role bypasses RLS), but add it for defence-in-depth.
CREATE POLICY "lmw_notices_service_all" ON public.lmw_notices
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

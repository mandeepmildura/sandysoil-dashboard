-- 013 — A6v3 runaway-watchdog pg_cron job
-- Registers the watchdog Edge Function to run every minute.
-- Applied directly to production on 2026-05-06 (jobid 16) — this migration
-- commits the source-of-truth record per CLAUDE.md discipline.
--
-- Replace YOUR_SERVICE_ROLE_KEY with the project's service_role key before
-- running on a fresh environment (find it in Supabase → Settings → API).
-- Idempotent: skips install if the job already exists.

DO $outer$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'a6v3-runaway-watchdog'
  ) THEN
    PERFORM cron.schedule(
      'a6v3-runaway-watchdog',
      '* * * * *',
      $$
        SELECT net.http_post(
          url     := 'https://lecssjvuskqemjzvjimo.supabase.co/functions/v1/a6v3-runaway-watchdog',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
          ),
          body    := '{}'::jsonb
        );
      $$
    );
  END IF;
END $outer$;

-- ============================================================
-- 007 — Indexes to reduce Disk IO from pg_cron queries
-- ============================================================

-- Speeds up the run-schedules edge function which queries this every minute
-- filtering on enabled=true and start_time matching current HH:MM
CREATE INDEX IF NOT EXISTS group_schedules_enabled_time_idx
  ON public.group_schedules (start_time)
  WHERE enabled = true;

-- Speeds up run-program-queue which queries this every minute
-- (partial index already created in 006, this ensures it exists)
CREATE INDEX IF NOT EXISTS program_queue_pending_idx
  ON public.program_queue (fire_at)
  WHERE fired_at IS NULL;

-- Speeds up closeOpenHistoryRecord() which queries zone_history by zone_num + ended_at IS NULL
CREATE INDEX IF NOT EXISTS zone_history_open_runs_idx
  ON public.zone_history (zone_num, started_at DESC)
  WHERE ended_at IS NULL;

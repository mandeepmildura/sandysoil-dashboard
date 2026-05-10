-- 014_pump_zone_scheduling.sql

-- 1. Pump zone designation per device
ALTER TABLE farm_devices
  ADD COLUMN IF NOT EXISTS pump_zone_num integer;

-- 2. Program-level duration (simultaneous-zone model)
ALTER TABLE zone_groups
  ADD COLUMN IF NOT EXISTS duration_min integer NOT NULL DEFAULT 30;

-- 3. Safety: program_queue ON steps must have duration_min set
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'program_queue'
      AND constraint_name = 'program_queue_on_requires_duration'
  ) THEN
    ALTER TABLE program_queue
      ADD CONSTRAINT program_queue_on_requires_duration
      CHECK (step_type <> 'on' OR duration_min IS NOT NULL);
  END IF;
END $$;

-- 4. Hourly pressure buckets for long-term storage
CREATE TABLE IF NOT EXISTS pressure_log_hourly (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device       text NOT NULL,
  hour_bucket  timestamptz NOT NULL,
  avg_psi      numeric(6,2),
  min_psi      numeric(6,2),
  max_psi      numeric(6,2),
  sample_count integer,
  created_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pressure_log_hourly_device_hour
  ON pressure_log_hourly(device, hour_bucket);
ALTER TABLE pressure_log_hourly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pressure_log_hourly_read" ON pressure_log_hourly
  FOR SELECT USING (true);
CREATE POLICY "pressure_log_hourly_write" ON pressure_log_hourly
  FOR INSERT WITH CHECK (true);
CREATE POLICY "pressure_log_hourly_update" ON pressure_log_hourly
  FOR UPDATE USING (true) WITH CHECK (true);

-- 5. Admin settings (phone number, alert channel)
CREATE TABLE IF NOT EXISTS admin_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin only" ON admin_settings FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') = 'mandeep@freshoz.com')
  WITH CHECK ((auth.jwt() ->> 'email') = 'mandeep@freshoz.com');

-- Seed default alert settings
INSERT INTO admin_settings (key, value) VALUES
  ('alert_phone', ''),
  ('alert_channel', 'whatsapp'),
  ('alert_hour_threshold_1', '3'),
  ('alert_hour_threshold_2', '6')
ON CONFLICT (key) DO NOTHING;

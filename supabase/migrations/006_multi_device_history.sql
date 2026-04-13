-- 1. zone_history: add device column so relay runs are tracked separately from irrigation
ALTER TABLE public.zone_history
  ADD COLUMN IF NOT EXISTS device text NOT NULL DEFAULT 'irrigation1';

-- 2. zone_group_members: add device column so A6v3 relays can belong to programs
ALTER TABLE public.zone_group_members
  ADD COLUMN IF NOT EXISTS device text NOT NULL DEFAULT 'irrigation1';

-- 3. zone_names: custom display names for zones (irrigation1) and relays (a6v3)
CREATE TABLE IF NOT EXISTS public.zone_names (
  device      text NOT NULL DEFAULT 'irrigation1',
  zone_num    int  NOT NULL,
  custom_name text NOT NULL,
  updated_at  timestamptz DEFAULT now(),
  PRIMARY KEY (device, zone_num)
);
ALTER TABLE public.zone_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zone_names_all" ON public.zone_names
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. pressure_log: A6v3 ADC1 channel pressure readings
ALTER TABLE public.pressure_log
  ADD COLUMN IF NOT EXISTS a6v3_ch1_psi numeric;

-- 5. farms: add contact fields for client management
ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS contact_name  text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS notes         text;

-- Add owner_id and customer_id to zone_groups (safe: no-op if already present)
ALTER TABLE public.zone_groups
  ADD COLUMN IF NOT EXISTS owner_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

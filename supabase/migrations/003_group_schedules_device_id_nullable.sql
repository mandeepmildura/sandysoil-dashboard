-- device_id is not set by the app when creating schedules; make it nullable
ALTER TABLE public.group_schedules ALTER COLUMN device_id DROP NOT NULL;

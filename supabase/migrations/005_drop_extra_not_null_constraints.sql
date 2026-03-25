-- Drop NOT NULL constraints on columns that aren't always available at insert time.
-- group_schedules.customer_id: app now passes it, but make nullable as fallback
ALTER TABLE public.group_schedules ALTER COLUMN customer_id DROP NOT NULL;

-- zone_history: inserted by the edge function (no user context) and by the app;
-- customer_id and device_id are not always known at insert time
ALTER TABLE public.zone_history ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.zone_history ALTER COLUMN device_id   DROP NOT NULL;

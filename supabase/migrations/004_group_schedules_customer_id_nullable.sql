-- customer_id on group_schedules should be nullable (app may not always pass it)
ALTER TABLE public.group_schedules ALTER COLUMN customer_id DROP NOT NULL;

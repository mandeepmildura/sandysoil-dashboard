-- ─────────────────────────────────────────────────────────────────────────────
-- Sandy Soil Automations — initial schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Farms ─────────────────────────────────────────────────────────────────────
create table if not exists farms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  status      text not null default 'offline',   -- online | offline | fault
  created_at  timestamptz not null default now()
);

-- ── Zone history ───────────────────────────────────────────────────────────────
create table if not exists zone_history (
  id           bigint generated always as identity primary key,
  zone_num     int  not null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  duration_min numeric,
  source       text default 'manual'              -- manual | schedule | program
);

-- ── Zone schedules (per-zone) ──────────────────────────────────────────────────
create table if not exists zone_schedules (
  id           bigint generated always as identity primary key,
  zone_num     int  not null unique,
  days_of_week int[] not null default '{}',       -- 0=Sun … 6=Sat
  start_time   time not null,
  duration_min int  not null default 30,
  enabled      boolean not null default true
);

-- ── Programs (zone groups) ─────────────────────────────────────────────────────
create table if not exists zone_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  run_mode    text not null default 'sequential', -- sequential | parallel
  created_at  timestamptz not null default now()
);

create table if not exists zone_group_members (
  group_id     uuid references zone_groups(id) on delete cascade,
  zone_num     int  not null,
  duration_min int  not null default 30,
  sort_order   int  not null default 0,
  primary key (group_id, zone_num)
);

create table if not exists group_schedules (
  id           bigint generated always as identity primary key,
  group_id     uuid references zone_groups(id) on delete cascade,
  label        text,
  days_of_week int[] not null default '{}',
  start_time   time not null,
  enabled      boolean not null default true
);

-- ── Pressure log ───────────────────────────────────────────────────────────────
create table if not exists pressure_log (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  inlet_psi   numeric not null,
  outlet_psi  numeric not null,
  diff_psi    numeric generated always as (inlet_psi - outlet_psi) stored
);

create index if not exists pressure_log_ts_idx on pressure_log (ts desc);

-- ── Device alerts ──────────────────────────────────────────────────────────────
create table if not exists device_alerts (
  id             bigint generated always as identity primary key,
  device_id      text,
  farm_id        uuid references farms(id) on delete set null,
  severity       text not null default 'warning',  -- info | warning | fault
  message        text not null,
  acknowledged   boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ── Device commands (replaces MQTT publish) ────────────────────────────────────
create table if not exists device_commands (
  id           bigint generated always as identity primary key,
  topic        text not null,
  payload      jsonb not null default '{}',
  inserted_at  timestamptz not null default now(),
  processed    boolean not null default false,
  processed_at timestamptz
);

create index if not exists device_commands_unprocessed_idx
  on device_commands (topic, inserted_at)
  where processed = false;

-- ── Device telemetry (replaces MQTT subscribe) ─────────────────────────────────
-- The device upserts one row per topic; dashboard reads via Realtime.
create table if not exists device_telemetry (
  topic       text primary key,
  payload     jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- ── Firmware releases ──────────────────────────────────────────────────────────
create table if not exists firmware_releases (
  id           bigint generated always as identity primary key,
  model        text not null,
  version      text not null,
  url          text not null,    -- public URL to the .bin file
  notes        text,
  released_at  timestamptz not null default now(),
  unique (model, version)
);

-- ── Device firmware status ─────────────────────────────────────────────────────
create table if not exists device_firmware (
  id               bigint generated always as identity primary key,
  device_id        text not null unique,
  farm_id          uuid references farms(id) on delete set null,
  model            text not null,
  current_version  text not null,
  last_seen_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
-- Enable RLS and allow authenticated users full access to all tables.
-- Tighten these policies for production as needed.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'farms','zone_history','zone_schedules',
    'zone_groups','zone_group_members','group_schedules',
    'pressure_log','device_alerts','device_commands',
    'device_telemetry','firmware_releases','device_firmware'
  ]
  loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "auth_users_all" on %I', tbl);
    execute format(
      'create policy "auth_users_all" on %I for all to authenticated using (true) with check (true)',
      tbl
    );
  end loop;
end $$;

-- Allow the device (service role / anon key with RLS bypass) to upsert telemetry
-- and mark commands processed without being a logged-in user.
drop policy if exists "anon_read_commands" on device_commands;
create policy "anon_read_commands" on device_commands
  for select to anon using (true);

drop policy if exists "anon_upsert_telemetry" on device_telemetry;
create policy "anon_upsert_telemetry" on device_telemetry
  for all to anon using (true) with check (true);

drop policy if exists "anon_update_commands" on device_commands;
create policy "anon_update_commands" on device_commands
  for update to anon using (true) with check (true);

drop policy if exists "anon_upsert_device_firmware" on device_firmware;
create policy "anon_upsert_device_firmware" on device_firmware
  for all to anon using (true) with check (true);

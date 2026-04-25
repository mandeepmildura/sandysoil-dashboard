# Sandy Soil Automations — Project Context

## Stack
- **Frontend**: React + Vite, Tailwind CSS, deployed on Cloudflare Pages (`sandysoil.pages.dev`)
- **Database**: Supabase (PostgreSQL) — zone history, schedules, programs, alerts, auth
- **MQTT Broker**: HiveMQ Cloud (`eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud`)
  - Dashboard connects via WSS port **8884**
  - Devices connect via MQTTS (TLS) port **8883**

## Devices

### 1. SSA-V8 — 8-Valve Irrigation Controller (`sandysoil-8z`)
- **Product name (UI):** "Irrigation Controller (SSA-V8)" — Sandy Soil Automations 8-valve
- **Repo**: `mandeepmildura/sandysoil-8z` (private, C++/ESP32 firmware)
- **Firmware version**: 2.3.3
- **Local IP**: 192.168.1.100
- **MQTT publish topic**: `farm/irrigation1/status`
- **MQTT subscribe topic**: `farm/irrigation1/zone/+/cmd`
- **Command payload**: `{"cmd": "on", "duration": 30}` or `{"cmd": "off"}`
- **State response topic**: `farm/irrigation1/zone/{N}/state`
- **State response payload**: `{"zone": 1, "name": "Zone 1", "on": true, "state": "manual"}`
- **Status payload example**:
  ```json
  {"device":"irrigation1","fw":"2.3.1","online":true,"supply_psi":35,
   "uptime":83595,"rssi":-45,"ip":"192.168.1.100",
   "zones":[{"id":1,"name":"Zone 1","on":false,"state":"off"}, ...]}
  ```
- **Zones**: 8 zones (Zone 1–8)
- **Known issue**: Does NOT execute schedules automatically — only responds to MQTT commands

### 2. KC868-A6v3 (6-Channel Relay Controller)
- **Model**: KinCony KC868-A6v3 (6-channel relay ESP32-S3)
- **Firmware**: KCS v3 (same as B16M)
- **Serial**: 8CBFEA03002C
- **MQTT publish topic**: `A6v3/8CBFEA03002C/STATE`
- **MQTT subscribe topic**: `A6v3/8CBFEA03002C/SET`
- **State payload**:
  ```json
  {"output1":{"value":false}, ..., "output6":{"value":false},
   "input1":{"value":false}, ..., "input6":{"value":false},
   "adc1":{"value":0}, "adc2":{"value":0}, "adc3":{"value":0}, "adc4":{"value":0},
   "dac1":{"value":0}, "dac2":{"value":0}}
  ```
- **Command payload**: `{"output1": {"value": true}}`
- **Hardware**: 6 relay outputs, 6 digital inputs, 4 analog inputs, 2 DAC outputs, LCD display, RS485, I2C

### 3. KinCony B16M (Test Board)
- **Model**: KinCony B16M (16-channel MOSFET outputs)
- **Firmware**: KCSv3 v3.24.2 (built Mar 24 2026), TLS support added in v3.23.2
- **Serial**: CCBA97071FD8
- **Local IP**: 192.168.1.104 (web UI at `http://192.168.1.104`)
- **MQTT publish topic**: `B16M/CCBA97071FD8/STATE`
- **MQTT subscribe topic**: `B16M/CCBA97071FD8/SET`
- **State payload**:
  ```json
  {"output1":{"value":false}, ..., "output16":{"value":false},
   "input1":{"value":false}, ..., "input16":{"value":false},
   "adc1":{"value":0}, "adc2":{"value":0}, "adc3":{"value":0}, "adc4":{"value":0}}
  ```
- **Command payload**: `{"output1": {"value": true}}`
- **Hardware**: 16 MOSFET outputs (DO1–DO16), 16 digital inputs (DI1–DI16), 4 analog inputs (CH1–CH4), RS485, I2C, Ethernet (RJ45)
- **Status**: Test board only — not in production irrigation use

## MQTT Topic Map

| Topic | Direction | Source | Description |
|-------|-----------|--------|-------------|
| `farm/irrigation1/status` | publish | 8-zone controller | Full device + zone status |
| `farm/irrigation1/zone/+/cmd` | subscribe | 8-zone controller | Zone on/off commands |
| `farm/irrigation1/zone/+/state` | publish | 8-zone controller | Per-zone state update after command |
| `farm/filter1/pressure` | publish | (TBD) | Filter inlet/outlet pressure |
| `farm/filter1/backwash/state` | publish | (TBD) | Backwash state |
| `farm/filter1/backwash/start` | subscribe | (TBD) | Start backwash command |
| `B16M/CCBA97071FD8/STATE` | publish | B16M board | Full I/O state |
| `B16M/CCBA97071FD8/SET` | subscribe | B16M board | Output control commands |
| `A6v3/8CBFEA03002C/STATE` | publish | A6v3 controller | Full I/O state |
| `A6v3/8CBFEA03002C/SET` | subscribe | A6v3 controller | Relay output control commands |

## Supabase Tables
- `zone_history` — zone run records (started_at, ended_at, zone_num, source)
- `zone_groups` — irrigation programs/groups
- `zone_group_members` — zones within a program (zone_num, duration_min, sort_order, step_type, device, delay_min)
- `group_schedules` — program schedules (days_of_week, start_time, enabled)
- `zone_schedules` — per-zone schedules
- `pressure_log` — historical pressure readings
- `device_alerts` — alerts with acknowledge/dismiss
- `program_queue` — queued steps for Run Now execution (group_id, step_type, device, zone_num, duration_min, fire_at, fired_at)

## Pending DB Migrations (run via Supabase MCP at session start)
```sql
-- Create program_queue table
CREATE TABLE IF NOT EXISTS program_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid REFERENCES zone_groups(id) ON DELETE CASCADE,
  step_type     text NOT NULL,
  device        text NOT NULL DEFAULT 'irrigation1',
  zone_num      integer NOT NULL,
  duration_min  integer,
  fire_at       timestamptz NOT NULL,
  fired_at      timestamptz,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE program_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON program_queue FOR ALL USING (true) WITH CHECK (true);

-- Drop unique constraint that blocks multi-step programs
ALTER TABLE zone_group_members
DROP CONSTRAINT IF EXISTS zone_group_members_group_id_zone_num_key;

-- Allow anon role to write pressure_log (run only if policy does not already exist)
-- Check first: SELECT policyname FROM pg_policies WHERE tablename='pressure_log';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pressure_log' AND policyname = 'pressure_log_anon_all'
  ) THEN
    EXECUTE 'CREATE POLICY "pressure_log_anon_all" ON public.pressure_log
      FOR ALL TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;
```

## Key Source Files
| File | Purpose |
|------|---------|
| `src/lib/mqttClient.js` | MQTT WSS client, subscribe/publish |
| `src/lib/commands.js` | Zone on/off, backwash, B16M output commands |
| `src/lib/supabase.js` | Supabase client |
| `src/hooks/useLiveTelemetry.js` | Subscribe to MQTT topics, return live data |
| `src/hooks/useZoneHistory.js` | Fetch zone run history |
| `src/hooks/usePressureHistory.js` | Fetch/downsample pressure history |
| `src/hooks/useAlerts.js` | Device alerts |
| `src/hooks/usePrograms.js` | Irrigation programs |
| `src/hooks/useScheduleRules.js` | Zone + group schedules |
| `src/pages/Dashboard.jsx` | Main dashboard — live zone status, B16M detail |
| `src/pages/Calendar.jsx` | Schedule calendar — display + Run Now |
| `src/pages/Zones.jsx` | Zone list with live state |

## Known Issues / TODO
- [x] **Schedule auto-execution** — DONE. `run-schedules` + `run-program-queue` Edge Functions on pg_cron handle this. `run-schedules` now kicks `run-program-queue` immediately after queueing, eliminating the previous 1-minute lag.
- [ ] **Filter pressure sensors**: `farm/filter1/pressure` topic not yet publishing — no sensor wired
- [ ] **Backwash control**: `farm/filter1/backwash/*` topics not yet wired to a device
- [ ] **B16M ADC**: CH1–CH4 all reading 0 — no sensors connected yet
- [ ] **SSA-V8 ADC pressure** — firmware to publish raw ADC values (modeled like A6v3); dashboard already supports `supply_psi` and the pressure_log table is ready
- [ ] **Multi-tenant per-customer MQTT credentials** — banner fires in AdminConsole when farms ≥ 5; switch from "unique topic per unit" to per-customer HiveMQ credentials at that threshold

## Roles / Access
- Admin = `mandeep@freshoz.com` (hard-coded in `src/lib/role.js`)
- Customers see: Dashboard, Zones, Schedule, Pressure, Alerts (their SSA-V8 only)
- Hidden from customers: A6v3, B16M devices, AdminConsole; direct URLs (`/a6v3`, `/b16m`, `/admin`) redirect to `/`

## Environment Variables
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_MQTT_HOST=eb65c13ec8ab480a9c8492778fdddda8.s1.eu.hivemq.cloud
VITE_MQTT_USER=your-mqtt-user
VITE_MQTT_PASS=your-mqtt-password
```

## Git Branch Convention
Claude works on branches named `claude/*` which are auto-merged into main via GitHub Actions.

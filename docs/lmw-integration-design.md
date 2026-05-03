# LMW Water Order Integration — Design

## Goal

Automate matching irrigation schedules in Sandy Soil dashboard with water orders at Lower Murray Water, so:

1. The user sees allocation, orders, and meter usage in the dashboard
2. Scheduled irrigation runs are guaranteed to have a corresponding water booking
3. Missed/over-booked windows surface as alerts
4. Routine bookings can be placed automatically (with approval)

## What LMW exposes

Site: `https://waterorder.lmw.vic.gov.au/` — classic ASP, no public API.

| Page | Purpose | Method |
|---|---|---|
| `default1.asp` | Login (outlet + PIN); dashboard tiles | POST form |
| `Assessment.asp` | Allocation balance (ABA), AUL, outlet meters | GET, parse HTML |
| `OrderHistory.asp` | All orders this season | GET, parse HTML table |
| `MeterReadings.asp` | Daily meter readings, actual vs estimated | GET, parse HTML table |
| `LiveFlow.asp` | Real-time flow rate + totalised volume | GET, parse HTML |
| `SRWA_OrderWater.asp` | Place / cancel / modify orders | POST form (10 orders/batch) |

Session is cookie-based (`ASPSESSIONID*`). No CSRF token observed. Idle timeout ~30 min.

Form field names captured (Place An Order):
- `st_day0..9`, `st_hour0..9`, `length0..9`, `amount0..9`, `shift0..9`
- For cancel: ticked checkbox per row + `Modify / Cancel Order` button

## Architecture

```
+-----------------+        +------------------+        +-----------------+
| Sandy Soil UI   | <----> | Supabase Edge    | <----> | LMW (HTML/POST) |
| (React/Vite)    |        | Functions (Deno) |        |                 |
+-----------------+        +------------------+        +-----------------+
        |                          |
        |                          v
        |                  +------------------+
        +----------------> | Supabase Postgres|
                           | (orders, alloc,  |
                           |  meter, creds)   |
                           +------------------+
```

## Data model

```sql
-- Per-customer LMW credentials (multi-tenant ready)
CREATE TABLE lmw_credentials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) NOT NULL,
  outlet_no   text NOT NULL,
  pin_enc     text NOT NULL,           -- pgsodium-encrypted
  last_login  timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- Snapshot of LMW order list (refreshed by sync function)
CREATE TABLE lmw_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id),
  outlet_no    text NOT NULL,
  receipt_no   text NOT NULL,
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  hours        numeric NOT NULL,
  flow_lps     integer NOT NULL,
  shift_no     integer NOT NULL,
  est_ml       numeric,
  status       text DEFAULT 'active',  -- active | running | cancelled | completed
  source       text DEFAULT 'manual',  -- manual | dashboard | auto
  synced_at    timestamptz DEFAULT now(),
  UNIQUE (outlet_no, receipt_no)
);

-- Snapshot of allocation
CREATE TABLE lmw_allocation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id),
  outlet_no         text NOT NULL,
  aba_id            text,
  carryover_ml      numeric,
  seasonal_alloc_ml numeric,
  trade_in_ml       numeric,
  trade_out_ml      numeric,
  water_use_ml      numeric,
  aba_balance_ml    numeric,
  available_ml      numeric,
  tradable_ml       numeric,
  period1_limit_ml  numeric,
  period1_used_ml   numeric,
  period1_end       date,
  period2_limit_ml  numeric,
  period2_used_ml   numeric,
  period2_end       date,
  synced_at         timestamptz DEFAULT now()
);

-- Daily meter readings
CREATE TABLE lmw_meter_readings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id),
  outlet_no    text NOT NULL,
  reading_date date NOT NULL,
  meter_reading numeric NOT NULL,
  act_usage_ml numeric,
  est_usage_ml numeric,
  synced_at    timestamptz DEFAULT now(),
  UNIQUE (outlet_no, reading_date)
);

-- Audit log of automated booking decisions
CREATE TABLE lmw_booking_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id),
  action      text NOT NULL,           -- placed | cancelled | failed | skipped
  reason      text,
  start_at    timestamptz,
  hours       numeric,
  flow_lps    integer,
  receipt_no  text,
  http_status integer,
  raw_response text,
  created_at  timestamptz DEFAULT now()
);
```

## Edge functions

### `lmw-sync` (read-only, runs every 30 min via pg_cron)

```
1. For each row in lmw_credentials:
   2. Decrypt PIN
   3. POST default1.asp with outlet+PIN -> capture session cookie
   4. GET Assessment.asp -> parse, upsert lmw_allocation
   5. GET OrderHistory.asp -> parse, upsert lmw_orders
   6. GET MeterReadings.asp -> parse, upsert lmw_meter_readings
   7. GET LiveFlow.asp -> parse current flow, push to Supabase realtime channel
8. UPDATE last_login
```

Parse with `deno-dom`; tables have stable structure so a few CSS selectors per page is enough.

### `lmw-place-order` (called from dashboard or auto-book function)

Input:
```json
{
  "user_id": "...",
  "orders": [{ "start_at": "2026-05-11T04:00:00+10:00", "hours": 2, "flow_lps": 17, "shift_no": 1 }]
}
```

Logic:
1. Login (reuse session from `lmw-sync` if fresh).
2. POST `SRWA_OrderWater.asp` with up to 10 orders per call.
3. Parse response — green rows = success with receipt_no, red rows = failed.
4. Insert successes into `lmw_orders` with `source = 'auto'` or `'dashboard'`.
5. Log every attempt to `lmw_booking_log`.

### `lmw-cancel-order`

Input: `{ "user_id": "...", "receipt_no": "484447" }`

Tick the cancel checkbox via the form post mechanism; mark order `cancelled` in DB.

### `lmw-rolling-bookings` (cron, e.g. Wed 06:00)

For each user:
1. Read `zone_groups` + `group_schedules` + `zone_schedules` for the next 10 days.
2. Project out every irrigation window (start_at, duration_min, max group duration treated as parallel run).
3. Diff against `lmw_orders.status='active'`.
4. For each gap **within booking horizon** (~8 days) and **at least N hours away** (default 12h):
   - Apply booking strategy (see below) → call `lmw-place-order`.
5. Push a `device_alerts` row for any gap that can't be auto-booked (too soon, allocation exhausted, etc.).

Default booking strategy:
- 2-hour buffer (irrigation duration + 1h)
- Sundays where zone 3 also runs at 08:00 → extend Sunday morning booking to cover 04:00–09:00
- Flow rate: latest used flow on this outlet (or 17 L/s default)
- Shift: 1

## Dashboard UI

### New page: **Water** (`src/pages/Water.jsx`)

Three sections:

```
+---------------------------- Water ----------------------------+
|                                                                |
|  ALLOCATION                                                    |
|  +------------------------+ +------------------+               |
|  | ABA Balance: 26.86 ML  | | Tradable: 26.80  |               |
|  +------------------------+ +------------------+               |
|  Period 1 (ends 08/05): 5.787 ML limit, 1.346 ML used  ▰▰▱▱▱  |
|  Period 2 (ends 15/05): 5.787 ML limit, 0 used         ▱▱▱▱▱  |
|                                                                |
|  USAGE THIS SEASON                                             |
|  Actual:    22.98 ML  -----  Estimated: 69.55 ML   (33%)      |
|  [Recharts line chart of daily meter readings]                 |
|                                                                |
|  UPCOMING BOOKINGS vs SCHEDULE                                 |
|  Day   | Schedule needs | Booked        | Status               |
|  Mon   | 04:00, 16:00  | ✓ ✓           | ok                   |
|  Tue   | 04:00, 16:00  | ✓ ✓           | ok                   |
|  ...                                                           |
|  Mon 11| 04:00, 16:00  | -, -          | gap (book in 5d)     |
|                                                                |
|  [Sync now]  [Book missing windows]                            |
+----------------------------------------------------------------+
```

### Modify: **Calendar** (`src/pages/Calendar.jsx`)

Overlay LMW order blocks on the existing schedule calendar. Color-code:
- Green: schedule with matching booking
- Amber: schedule, no booking, still bookable
- Red: schedule, no booking, past horizon

### Admin tile: **LMW Setup** (in `src/pages/AdminConsole.jsx`)

Per-customer form: outlet, PIN, sync toggle, auto-book toggle.

## New hooks

```js
// src/hooks/useLmwAllocation.js
// src/hooks/useLmwOrders.js          (returns active orders, with gap analysis vs schedules)
// src/hooks/useLmwMeterReadings.js
// src/hooks/useLmwGapAnalysis.js     (joins schedules + orders, projects 10 days)
```

## Phased rollout

1. **Read-only sync** (lowest risk) — show allocation, orders, usage in dashboard. No writes to LMW.
2. **Manual booking from dashboard** — "Book missing" buttons that call `lmw-place-order` after explicit confirmation.
3. **Auto-booking** — `lmw-rolling-bookings` cron runs the booking strategy automatically once you trust it.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| LMW changes HTML, scraper breaks | Snapshot raw HTML in `lmw_booking_log`; small CSS-selector parser per page; alert in dashboard if parse fails |
| Wrong order placed (financial cost) | Always log to `lmw_booking_log`; require `source='auto'` orders to be reversible (cancel within X hrs); cap auto-bookings per day |
| Credentials leak | Use `pgsodium` to encrypt PIN; never log decrypted; rotate via admin UI |
| Schedule changed but old order still placed | Sync runs reflect current state; on schedule change, run gap analysis and propose cancellations |
| Booking horizon < irrigation horizon | Already handled — auto-book function only attempts gaps within horizon; flags rest as alerts |

## Order of work (suggested)

1. Migrations: create the 5 LMW tables (with RLS keyed on `auth.uid()`)
2. Edge function `lmw-sync` + cron — verify reads work end-to-end, see data in dashboard
3. New `Water.jsx` page with allocation + usage + orders
4. Edge function `lmw-place-order` — wired to a "Book this window" button on Calendar.jsx
5. Edge function `lmw-cancel-order` — wired to "Cancel" button next to each LMW order in the UI
6. `lmw-rolling-bookings` cron + audit-log surfacing in AdminConsole
7. Multi-tenant rollout: per-customer credentials and `lmw_credentials.user_id` filter throughout

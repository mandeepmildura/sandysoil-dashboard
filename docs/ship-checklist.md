# SSA-V8 — Customer Ship Checklist

Repeatable runbook for shipping a Sandy Soil Automations 8-valve irrigation controller (SSA-V8) to a new customer.

## Before you ship the unit

1. **Flash latest firmware** (or confirm OTA pulled it):
   - Latest release: `mandeepmildura/sandysoil-8z` → Releases → `vX.Y.Z` → `firmware.bin`.
   - For shipping: minimum **v2.4.1** (per-unit topics, hotspot Wi-Fi setup).

2. **Factory reset NVS** so the unit boots clean for the customer:
   - Connect serial; in the Arduino monitor, reset preferences (or hold a reset trigger if present).
   - On next boot the unit will:
     - Have empty Wi-Fi creds → boots into hotspot mode `FarmControl-Irrigation-Setup` at `http://192.168.4.1`.
     - Have empty MQTT base topic → defaults to `farm/<chip-id>` (12-hex MAC, lowercase).

3. **Note the chip ID** (printed on the OLED on first boot, or via serial monitor — `[Storage] Default base topic: farm/...`). Stick it on a label on the unit and write it on the shipping form. This is the key to the customer's data.

4. **Bench-test before sending**:
   - Power on, hotspot appears.
   - Connect a phone to the hotspot, fill the form, point it at your office Wi-Fi.
   - Confirm it shows up in the dashboard's Admin Console under "Unclaimed Devices" with the chip ID.
   - Click each zone on/off in the UI to verify all 8 relays click.
   - Optionally trigger an OTA check.

## When the customer receives it

1. **Customer plugs it in** at their farm, somewhere with Wi-Fi reach.
2. They see the OLED says "Setup Mode". They join `FarmControl-Irrigation-Setup` Wi-Fi from a phone.
3. Captive portal at `http://192.168.4.1` opens. They enter:
   - Their home/farm Wi-Fi SSID + password
   - (Optional) MQTT host/credentials — these can be pre-filled in firmware defaults; verify
4. Save → unit reboots → joins the customer's Wi-Fi → connects to HiveMQ → starts publishing on `farm/<its-chip-id>/status`.

## What you (admin) do in the dashboard

1. Open **https://sandysoil.pages.dev/admin** logged in as `mandeep@freshoz.com`.
2. **Farms** tab → **+ Add Farm** with the customer's name, location, contact email (this is the email they'll log in with).
3. **Devices** tab → wait for the unit to appear in the orange "Unclaimed Devices" banner (within ~30 s of customer's unit coming online).
4. Click the **Assign to farm…** dropdown → pick their farm. Done.
5. The customer signs up at `sandysoil.pages.dev` with the same email you used for the farm. (Or they sign up first; either order works as long as the email matches.)

## Verifying the customer can see their controller

1. Customer logs in.
2. Sidebar shows: Dashboard / Controller / Schedule / Pressure / Alerts. **No** A6v3, B16M, Admin.
3. The "Controller" page shows their 8 zones, the Programs tab, History tab.
4. If anything's not linked, they'll see **🌱 No controller assigned** with a "Contact Support" button.

## When you cross 5 customers

The Admin Console will display an orange banner reminding you to upgrade from "unique topic per unit" to "per-customer MQTT credentials" in HiveMQ for true broker-level isolation. See the multi-tenancy upgrade notes when that day comes.

## Common gotchas

- **Customer emails the support address asking why their controller isn't showing data**: usually means the device's `farm_id` is still NULL in `farm_devices`. Open Admin → Devices, find the row, set the farm.
- **Customer sees admin-only nav items**: their email matches `mandeep@freshoz.com` — they're being treated as admin. Verify the email in `auth.users`.
- **Controller offline within minutes of arrival**: customer's Wi-Fi is too weak in the install location, or they entered the wrong SSID/password. Power-cycle the unit while holding the reset trigger to force back to hotspot mode.

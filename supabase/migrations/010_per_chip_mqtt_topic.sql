-- ============================================================
-- 010 — Per-chip MQTT topic prefix
--
-- Adds farm_devices.mqtt_base_topic so each device can publish on
-- its own topic prefix (e.g. farm/<chip-id>) instead of every device
-- in the fleet sharing farm/irrigation1.
--
-- The legacy first-customer unit keeps farm/irrigation1 via the
-- backfill below; new devices default to farm/<device_id>.
--
-- Apply order: after 009. Idempotent.
-- ============================================================

ALTER TABLE public.farm_devices
  ADD COLUMN IF NOT EXISTS mqtt_base_topic text;

-- Backfill: legacy units that look like the original irrigation controller.
-- Anything matching the historical naming gets the legacy topic so the
-- dashboard and firmware stay aligned.
UPDATE public.farm_devices
SET mqtt_base_topic = 'farm/irrigation1'
WHERE mqtt_base_topic IS NULL
  AND (
    device_id = 'irrigation1'
    OR device_id = 'KC868-001'
    OR type = 'Irrigation Controller'
  );

-- Everything else: derive from device_id (the chip serial, lowercased).
UPDATE public.farm_devices
SET mqtt_base_topic = 'farm/' || lower(device_id)
WHERE mqtt_base_topic IS NULL;

-- Going forward, every farm_devices insert must specify the topic.
ALTER TABLE public.farm_devices
  ALTER COLUMN mqtt_base_topic SET NOT NULL;

CREATE INDEX IF NOT EXISTS farm_devices_mqtt_base_topic_idx
  ON public.farm_devices (mqtt_base_topic);


-- ── program_queue: capture the MQTT prefix at queue time ──
-- The schedule executor needs to know which device's topic to publish to.
-- Adding the column here means the executor doesn't have to re-resolve
-- the device → topic mapping at fire time (which is brittle if the
-- assignment changes mid-run).

ALTER TABLE public.program_queue
  ADD COLUMN IF NOT EXISTS mqtt_base_topic text;

-- Backfill any in-flight queued steps with the legacy prefix.
UPDATE public.program_queue
SET mqtt_base_topic = 'farm/irrigation1'
WHERE mqtt_base_topic IS NULL;

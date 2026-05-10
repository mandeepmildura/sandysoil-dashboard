/**
 * MQTT wildcard topic matcher.
 *
 * Supports single-level '+' wildcards only (no '#' multi-level).
 * Kept in its own module because the logic was duplicated in
 * mqttClient.js and useLiveTelemetry.js — drift between copies
 * would cause phantom-subscription bugs.
 */
export function mqttMatch(pattern, topic) {
  const p = pattern.split('/')
  const t = topic.split('/')
  if (p.length !== t.length) return false
  return p.every((seg, i) => seg === '+' || seg === t[i])
}

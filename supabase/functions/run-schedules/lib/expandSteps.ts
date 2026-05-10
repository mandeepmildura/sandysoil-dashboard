export type Step = {
  zone_num: number
  duration_min: number | null
  sort_order: number
  step_type: string | null
  delay_min: number | null
  device: string | null
}

export type QueueRow = {
  group_id: string
  step_type: string
  device: string
  zone_num: number
  duration_min: number | null
  fire_at: string
  mqtt_base_topic: string
}

export function expandSteps(
  groupId: string,
  runMode: string,
  steps: Step[],
  baseMs: number,
  mqttBaseTopic: string = 'farm/irrigation1',
  pumpZoneNum: number | null = null,
  programDurationMin: number | null = null,
  suppressPumpOff: boolean = false,
): QueueRow[] {
  const sorted = [...steps].sort((a, b) => a.sort_order - b.sort_order)
  const rows: QueueRow[] = []

  if (runMode === 'simultaneous') {
    const durMin = programDurationMin ?? 30
    const offMs  = baseMs + durMin * 60_000

    // Pump ON first (before zone ONs so relay sequence is correct)
    if (pumpZoneNum != null) {
      rows.push({ group_id: groupId, step_type: 'on', device: 'irrigation1',
        zone_num: pumpZoneNum, duration_min: durMin,
        fire_at: new Date(baseMs).toISOString(), mqtt_base_topic: mqttBaseTopic })
    }

    for (const step of sorted) {
      const device = step.device ?? 'irrigation1'
      // Skip if this zone is the pump zone — already injected above
      if (pumpZoneNum != null && step.zone_num === pumpZoneNum) continue

      rows.push({ group_id: groupId, step_type: 'on', device,
        zone_num: step.zone_num, duration_min: durMin,
        fire_at: new Date(baseMs).toISOString(), mqtt_base_topic: mqttBaseTopic })

      rows.push({ group_id: groupId, step_type: 'off', device,
        zone_num: step.zone_num, duration_min: durMin,
        fire_at: new Date(offMs).toISOString(), mqtt_base_topic: mqttBaseTopic })
    }

    // Pump OFF last (after zone OFFs)
    if (pumpZoneNum != null && !suppressPumpOff) {
      rows.push({ group_id: groupId, step_type: 'off', device: 'irrigation1',
        zone_num: pumpZoneNum, duration_min: durMin,
        fire_at: new Date(offMs).toISOString(), mqtt_base_topic: mqttBaseTopic })
    }

    return rows
  }

  // Legacy sequential / parallel modes — unchanged
  let cursorMs = baseMs

  for (const step of sorted) {
    const stepType = step.step_type ?? 'on'
    const device   = step.device    ?? 'irrigation1'

    if (stepType === 'delay') {
      cursorMs += (step.delay_min ?? 0) * 60_000
      continue
    }

    rows.push({ group_id: groupId, step_type: stepType, device,
      zone_num: step.zone_num, duration_min: step.duration_min,
      fire_at: new Date(cursorMs).toISOString(), mqtt_base_topic: mqttBaseTopic })

    if (stepType === 'on' && device === 'a6v3' && (step.duration_min ?? 0) > 0) {
      const offAtMs = cursorMs + (step.duration_min ?? 0) * 60_000
      rows.push({ group_id: groupId, step_type: 'off', device,
        zone_num: step.zone_num, duration_min: step.duration_min ?? 0,
        fire_at: new Date(offAtMs).toISOString(), mqtt_base_topic: mqttBaseTopic })
    }

    if (stepType === 'on' && (device === 'irrigation1' || device === 'a6v3') && runMode === 'sequential') {
      cursorMs += (step.duration_min ?? 0) * 60_000
    }
  }

  return rows
}

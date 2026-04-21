/**
 * Pure step-expansion logic for run-schedules.
 *
 * Given a zone_groups row + its zone_group_members, produces the list of
 * program_queue rows that should be inserted. Walks the steps in sort order
 * and:
 *   • 'delay' steps advance the cursor forward in time (no queue row)
 *   • 'on' / 'off' steps produce a queue row with fire_at = cursor
 *   • A6v3 'on' steps with a duration also emit an explicit 'off' row at
 *     cursor + duration (A6v3 firmware has no auto-off timer)
 *   • Sequential runs advance the cursor by duration after each 'on' so the
 *     next step fires when the previous one finishes
 *
 * No Supabase/Deno imports — safe to unit test in Node.
 */

export type Step = {
  zone_num: number
  duration_min: number | null
  sort_order: number
  step_type: string | null   // 'on' | 'off' | 'delay' — null treated as 'on'
  delay_min: number | null
  device: string | null      // 'irrigation1' | 'a6v3' — null treated as 'irrigation1'
}

export type QueueRow = {
  group_id: string
  step_type: string
  device: string
  zone_num: number
  duration_min: number | null
  fire_at: string
}

export function expandSteps(
  groupId: string,
  runMode: string,
  steps: Step[],
  baseMs: number,
): QueueRow[] {
  const sorted = [...steps].sort((a, b) => a.sort_order - b.sort_order)

  let cursorMs = baseMs
  const rows: QueueRow[] = []

  for (const step of sorted) {
    const stepType = step.step_type ?? 'on'
    const device   = step.device    ?? 'irrigation1'

    if (stepType === 'delay') {
      cursorMs += (step.delay_min ?? 0) * 60_000
      continue
    }

    rows.push({
      group_id:    groupId,
      step_type:   stepType,
      device,
      zone_num:    step.zone_num,
      duration_min: step.duration_min,
      fire_at:     new Date(cursorMs).toISOString(),
    })

    if (stepType === 'on' && device === 'a6v3' && (step.duration_min ?? 0) > 0) {
      const offAtMs = cursorMs + (step.duration_min ?? 0) * 60_000
      rows.push({
        group_id:     groupId,
        step_type:    'off',
        device,
        zone_num:     step.zone_num,
        duration_min: null,
        fire_at:      new Date(offAtMs).toISOString(),
      })
    }

    if (stepType === 'on'
        && (device === 'irrigation1' || device === 'a6v3')
        && runMode === 'sequential') {
      cursorMs += (step.duration_min ?? 0) * 60_000
    }
  }

  return rows
}

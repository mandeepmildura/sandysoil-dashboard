import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Loads firmware release info and per-device firmware status.
 *
 * Supabase tables expected:
 *   firmware_releases(id, model, version, url, notes, released_at)
 *   device_firmware(id, device_id, farm_id, model, current_version, last_seen_at)
 */
export function useFirmware() {
  const [releases, setReleases]   = useState([])
  const [devices,  setDevices]    = useState([])
  const [loading,  setLoading]    = useState(true)
  const [tick,     setTick]       = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [relRes, devRes] = await Promise.all([
        supabase.from('firmware_releases').select('*').order('released_at', { ascending: false }),
        supabase.from('device_firmware').select('*, farms(name)').order('model'),
      ])
      if (relRes.data) setReleases(relRes.data)
      if (devRes.data) setDevices(devRes.data)
      setLoading(false)
    }
    load()
  }, [tick])

  /**
   * Returns the latest release for a given model, or null if none.
   */
  function latestRelease(model) {
    return releases.find(r => r.model === model) ?? null
  }

  /**
   * True when the device's current_version is behind the latest release.
   */
  function needsUpdate(device) {
    const latest = latestRelease(device.model)
    return latest ? latest.version !== device.current_version : false
  }

  /**
   * Summary grouped by model: { model, count, current_version, latest_version, updateCount }
   */
  const byModel = Object.values(
    devices.reduce((acc, d) => {
      const latest = latestRelease(d.model)
      if (!acc[d.model]) {
        acc[d.model] = {
          model:           d.model,
          count:           0,
          current_version: d.current_version,
          latest_version:  latest?.version ?? d.current_version,
          url:             latest?.url ?? null,
          updateCount:     0,
        }
      }
      acc[d.model].count++
      if (needsUpdate(d)) acc[d.model].updateCount++
      return acc
    }, {})
  )

  return { releases, devices, byModel, loading, reload, latestRelease, needsUpdate }
}

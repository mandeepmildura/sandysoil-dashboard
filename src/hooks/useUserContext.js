import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Loads the current auth user + their profile + all visible devices.
 * Admin users can see all devices. Regular users see only their own.
 */
export function useUserContext() {
  const [userId, setUserId]           = useState(null)
  const [profile, setProfile]         = useState(null)
  const [devices, setDevices]         = useState([])
  const [irrigationId, setIrrigationId] = useState(null)
  const [filterId, setFilterId]       = useState(null)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setUserId(user.id)

      const [profileRes, devicesRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('devices').select('id, device_type, device_name, mqtt_topic_base').order('sort_order'),
      ])

      const prof = profileRes.data ?? null
      const devs = devicesRes.data ?? []

      setProfile(prof)
      setDevices(devs)
      setIrrigationId(devs.find(d => d.device_type === 'irrigation')?.id ?? null)
      setFilterId(devs.find(d => d.device_type === 'filter')?.id ?? null)
      setLoading(false)
    }
    load()
  }, [])

  return {
    userId,
    profile,
    devices,
    irrigationId,
    filterId,
    isAdmin: profile?.is_admin ?? false,
    loading,
  }
}

import { useState, useEffect, useCallback } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import VitalsStrip from '../components/VitalsStrip'
import { supabase } from '../lib/supabase'

export default function AdminConsole() {
  const [profiles, setProfiles] = useState([])
  const [devices, setDevices]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [editId, setEditId]     = useState(null)
  const [editFarm, setEditFarm] = useState('')
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [profRes, devRes] = await Promise.all([
      supabase.from('profiles').select('id, name, email, farm_name, is_admin').order('is_admin', { ascending: false }),
      supabase.from('devices').select('id, customer_id, device_name, device_type, mqtt_topic_base, enabled').order('sort_order'),
    ])
    if (profRes.data) setProfiles(profRes.data)
    if (devRes.data)  setDevices(devRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function devicesFor(userId) {
    return devices.filter(d => d.customer_id === userId)
  }

  async function saveFarmName(id) {
    setSaving(true)
    const { error } = await supabase.from('profiles').update({ farm_name: editFarm.trim() || null }).eq('id', id)
    if (error) {
      setMsg({ ok: false, text: error.message })
    } else {
      setMsg({ ok: true, text: 'Farm name updated.' })
      setEditId(null)
      load()
    }
    setSaving(false)
    setTimeout(() => setMsg(null), 3000)
  }

  async function assignDevice(deviceId, customerId) {
    await supabase.from('devices').update({ customer_id: customerId }).eq('id', deviceId)
    load()
  }

  const farmers   = profiles.filter(p => !p.is_admin)
  const admins    = profiles.filter(p => p.is_admin)
  const unassigned = devices.filter(d => !profiles.find(p => p.id === d.customer_id))

  const VITALS = [
    { label: 'Farmers',        value: String(farmers.length),  unit: '' },
    { label: 'Total Devices',  value: String(devices.length),  unit: '', status: 'online', statusLabel: 'REGISTERED' },
    { label: 'Assigned',       value: String(devices.filter(d => profiles.find(p => p.id === d.customer_id)).length), unit: '', status: 'online', statusLabel: 'ASSIGNED' },
    { label: 'Unassigned',     value: String(unassigned.length), unit: '', status: unassigned.length > 0 ? 'warning' : 'online', statusLabel: unassigned.length > 0 ? 'ACTION' : 'OK' },
  ]

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Farm Management Console</h1>
        <p className="text-sm text-[#40493d] font-body mt-1">Sandy Soil Automations — Admin</p>
      </div>

      <VitalsStrip vitals={VITALS} />

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-semibold ${msg.ok ? 'bg-[#0d631b]/10 text-[#0d631b]' : 'bg-[#ffdad6] text-[#ba1a1a]'}`}>
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Farmers + devices */}
        <div className="col-span-2 space-y-4">
          <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">Farmers</h2>

          {loading && <p className="text-sm text-[#40493d]">Loading…</p>}

          {farmers.map(p => {
            const farmerDevices = devicesFor(p.id)
            const isEditing = editId === p.id
            return (
              <div key={p.id} className="bg-[#ffffff] rounded-xl shadow-card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-headline font-semibold text-[#1a1c1c]">{p.name}</p>
                    <p className="text-xs text-[#40493d]">{p.email}</p>
                  </div>
                  <button onClick={() => { setEditId(isEditing ? null : p.id); setEditFarm(p.farm_name ?? '') }}
                    className="text-xs text-[#00639a] font-semibold hover:underline">
                    {isEditing ? 'Cancel' : 'Edit'}
                  </button>
                </div>

                {/* Farm name */}
                {isEditing ? (
                  <div className="flex gap-2 mb-3">
                    <input value={editFarm} onChange={e => setEditFarm(e.target.value)}
                      placeholder="Farm name"
                      className="flex-1 bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none" />
                    <button onClick={() => saveFarmName(p.id)} disabled={saving}
                      className="px-4 py-2 rounded-lg gradient-primary text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50">
                      Save
                    </button>
                  </div>
                ) : (
                  <p className="text-sm font-body text-[#40493d] mb-3">
                    Farm: <span className="font-semibold text-[#1a1c1c]">{p.farm_name ?? <em className="text-[#40493d] font-normal">Not set</em>}</span>
                  </p>
                )}

                {/* Devices */}
                <div>
                  <p className="text-xs font-body text-[#40493d] mb-2">Devices ({farmerDevices.length})</p>
                  {farmerDevices.length === 0 ? (
                    <p className="text-xs text-[#40493d] italic">No devices assigned</p>
                  ) : (
                    <div className="space-y-2">
                      {farmerDevices.map(d => (
                        <div key={d.id} className="flex items-center justify-between bg-[#f3f3f3] rounded-lg px-3 py-2">
                          <div>
                            <p className="text-xs font-semibold text-[#1a1c1c]">{d.device_name}</p>
                            <p className="text-[10px] text-[#40493d]">{d.mqtt_topic_base} · {d.device_type}</p>
                          </div>
                          <StatusChip status={d.enabled ? 'online' : 'offline'} label={d.enabled ? 'ON' : 'OFF'} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Assign unassigned device */}
                  {unassigned.length > 0 && (
                    <div className="mt-2">
                      <select
                        defaultValue=""
                        onChange={e => { if (e.target.value) assignDevice(e.target.value, p.id) }}
                        className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-xs font-body text-[#40493d] outline-none"
                      >
                        <option value="" disabled>+ Assign a device…</option>
                        {unassigned.map(d => (
                          <option key={d.id} value={d.id}>{d.device_name} ({d.mqtt_topic_base})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {!loading && farmers.length === 0 && (
            <p className="text-sm text-[#40493d] text-center py-6">
              No farmers yet. Farmers can create accounts from the login page.
            </p>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Admin accounts */}
          <Card accent="green">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Admins</h2>
            <div className="space-y-2">
              {admins.map(a => (
                <div key={a.id} className="bg-[#f3f3f3] rounded-lg p-3">
                  <p className="text-xs font-semibold text-[#1a1c1c]">{a.name}</p>
                  <p className="text-[10px] text-[#40493d]">{a.email}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* All devices */}
          <Card accent="blue">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">All Devices</h2>
            <div className="space-y-2">
              {devices.map(d => {
                const owner = profiles.find(p => p.id === d.customer_id)
                return (
                  <div key={d.id} className="bg-[#f3f3f3] rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs font-semibold text-[#1a1c1c]">{d.device_name}</p>
                        <p className="text-[10px] text-[#40493d]">{d.mqtt_topic_base}</p>
                        <p className="text-[10px] text-[#40493d]">{owner ? (owner.farm_name ?? owner.name) : <span className="text-[#e65100]">Unassigned</span>}</p>
                      </div>
                      <StatusChip status={d.enabled ? 'online' : 'offline'} label={d.device_type} />
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card>
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-2">New Farmer Signup</h2>
            <p className="text-xs text-[#40493d] font-body">
              Farmers create their own account from the login page using the "Create an account" link. Their farm name and email will appear here once registered.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

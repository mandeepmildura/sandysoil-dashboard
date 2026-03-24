import { useState, useEffect, useCallback } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import VitalsStrip from '../components/VitalsStrip'
import { supabase } from '../lib/supabase'

const ACTIVITY = [
  { farm: 'Mildura Block A',    event: 'Zone 3 started',        time: '2 min ago' },
  { farm: 'Sunraysia North',    event: 'Morning run completed', time: '8 min ago' },
  { farm: 'Red Cliffs Station', event: 'High pressure warning', time: '1h ago'    },
  { farm: 'Euston Almonds',     event: 'Device offline',        time: '3h ago'    },
  { farm: 'Robinvale Citrus',   event: 'Backwash complete',     time: '4h ago'    },
]

// Demo farm data shown as fallback when farms table is unavailable
const DEMO_FARMS = [
  { id: 1, name: 'Mildura Block A',    location: 'Mildura',    status: 'online',  created_at: new Date(Date.now() - 86400000 * 30).toISOString() },
  { id: 2, name: 'Sunraysia North',    location: 'Mildura',    status: 'online',  created_at: new Date(Date.now() - 86400000 * 25).toISOString() },
  { id: 3, name: 'Red Cliffs Station', location: 'Red Cliffs', status: 'fault',   created_at: new Date(Date.now() - 86400000 * 20).toISOString() },
  { id: 4, name: 'Euston Almonds',     location: 'Euston',     status: 'offline', created_at: new Date(Date.now() - 86400000 * 15).toISOString() },
  { id: 5, name: 'Robinvale Citrus',   location: 'Robinvale',  status: 'online',  created_at: new Date(Date.now() - 86400000 * 10).toISOString() },
]

// Demo device data shown as fallback when farm_devices table is unavailable
const DEMO_DEVICES = [
  { id: 1, farm_name: 'Mildura Block A',    device_id: 'KC868-001', model: 'KC868-A8v3', type: 'Irrigation Controller', firmware: 'v2.3.1', status: 'online',  last_seen: new Date(Date.now() - 60000).toISOString() },
  { id: 2, farm_name: 'Mildura Block A',    device_id: 'ALR-001',   model: 'ALR-V13',    type: 'Filter Station',        firmware: 'v1.2.0', status: 'online',  last_seen: new Date(Date.now() - 120000).toISOString() },
  { id: 3, farm_name: 'Sunraysia North',    device_id: 'KC868-002', model: 'KC868-A8v3', type: 'Irrigation Controller', firmware: 'v2.3.1', status: 'online',  last_seen: new Date(Date.now() - 300000).toISOString() },
  { id: 4, farm_name: 'Sunraysia North',    device_id: 'ALR-002',   model: 'ALR-V13',    type: 'Filter Station',        firmware: 'v1.1.8', status: 'warning', last_seen: new Date(Date.now() - 900000).toISOString() },
  { id: 5, farm_name: 'Red Cliffs Station', device_id: 'KC868-003', model: 'KC868-A8v3', type: 'Irrigation Controller', firmware: 'v2.2.0', status: 'fault',   last_seen: new Date(Date.now() - 7200000).toISOString() },
  { id: 6, farm_name: 'Euston Almonds',     device_id: 'KC868-004', model: 'KC868-A8v3', type: 'Irrigation Controller', firmware: 'v2.3.1', status: 'offline', last_seen: new Date(Date.now() - 10800000).toISOString() },
  { id: 7, farm_name: 'Robinvale Citrus',   device_id: 'KC868-005', model: 'KC868-A8v3', type: 'Irrigation Controller', firmware: 'v2.3.1', status: 'online',  last_seen: new Date(Date.now() - 600000).toISOString() },
  { id: 8, farm_name: 'Robinvale Citrus',   device_id: 'ALR-003',   model: 'ALR-V13',    type: 'Filter Station',        firmware: 'v1.2.0', status: 'online',  last_seen: new Date(Date.now() - 660000).toISOString() },
]

function fmtLastSeen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const diffMin = Math.floor((Date.now() - d) / 60000)
  if (diffMin < 2)   return 'Just now'
  if (diffMin < 60)  return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)    return `${diffH}h ago`
  return d.toLocaleDateString()
}

export default function AdminConsole() {
  const [activeTab, setActiveTab] = useState('farms')

  // ── Farms state ──────────────────────────────────────────────────────────
  const [farms, setFarms]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [farmName, setFarmName] = useState('')
  const [location, setLocation] = useState('')
  const [saving, setSaving]     = useState(false)
  const [saveMsg, setSaveMsg]   = useState(null)

  const [usingDemoFarms, setUsingDemoFarms] = useState(false)

  const loadFarms = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('farms').select('*').order('created_at')
      if (!error && data && data.length >= 0) {
        setFarms(data)
        setUsingDemoFarms(false)
      } else {
        setFarms(DEMO_FARMS)
        setUsingDemoFarms(true)
      }
    } catch (e) {
      setFarms(DEMO_FARMS)
      setUsingDemoFarms(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFarms() }, [loadFarms])

  async function addFarm() {
    if (!farmName.trim()) { setSaveMsg({ ok: false, text: 'Enter a farm name' }); return }
    if (usingDemoFarms) {
      setSaveMsg({ ok: false, text: 'Database not configured — showing demo data only.' })
      setTimeout(() => setSaveMsg(null), 4000)
      return
    }
    setSaving(true)
    setSaveMsg(null)
    try {
      const { error } = await supabase.from('farms').insert({
        name: farmName.trim(),
        location: location.trim() || null,
      })
      if (error) {
        setSaveMsg({ ok: false, text: 'Could not save farm. Please check database setup.' })
      } else {
        setFarmName('')
        setLocation('')
        setSaveMsg({ ok: true, text: 'Farm added.' })
        loadFarms()
      }
    } catch (e) {
      setSaveMsg({ ok: false, text: 'Could not save farm. Please check database setup.' })
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(null), 4000)
  }

  async function deleteFarm(id) {
    if (!window.confirm('Remove this farm?')) return
    try {
      await supabase.from('farms').delete().eq('id', id)
      loadFarms()
    } catch (e) {
      console.error('deleteFarm error:', e)
    }
  }

  // ── Devices state ─────────────────────────────────────────────────────────
  const [devices, setDevices]           = useState([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [deviceSearch, setDeviceSearch] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('all') // all | online | offline | fault

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true)
    try {
      const { data, error } = await supabase
        .from('farm_devices')
        .select('*, farms(name)')
        .order('farm_id')
      if (!error && data && data.length > 0) {
        // Flatten the join
        setDevices(data.map(d => ({ ...d, farm_name: d.farms?.name ?? '—' })))
      } else {
        // Fall back to demo data
        setDevices(DEMO_DEVICES)
      }
    } catch (e) {
      setDevices(DEMO_DEVICES)
    } finally {
      setDevicesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'devices') loadDevices()
  }, [activeTab, loadDevices])

  const filteredDevices = devices.filter(d => {
    const matchSearch = deviceSearch === '' ||
      d.farm_name?.toLowerCase().includes(deviceSearch.toLowerCase()) ||
      d.device_id?.toLowerCase().includes(deviceSearch.toLowerCase()) ||
      d.model?.toLowerCase().includes(deviceSearch.toLowerCase())
    const matchStatus = deviceFilter === 'all' || d.status === deviceFilter
    return matchSearch && matchStatus
  })

  // ── Vitals ────────────────────────────────────────────────────────────────
  const onlineFarms = farms.filter(f => f.status === 'online').length
  const faultFarms  = farms.filter(f => f.status === 'fault').length

  const VITALS = [
    { label: 'Total Farms',       value: String(farms.length), unit: '' },
    { label: 'Online Farms',      value: String(onlineFarms),  unit: `/ ${farms.length}`, status: 'online',  statusLabel: 'ONLINE' },
    { label: 'Active Irrigation', value: '—',                  unit: '',                  status: 'running', statusLabel: 'RUNNING' },
    { label: 'Active Faults',     value: String(faultFarms),   unit: '',                  status: faultFarms > 0 ? 'fault' : 'online', statusLabel: faultFarms > 0 ? 'FAULT' : 'OK' },
  ]

  const inputClass = 'bg-[#f3f3f3] rounded-lg px-3 py-2.5 text-sm font-body text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:ring-2 focus:ring-[#0d631b]/10 focus:bg-white transition-all'

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Farm Management Console</h1>
        <p className="text-sm text-[#40493d] font-body mt-1">Sandy Soil Automations — Service Dashboard</p>
      </div>

      <VitalsStrip vitals={VITALS} />

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6">
        {[
          { id: 'farms',   label: 'Farms' },
          { id: 'devices', label: 'Customer Devices' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-body font-medium transition-colors ${
              activeTab === t.id ? 'bg-[#1a1c1c] text-white' : 'text-[#40493d] hover:bg-[#f3f3f3]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Farms Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'farms' && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            {usingDemoFarms && (
              <div className="mb-3 px-4 py-2.5 bg-[#e65100]/10 border border-[#e65100]/20 rounded-lg text-xs text-[#e65100] font-semibold">
                Demo data — farms table not found in database. Connect Supabase to enable live data.
              </div>
            )}
            <div className="bg-[#ffffff] rounded-xl shadow-card overflow-hidden">
              <table className="w-full text-sm font-body">
                <thead>
                  <tr className="bg-[#f3f3f3]">
                    {['Farm', 'Location', 'Status', ''].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-[#40493d] px-4 py-3 first:pl-5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={4} className="px-5 py-4 text-sm text-[#40493d]">Loading farms…</td></tr>
                  )}
                  {!loading && farms.length === 0 && (
                    <tr><td colSpan={4} className="px-5 py-6 text-sm text-[#40493d] text-center">No farms yet. Add one below.</td></tr>
                  )}
                  {farms.map((f, i) => (
                    <tr key={f.id} className={`hover:bg-[#f9f9f9] transition-colors ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}>
                      <td className="px-5 py-3 font-semibold text-[#1a1c1c]">{f.name}</td>
                      <td className="px-4 py-3 text-[#40493d] text-xs">{f.location ?? '—'}</td>
                      <td className="px-4 py-3"><StatusChip status={f.status ?? 'offline'} label={(f.status ?? 'offline').toUpperCase()} /></td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteFarm(f.id)} className="text-[#ba1a1a] text-xs hover:underline">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add farm card */}
            <div className="mt-4 bg-[#ffffff] rounded-xl shadow-card p-5 border-2 border-dashed border-[#bfcaba]/40">
              <p className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">+ Add New Farm</p>
              <div className="grid grid-cols-3 gap-3">
                <input
                  value={farmName}
                  onChange={e => setFarmName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addFarm()}
                  placeholder="Farm name"
                  className={`${inputClass} col-span-2`}
                />
                <input
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addFarm()}
                  placeholder="Location"
                  className={inputClass}
                />
              </div>
              {saveMsg && (
                <p className={`mt-2 text-xs font-semibold ${saveMsg.ok ? 'text-[#0d631b]' : 'text-[#ba1a1a]'}`}>{saveMsg.text}</p>
              )}
              <button
                onClick={addFarm}
                disabled={saving}
                className="mt-3 gradient-primary text-white text-sm font-semibold px-5 py-2 rounded-xl shadow-fab hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? 'Adding…' : 'Add Farm'}
              </button>
            </div>
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            <Card accent="blue">
              <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Recent Activity</h2>
              <div className="space-y-2">
                {ACTIVITY.map((a, i) => (
                  <div key={i} className="bg-[#f3f3f3] rounded-lg p-3">
                    <p className="text-xs font-semibold text-[#1a1c1c]">{a.farm}</p>
                    <p className="text-[10px] text-[#40493d]">{a.event} · {a.time}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card accent="green">
              <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Firmware Status</h2>
              <div className="space-y-2 mb-4">
                {[
                  { model: 'KC868-A8v3', count: 12, version: 'v2.3.1', update: false },
                  { model: 'ALR-V13',    count: 12, version: 'v1.2.0', update: true  },
                ].map(d => (
                  <div key={d.model} className="bg-[#f3f3f3] rounded-lg p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs font-semibold text-[#1a1c1c]">{d.model}</p>
                        <p className="text-[10px] text-[#40493d]">{d.count} devices · {d.version}</p>
                      </div>
                      {d.update && (
                        <span className="text-[10px] bg-[#e65100]/10 text-[#e65100] font-semibold px-2 py-0.5 rounded-full">Update</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button className="w-full gradient-primary text-white text-xs font-semibold py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
                Push Firmware Update
              </button>
            </Card>
          </div>
        </div>
      )}

      {/* ── Devices Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'devices' && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-4">
            {/* Search + filter bar */}
            <div className="flex gap-3 items-center">
              <input
                value={deviceSearch}
                onChange={e => setDeviceSearch(e.target.value)}
                placeholder="Search farm, device ID or model…"
                className={`flex-1 ${inputClass}`}
              />
              <div className="flex gap-1">
                {['all', 'online', 'offline', 'fault'].map(s => (
                  <button
                    key={s}
                    onClick={() => setDeviceFilter(s)}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${
                      deviceFilter === s ? 'bg-[#1a1c1c] text-white' : 'bg-[#f3f3f3] text-[#40493d] hover:bg-[#e8e8e8]'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {devicesLoading && (
              <p className="text-sm text-[#40493d] font-body">Loading devices…</p>
            )}

            {!devicesLoading && (
              <div className="bg-[#ffffff] rounded-xl shadow-card overflow-hidden">
                <table className="w-full text-sm font-body">
                  <thead>
                    <tr className="bg-[#f3f3f3]">
                      {['Farm', 'Device ID', 'Model / Type', 'Firmware', 'Last Seen', 'Status'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-[#40493d] px-4 py-3 first:pl-5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDevices.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-sm text-[#40493d] text-center">
                          No devices match your search.
                        </td>
                      </tr>
                    )}
                    {filteredDevices.map((d, i) => (
                      <tr
                        key={d.id}
                        className={`hover:bg-[#f9f9f9] transition-colors ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}
                      >
                        <td className="px-5 py-3 font-semibold text-[#1a1c1c] text-xs">{d.farm_name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#40493d]">{d.device_id}</td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-semibold text-[#1a1c1c]">{d.model}</p>
                          <p className="text-[10px] text-[#40493d]">{d.type}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#40493d]">{d.firmware ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-[#40493d]">{fmtLastSeen(d.last_seen)}</td>
                        <td className="px-4 py-3">
                          <StatusChip
                            status={d.status ?? 'offline'}
                            label={(d.status ?? 'offline').toUpperCase()}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Devices sidebar */}
          <div className="space-y-4">
            <Card accent="blue">
              <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Device Summary</h2>
              <div className="space-y-2">
                {[
                  { label: 'Total Devices',  value: devices.length,                                        color: 'text-[#1a1c1c]' },
                  { label: 'Online',         value: devices.filter(d => d.status === 'online').length,   color: 'text-[#0d631b]' },
                  { label: 'Offline',        value: devices.filter(d => d.status === 'offline').length,  color: 'text-[#40493d]' },
                  { label: 'Warnings',       value: devices.filter(d => d.status === 'warning').length,  color: 'text-[#e65100]' },
                  { label: 'Faults',         value: devices.filter(d => d.status === 'fault').length,    color: 'text-[#ba1a1a]' },
                ].map(s => (
                  <div key={s.label} className="flex justify-between items-center bg-[#f3f3f3] rounded-lg px-3 py-2">
                    <span className="text-xs text-[#40493d]">{s.label}</span>
                    <span className={`text-sm font-bold ${s.color}`}>{s.value}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card accent="green">
              <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Tech Support</h2>
              <p className="text-[10px] text-[#40493d] mb-3 leading-relaxed">
                Use the device list to identify offline or faulted devices. Filter by status to quickly find issues across all customer farms.
              </p>
              <div className="space-y-2">
                <button
                  onClick={loadDevices}
                  className="w-full bg-[#f3f3f3] text-[#1a1c1c] text-xs font-semibold py-2.5 rounded-xl hover:bg-[#e8e8e8] transition-colors"
                >
                  Refresh Device List
                </button>
                <button className="w-full gradient-primary text-white text-xs font-semibold py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
                  Export Device Report
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

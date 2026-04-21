import { useState, useEffect, useCallback } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import VitalsStrip from '../components/VitalsStrip'
import { supabase } from '../lib/supabase'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { mqttPublish } from '../lib/mqttClient'
import { fmtRelative as fmtLastSeen, fmtEvent } from '../lib/format'

export default function AdminConsole() {
  const [activeTab, setActiveTab] = useState('farms')

  // ── Farms ────────────────────────────────────────────────────────────────
  const [farms, setFarms]         = useState([])
  const [farmsLoading, setFarmsLoading] = useState(true)
  const [farmForm, setFarmForm]   = useState({ name: '', location: '', contact_name: '', contact_email: '', contact_phone: '', notes: '' })
  const [editFarm, setEditFarm]   = useState(null) // farm object being edited
  const [saving, setSaving]       = useState(false)
  const [saveMsg, setSaveMsg]     = useState(null)
  const [expandedFarm, setExpandedFarm] = useState(null)

  const loadFarms = useCallback(async () => {
    setFarmsLoading(true)
    const { data, error } = await supabase
      .from('farms')
      .select('id, name, location, contact_name, contact_email, contact_phone, notes')
      .order('created_at')
    if (!error && data) setFarms(data)
    setFarmsLoading(false)
  }, [])

  useEffect(() => { loadFarms() }, [loadFarms])

  function farmFieldLabel(field) {
    return {
      name: 'Farm Name', location: 'Location', contact_name: 'Contact Name',
      contact_email: 'Contact Email', contact_phone: 'Contact Phone', notes: 'Notes',
    }[field] ?? field
  }

  async function saveFarm() {
    if (!farmForm.name.trim()) { setSaveMsg({ ok: false, text: 'Enter a farm name' }); return }
    setSaving(true); setSaveMsg(null)
    const payload = {
      name: farmForm.name.trim(),
      location: farmForm.location.trim() || null,
      contact_name: farmForm.contact_name.trim() || null,
      contact_email: farmForm.contact_email.trim() || null,
      contact_phone: farmForm.contact_phone.trim() || null,
      notes: farmForm.notes.trim() || null,
    }
    let error
    if (editFarm) {
      const res = await supabase.from('farms').update(payload).eq('id', editFarm.id)
      error = res.error
    } else {
      const res = await supabase.from('farms').insert(payload)
      error = res.error
    }
    if (error) {
      setSaveMsg({ ok: false, text: error.message })
    } else {
      setSaveMsg({ ok: true, text: editFarm ? 'Farm updated.' : 'Farm added.' })
      setFarmForm({ name: '', location: '', contact_name: '', contact_email: '', contact_phone: '', notes: '' })
      setEditFarm(null)
      loadFarms()
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(null), 4000)
  }

  function startEditFarm(f) {
    setEditFarm(f)
    setFarmForm({
      name: f.name ?? '',
      location: f.location ?? '',
      contact_name: f.contact_name ?? '',
      contact_email: f.contact_email ?? '',
      contact_phone: f.contact_phone ?? '',
      notes: f.notes ?? '',
    })
  }

  function cancelEdit() {
    setEditFarm(null)
    setFarmForm({ name: '', location: '', contact_name: '', contact_email: '', contact_phone: '', notes: '' })
  }

  async function deleteFarm(id) {
    if (!window.confirm('Remove this farm? This will also remove all linked devices.')) return
    await supabase.from('farms').delete().eq('id', id)
    loadFarms()
  }

  // ── Devices ──────────────────────────────────────────────────────────────
  const [devices, setDevices]           = useState([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [deviceSearch, setDeviceSearch] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('all')
  const [showAddDevice, setShowAddDevice] = useState(false)
  const [deviceForm, setDeviceForm]     = useState({ farm_id: '', device_id: '', model: '', type: '' })
  const [savingDevice, setSavingDevice] = useState(false)
  const [deviceMsg, setDeviceMsg]       = useState(null)
  const [editDevice, setEditDevice]     = useState(null)
  const [editDeviceForm, setEditDeviceForm] = useState({})

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true)
    const { data, error } = await supabase
      .from('farm_devices')
      .select('id, farm_id, device_id, model, type, firmware, last_seen, status, farms(name)')
      .order('farm_id')
    if (!error && data) {
      setDevices(data.map(d => ({ ...d, farm_name: d.farms?.name ?? '—' })))
    }
    setDevicesLoading(false)
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

  async function addDevice() {
    if (!deviceForm.device_id.trim()) { setDeviceMsg({ ok: false, text: 'Enter a device ID' }); return }
    setSavingDevice(true); setDeviceMsg(null)
    const { error } = await supabase.from('farm_devices').insert({
      farm_id: deviceForm.farm_id || null,
      device_id: deviceForm.device_id.trim(),
      model: deviceForm.model.trim() || null,
      type: deviceForm.type.trim() || null,
    })
    if (error) {
      setDeviceMsg({ ok: false, text: error.message })
    } else {
      setDeviceMsg({ ok: true, text: 'Device added.' })
      setDeviceForm({ farm_id: '', device_id: '', model: '', type: '' })
      setShowAddDevice(false)
      loadDevices()
    }
    setSavingDevice(false)
    setTimeout(() => setDeviceMsg(null), 4000)
  }

  async function saveDeviceEdit(id) {
    const { error } = await supabase.from('farm_devices').update({
      model: editDeviceForm.model ?? null,
      type: editDeviceForm.type ?? null,
      firmware: editDeviceForm.firmware ?? null,
      farm_id: editDeviceForm.farm_id || null,
    }).eq('id', id)
    if (!error) { setEditDevice(null); loadDevices() }
  }

  async function deleteDevice(id) {
    if (!window.confirm('Remove this device?')) return
    await supabase.from('farm_devices').delete().eq('id', id)
    loadDevices()
  }

  // ── Activity feed ────────────────────────────────────────────────────────
  const [activity, setActivity] = useState([])
  useEffect(() => {
    async function loadActivity() {
      const { data } = await supabase
        .from('zone_history')
        .select('device, zone_num, started_at, source')
        .order('started_at', { ascending: false })
        .limit(10)
      if (data) setActivity(data.map(fmtEvent))
    }
    loadActivity()
  }, [])

  // ── Firmware OTA ─────────────────────────────────────────────────────────
  const { data: mqttData } = useLiveTelemetry(['farm/irrigation1/status', 'farm/irrigation1/ota/status'])
  const irr    = mqttData['farm/irrigation1/status']
  const otaMsg = mqttData['farm/irrigation1/ota/status']

  const [otaState,  setOtaState]  = useState('idle')
  const [otaLatest, setOtaLatest] = useState(null)
  const [otaError,  setOtaError]  = useState(null)

  useEffect(() => {
    if (!otaMsg) return
    if (otaMsg.update_available === true)     { setOtaLatest(otaMsg.latest ?? null); setOtaState('update_available') }
    else if (otaMsg.update_available === false)   setOtaState('up_to_date')
    else if (otaMsg.status === 'done')            setOtaState('done')
    else if (otaMsg.status?.startsWith('error')) { setOtaState('error'); setOtaError(otaMsg.status) }
    else if (['downloading','flashing'].includes(otaMsg.status)) setOtaState('updating')
  }, [otaMsg])

  const checkFirmware   = () => { setOtaState('checking'); setOtaError(null); mqttPublish('farm/irrigation1/cmd/ota', { action: 'check' }) }
  const pushFirmware    = () => { setOtaState('updating');  setOtaError(null); mqttPublish('farm/irrigation1/cmd/ota', { action: 'update' }) }

  // ── Vitals ────────────────────────────────────────────────────────────────
  const onlineFarms = farms.filter(f => f.status === 'online').length
  const faultFarms  = farms.filter(f => f.status === 'fault').length
  const VITALS = [
    { label: 'Total Farms',  value: String(farms.length),   unit: '' },
    { label: 'Online Farms', value: String(onlineFarms),    unit: `/ ${farms.length}`, status: 'online', statusLabel: 'ONLINE' },
    { label: 'Total Devices', value: String(devices.length), unit: '' },
    { label: 'Active Faults', value: String(faultFarms),    unit: '', status: faultFarms > 0 ? 'fault' : 'online', statusLabel: faultFarms > 0 ? 'FAULT' : 'OK' },
  ]

  const inputClass = 'bg-[#f3f3f3] rounded-lg px-3 py-2.5 text-sm font-body text-[#1a1c1c] outline-none border border-transparent focus:border-[#0d631b]/40 focus:ring-2 focus:ring-[#0d631b]/10 focus:bg-white transition-all'

  return (
    <div className="flex-1 p-8 md:p-12 bg-[#f8faf9] overflow-auto min-h-screen">
      <div className="mb-8">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#717975] mb-2">Service Dashboard</p>
        <h1 className="text-4xl font-extrabold text-[#17362e] tracking-tight">Farm Management Console</h1>
        <p className="text-sm text-[#717975] mt-1">Sandy Soil Automations — all farms and devices</p>
      </div>

      <VitalsStrip vitals={VITALS} />

      <div className="inline-flex bg-[#f2f4f3] p-1 rounded-full mb-6">
        {[
          { id: 'farms',   label: 'Farms' },
          { id: 'devices', label: 'Customer Devices' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeTab === t.id ? 'bg-white shadow-sm text-[#17362e]' : 'text-[#717975] hover:text-[#17362e]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Farms Tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'farms' && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-4">
            {/* Farm table */}
            <div className="bg-white rounded-xl shadow-card overflow-hidden">
              <table className="w-full text-sm font-body">
                <thead>
                  <tr className="bg-[#f3f3f3]">
                    {['Farm', 'Location', 'Contact', 'Status', ''].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-[#40493d] px-4 py-3 first:pl-5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {farmsLoading && (
                    <tr><td colSpan={5} className="px-5 py-4 text-sm text-[#40493d]">Loading farms…</td></tr>
                  )}
                  {!farmsLoading && farms.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-6 text-sm text-[#40493d] text-center">No farms yet. Add one below.</td></tr>
                  )}
                  {farms.map((f, i) => (
                    <>
                      <tr
                        key={f.id}
                        className={`hover:bg-[#f9f9f9] transition-colors cursor-pointer ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}
                        onClick={() => setExpandedFarm(expandedFarm === f.id ? null : f.id)}
                      >
                        <td className="px-5 py-3 font-semibold text-[#1a1c1c]">{f.name}</td>
                        <td className="px-4 py-3 text-[#40493d] text-xs">{f.location ?? '—'}</td>
                        <td className="px-4 py-3 text-[#40493d] text-xs">
                          {f.contact_name ?? '—'}
                          {f.contact_email && <span className="block text-[10px]">{f.contact_email}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <StatusChip status={f.status ?? 'offline'} label={(f.status ?? 'offline').toUpperCase()} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={e => { e.stopPropagation(); startEditFarm(f) }} className="text-[#00639a] text-xs hover:underline">Edit</button>
                            <button onClick={e => { e.stopPropagation(); deleteFarm(f.id) }} className="text-[#ba1a1a] text-xs hover:underline">Remove</button>
                          </div>
                        </td>
                      </tr>
                      {expandedFarm === f.id && (
                        <tr key={`${f.id}-exp`} className="bg-[#f9f9f9]">
                          <td colSpan={5} className="px-5 py-3">
                            <div className="grid grid-cols-3 gap-4 text-xs text-[#40493d]">
                              <div><span className="font-semibold">Phone:</span> {f.contact_phone ?? '—'}</div>
                              <div><span className="font-semibold">Email:</span> {f.contact_email ?? '—'}</div>
                              <div><span className="font-semibold">Notes:</span> {f.notes ?? '—'}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add / Edit farm form */}
            <div className="bg-white rounded-xl shadow-card p-5 border-2 border-dashed border-[#bfcaba]/40">
              <p className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">
                {editFarm ? `✏️ Editing: ${editFarm.name}` : '+ Add New Farm'}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                {['name', 'location', 'contact_name', 'contact_email', 'contact_phone'].map(field => (
                  <input
                    key={field}
                    value={farmForm[field]}
                    onChange={e => setFarmForm(f => ({ ...f, [field]: e.target.value }))}
                    placeholder={farmFieldLabel(field)}
                    className={`${inputClass} ${field === 'name' ? 'col-span-2' : ''}`}
                  />
                ))}
                <textarea
                  value={farmForm.notes}
                  onChange={e => setFarmForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Notes (optional)"
                  rows={2}
                  className={`${inputClass} col-span-2 resize-none`}
                />
              </div>
              {saveMsg && (
                <p className={`mb-2 text-xs font-semibold ${saveMsg.ok ? 'text-[#0d631b]' : 'text-[#ba1a1a]'}`}>{saveMsg.text}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={saveFarm}
                  disabled={saving}
                  className="gradient-primary text-white text-sm font-semibold px-5 py-2 rounded-xl shadow-fab hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {saving ? 'Saving…' : editFarm ? 'Save Changes' : 'Add Farm'}
                </button>
                {editFarm && (
                  <button onClick={cancelEdit} className="text-[#40493d] text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#f3f3f3] transition-colors">
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            <Card accent="blue">
              <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Recent Activity</h2>
              <div className="space-y-2">
                {activity.length === 0 && (
                  <p className="text-xs text-[#40493d]">No recent activity.</p>
                )}
                {activity.map((a, i) => (
                  <div key={i} className="bg-[#f3f3f3] rounded-lg p-3">
                    <p className="text-xs font-semibold text-[#1a1c1c]">{a.text}</p>
                    <p className="text-[10px] text-[#40493d]">{a.time}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card accent="green">
              <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Firmware Status</h2>
              <div className="bg-[#f3f3f3] rounded-lg p-3 mb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-semibold text-[#1a1c1c]">Irrigation Controller</p>
                    <p className="text-[10px] text-[#40493d] mt-0.5">
                      Current: <span className="font-semibold">{irr?.fw ? `v${irr.fw}` : '—'}</span>
                      {otaLatest && <span className="ml-1">→ v{otaLatest} available</span>}
                    </p>
                    <p className="text-[10px] text-[#40493d]">
                      Device: <span className={irr?.online ? 'text-[#0d631b] font-semibold' : 'text-[#ba1a1a] font-semibold'}>
                        {irr?.online ? 'Online' : irr ? 'Offline' : '—'}
                      </span>
                    </p>
                  </div>
                  {otaState === 'update_available' && <span className="text-[10px] bg-[#e65100]/10 text-[#e65100] font-semibold px-2 py-0.5 rounded-full">Update</span>}
                  {otaState === 'up_to_date'       && <span className="text-[10px] bg-[#0d631b]/10  text-[#0d631b] font-semibold px-2 py-0.5 rounded-full">Up to date</span>}
                  {otaState === 'done'              && <span className="text-[10px] bg-[#0d631b]/10  text-[#0d631b] font-semibold px-2 py-0.5 rounded-full">Updated ✓</span>}
                  {otaState === 'updating'          && <span className="text-[10px] bg-[#00639a]/10  text-[#00639a] font-semibold px-2 py-0.5 rounded-full">{otaMsg?.status === 'flashing' ? 'Flashing…' : 'Downloading…'}</span>}
                </div>
                {otaState === 'error' && <p className="text-[10px] text-[#ba1a1a] mt-1">{otaError}</p>}
              </div>
              <div className="space-y-2">
                <button onClick={checkFirmware} disabled={otaState === 'checking' || otaState === 'updating' || !irr?.online} className="w-full bg-[#f3f3f3] text-[#1a1c1c] text-xs font-semibold py-2 rounded-xl hover:bg-[#e8e8e8] disabled:opacity-40 transition-colors">
                  {otaState === 'checking' ? 'Checking…' : 'Check for Update'}
                </button>
                <button onClick={pushFirmware} disabled={otaState === 'updating' || otaState === 'checking' || !irr?.online} className="w-full gradient-primary text-white text-xs font-semibold py-2.5 rounded-xl shadow-fab hover:opacity-90 disabled:opacity-40 transition-opacity">
                  {otaState === 'updating' ? 'Updating…' : 'Push Firmware Update'}
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── Devices Tab ──────────────────────────────────────────────────────── */}
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
              <button
                onClick={() => setShowAddDevice(s => !s)}
                className="px-4 py-2 rounded-lg text-xs font-semibold gradient-primary text-white shadow-fab hover:opacity-90 transition-opacity"
              >
                + Add Device
              </button>
            </div>

            {/* Add device form */}
            {showAddDevice && (
              <div className="bg-white rounded-xl shadow-card p-4 border-2 border-dashed border-[#0d631b]/30">
                <p className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Add New Device</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <select
                    value={deviceForm.farm_id}
                    onChange={e => setDeviceForm(f => ({ ...f, farm_id: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Select Farm (optional)</option>
                    {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  <input value={deviceForm.device_id} onChange={e => setDeviceForm(f => ({ ...f, device_id: e.target.value }))} placeholder="Device ID / Serial *" className={inputClass} />
                  <input value={deviceForm.model} onChange={e => setDeviceForm(f => ({ ...f, model: e.target.value }))} placeholder="Model (e.g. KC868-A6v3)" className={inputClass} />
                  <input value={deviceForm.type}  onChange={e => setDeviceForm(f => ({ ...f, type: e.target.value }))}  placeholder="Type (e.g. Relay Controller)" className={inputClass} />
                </div>
                {deviceMsg && <p className={`mb-2 text-xs font-semibold ${deviceMsg.ok ? 'text-[#0d631b]' : 'text-[#ba1a1a]'}`}>{deviceMsg.text}</p>}
                <div className="flex gap-2">
                  <button onClick={addDevice} disabled={savingDevice} className="gradient-primary text-white text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
                    {savingDevice ? 'Adding…' : 'Add Device'}
                  </button>
                  <button onClick={() => setShowAddDevice(false)} className="text-[#40493d] text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#f3f3f3] transition-colors">Cancel</button>
                </div>
              </div>
            )}

            {devicesLoading ? (
              <p className="text-sm text-[#40493d] font-body">Loading devices…</p>
            ) : (
              <div className="bg-white rounded-xl shadow-card overflow-hidden">
                <table className="w-full text-sm font-body">
                  <thead>
                    <tr className="bg-[#f3f3f3]">
                      {['Farm', 'Device ID', 'Model / Type', 'Firmware', 'Last Seen', 'Status', ''].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-[#40493d] px-4 py-3 first:pl-5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDevices.length === 0 && (
                      <tr><td colSpan={7} className="px-5 py-8 text-sm text-[#40493d] text-center">No devices match your search.</td></tr>
                    )}
                    {filteredDevices.map((d, i) => (
                      editDevice === d.id ? (
                        <tr key={d.id} className="bg-[#f9faf9]">
                          <td className="px-4 py-2">
                            <select value={editDeviceForm.farm_id ?? ''} onChange={e => setEditDeviceForm(f => ({ ...f, farm_id: e.target.value }))} className="bg-[#f3f3f3] rounded px-2 py-1 text-xs w-full">
                              <option value="">No farm</option>
                              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                          </td>
                          <td className="px-4 py-2 text-xs text-[#40493d] font-mono">{d.device_id}</td>
                          <td className="px-4 py-2">
                            <input value={editDeviceForm.model ?? ''} onChange={e => setEditDeviceForm(f => ({ ...f, model: e.target.value }))} className="bg-[#f3f3f3] rounded px-2 py-1 text-xs w-full mb-1" placeholder="Model" />
                            <input value={editDeviceForm.type ?? ''} onChange={e => setEditDeviceForm(f => ({ ...f, type: e.target.value }))} className="bg-[#f3f3f3] rounded px-2 py-1 text-xs w-full" placeholder="Type" />
                          </td>
                          <td className="px-4 py-2">
                            <input value={editDeviceForm.firmware ?? ''} onChange={e => setEditDeviceForm(f => ({ ...f, firmware: e.target.value }))} className="bg-[#f3f3f3] rounded px-2 py-1 text-xs w-full" placeholder="Firmware" />
                          </td>
                          <td className="px-4 py-2 text-xs text-[#40493d]">{fmtLastSeen(d.last_seen)}</td>
                          <td className="px-4 py-2"><StatusChip status={d.status ?? 'offline'} label={(d.status ?? 'offline').toUpperCase()} /></td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1">
                              <button onClick={() => saveDeviceEdit(d.id)} className="text-[#0d631b] text-xs font-semibold hover:underline">Save</button>
                              <button onClick={() => setEditDevice(null)} className="text-[#40493d] text-xs hover:underline">✕</button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={d.id} className={`hover:bg-[#f9f9f9] transition-colors ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}>
                          <td className="px-5 py-3 font-semibold text-[#1a1c1c] text-xs">{d.farm_name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-[#40493d]">{d.device_id}</td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-semibold text-[#1a1c1c]">{d.model ?? '—'}</p>
                            <p className="text-[10px] text-[#40493d]">{d.type ?? '—'}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-[#40493d]">{d.firmware ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-[#40493d]">{fmtLastSeen(d.last_seen)}</td>
                          <td className="px-4 py-3"><StatusChip status={d.status ?? 'offline'} label={(d.status ?? 'offline').toUpperCase()} /></td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button onClick={() => { setEditDevice(d.id); setEditDeviceForm({ model: d.model ?? '', type: d.type ?? '', firmware: d.firmware ?? '', farm_id: d.farm_id ?? '' }) }} className="text-[#00639a] text-xs hover:underline">Edit</button>
                              <button onClick={() => deleteDevice(d.id)} className="text-[#ba1a1a] text-xs hover:underline">Remove</button>
                            </div>
                          </td>
                        </tr>
                      )
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
                  { label: 'Total Devices', value: devices.length,                                       color: 'text-[#1a1c1c]' },
                  { label: 'Online',        value: devices.filter(d => d.status === 'online').length,   color: 'text-[#0d631b]' },
                  { label: 'Offline',       value: devices.filter(d => d.status === 'offline').length,  color: 'text-[#40493d]' },
                  { label: 'Warnings',      value: devices.filter(d => d.status === 'warning').length,  color: 'text-[#e65100]' },
                  { label: 'Faults',        value: devices.filter(d => d.status === 'fault').length,    color: 'text-[#ba1a1a]' },
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
                Use the device list to identify offline or faulted devices. Filter by status to quickly find issues.
              </p>
              <button
                onClick={loadDevices}
                className="w-full bg-[#f3f3f3] text-[#1a1c1c] text-xs font-semibold py-2.5 rounded-xl hover:bg-[#e8e8e8] transition-colors"
              >
                Refresh Device List
              </button>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

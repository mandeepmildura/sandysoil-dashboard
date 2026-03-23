import { useState, useEffect, useCallback } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import VitalsStrip from '../components/VitalsStrip'
import { supabase } from '../lib/supabase'
import { useFirmware } from '../hooks/useFirmware'
import { otaUpdate } from '../lib/commands'

const ACTIVITY = [
  { farm: 'Mildura Block A',   event: 'Zone 3 started',         time: '2 min ago' },
  { farm: 'Sunraysia North',   event: 'Morning run completed',  time: '8 min ago' },
  { farm: 'Red Cliffs Station',event: 'High pressure warning',  time: '1h ago'    },
  { farm: 'Euston Almonds',    event: 'Device offline',         time: '3h ago'    },
  { farm: 'Robinvale Citrus',  event: 'Backwash complete',      time: '4h ago'    },
]

export default function AdminConsole() {
  const [farms, setFarms]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [farmName, setFarmName] = useState('')
  const [location, setLocation] = useState('')
  const [saving, setSaving]     = useState(false)
  const [saveMsg, setSaveMsg]   = useState(null)

  const { byModel, loading: fwLoading, reload: reloadFw } = useFirmware()
  const [otaBusy,  setOtaBusy]  = useState({})
  const [otaMsg,   setOtaMsg]   = useState(null)

  const loadFarms = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('farms').select('*').order('created_at')
    if (!error && data) setFarms(data)
    setLoading(false)
  }, [])

  useEffect(() => { loadFarms() }, [loadFarms])

  async function addFarm() {
    if (!farmName.trim()) { setSaveMsg({ ok: false, text: 'Enter a farm name' }); return }
    setSaving(true)
    setSaveMsg(null)
    const { error } = await supabase.from('farms').insert({
      name: farmName.trim(),
      location: location.trim() || null,
    })
    if (error) {
      setSaveMsg({ ok: false, text: error.message ?? 'Save failed' })
    } else {
      setFarmName('')
      setLocation('')
      setSaveMsg({ ok: true, text: 'Farm added.' })
      loadFarms()
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(null), 4000)
  }

  async function deleteFarm(id) {
    if (!window.confirm('Remove this farm?')) return
    await supabase.from('farms').delete().eq('id', id)
    loadFarms()
  }

  async function pushOta(model, url, version) {
    if (!window.confirm(`Push firmware ${version} to all ${model} devices?`)) return
    setOtaBusy(b => ({ ...b, [model]: true }))
    setOtaMsg(null)
    try {
      await otaUpdate(model, url, version)
      setOtaMsg({ ok: true, text: `OTA queued for ${model} → ${version}` })
      reloadFw()
    } catch (e) {
      setOtaMsg({ ok: false, text: e.message ?? 'OTA failed' })
    }
    setOtaBusy(b => ({ ...b, [model]: false }))
    setTimeout(() => setOtaMsg(null), 5000)
  }

  const onlineFarms = farms.filter(f => f.status === 'online').length
  const faultFarms  = farms.filter(f => f.status === 'fault').length

  const VITALS = [
    { label: 'Total Farms',       value: String(farms.length), unit: '' },
    { label: 'Online Farms',      value: String(onlineFarms),  unit: `/ ${farms.length}`, status: 'online',  statusLabel: 'ONLINE' },
    { label: 'Active Irrigation', value: '—',  unit: '',      status: 'running', statusLabel: 'RUNNING' },
    { label: 'Active Faults',     value: String(faultFarms),   unit: '',      status: faultFarms > 0 ? 'fault' : 'online', statusLabel: faultFarms > 0 ? 'FAULT' : 'OK' },
  ]

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Farm Management Console</h1>
        <p className="text-sm text-[#40493d] font-body mt-1">Sandy Soil Automations — Service Dashboard</p>
      </div>

      <VitalsStrip vitals={VITALS} />

      <div className="grid grid-cols-3 gap-6">
        {/* Farm table */}
        <div className="col-span-2">
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
                      <button onClick={() => deleteFarm(f.id)}
                        className="text-[#ba1a1a] text-xs hover:underline">Remove</button>
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
                value={farmName} onChange={e => setFarmName(e.target.value)}
                placeholder="Farm name"
                className="bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none col-span-2"
              />
              <input
                value={location} onChange={e => setLocation(e.target.value)}
                placeholder="Location"
                className="bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none"
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
            {fwLoading ? (
              <p className="text-xs text-[#40493d] mb-4">Loading…</p>
            ) : byModel.length === 0 ? (
              <p className="text-xs text-[#40493d] mb-4">No devices registered.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {byModel.map(d => (
                  <div key={d.model} className="bg-[#f3f3f3] rounded-lg p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs font-semibold text-[#1a1c1c]">{d.model}</p>
                        <p className="text-[10px] text-[#40493d]">
                          {d.count} device{d.count !== 1 ? 's' : ''} · {d.current_version}
                          {d.updateCount > 0 && ` (${d.updateCount} outdated)`}
                        </p>
                        {d.updateCount > 0 && (
                          <p className="text-[10px] text-[#0d631b] mt-0.5">Latest: {d.latest_version}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {d.updateCount > 0 && (
                          <span className="text-[10px] bg-[#e65100]/10 text-[#e65100] font-semibold px-2 py-0.5 rounded-full">
                            Update available
                          </span>
                        )}
                        {d.updateCount > 0 && d.url && (
                          <button
                            onClick={() => pushOta(d.model, d.url, d.latest_version)}
                            disabled={!!otaBusy[d.model]}
                            className="text-[10px] bg-[#1a1c1c] text-white font-semibold px-2 py-0.5 rounded-full hover:opacity-80 disabled:opacity-40 transition-opacity"
                          >
                            {otaBusy[d.model] ? 'Queuing…' : 'Push OTA'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {otaMsg && (
              <p className={`text-xs font-semibold mb-2 ${otaMsg.ok ? 'text-[#0d631b]' : 'text-[#ba1a1a]'}`}>
                {otaMsg.text}
              </p>
            )}
            <button
              onClick={() => byModel.filter(d => d.updateCount > 0 && d.url).forEach(d => pushOta(d.model, d.url, d.latest_version))}
              disabled={byModel.every(d => d.updateCount === 0) || Object.values(otaBusy).some(Boolean)}
              className="w-full gradient-primary text-white text-xs font-semibold py-2.5 rounded-xl shadow-fab hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              Push All Pending Updates
            </button>
          </Card>
        </div>
      </div>
    </div>
  )
}

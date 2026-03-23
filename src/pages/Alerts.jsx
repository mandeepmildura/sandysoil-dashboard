import { useState } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useAlerts } from '../hooks/useAlerts'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'

// Static demo alerts shown when DB table is empty or unavailable
const DEMO_ALERTS = [
  { id: 1, severity: 'fault',   title: 'High Pressure Alert',        device: 'Irrigation Controller', created_at: new Date().toISOString(), description: 'Supply PSI exceeded 65 PSI. Zone 3 was active.',  acknowledged: false },
  { id: 2, severity: 'fault',   title: 'Filter Fault',               device: 'Filter Station',        created_at: new Date().toISOString(), description: 'Backwash cycle failed to complete. Manual reset required.', acknowledged: false },
  { id: 3, severity: 'warning', title: 'Zone 3 Runtime Exceeded',    device: 'Irrigation Controller', created_at: new Date().toISOString(), description: 'Zone ran 45 min over scheduled time.',            acknowledged: false },
]

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now - d) / 60000)
  if (diffMin < 2)   return 'Just now'
  if (diffMin < 60)  return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)    return `${diffH}h ago`
  return d.toLocaleDateString()
}

export default function Alerts() {
  const { alerts: dbAlerts, loading, acknowledge, dismiss } = useAlerts()
  const { data: live } = useLiveTelemetry(['farm/irrigation1/status', 'farm/filter1/pressure'])

  // Use DB alerts if loaded and non-empty, otherwise show demo
  const source = (!loading && dbAlerts.length > 0) ? dbAlerts : (loading ? [] : DEMO_ALERTS)
  const [localAlerts, setLocalAlerts] = useState(null) // null = use source
  const alerts = localAlerts ?? source

  // Sync localAlerts when source changes (fresh load)
  const [prevSource, setPrevSource] = useState(null)
  if (prevSource !== source) {
    setPrevSource(source)
    setLocalAlerts(null)
  }

  const [tab, setTab] = useState('All')
  const tabs = ['All', 'Critical', 'Warnings', 'Resolved']

  const filtered = alerts.filter(a => {
    if (tab === 'All')      return true
    if (tab === 'Critical') return a.severity === 'fault'  && !a.acknowledged
    if (tab === 'Warnings') return a.severity === 'warning' && !a.acknowledged
    if (tab === 'Resolved') return !!a.acknowledged
    return true
  })

  const irr   = live['farm/irrigation1/status']  ?? null
  const press = live['farm/filter1/pressure']     ?? null

  const DEVICES = [
    { name: 'Irrigation Controller', model: 'KC868-A8v3', fw: irr?.fw ?? '—', status: irr?.online ? 'online' : 'offline' },
    { name: 'Filter Station',        model: 'ALR-V13',    fw: '—',             status: press ? 'online' : 'offline' },
  ]

  async function handleAcknowledge(alert) {
    if (dbAlerts.find(a => a.id === alert.id)) {
      await acknowledge(alert.id)
    } else {
      // Demo mode — just update local state
      setLocalAlerts(prev => (prev ?? alerts).map(a => a.id === alert.id ? { ...a, acknowledged: true } : a))
    }
  }

  async function handleDismiss(alert) {
    if (dbAlerts.find(a => a.id === alert.id)) {
      await dismiss(alert.id)
    } else {
      // Demo mode
      setLocalAlerts(prev => (prev ?? alerts).filter(a => a.id !== alert.id))
    }
  }

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <h1 className="font-headline font-bold text-2xl text-[#1a1c1c] mb-5">Alerts & Notifications</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-5">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-body font-medium transition-colors ${
              tab === t ? 'bg-[#1a1c1c] text-white' : 'text-[#40493d] hover:bg-[#f3f3f3]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Alert list */}
        <div className="col-span-2 space-y-3">
          {loading && <p className="text-sm text-[#40493d]">Loading alerts…</p>}

          {filtered.map(a => (
            <div key={a.id} className="bg-[#ffffff] rounded-xl shadow-card overflow-hidden flex">
              {/* Accent bar */}
              <div className={`w-1 shrink-0 ${
                a.severity === 'fault'   ? 'bg-[#ba1a1a]' :
                a.severity === 'warning' ? 'bg-[#e65100]' :
                'bg-[#0d631b]'
              }`} />
              <div className="flex-1 p-4">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <p className="font-headline font-semibold text-[#1a1c1c] text-sm">{a.title}</p>
                    <StatusChip
                      status={a.acknowledged ? 'completed' : a.severity}
                      label={a.acknowledged ? 'RESOLVED' : a.severity?.toUpperCase()}
                    />
                  </div>
                  <span className="text-[10px] text-[#40493d] shrink-0 ml-4">{fmtTime(a.created_at)}</span>
                </div>
                <p className="text-xs text-[#40493d] mb-1">{a.device ?? a.device_id}</p>
                <p className="text-xs text-[#1a1c1c]">{a.description ?? a.message}</p>
                {!a.acknowledged && (
                  <div className="flex gap-3 mt-3">
                    <button
                      onClick={() => handleAcknowledge(a)}
                      className="bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#e8e8e8] transition-colors"
                    >
                      Acknowledge
                    </button>
                    <button
                      onClick={() => handleDismiss(a)}
                      className="text-[#ba1a1a] text-xs font-semibold hover:underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {a.acknowledged && (
                  <button
                    onClick={() => handleDismiss(a)}
                    className="mt-2 text-[#40493d] text-xs hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-[#40493d] font-body text-center py-10">No alerts in this category.</p>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <Card accent="green">
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">System Health</h2>
            <div className="space-y-3">
              {DEVICES.map(d => (
                <div key={d.name} className="bg-[#f3f3f3] rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-xs font-semibold text-[#1a1c1c]">{d.name}</p>
                      <p className="text-[10px] text-[#40493d]">{d.model} · {d.fw}</p>
                    </div>
                    <StatusChip status={d.status} label={d.status.toUpperCase()} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">Notification Settings</h2>
            <div className="space-y-3">
              {[
                { label: 'Email — Critical alerts', on: true },
                { label: 'Email — Warnings',        on: true },
                { label: 'SMS — Critical alerts',   on: false },
                { label: 'Push notifications',      on: true },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-xs font-body text-[#40493d]">{s.label}</span>
                  <div className={`relative w-8 h-4 rounded-full transition-colors ${s.on ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${s.on ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

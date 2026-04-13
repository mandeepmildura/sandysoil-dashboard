import { useState, useEffect } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { useAlerts } from '../hooks/useAlerts'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now - d) / 60000)
  if (diffMin < 2)  return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `${diffH}h ago`
  return d.toLocaleDateString()
}

export default function Alerts() {
  const { alerts: dbAlerts, loading, acknowledge, dismiss } = useAlerts()
  const { data: live } = useLiveTelemetry([
    'farm/irrigation1/status',
    'A6v3/8CBFEA03002C/STATE',
    'B16M/CCBA97071FD8/STATE',
  ])

  const [localAlerts, setLocalAlerts] = useState([])
  const [usingDB, setUsingDB]         = useState(false)
  const [tab, setTab]                 = useState('All')

  // Once DB load completes, switch to DB data
  useEffect(() => {
    if (!loading) {
      setLocalAlerts(dbAlerts)
      setUsingDB(true)
    }
  }, [loading, dbAlerts])

  const tabs = ['All', 'Critical', 'Warnings', 'Info', 'Resolved']

  const filtered = localAlerts.filter(a => {
    if (tab === 'All')      return !a.acknowledged
    if (tab === 'Critical') return a.severity === 'fault'   && !a.acknowledged
    if (tab === 'Warnings') return a.severity === 'warning' && !a.acknowledged
    if (tab === 'Info')     return a.severity === 'info'    && !a.acknowledged
    if (tab === 'Resolved') return !!a.acknowledged
    return true
  })

  const irr  = live['farm/irrigation1/status']  ?? null
  const a6v3 = live['A6v3/8CBFEA03002C/STATE']  ?? null
  const b16m = live['B16M/CCBA97071FD8/STATE']   ?? null

  const DEVICES = [
    { name: 'Irrigation Controller', model: '8-zone ESP32',   fw: irr?.fw  ?? '—', status: irr  ? 'online' : 'offline' },
    { name: 'A6v3 Relay / Pressure', model: 'KC868-A6v3',     fw: '—',             status: a6v3 ? 'online' : 'offline' },
    { name: 'B16M MOSFET Board',     model: 'KinCony B16M',   fw: '—',             status: b16m ? 'online' : 'offline' },
  ]

  async function handleAcknowledge(alert) {
    if (usingDB) {
      await acknowledge(alert.id)
    }
    setLocalAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, acknowledged: true } : a))
  }

  async function handleDismiss(alert) {
    if (usingDB) {
      await dismiss(alert.id)
    }
    setLocalAlerts(prev => prev.filter(a => a.id !== alert.id))
  }

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <h1 className="font-headline font-bold text-2xl text-[#1a1c1c] mb-5">Alerts & Notifications</h1>

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
        <div className="col-span-2 space-y-3">
          {loading && <p className="text-sm text-[#40493d]">Loading alerts…</p>}

          {filtered.map(a => (
            <div key={a.id} className="bg-[#ffffff] rounded-xl shadow-card overflow-hidden flex">
              <div className={`w-1 shrink-0 ${
                a.severity === 'fault'   ? 'bg-[#ba1a1a]' :
                a.severity === 'warning' ? 'bg-[#e65100]' :
                a.severity === 'info'    ? 'bg-[#1565c0]' :
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
                { label: 'Email — Critical alerts', on: true  },
                { label: 'Email — Warnings',        on: true  },
                { label: 'SMS — Critical alerts',   on: false },
                { label: 'Push notifications',      on: true  },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-xs font-body text-[#40493d]">{s.label}</span>
                  <div className={`relative w-8 h-4 rounded-full ${s.on ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}>
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

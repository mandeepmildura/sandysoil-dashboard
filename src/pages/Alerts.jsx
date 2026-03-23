import { useState } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'

const ALL_ALERTS = [
  { id: 1, severity: 'fault',   title: 'High Pressure Alert',        device: 'Irrigation Controller', time: '14:32 today',    desc: 'Supply PSI exceeded 65 PSI. Zone 3 was active.',  resolved: false },
  { id: 2, severity: 'fault',   title: 'Filter Fault',               device: 'Filter Station',        time: '12:15 today',    desc: 'Backwash cycle failed to complete. Manual reset required.', resolved: false },
  { id: 3, severity: 'warning', title: 'Zone 3 Runtime Exceeded',    device: 'Irrigation Controller', time: '10:00 today',    desc: 'Zone ran 45 min over scheduled time.',            resolved: false },
  { id: 4, severity: 'warning', title: 'Device Offline',             device: 'Irrigation Controller', time: '2h ago',         desc: 'Device last seen 2 hours ago. Check connectivity.', resolved: false },
  { id: 5, severity: 'online',  title: 'Backwash Complete',          device: 'Filter Station',        time: 'Yesterday 09:00',desc: 'Backwash cycle completed successfully.',           resolved: true },
  { id: 6, severity: 'online',  title: 'OTA Update Applied',         device: 'Irrigation Controller', time: '2 days ago',     desc: 'Firmware updated to v2.3.1 successfully.',         resolved: true },
]

const DEVICES = [
  { name: 'Irrigation Controller', model: 'KC868-A8v3', fw: 'v2.3.1', status: 'online'  },
  { name: 'Filter Station',        model: 'ALR-V13',    fw: 'v1.2.0', status: 'warning' },
]

const accentFor = s => ({ fault: 'red', warning: 'amber', online: 'green', upcoming: 'blue' }[s] ?? undefined)

export default function Alerts() {
  const [tab, setTab] = useState('All')
  const tabs = ['All', 'Critical', 'Warnings', 'Resolved']

  const filtered = ALL_ALERTS.filter(a => {
    if (tab === 'All')      return true
    if (tab === 'Critical') return a.severity === 'fault' && !a.resolved
    if (tab === 'Warnings') return a.severity === 'warning' && !a.resolved
    if (tab === 'Resolved') return a.resolved
    return true
  })

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
          {filtered.map(a => (
            <div key={a.id} className={`bg-[#ffffff] rounded-xl shadow-card overflow-hidden flex`}>
              {/* Accent bar */}
              <div className={`w-1 shrink-0 ${
                a.severity === 'fault' ? 'bg-[#ba1a1a]' :
                a.severity === 'warning' ? 'bg-[#e65100]' :
                'bg-[#0d631b]'
              }`} />
              <div className="flex-1 p-4">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <p className="font-headline font-semibold text-[#1a1c1c] text-sm">{a.title}</p>
                    <StatusChip status={a.resolved ? 'completed' : a.severity} label={a.resolved ? 'RESOLVED' : a.severity.toUpperCase()} />
                  </div>
                  <span className="text-[10px] text-[#40493d] shrink-0 ml-4">{a.time}</span>
                </div>
                <p className="text-xs text-[#40493d] mb-1">{a.device}</p>
                <p className="text-xs text-[#1a1c1c]">{a.desc}</p>
                {!a.resolved && (
                  <div className="flex gap-3 mt-3">
                    <button className="bg-[#e2e2e2] text-[#1a1c1c] text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#e8e8e8] transition-colors">
                      Acknowledge
                    </button>
                    <button className="text-[#00639a] text-xs font-semibold hover:underline">
                      View Device
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
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

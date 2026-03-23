import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import VitalsStrip from '../components/VitalsStrip'

const FARMS = [
  { id: 1, name: 'Mildura Block A',   location: 'Mildura, VIC',      devices: 2, status: 'online',  lastActivity: '2 min ago',   supply: '47.3', inlet: '52.1' },
  { id: 2, name: 'Sunraysia North',   location: 'Irymple, VIC',      devices: 2, status: 'online',  lastActivity: '5 min ago',   supply: '43.8', inlet: '48.2' },
  { id: 3, name: 'Red Cliffs Station',location: 'Red Cliffs, VIC',   devices: 2, status: 'warning', lastActivity: '1h ago',      supply: '38.1', inlet: '41.0' },
  { id: 4, name: 'Coomealla Fruit',   location: 'Coomealla, NSW',    devices: 1, status: 'online',  lastActivity: '12 min ago',  supply: '50.2', inlet: null   },
  { id: 5, name: 'Euston Almonds',    location: 'Euston, NSW',       devices: 2, status: 'fault',   lastActivity: '3h ago',      supply: null,   inlet: null   },
  { id: 6, name: 'Robinvale Citrus',  location: 'Robinvale, VIC',    devices: 2, status: 'online',  lastActivity: '8 min ago',   supply: '44.6', inlet: '49.1' },
]

const ACTIVITY = [
  { farm: 'Mildura Block A',   event: 'Zone 3 started',         time: '2 min ago' },
  { farm: 'Sunraysia North',   event: 'Morning run completed',  time: '8 min ago' },
  { farm: 'Red Cliffs Station',event: 'High pressure warning',  time: '1h ago'    },
  { farm: 'Euston Almonds',    event: 'Device offline',         time: '3h ago'    },
  { farm: 'Robinvale Citrus',  event: 'Backwash complete',      time: '4h ago'    },
]

const VITALS = [
  { label: 'Total Farms',       value: '12', unit: '' },
  { label: 'Online Devices',    value: '23', unit: '/ 24', status: 'online',  statusLabel: 'ONLINE' },
  { label: 'Active Irrigation', value: '4',  unit: 'farms', status: 'running', statusLabel: 'RUNNING' },
  { label: 'Active Faults',     value: '2',  unit: '',      status: 'fault',   statusLabel: 'FAULT' },
]

export default function AdminConsole() {
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
                  {['Farm', 'Location', 'Devices', 'Status', 'Last Active', 'Supply', 'Inlet', ''].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-[#40493d] px-4 py-3 first:pl-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FARMS.map((f, i) => (
                  <tr key={f.id} className={`hover:bg-[#f9f9f9] transition-colors cursor-pointer ${i % 2 !== 0 ? 'bg-[#f3f3f3]/40' : ''}`}>
                    <td className="px-5 py-3 font-semibold text-[#1a1c1c]">{f.name}</td>
                    <td className="px-4 py-3 text-[#40493d] text-xs">{f.location}</td>
                    <td className="px-4 py-3 text-[#1a1c1c] font-semibold">{f.devices}</td>
                    <td className="px-4 py-3"><StatusChip status={f.status} /></td>
                    <td className="px-4 py-3 text-[#40493d] text-xs">{f.lastActivity}</td>
                    <td className="px-4 py-3 font-body font-semibold text-[#1a1c1c] tracking-data">{f.supply ? `${f.supply} PSI` : '—'}</td>
                    <td className="px-4 py-3 font-body font-semibold text-[#1a1c1c] tracking-data">{f.inlet ? `${f.inlet} PSI` : '—'}</td>
                    <td className="px-4 py-3 text-[#00639a] text-xs hover:underline">View</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add farm card */}
          <div className="mt-4 bg-[#ffffff] rounded-xl shadow-card p-5 border-2 border-dashed border-[#bfcaba]/40">
            <p className="font-headline font-semibold text-sm text-[#1a1c1c] mb-3">+ Add New Farm</p>
            <div className="grid grid-cols-3 gap-3">
              <input placeholder="Farm name"  className="bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none col-span-2" />
              <input placeholder="Location"   className="bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none" />
            </div>
            <button className="mt-3 gradient-primary text-white text-sm font-semibold px-5 py-2 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
              Add Farm
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
    </div>
  )
}

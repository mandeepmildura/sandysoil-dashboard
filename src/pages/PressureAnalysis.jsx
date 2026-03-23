import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import Card from '../components/Card'
import VitalsStrip from '../components/VitalsStrip'
import StatusChip from '../components/StatusChip'

const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
const data = hours.map((time, i) => ({
  time,
  supply: 44 + Math.sin(i / 3) * 6 + Math.random() * 2,
  inlet:  48 + Math.sin(i / 3 + 0.5) * 5 + Math.random() * 2,
  outlet: 45 + Math.sin(i / 3 + 0.3) * 5 + Math.random() * 2,
}))

const VITALS = [
  { label: 'Supply PSI',    value: '47.3', unit: 'PSI' },
  { label: 'Inlet PSI',     value: '52.1', unit: 'PSI' },
  { label: 'Outlet PSI',    value: '48.6', unit: 'PSI' },
  { label: 'Pressure Drop', value: '3.5',  unit: 'PSI' },
]

const EVENTS = [
  { time: '06:30', event: 'Backwash triggered',    status: 'upcoming' },
  { time: '08:15', event: 'High pressure alert',   status: 'fault' },
  { time: '12:00', event: 'Manual backwash reset', status: 'completed' },
  { time: '14:32', event: 'PSI spike — 65 PSI',    status: 'warning' },
]

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl p-3 shadow-card text-xs font-body">
      <p className="font-semibold text-[#1a1c1c] mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value.toFixed(1)} PSI</p>
      ))}
    </div>
  )
}

export default function PressureAnalysis() {
  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <h1 className="font-headline font-bold text-2xl text-[#1a1c1c] mb-6">Pressure Analysis</h1>

      <VitalsStrip vitals={VITALS} />

      {/* 24h chart */}
      <Card accent="blue" className="mb-6">
        <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">24-Hour Pressure History</h2>
        <div className="bg-[#f3f3f3] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e2" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#40493d', fontFamily: 'Inter' }} interval={3} />
              <YAxis domain={[30, 70]} tick={{ fontSize: 10, fill: '#40493d', fontFamily: 'Inter' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'Inter' }} />
              <Line type="monotone" dataKey="supply" name="Supply"  stroke="#0d631b" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="inlet"  name="Inlet"   stroke="#00639a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="outlet" name="Outlet"  stroke="#485860" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-6">
        {/* Peak & Average */}
        <Card accent="green">
          <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Peak & Average by Hour</h2>
          <div className="space-y-2">
            {['06:00–08:00', '08:00–12:00', '12:00–15:00', '15:00–18:00'].map((range, i) => (
              <div key={range} className={`rounded-lg p-3 ${i === 2 ? 'bg-[#0d631b]/10' : 'bg-[#f3f3f3]'}`}>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-body text-[#40493d]">{range}</span>
                  <span className="text-sm font-headline font-bold text-[#1a1c1c]">
                    {[49.2, 47.8, 52.1, 46.5][i]} PSI
                  </span>
                </div>
                <div className="mt-1 h-1.5 bg-[#e2e2e2] rounded-full overflow-hidden">
                  <div className="h-full rounded-full gradient-primary" style={{ width: `${[72, 65, 82, 60][i]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Pressure events */}
        <Card accent="amber">
          <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Pressure Events</h2>
          <div className="space-y-3">
            {EVENTS.map((e, i) => (
              <div key={i} className="flex items-start gap-3 bg-[#f3f3f3] rounded-lg p-3">
                <StatusChip status={e.status} />
                <div>
                  <p className="text-xs font-semibold text-[#1a1c1c]">{e.event}</p>
                  <p className="text-[10px] text-[#40493d]">{e.time}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

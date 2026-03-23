import { useState } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'

const INITIAL_RULES = [
  {
    id: 1, name: 'Morning Block — Zones 1–4',
    days: [true, true, true, true, true, false, false],
    startTime: '06:00', duration: 30, psiThreshold: 35, active: true,
    zones: [1, 2, 3, 4],
  },
  {
    id: 2, name: 'Evening Orchard — Zones 5–6',
    days: [true, false, true, false, true, false, false],
    startTime: '17:30', duration: 60, psiThreshold: 30, active: true,
    zones: [5, 6],
  },
  {
    id: 3, name: 'Weekend Deep Water',
    days: [false, false, false, false, false, true, true],
    startTime: '07:00', duration: 90, psiThreshold: 40, active: false,
    zones: [1, 2, 3, 4, 5, 6, 7, 8],
  },
]

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function ScheduleRules() {
  const [rules, setRules] = useState(INITIAL_RULES)
  const [selected, setSelected] = useState(null)

  const rule = rules.find(r => r.id === selected)

  function toggleRule(id) {
    setRules(rs => rs.map(r => r.id === id ? { ...r, active: !r.active } : r))
  }

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Schedule Rules</h1>
        <button className="gradient-primary text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
          + New Rule
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Rules list */}
        <div className="col-span-2 space-y-4">
          {rules.map(r => (
            <Card key={r.id} accent={r.active ? 'green' : undefined}
              className={`cursor-pointer transition-all ${selected === r.id ? 'ring-2 ring-[#0d631b]/30' : ''}`}
            >
              <div onClick={() => setSelected(selected === r.id ? null : r.id)}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-headline font-semibold text-[#1a1c1c]">{r.name}</p>
                    <p className="text-xs text-[#40493d] mt-0.5">
                      {r.startTime} · {r.duration} min/zone · PSI ≥ {r.psiThreshold}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusChip status={r.active ? 'online' : 'paused'} label={r.active ? 'ACTIVE' : 'PAUSED'} />
                    <button
                      onClick={e => { e.stopPropagation(); toggleRule(r.id) }}
                      className={`relative w-9 h-5 rounded-full transition-colors ${r.active ? 'bg-[#0d631b]' : 'bg-[#e2e2e2]'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${r.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                </div>

                {/* Day chips */}
                <div className="flex gap-1.5 mb-3">
                  {DAY_LABELS.map((d, i) => (
                    <span key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-body font-semibold ${
                      r.days[i] ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'
                    }`}>{d}</span>
                  ))}
                </div>

                {/* Zone chips */}
                <div className="flex gap-1.5">
                  {r.zones.map(z => (
                    <span key={z} className="px-2 py-0.5 bg-[#f3f3f3] rounded-full text-[10px] font-body text-[#40493d]">Z{z}</span>
                  ))}
                </div>
              </div>

              {/* Ghost actions */}
              <div className="flex gap-4 mt-3 pt-3 border-t border-[#f3f3f3]">
                <button onClick={() => setSelected(r.id)} className="text-xs font-body text-[#00639a] hover:underline">Edit</button>
                <button className="text-xs font-body text-[#ba1a1a] hover:underline">Delete</button>
              </div>
            </Card>
          ))}
        </div>

        {/* Rule Editor */}
        <div>
          {rule ? (
            <Card accent="blue">
              <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Edit Rule</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">Rule Name</label>
                  <input defaultValue={rule.name} className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:border-l-[3px] focus:border-[#00639a] transition-all" />
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-2">Days</label>
                  <div className="flex gap-1.5">
                    {DAY_LABELS.map((d, i) => (
                      <button key={i} className={`w-7 h-7 rounded-full text-xs font-body font-semibold transition-colors ${
                        rule.days[i] ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'
                      }`}>{d}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">Start Time</label>
                  <input type="time" defaultValue={rule.startTime} className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white transition-all" />
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">Duration per zone: {rule.duration} min</label>
                  <input type="range" min={5} max={120} defaultValue={rule.duration} className="w-full accent-[#0d631b]" />
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">Skip if PSI below: {rule.psiThreshold}</label>
                  <input type="range" min={10} max={60} defaultValue={rule.psiThreshold} className="w-full accent-[#00639a]" />
                </div>
                <button className="w-full gradient-primary text-white font-body font-semibold text-sm py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
                  Save Rule
                </button>
                <button onClick={() => setSelected(null)} className="w-full text-[#40493d] font-body text-sm py-2 hover:text-[#1a1c1c] transition-colors">
                  Cancel
                </button>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="space-y-3">
                <h2 className="font-headline font-semibold text-base text-[#1a1c1c]">Smart Conditions</h2>
                {[
                  { label: 'Filter fault → Skip schedule', color: 'red' },
                  { label: 'PSI drops below 30 → Pause & alert', color: 'amber' },
                  { label: 'Rain sensor → Skip all zones', color: 'blue' },
                ].map((c, i) => (
                  <div key={i} className="bg-[#f3f3f3] rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${c.color === 'red' ? 'bg-[#ba1a1a]' : c.color === 'amber' ? 'bg-[#e65100]' : 'bg-[#00639a]'}`} />
                      <p className="text-xs font-body text-[#1a1c1c]">{c.label}</p>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-[#40493d] font-body">Select a rule to edit it, or create a new one.</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

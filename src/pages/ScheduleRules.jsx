import { useState, useEffect } from 'react'
import Card from '../components/Card'
import StatusChip from '../components/StatusChip'
import { supabase } from '../lib/supabase'

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const BLANK_RULE = {
  name: 'New Rule',
  days: [true, true, true, true, true, false, false],
  startTime: '06:00',
  duration: 30,
  psiThreshold: 35,
  active: true,
  zones: [1],
}

export default function ScheduleRules() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Load rules from Supabase
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('schedule_rules')
        .select('*')
        .order('created_at', { ascending: true })
      if (!error && data && data.length > 0) {
        setRules(data.map(r => ({
          ...r,
          days: typeof r.days === 'string' ? JSON.parse(r.days) : (r.days ?? [true,true,true,true,true,false,false]),
          zones: typeof r.zone_nums === 'string' ? JSON.parse(r.zone_nums) : (r.zone_nums ?? [1]),
          startTime: r.start_time ?? '06:00',
          duration: r.duration_min ?? 30,
          psiThreshold: r.psi_threshold ?? 35,
        })))
      }
      setLoading(false)
    }
    load()
  }, [])

  const rule = rules.find(r => r.id === selected)

  // Sync draft when a rule is selected
  useEffect(() => {
    if (rule) setDraft({ ...rule })
    else setDraft(null)
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleRule(id) {
    setRules(rs => rs.map(r => r.id === id ? { ...r, active: !r.active } : r))
    // Persist active toggle immediately
    const r = rules.find(r => r.id === id)
    if (r) supabase.from('schedule_rules').update({ active: !r.active }).eq('id', id)
  }

  function handleNewRule() {
    const newRule = { ...BLANK_RULE, id: `new-${Date.now()}`, _isNew: true }
    setRules(rs => [...rs, newRule])
    setSelected(newRule.id)
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true); setSaveError(null)
    const payload = {
      name: draft.name,
      start_time: draft.startTime,
      days: JSON.stringify(draft.days),
      duration_min: draft.duration,
      psi_threshold: draft.psiThreshold,
      active: draft.active,
      zone_nums: JSON.stringify(draft.zones),
    }
    let error
    if (draft._isNew) {
      const res = await supabase.from('schedule_rules').insert(payload).select().single()
      error = res.error
      if (!error && res.data) {
        const saved = {
          ...draft,
          ...res.data,
          days: draft.days,
          zones: draft.zones,
          startTime: draft.startTime,
          duration: draft.duration,
          psiThreshold: draft.psiThreshold,
          _isNew: undefined,
        }
        setRules(rs => rs.map(r => r.id === draft.id ? saved : r))
        setSelected(res.data.id)
      }
    } else {
      const res = await supabase.from('schedule_rules').update(payload).eq('id', draft.id)
      error = res.error
      if (!error) {
        setRules(rs => rs.map(r => r.id === draft.id ? { ...r, ...draft } : r))
      }
    }
    if (error) setSaveError(error.message)
    setSaving(false)
  }

  async function handleDelete(id) {
    const r = rules.find(r => r.id === id)
    if (!r) return
    if (!r._isNew) await supabase.from('schedule_rules').delete().eq('id', id)
    setRules(rs => rs.filter(r => r.id !== id))
    if (selected === id) setSelected(null)
  }

  return (
    <div className="flex-1 p-6 bg-[#f9f9f9] overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Schedule Rules</h1>
        <button
          onClick={handleNewRule}
          className="gradient-primary text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity"
        >
          + New Rule
        </button>
      </div>

      {loading && <p className="text-sm text-[#40493d] mb-4">Loading schedules…</p>}
      {!loading && rules.length === 0 && (
        <p className="text-sm text-[#40493d] mb-4">No schedule rules yet. Create one with "+ New Rule".</p>
      )}

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
                  {(r.zones ?? []).map(z => (
                    <span key={z} className="px-2 py-0.5 bg-[#f3f3f3] rounded-full text-[10px] font-body text-[#40493d]">Z{z}</span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-4 mt-3 pt-3 border-t border-[#f3f3f3]">
                <button onClick={e => { e.stopPropagation(); setSelected(r.id) }} className="text-xs font-body text-[#00639a] hover:underline">Edit</button>
                <button onClick={e => { e.stopPropagation(); handleDelete(r.id) }} className="text-xs font-body text-[#ba1a1a] hover:underline">Delete</button>
              </div>
            </Card>
          ))}
        </div>

        {/* Rule Editor */}
        <div>
          {draft ? (
            <Card accent="blue">
              <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">
                {draft._isNew ? 'New Rule' : 'Edit Rule'}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">Rule Name</label>
                  <input
                    value={draft.name}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:border-l-[3px] focus:border-[#00639a] transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-2">Days</label>
                  <div className="flex gap-1.5">
                    {DAY_LABELS.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => setDraft(dr => ({ ...dr, days: dr.days.map((v, j) => j === i ? !v : v) }))}
                        className={`w-7 h-7 rounded-full text-xs font-body font-semibold transition-colors ${
                          draft.days[i] ? 'bg-[#0d631b] text-white' : 'bg-[#f3f3f3] text-[#40493d]'
                        }`}
                      >{d}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">Start Time</label>
                  <input
                    type="time"
                    value={draft.startTime}
                    onChange={e => setDraft(d => ({ ...d, startTime: e.target.value }))}
                    className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">
                    Duration per zone: {draft.duration} min
                  </label>
                  <input
                    type="range" min={5} max={120}
                    value={draft.duration}
                    onChange={e => setDraft(d => ({ ...d, duration: Number(e.target.value) }))}
                    className="w-full accent-[#0d631b]"
                  />
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">
                    Skip if PSI below: {draft.psiThreshold}
                  </label>
                  <input
                    type="range" min={10} max={60}
                    value={draft.psiThreshold}
                    onChange={e => setDraft(d => ({ ...d, psiThreshold: Number(e.target.value) }))}
                    className="w-full accent-[#00639a]"
                  />
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">Zones (comma-separated)</label>
                  <input
                    value={(draft.zones ?? []).join(', ')}
                    onChange={e => {
                      const nums = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
                      setDraft(d => ({ ...d, zones: nums }))
                    }}
                    className="w-full bg-[#f3f3f3] rounded-lg px-3 py-2 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white transition-all"
                    placeholder="e.g. 1, 2, 3"
                  />
                </div>
                {saveError && (
                  <p className="text-xs text-[#ba1a1a] bg-[#ffdad6] rounded-lg px-3 py-2">{saveError}</p>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full gradient-primary text-white font-body font-semibold text-sm py-2.5 rounded-xl shadow-fab hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Rule'}
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="w-full text-[#40493d] font-body text-sm py-2 hover:text-[#1a1c1c] transition-colors"
                >
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

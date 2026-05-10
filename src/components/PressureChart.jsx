// src/components/PressureChart.jsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

/**
 * Compact supply-pressure line chart for the Dashboard.
 *
 * @param {{ time: string, supply: number|null }[]} props.data
 *   Bucketed rows from usePressureHistory (use the `supply` field).
 * @param {number|null} props.currentPsi   Live reading — shown as large number above chart.
 * @param {number}      props.lowThreshold Red reference line (default 15 PSI).
 */
export default function PressureChart({ data = [], currentPsi = null, lowThreshold = 15 }) {
  const chartData = data
    .filter(d => d.supply != null)
    .map(d => ({ time: d.time, psi: d.supply }))

  return (
    <div>
      {currentPsi != null && (
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0d4d20', marginBottom: '0.5rem' }}>
          {typeof currentPsi === 'number' ? currentPsi.toFixed(1) : currentPsi}{' '}
          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#7a8580' }}>PSI</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#7a8580' }} interval="preserveStartEnd" />
          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#7a8580' }} width={36} />
          <Tooltip
            formatter={(v) => [`${Number(v).toFixed(1)} PSI`, 'Pressure']}
            labelFormatter={(l) => l}
            contentStyle={{ fontSize: '0.75rem', borderRadius: 6 }}
          />
          <ReferenceLine
            y={lowThreshold}
            stroke="#e53935"
            strokeDasharray="3 3"
            label={{ value: `${lowThreshold} PSI min`, fontSize: 9, fill: '#e53935' }}
          />
          <Line type="monotone" dataKey="psi" stroke="#0d4d20" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

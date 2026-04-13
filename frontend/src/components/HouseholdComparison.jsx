import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { niceTicks } from '../utils/niceTicks'

const fmt = (value) => value.toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function HouseholdComparison({ households, currentType }) {
  const annualHouseholds = useMemo(() => households || [], [households])

  const yTicks = useMemo(() => {
    if (!annualHouseholds.length) return [0]
    const maxValue = Math.max(...annualHouseholds.map((item) => item.net_resources_annual))
    return niceTicks(maxValue)
  }, [annualHouseholds])

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload
      return (
        <div style={{
          background: '#1a2744',
          padding: '12px 16px',
          borderRadius: '8px',
          boxShadow: '0 12px 32px rgba(26, 39, 68, 0.25)',
          color: 'white',
          fontFamily: "'Inter', sans-serif",
        }}>
          <p style={{ fontSize: '0.75rem', letterSpacing: '0.05em', opacity: 0.7, marginBottom: '4px' }}>
            {item.label}
          </p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#4FD1C5' }}>
            {fmt(item.net_resources_annual)}/yr
          </p>
          <p style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: '4px' }}>
            Annual net income
          </p>
          <p style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: '6px' }}>
            {item.counts.num_adults} adult(s), {item.counts.num_children} dependant(s)
          </p>
        </div>
      )
    }
    return null
  }

  if (!annualHouseholds.length) {
    return <p className="ranking-empty">No household comparison available yet.</p>
  }

  return (
    <div className="chart-wrapper">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={annualHouseholds}
          margin={{ top: 10, right: 20, left: 10, bottom: 24 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" vertical={false} />
          <XAxis
            dataKey="short_label"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#e5e2dd' }}
            tickLine={{ stroke: '#e5e2dd' }}
          />
          <YAxis
            domain={[0, yTicks[yTicks.length - 1]]}
            ticks={yTicks}
            tickFormatter={fmt}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#e5e2dd' }}
            tickLine={{ stroke: '#e5e2dd' }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(13, 148, 136, 0.08)' }} />
          <Bar dataKey="net_resources_annual" radius={[4, 4, 0, 0]}>
            {annualHouseholds.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.household_type === currentType ? '#1E293B' : '#319795'}
                opacity={entry.household_type === currentType ? 1 : 0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default HouseholdComparison

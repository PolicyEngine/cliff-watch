import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { niceTicks } from '../utils/niceTicks'

const fmt = (value) => value.toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function BenefitChart({ data, currentIncome }) {
  const { xTicks, yTicks } = useMemo(() => {
    if (!data || data.length === 0) return { xTicks: [0], yTicks: [0] }
    const xMax = Math.max(...data.map((item) => item.earned_income_monthly))
    const yMax = Math.max(...data.map((item) => item.net_resources_monthly))
    return { xTicks: niceTicks(xMax), yTicks: niceTicks(yMax) }
  }, [data])

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload
      return (
        <div style={{
          background: '#1a2744',
          padding: '14px 18px',
          borderRadius: '8px',
          boxShadow: '0 12px 32px rgba(26, 39, 68, 0.25)',
          color: 'white',
          fontFamily: "'Inter', sans-serif",
        }}>
          <p style={{ fontSize: '0.75rem', letterSpacing: '0.05em', opacity: 0.7, marginBottom: '4px' }}>
            Earnings: {fmt(label)}/mo
          </p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#4FD1C5' }}>
            Net resources: {fmt(payload[0].value)}/mo
          </p>
          <p style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '4px' }}>
            Support: {fmt(point.core_support_monthly)}/mo
          </p>
          {point.has_previous_point && (
            <p style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '4px' }}>
              Change vs prior point: {fmt(point.net_change_monthly)}/mo
            </p>
          )}
          {point.is_cliff && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', color: '#FCA5A5', marginBottom: '6px' }}>
                Main cliff drivers
              </p>
              {(point.cliff_drivers || []).slice(0, 3).map((driver) => (
                <div
                  key={driver.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    fontSize: '0.8rem',
                    marginTop: '4px',
                  }}
                >
                  <span>{driver.label}</span>
                  <span>{fmt(Math.abs(driver.resource_effect_monthly))}/mo</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }
    return null
  }

  return (
    <div className="chart-wrapper">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" />
          <XAxis
            dataKey="earned_income_monthly"
            type="number"
            domain={[0, xTicks[xTicks.length - 1]]}
            ticks={xTicks}
            tickFormatter={fmt}
            label={{ value: 'Monthly household earnings', position: 'bottom', offset: -5, fill: '#6b7280', fontSize: 11 }}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#e5e2dd' }}
            tickLine={{ stroke: '#e5e2dd' }}
          />
          <YAxis
            domain={[0, yTicks[yTicks.length - 1]]}
            ticks={yTicks}
            tickFormatter={fmt}
            label={{ value: 'Monthly net resources', angle: -90, position: 'insideLeft', dx: -5, style: { textAnchor: 'middle', fill: '#6b7280', fontSize: 11 } }}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#e5e2dd' }}
            tickLine={{ stroke: '#e5e2dd' }}
          />
          <Tooltip content={<CustomTooltip />} separator=": " />
          <ReferenceLine y={0} stroke="#e5e2dd" />
          {currentIncome != null && <ReferenceLine x={currentIncome} stroke="#64748B" strokeDasharray="4 4" />}
          <Line
            type="monotone"
            dataKey="net_resources_monthly"
            stroke="#319795"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 6, fill: '#1E293B', stroke: '#1a2744', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default BenefitChart

import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

const DEFAULT_COUNT = 7

const getOrdinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function StateRanking({ data, selectedState, onStateSelect }) {
  const [expanded, setExpanded] = useState(false)

  const allStates = useMemo(() => (
    (data || []).map((item) => ({
      ...item,
      net_resources_annual: Number(item.net_resources || 0),
    }))
  ), [data])
  const displayStates = expanded ? allStates : allStates.slice(0, DEFAULT_COUNT)

  const formatCurrency = (value) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)

  const selectedStateData = useMemo(() => {
    if (!data || !selectedState) return null
    const idx = allStates.findIndex((item) => item.state === selectedState)
    if (idx === -1) return null
    return { ...allStates[idx], rank: idx + 1 }
  }, [data, selectedState, allStates])

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload
      return (
        <div style={{
          background: '#1a2744',
          padding: '12px 16px',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(26, 39, 68, 0.25)',
          color: 'white',
          fontFamily: "'Inter', sans-serif",
        }}>
          <p style={{ fontWeight: 600, marginBottom: '4px' }}>{item.state_name}</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#4FD1C5' }}>
            {formatCurrency(item.net_resources_annual)}/yr
          </p>
        </div>
      )
    }
    return null
  }

  if (!data || allStates.length === 0) {
    return <p className="ranking-empty">No state comparison available for this household.</p>
  }

  return (
    <div className="state-ranking">
      {selectedStateData && (
        <div className="selected-state-rank">
          <span className="rank-badge">#{selectedStateData.rank}</span>
          <span className="rank-text">
            <strong>{selectedStateData.state_name}</strong> provides the {getOrdinal(selectedStateData.rank)} highest modeled annual net income for this household
            {selectedStateData.net_resources_annual > 0 && (
              <> (<strong>{formatCurrency(selectedStateData.net_resources_annual)}/yr</strong>)</>
            )}
          </span>
        </div>
      )}

      <div className="ranking-chart">
        <ResponsiveContainer width="100%" height={Math.max(200, displayStates.length * 36)}>
          <BarChart
            data={displayStates}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
            barCategoryGap={6}
          >
            <XAxis
              type="number"
              tickFormatter={formatCurrency}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={{ stroke: '#e5e2dd' }}
              tickLine={{ stroke: '#e5e2dd' }}
            />
            <YAxis
              type="category"
              dataKey="state_name"
              tick={{ fill: '#1a2744', fontSize: 12, fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
              width={75}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(13, 148, 136, 0.08)' }} />
            <Bar
              dataKey="net_resources_annual"
              radius={[0, 4, 4, 0]}
              onClick={(item) => onStateSelect(item.state)}
              style={{ cursor: 'pointer' }}
            >
              {displayStates.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.state === selectedState ? '#1E293B' : '#319795'}
                  opacity={entry.state === selectedState ? 1 : 0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="ranking-footer">
        {allStates.length > DEFAULT_COUNT && (
          <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show all ${allStates.length} states`}
          </button>
        )}
        <p>Click a bar to select that state</p>
      </div>
    </div>
  )
}

export default StateRanking

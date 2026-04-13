import { useState, memo, useMemo } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'

const geoUrl = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

const FIPS_TO_STATE = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
}

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii',
  ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

const HEATMAP_COLORS = [
  '#f0fdfa',
  '#ccfbf1',
  '#99f6e4',
  '#5eead4',
  '#2dd4bf',
  '#14b8a6',
  '#0d9488',
  '#0f766e',
  '#115e59',
  '#134e4a',
]

function StateMap({ selectedState, availableStates, onStateSelect, comparisonData, maxNetResources }) {
  const [hoveredState, setHoveredState] = useState(null)
  const availableSet = new Set((availableStates || []).map((item) => item.code))

  const benefitMap = useMemo(() => {
    if (!comparisonData) return {}
    const map = {}
    comparisonData.forEach((item) => {
      map[item.state] = item
    })
    return map
  }, [comparisonData])

  const isHeatmapMode = comparisonData && comparisonData.length > 0

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)

  const getHeatmapColor = (stateCode) => {
    const data = benefitMap[stateCode]
    const netResourcesAnnual = Number(data?.net_resources || 0)
    if (!data || netResourcesAnnual <= 0 || maxNetResources <= 0) {
      return '#f0ede8'
    }
    const ratio = netResourcesAnnual / maxNetResources
    const index = Math.min(Math.floor(ratio * HEATMAP_COLORS.length), HEATMAP_COLORS.length - 1)
    return HEATMAP_COLORS[index]
  }

  const getStateColor = (stateCode) => {
    if (isHeatmapMode) {
      return getHeatmapColor(stateCode)
    }
    if (stateCode === selectedState) {
      return '#0f766e'
    }
    if (availableSet.has(stateCode)) {
      return '#5eead4'
    }
    return '#f0ede8'
  }

  const getHoverColor = (stateCode) => {
    if (isHeatmapMode) {
      const data = benefitMap[stateCode]
      const netResourcesAnnual = Number(data?.net_resources || 0)
      if (!data || netResourcesAnnual <= 0) {
        return '#e5e2dd'
      }
      const ratio = netResourcesAnnual / maxNetResources
      const index = Math.min(Math.floor(ratio * HEATMAP_COLORS.length) + 1, HEATMAP_COLORS.length - 1)
      return HEATMAP_COLORS[index]
    }
    if (stateCode === selectedState) {
      return '#0d9488'
    }
    if (availableSet.has(stateCode)) {
      return '#2dd4bf'
    }
    return '#e5e2dd'
  }

  const handleClick = (stateCode) => {
    if (availableSet.has(stateCode)) {
      onStateSelect(stateCode)
    }
  }

  return (
    <div className="state-map-container">
      <div className="map-wrapper">
        <ComposableMap
          projection="geoAlbersUsa"
          projectionConfig={{ scale: 1100 }}
          width={800}
          height={500}
          style={{ width: '100%', height: 'auto' }}
        >
          <Geographies geography={geoUrl}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const stateCode = FIPS_TO_STATE[geo.id]
                if (!stateCode) return null

                const isSelected = stateCode === selectedState
                const isHovered = stateCode === hoveredState

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={isHovered ? getHoverColor(stateCode) : getStateColor(stateCode)}
                    stroke={isSelected ? '#1a2744' : '#fff'}
                    strokeWidth={isSelected ? 1.5 : 0.5}
                    style={{
                      default: { outline: 'none' },
                      hover: { outline: 'none', cursor: 'pointer' },
                      pressed: { outline: 'none' },
                    }}
                    onMouseEnter={() => setHoveredState(stateCode)}
                    onMouseLeave={() => setHoveredState(null)}
                    onClick={() => handleClick(stateCode)}
                  />
                )
              })
            }
          </Geographies>
        </ComposableMap>
      </div>

      <div className="map-state-info">
        <div className={`map-state-card selected ${hoveredState && hoveredState !== selectedState ? 'dimmed' : ''}`}>
          <strong>{STATE_NAMES[selectedState] || selectedState}</strong>
          {isHeatmapMode && benefitMap[selectedState] ? (
            <span className="benefit-amount">
              {formatCurrency(benefitMap[selectedState].net_resources)}/yr
            </span>
          ) : null}
        </div>

        {hoveredState && hoveredState !== selectedState && (
          <div className="map-state-card hovered">
            <strong>{STATE_NAMES[hoveredState]}</strong>
            {isHeatmapMode && benefitMap[hoveredState] ? (
              <span className="benefit-amount">
                {formatCurrency(benefitMap[hoveredState].net_resources)}/yr
              </span>
            ) : null}
          </div>
        )}
      </div>

      {isHeatmapMode && (
        <div className="heatmap-legend">
          <span className="legend-label">Lower resources</span>
          <div className="gradient-bar">
            {HEATMAP_COLORS.map((color, index) => (
              <div key={index} className="gradient-step" style={{ background: color }} />
            ))}
          </div>
          <span className="legend-label">Higher resources</span>
        </div>
      )}
    </div>
  )
}

export default memo(StateMap)

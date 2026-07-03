import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { niceTicks } from '../utils/niceTicks'
import { buildCliffReport, filterMaterialCliffDrivers } from '../utils/cliffReport'
import {
  COMPOSITION_OPTIONS,
  EARNINGS_AREA,
  MEASURE_OPTIONS,
  MTR_CAP,
  MTR_LINE,
  MTR_OTHER_AREA,
  MTR_OTHER_KEY,
  NET_LINE,
  VIEW_COPY,
  buildChartPoints,
  buildComponents,
  contributionKey,
  fmtUsd,
  hasMaterialMtrResidual,
  materialLevelComponents,
  materialMtrComponents,
  mtrAxisFor,
  signedNiceTicks,
  valueKey,
} from '../utils/chartModel'
import ChartTooltip from './ChartTooltip'

const CLIFF_HIGHLIGHT_STYLES = {
  severe: {
    stroke: '#DC2626',
    dotFill: '#DC2626',
    fill: '#FCA5A5',
  },
  moderate: {
    stroke: '#D97706',
    dotFill: '#D97706',
    fill: '#FCD34D',
  },
  mild: {
    stroke: '#CA8A04',
    dotFill: '#CA8A04',
    fill: '#FDE68A',
  },
}

const fmtPercentTick = (value) => `${Math.round(value * 100)}%`

const placeholderPoints = (maxEarnedIncome) => ([
  { earnings: 0, net: 0, marginal_tax_rate: 0 },
  { earnings: Number(maxEarnedIncome || 0), net: 0, marginal_tax_rate: 0 },
])

function BenefitChart({
  data,
  loading = false,
  placeholderMaxEarnedIncome = 100000,
  metadata,
}) {
  const [measure, setMeasure] = useState('income')
  const [composition, setComposition] = useState('total')
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set())
  const [showCliffHighlights, setShowCliffHighlights] = useState(true)

  const isMtr = measure === 'mtr'
  const isByProgram = composition === 'by_program'
  const view = `${measure}:${composition}`
  const copy = VIEW_COPY[view]
  const hasRealData = Boolean(data?.length)

  const isVisible = (key) => !hiddenKeys.has(key)
  const toggleKey = (key) => {
    setHiddenKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const components = useMemo(() => buildComponents(metadata), [metadata])

  const points = useMemo(() => {
    if (!hasRealData) {
      return loading ? placeholderPoints(placeholderMaxEarnedIncome) : []
    }
    return buildChartPoints(data, components)
  }, [components, data, hasRealData, loading, placeholderMaxEarnedIncome])

  const levelComponents = useMemo(
    () => (hasRealData ? materialLevelComponents(points, components) : []),
    [components, hasRealData, points],
  )
  const mtrComponents = useMemo(
    () => (hasRealData ? materialMtrComponents(points, components) : []),
    [components, hasRealData, points],
  )
  const showResidual = useMemo(
    () => hasRealData && hasMaterialMtrResidual(points),
    [hasRealData, points],
  )

  const visibleLevelComponents = levelComponents.filter((component) => isVisible(component.key))
  const visibleMtrComponents = mtrComponents.filter((component) => isVisible(component.key))

  const cliffReport = useMemo(() => buildCliffReport(points), [points])
  const highlightedCliffs = cliffReport.cliffs || []
  const reportableCliffKeys = useMemo(() => (
    new Set(
      highlightedCliffs.map((cliff) => (
        `${Math.round(cliff.startIncomeAnnual)}:${Math.round(cliff.endIncomeAnnual)}`
      )),
    )
  ), [highlightedCliffs])

  const previewedCliffKeys = useMemo(() => (
    new Set(
      points
        .filter((point) => point?.has_upcoming_cliff)
        .map((point) => (
          `${Math.round(Number(point?.earnings || 0))}:${Math.round(Number(point?.upcoming_cliff_income || 0))}`
        ))
        .filter((key) => reportableCliffKeys.has(key)),
    )
  ), [points, reportableCliffKeys])

  const deadZoneBands = useMemo(() => {
    if (!points.length) {
      return []
    }

    const lastIncome = Number(points[points.length - 1]?.earnings || 0)

    return (cliffReport.zones || [])
      .map((zone) => {
        const startIncome = Number(zone.startIncomeAnnual || 0)
        const recoveryIncome = zone.recoveryIncomeAnnual ?? lastIncome

        if (recoveryIncome <= startIncome) {
          return null
        }

        return {
          startIncome,
          recoveryIncome,
          tone: zone.severity?.tone || zone.cliffs?.[0]?.severity?.tone || 'mild',
        }
      })
      .filter(Boolean)
  }, [cliffReport.zones, points])

  const axes = useMemo(() => {
    if (!hasRealData) {
      const placeholderDetailTicks = signedNiceTicks(-20000, Math.max(placeholderMaxEarnedIncome, 50000))
      return {
        xTicks: niceTicks(placeholderMaxEarnedIncome),
        netTicks: niceTicks(Math.max(placeholderMaxEarnedIncome, 50000)),
        detailTicks: placeholderDetailTicks,
        mtr: { ticks: [0, 0.25, 0.5, 0.75, 1], domain: [0, MTR_CAP] },
      }
    }

    const xMax = Math.max(...points.map((point) => point.earnings))
    const netMax = isVisible(NET_LINE.key)
      ? Math.max(0, ...points.map((point) => Math.max(0, point.net)))
      : 0

    let detailMax = 0
    let detailMin = 0
    points.forEach((point) => {
      let positiveStack = isVisible(EARNINGS_AREA.key) ? Math.max(0, point.earnings) : 0
      let negativeStack = 0
      visibleLevelComponents.forEach((component) => {
        const value = Number(point[valueKey(component)] || 0)
        if (value > 0) {
          positiveStack += value
        } else {
          negativeStack += value
        }
      })
      const netValue = isVisible(NET_LINE.key) ? point.net : 0

      detailMax = Math.max(detailMax, positiveStack, netValue, 0)
      detailMin = Math.min(detailMin, negativeStack, netValue, 0)
    })

    // The stacked contributions only widen the rate axis in the by-program
    // view; the total view floors on the combined rate alone.
    const mtrKeys = isByProgram
      ? [
        ...visibleMtrComponents.map(contributionKey),
        ...(showResidual && isVisible(MTR_OTHER_KEY) ? [MTR_OTHER_KEY] : []),
      ]
      : []

    return {
      xTicks: niceTicks(xMax),
      netTicks: niceTicks(netMax),
      detailTicks: signedNiceTicks(detailMin, detailMax),
      mtr: mtrAxisFor(points, mtrKeys),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealData, hiddenKeys, isByProgram, placeholderMaxEarnedIncome, points, showResidual, visibleLevelComponents, visibleMtrComponents])

  const yAxisProps = useMemo(() => {
    if (isMtr) {
      return {
        domain: axes.mtr.domain,
        ticks: axes.mtr.ticks,
        tickFormatter: fmtPercentTick,
        allowDataOverflow: true,
        label: 'Marginal tax rate',
      }
    }
    if (isByProgram) {
      return {
        domain: [axes.detailTicks[0], axes.detailTicks[axes.detailTicks.length - 1]],
        ticks: axes.detailTicks,
        tickFormatter: fmtUsd,
        allowDataOverflow: false,
        label: 'Annual amount ($)',
      }
    }
    return {
      domain: [0, axes.netTicks[axes.netTicks.length - 1]],
      ticks: axes.netTicks,
      tickFormatter: fmtUsd,
      allowDataOverflow: false,
      label: 'Annual amount ($)',
    }
  }, [axes, isByProgram, isMtr])

  const legendItems = useMemo(() => {
    if (!isMtr) {
      if (!isByProgram) {
        return [NET_LINE]
      }
      return [NET_LINE, EARNINGS_AREA, ...levelComponents]
    }
    if (!isByProgram) {
      return [MTR_LINE]
    }
    return [
      MTR_LINE,
      ...mtrComponents,
      ...(showResidual ? [MTR_OTHER_AREA] : []),
    ]
  }, [isByProgram, isMtr, levelComponents, mtrComponents, showResidual])

  const showCliffChip = highlightedCliffs.length > 0 && !(isMtr && isByProgram)
  const showDeadZones = showCliffHighlights && !isByProgram
  const showCliffDots = showCliffHighlights && !isMtr

  const resolveCliff = (point) => {
    const currentStart = Number(point?.earnings || 0) - Number(point?.step_annual || 0)
    const currentEnd = Number(point?.earnings || 0)
    const currentKey = `${Math.round(currentStart)}:${Math.round(currentEnd)}`
    const upcomingKey = `${Math.round(Number(point?.earnings || 0))}:${Math.round(Number(point?.upcoming_cliff_income || 0))}`

    if (point?.has_upcoming_cliff && reportableCliffKeys.has(upcomingKey)) {
      return {
        kind: 'upcoming',
        dropAnnual: Number(point.upcoming_cliff_drop_annual || 0),
        targetIncome: Number(point.upcoming_cliff_income || 0),
        drivers: point.upcoming_cliff_drivers || [],
      }
    }

    if (
      point?.is_cliff
      && reportableCliffKeys.has(currentKey)
      && !previewedCliffKeys.has(currentKey)
    ) {
      return {
        kind: 'current',
        dropAnnual: Number(point.cliff_drop_annual || 0),
        targetIncome: Number(point.earnings || 0),
        drivers: filterMaterialCliffDrivers(point.cliff_drivers || []),
      }
    }

    return null
  }

  const lineType = isMtr ? 'stepBefore' : 'linear'
  const zeroLineEmphasized = isByProgram || (isMtr && axes.mtr.domain[0] < 0)

  const wrapperClassName = [
    'chart-wrapper',
    'chart-wrapper--full',
    isByProgram ? 'chart-wrapper--program-detail' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={wrapperClassName}>
      <div className="chart-panel-header">
        <div>
          <h4>{copy.title}</h4>
          <p>{copy.description}</p>
        </div>
        <div className="chart-view-toggles">
          <div className="chart-view-toggle" role="tablist" aria-label="Measure">
            {MEASURE_OPTIONS.map((option) => {
              const isActive = measure === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`chart-view-button ${isActive ? 'active' : ''}`}
                  onClick={() => setMeasure(option.key)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <div className="chart-view-toggle" role="tablist" aria-label="Breakdown">
            {COMPOSITION_OPTIONS.map((option) => {
              const isActive = composition === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`chart-view-button ${isActive ? 'active' : ''}`}
                  onClick={() => setComposition(option.key)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="chart-legend">
        {legendItems.map((item) => {
          const isLine = !item.fill
          return (
            <button
              key={item.key}
              type="button"
              className={`chart-toggle ${isVisible(item.key) ? 'active' : ''}`}
              onClick={() => toggleKey(item.key)}
              style={{
                '--legend-stroke': item.stroke,
              }}
            >
              <span
                className={`chart-legend-swatch ${isLine ? 'chart-legend-swatch--line' : ''}`}
                style={{
                  '--legend-stroke': item.stroke,
                  '--legend-fill': item.fill || 'transparent',
                }}
              />
              <span>{item.label}</span>
            </button>
          )
        })}
        {showCliffChip ? (
          <button
            type="button"
            className={`chart-toggle ${showCliffHighlights ? 'active' : ''}`}
            onClick={() => setShowCliffHighlights((current) => !current)}
            style={{
              '--legend-stroke': CLIFF_HIGHLIGHT_STYLES.severe.stroke,
            }}
          >
            <span
              className="chart-legend-swatch chart-legend-swatch--dot"
              style={{
                '--legend-stroke': CLIFF_HIGHLIGHT_STYLES.severe.stroke,
                '--legend-fill': CLIFF_HIGHLIGHT_STYLES.severe.dotFill,
              }}
            />
            <span>Cliff highlights</span>
          </button>
        ) : null}
      </div>

      <div className="chart-canvas">
        {loading ? (
          <div className="chart-loading-overlay" aria-live="polite">
            <div className="chart-loading-card">
              <strong>Finding cliffs...</strong>
            </div>
          </div>
        ) : null}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            key={view}
            data={points}
            margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
            stackOffset={isByProgram ? 'sign' : undefined}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" vertical={false} />
            <XAxis
              dataKey="earnings"
              type="number"
              domain={[0, axes.xTicks[axes.xTicks.length - 1]]}
              ticks={axes.xTicks}
              tickFormatter={fmtUsd}
              label={{ value: 'Annual household wages and salaries', position: 'bottom', offset: -5, fill: '#6b7280', fontSize: 11 }}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={{ stroke: '#e5e2dd' }}
              tickLine={{ stroke: '#e5e2dd' }}
            />
            <YAxis
              domain={yAxisProps.domain}
              ticks={yAxisProps.ticks}
              tickFormatter={yAxisProps.tickFormatter}
              allowDataOverflow={yAxisProps.allowDataOverflow}
              label={{
                value: yAxisProps.label,
                angle: -90,
                position: 'insideLeft',
                dx: -5,
                style: { textAnchor: 'middle', fill: '#6b7280', fontSize: 11 },
              }}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={{ stroke: '#e5e2dd' }}
              tickLine={{ stroke: '#e5e2dd' }}
            />
            <Tooltip
              content={(
                <ChartTooltip
                  measure={measure}
                  composition={composition}
                  components={components}
                  isVisible={isVisible}
                  resolveCliff={resolveCliff}
                  showResidual={showResidual}
                />
              )}
            />
            <ReferenceLine
              y={0}
              stroke={zeroLineEmphasized ? '#475569' : '#cbd5e1'}
              strokeWidth={zeroLineEmphasized ? 2.2 : 1.1}
            />
            {isMtr ? (
              <ReferenceLine
                y={MTR_CAP}
                stroke="#DC2626"
                strokeDasharray="4 4"
                strokeOpacity={0.55}
              />
            ) : null}

            {showDeadZones
              ? deadZoneBands.map((zone) => (
                <ReferenceArea
                  key={`dead-zone-${zone.startIncome}-${zone.recoveryIncome}`}
                  x1={zone.startIncome}
                  x2={zone.recoveryIncome}
                  fill="#FCA5A5"
                  fillOpacity={0.28}
                  strokeOpacity={0}
                  ifOverflow="extendDomain"
                />
              ))
              : null}

            {!isMtr && isByProgram && isVisible(EARNINGS_AREA.key) ? (
              <Area
                type="linear"
                dataKey="earnings"
                stackId="stack"
                stroke={EARNINGS_AREA.stroke}
                fill={EARNINGS_AREA.fill}
                fillOpacity={0.9}
                strokeOpacity={0.38}
                strokeWidth={1.15}
                strokeLinejoin="round"
                strokeLinecap="round"
                isAnimationActive={false}
              />
            ) : null}

            {!isMtr && isByProgram
              ? visibleLevelComponents.map((component) => (
                <Area
                  key={component.key}
                  type="linear"
                  dataKey={valueKey(component)}
                  stackId="stack"
                  stroke={component.hideStroke ? 'none' : component.stroke}
                  fill={component.fill}
                  fillOpacity={component.group === 'tax' ? 0.78 : 0.9}
                  strokeOpacity={component.hideStroke ? 0 : 0.38}
                  strokeWidth={component.hideStroke ? 0 : 1.15}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  isAnimationActive={false}
                />
              ))
              : null}

            {isMtr && isByProgram
              ? visibleMtrComponents.map((component) => (
                <Area
                  key={component.key}
                  type="stepBefore"
                  dataKey={contributionKey(component)}
                  stackId="stack"
                  stroke={component.hideStroke ? 'none' : component.stroke}
                  fill={component.fill}
                  fillOpacity={component.group === 'tax' ? 0.78 : 0.9}
                  strokeOpacity={component.hideStroke ? 0 : 0.38}
                  strokeWidth={component.hideStroke ? 0 : 1.15}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  isAnimationActive={false}
                />
              ))
              : null}

            {isMtr && isByProgram && showResidual && isVisible(MTR_OTHER_KEY) ? (
              <Area
                type="stepBefore"
                dataKey={MTR_OTHER_KEY}
                stackId="stack"
                stroke="none"
                fill={MTR_OTHER_AREA.fill}
                fillOpacity={0.85}
                strokeOpacity={0}
                isAnimationActive={false}
              />
            ) : null}

            {!isMtr && isVisible(NET_LINE.key) ? (
              <Line
                type={lineType}
                dataKey="net"
                stroke={NET_LINE.stroke}
                strokeWidth={NET_LINE.strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 6, fill: '#111827', stroke: '#ffffff', strokeWidth: 2 }}
              />
            ) : null}

            {isMtr && isVisible(MTR_LINE.key) ? (
              <Line
                type="stepBefore"
                dataKey="marginal_tax_rate"
                stroke={MTR_LINE.stroke}
                strokeWidth={MTR_LINE.strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={{ r: 5, fill: '#111827', stroke: '#ffffff', strokeWidth: 2 }}
              />
            ) : null}

            {showCliffDots
              ? highlightedCliffs.map((cliff) => {
                const style = CLIFF_HIGHLIGHT_STYLES[cliff.severity?.tone] || CLIFF_HIGHLIGHT_STYLES.moderate
                return (
                  <ReferenceDot
                    key={`cliff-dot-${cliff.startIncomeAnnual}-${cliff.endIncomeAnnual}`}
                    x={cliff.startIncomeAnnual}
                    y={cliff.beforeResourcesAnnual}
                    r={isByProgram ? 5.5 : 4.75}
                    fill={style.dotFill}
                    stroke="#ffffff"
                    strokeWidth={2.25}
                    ifOverflow="extendDomain"
                    isFront
                  />
                )
              })
              : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default BenefitChart

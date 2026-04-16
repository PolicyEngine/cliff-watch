import { useEffect, useMemo, useState } from 'react'
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

const fmt = (value) => value.toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const fmtMtr = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  return `${(Number(value) * 100).toFixed(0)}%`
}

const MTR_COLOR = '#7C3AED'

const CHART_MODE_OPTIONS = [
  {
    key: 'net_income',
    label: 'Net income',
  },
  {
    key: 'program_detail',
    label: 'Program detail',
  },
]

const NET_VIEW_SERIES = [
  {
    key: 'net_resources_annual',
    label: 'Net income',
    type: 'line',
    stroke: '#111827',
    strokeWidth: 2.8,
    defaultVisible: true,
  },
]

const PROGRAM_DETAIL_LINE_SERIES = [
  {
    key: 'detail_net_income_annual',
    label: 'Net income',
    type: 'line',
    stroke: '#111827',
    strokeWidth: 2.8,
    defaultVisible: true,
  },
]

const PROGRAM_DETAIL_AREA_SERIES = [
  {
    key: 'earned_income_annual',
    label: 'Wages and salaries',
    type: 'area',
    stroke: '#6B7B93',
    fill: '#D8E1EC',
    defaultVisible: true,
  },
  {
    key: 'federal_taxes_before_refundable_credits_annual',
    label: 'Federal taxes',
    type: 'area',
    stroke: '#DC2626',
    fill: '#FECACA',
    defaultVisible: true,
    hideStroke: true,
  },
  {
    key: 'state_taxes_before_refundable_credits_annual',
    label: 'State taxes',
    type: 'area',
    stroke: '#B91C1C',
    fill: '#FCA5A5',
    defaultVisible: true,
    hideStroke: true,
  },
  {
    key: 'federal_refundable_credits_annual',
    label: 'Federal refundable tax credits',
    type: 'area',
    stroke: '#7C3AED',
    fill: '#DDD6FE',
    defaultVisible: true,
  },
  {
    key: 'state_refundable_credits_annual',
    label: 'State refundable tax credits',
    type: 'area',
    stroke: '#6D28D9',
    fill: '#C4B5FD',
    defaultVisible: true,
  },
  {
    key: 'tanf_annual',
    label: 'TANF',
    type: 'area',
    stroke: '#9A5A3C',
    fill: '#D7AE8E',
    defaultVisible: true,
  },
  {
    key: 'snap_annual',
    label: 'SNAP',
    type: 'area',
    stroke: '#4A9B68',
    fill: '#9BD3A8',
    defaultVisible: true,
  },
  {
    key: 'wic_annual',
    label: 'WIC',
    type: 'area',
    stroke: '#D17AA4',
    fill: '#F1C4D8',
    defaultVisible: true,
  },
  {
    key: 'free_school_meals_annual',
    label: 'School meals',
    type: 'area',
    stroke: '#C9963E',
    fill: '#F0D29E',
    defaultVisible: true,
  },
  {
    key: 'child_care_subsidies_annual',
    label: 'Child care subsidies',
    type: 'area',
    stroke: '#8B5CF6',
    fill: '#DDD6FE',
    defaultVisible: true,
  },
  {
    key: 'medicaid_annual',
    label: 'Medicaid',
    type: 'area',
    stroke: '#0F766E',
    fill: '#A7E4DB',
    defaultVisible: true,
  },
  {
    key: 'chip_annual',
    label: 'CHIP',
    type: 'area',
    stroke: '#6366F1',
    fill: '#C7D2FE',
    defaultVisible: true,
  },
  {
    key: 'aca_ptc_annual',
    label: 'ACA',
    type: 'area',
    stroke: '#3B82F6',
    fill: '#BFDBFE',
    defaultVisible: true,
  },
]

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

const DETAIL_TOOLTIP_ORDER = [
  'earned_income_annual',
  'federal_refundable_credits_annual',
  'state_refundable_credits_annual',
  'tanf_annual',
  'snap_annual',
  'wic_annual',
  'free_school_meals_annual',
  'child_care_subsidies_annual',
  'medicaid_annual',
  'chip_annual',
  'aca_ptc_annual',
  'federal_taxes_before_refundable_credits_annual',
  'state_taxes_before_refundable_credits_annual',
]

function chooseNiceStep(rawStep) {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const normalized = rawStep / magnitude

  if (normalized <= 1) return 1 * magnitude
  if (normalized <= 2) return 2 * magnitude
  if (normalized <= 2.5) return 2.5 * magnitude
  if (normalized <= 5) return 5 * magnitude
  return 10 * magnitude
}

function signedNiceTicks(minValue, maxValue, targetCount = 10) {
  const min = Math.min(0, minValue)
  const max = Math.max(0, maxValue)
  const span = max - min

  if (span <= 0) {
    return [0]
  }

  const step = chooseNiceStep(span / targetCount)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks = []

  for (let value = niceMin; value <= niceMax + (step / 2); value += step) {
    ticks.push(Math.round(value * 1e10) / 1e10)
  }

  return ticks
}

function BenefitChart({
  data,
  loading = false,
  placeholderMaxEarnedIncome = 100000,
}) {
  const [chartMode, setChartMode] = useState('net_income')
  const [netVisibleKeys, setNetVisibleKeys] = useState({})
  const [detailVisibleKeys, setDetailVisibleKeys] = useState({})
  const [showCliffHighlights, setShowCliffHighlights] = useState(true)
  const [showMtr, setShowMtr] = useState(false)
  const hasRealData = Boolean(data?.length)

  const annualizedData = useMemo(() => {
    const rawPoints = data || []
    if (!rawPoints.length && loading) {
      return [
        {
          earned_income_annual: 0,
          net_resources_annual: 0,
          detail_net_income_annual: 0,
          benefits_only_annual: 0,
          federal_refundable_credits_annual: 0,
          state_refundable_credits_annual: 0,
          federal_taxes_annual: 0,
          state_taxes_annual: 0,
          federal_taxes_before_refundable_credits_annual: 0,
          state_taxes_before_refundable_credits_annual: 0,
          cliff_drop_annual: 0,
        },
        {
          earned_income_annual: Number(placeholderMaxEarnedIncome || 0),
          net_resources_annual: 0,
          detail_net_income_annual: 0,
          benefits_only_annual: 0,
          federal_refundable_credits_annual: 0,
          state_refundable_credits_annual: 0,
          federal_taxes_annual: 0,
          state_taxes_annual: 0,
          federal_taxes_before_refundable_credits_annual: 0,
          state_taxes_before_refundable_credits_annual: 0,
          cliff_drop_annual: 0,
        },
      ]
    }

    const basePoints = rawPoints.map((point) => {
      const taxesAnnual = Number(point.taxes || 0)
      const coreBenefitsAnnual = Number(point.core_support || 0)
      const federalRefundableCreditsAnnual = Number(point.federal_refundable_credits || 0)
      const stateRefundableCreditsAnnual = Number(point.state_refundable_credits || 0)
      const federalTaxesAnnual = Number(point.federal_taxes_before_refundable_credits || 0)
      const stateTaxesAnnual = Number(point.state_taxes_before_refundable_credits || 0)

      return {
        ...point,
        earned_income_annual: Number(point.earned_income || 0),
        net_resources_annual: Number(point.net_resources || 0),
        detail_net_income_annual: Number(point.net_resources || 0),
        benefits_and_credits_annual: coreBenefitsAnnual,
        benefits_only_annual: coreBenefitsAnnual - federalRefundableCreditsAnnual - stateRefundableCreditsAnnual,
        taxes_annual: taxesAnnual,
        federal_taxes_annual: federalTaxesAnnual,
        state_taxes_annual: stateTaxesAnnual,
        federal_taxes_before_refundable_credits_annual: -federalTaxesAnnual,
        state_taxes_before_refundable_credits_annual: -stateTaxesAnnual,
        medicaid_annual: Number(point.medicaid || 0),
        chip_annual: Number(point.chip || 0),
        aca_ptc_annual: Number(point.aca_ptc || 0),
        snap_annual: Number(point.snap || 0),
        federal_refundable_credits_annual: federalRefundableCreditsAnnual,
        state_refundable_credits_annual: stateRefundableCreditsAnnual,
        tanf_annual: Number(point.tanf || 0),
        free_school_meals_annual: Number(point.free_school_meals || 0),
        child_care_subsidies_annual: Number(point.child_care_subsidies || 0),
        wic_annual: Number(point.wic || 0),
        net_change_annual_display: Number(point.net_change_annual || 0),
        cliff_drop_annual: Number(point.cliff_drop_annual || 0),
      }
    })

    const withMtr = basePoints.map((point, index) => {
      const prev = basePoints[index - 1]
      if (!prev) {
        return { ...point, marginal_tax_rate: null }
      }
      const deltaEarn = point.earned_income_annual - prev.earned_income_annual
      const deltaNet = point.net_resources_annual - prev.net_resources_annual
      const mtr = deltaEarn > 0 ? 1 - deltaNet / deltaEarn : null
      return { ...point, marginal_tax_rate: mtr }
    })

    return withMtr.map((point, index) => {
      const nextPoint = withMtr[index + 1]
      if (!nextPoint?.is_cliff) {
        return point
      }

      return {
        ...point,
        has_upcoming_cliff: true,
        upcoming_cliff_drop_annual: Number(nextPoint.cliff_drop_annual || 0),
        upcoming_cliff_income_annual: Number(nextPoint.earned_income_annual || 0),
        upcoming_cliff_drivers: filterMaterialCliffDrivers(nextPoint.cliff_drivers || []),
      }
    })
  }, [data, loading, placeholderMaxEarnedIncome])

  const detailAreaSeries = useMemo(() => (
    PROGRAM_DETAIL_AREA_SERIES.filter((series) => (
      annualizedData.some((item) => Math.abs(Number(item[series.key] || 0)) > 0)
    ))
  ), [annualizedData])

  const detailLegendSeries = useMemo(() => {
    const earningsSeries = detailAreaSeries.find((series) => series.key === 'earned_income_annual')
    const federalTaxesSeries = detailAreaSeries.find((series) => series.key === 'federal_taxes_before_refundable_credits_annual')
    const stateTaxesSeries = detailAreaSeries.find((series) => series.key === 'state_taxes_before_refundable_credits_annual')
    const remainingAreaSeries = detailAreaSeries.filter((series) => (
      series.key !== 'earned_income_annual'
      && series.key !== 'federal_taxes_before_refundable_credits_annual'
      && series.key !== 'state_taxes_before_refundable_credits_annual'
    ))

    return [
      PROGRAM_DETAIL_LINE_SERIES[0],
      earningsSeries,
      federalTaxesSeries,
      stateTaxesSeries,
      ...remainingAreaSeries,
    ].filter(Boolean)
  }, [detailAreaSeries])

  useEffect(() => {
    setNetVisibleKeys((current) => {
      const next = {}
      NET_VIEW_SERIES.forEach((series) => {
        next[series.key] = current[series.key] ?? series.defaultVisible
      })
      return next
    })
  }, [])

  useEffect(() => {
    setDetailVisibleKeys((current) => {
      const next = {}
      detailLegendSeries.forEach((series) => {
        next[series.key] = current[series.key] ?? series.defaultVisible
      })
      return next
    })
  }, [detailLegendSeries])

  const visibleNetSeries = useMemo(() => (
    NET_VIEW_SERIES.filter((series) => netVisibleKeys[series.key])
  ), [netVisibleKeys])

  const visibleDetailLineSeries = useMemo(() => (
    PROGRAM_DETAIL_LINE_SERIES.filter((series) => detailVisibleKeys[series.key])
  ), [detailVisibleKeys])

  const visibleDetailAreaSeries = useMemo(() => (
    detailAreaSeries.filter((series) => detailVisibleKeys[series.key])
  ), [detailAreaSeries, detailVisibleKeys])

  const cliffReport = useMemo(() => buildCliffReport(annualizedData), [annualizedData])
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
      annualizedData
        .filter((point) => point?.has_upcoming_cliff)
        .map((point) => (
          `${Math.round(Number(point?.earned_income_annual || 0))}:${Math.round(Number(point?.upcoming_cliff_income_annual || 0))}`
        ))
        .filter((key) => reportableCliffKeys.has(key)),
    )
  ), [annualizedData, reportableCliffKeys])

  const deadZoneBands = useMemo(() => {
    if (!annualizedData.length) {
      return []
    }

    const lastIncomeAnnual = Number(annualizedData[annualizedData.length - 1]?.earned_income_annual || 0)

    return (cliffReport.zones || [])
      .map((zone) => {
        const startIncomeAnnual = Number(zone.startIncomeAnnual || 0)
        const recoveryIncomeAnnual = zone.recoveryIncomeAnnual ?? lastIncomeAnnual

        if (recoveryIncomeAnnual <= startIncomeAnnual) {
          return null
        }

        return {
          startIncomeAnnual,
          recoveryIncomeAnnual,
          tone: zone.severity?.tone || zone.cliffs?.[0]?.severity?.tone || 'mild',
        }
      })
      .filter(Boolean)
  }, [annualizedData, cliffReport.zones])

  const { xTicks, netYTicks, detailYTicks, detailDomain } = useMemo(() => {
    if (!annualizedData.length || (!hasRealData && loading)) {
      const placeholderDetailTicks = signedNiceTicks(-20000, Math.max(placeholderMaxEarnedIncome, 50000))
      return {
        xTicks: niceTicks(placeholderMaxEarnedIncome),
        netYTicks: niceTicks(Math.max(placeholderMaxEarnedIncome, 50000)),
        detailYTicks: placeholderDetailTicks,
        detailDomain: [
          placeholderDetailTicks[0],
          placeholderDetailTicks[placeholderDetailTicks.length - 1],
        ],
      }
    }

    const xMax = Math.max(...annualizedData.map((item) => item.earned_income_annual))
    const netYMax = Math.max(
      0,
      ...annualizedData.map((item) => Math.max(
        0,
        ...visibleNetSeries.map((series) => Number(item[series.key] || 0)),
      )),
    )
    let detailMax = 0
    let detailMin = 0

    annualizedData.forEach((item) => {
      const positiveStack = visibleDetailAreaSeries.reduce(
        (sum, series) => sum + Math.max(0, Number(item[series.key] || 0)),
        0,
      )
      const negativeStack = visibleDetailAreaSeries.reduce(
        (sum, series) => sum + Math.min(0, Number(item[series.key] || 0)),
        0,
      )
      const lineValues = visibleDetailLineSeries.map((series) => Number(item[series.key] || 0))

      detailMax = Math.max(detailMax, positiveStack, ...lineValues, 0)
      detailMin = Math.min(detailMin, negativeStack, ...lineValues, 0)
    })

    const computedDetailYTicks = signedNiceTicks(detailMin, detailMax)

    return {
      xTicks: niceTicks(xMax),
      netYTicks: niceTicks(netYMax),
      detailYTicks: computedDetailYTicks,
      detailDomain: [
        computedDetailYTicks[0],
        computedDetailYTicks[computedDetailYTicks.length - 1],
      ],
    }
  }, [annualizedData, hasRealData, loading, placeholderMaxEarnedIncome, visibleDetailAreaSeries, visibleDetailLineSeries, visibleNetSeries])

  const toggleNetSeries = (key) => {
    setNetVisibleKeys((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  const toggleDetailSeries = (key) => {
    setDetailVisibleKeys((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  const getTooltipCliff = (point) => {
    const currentStartIncomeAnnual = Number(point?.earned_income_annual || 0) - Number(point?.step_annual || 0)
    const currentEndIncomeAnnual = Number(point?.earned_income_annual || 0)
    const currentCliffKey = `${Math.round(currentStartIncomeAnnual)}:${Math.round(currentEndIncomeAnnual)}`
    const upcomingCliffKey = `${Math.round(Number(point?.earned_income_annual || 0))}:${Math.round(Number(point?.upcoming_cliff_income_annual || 0))}`

    if (point?.has_upcoming_cliff && reportableCliffKeys.has(upcomingCliffKey)) {
      return {
        kind: 'upcoming',
        dropAnnual: Number(point.upcoming_cliff_drop_annual || 0),
        targetIncomeAnnual: Number(point.upcoming_cliff_income_annual || 0),
        drivers: point.upcoming_cliff_drivers || [],
      }
    }

    if (
      point?.is_cliff
      && reportableCliffKeys.has(currentCliffKey)
      && !previewedCliffKeys.has(currentCliffKey)
    ) {
      return {
        kind: 'current',
        dropAnnual: Number(point.cliff_drop_annual || 0),
        targetIncomeAnnual: Number(point.earned_income_annual || 0),
        drivers: filterMaterialCliffDrivers(point.cliff_drivers || []),
      }
    }

    return null
  }

  const NetTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) {
      return null
    }

    const point = payload[0].payload
    const tooltipCliff = getTooltipCliff(point)

    return (
      <div className="chart-tooltip">
        <p className="chart-tooltip-kicker">Wages and salaries: {fmt(label)}/yr</p>
        <p className="chart-tooltip-highlight">Net income: {fmt(point.net_resources_annual)}/yr</p>
        <div className="chart-tooltip-divider">
          <div className="chart-tooltip-row">
            <span>Wages and salaries</span>
            <span>{fmt(point.earned_income_annual)}/yr</span>
          </div>
          <div className="chart-tooltip-row">
            <span>Benefits</span>
            <span>{fmt(point.benefits_only_annual)}/yr</span>
          </div>
          <div className="chart-tooltip-row">
            <span>Federal refundable tax credits</span>
            <span>{fmt(point.federal_refundable_credits_annual)}/yr</span>
          </div>
          <div className="chart-tooltip-row">
            <span>State refundable tax credits</span>
            <span>{fmt(point.state_refundable_credits_annual)}/yr</span>
          </div>
          <div className="chart-tooltip-row">
            <span>Federal taxes</span>
            <span>{fmt(point.federal_taxes_annual)}/yr</span>
          </div>
          <div className="chart-tooltip-row">
            <span>State taxes</span>
            <span>{fmt(point.state_taxes_annual)}/yr</span>
          </div>
          {tooltipCliff ? (
            <div className="chart-tooltip-row">
              <span>{tooltipCliff.kind === 'upcoming' ? 'Cliff on next step' : 'Cliff loss at this step'}</span>
              <span>{fmt(-tooltipCliff.dropAnnual)}/yr</span>
            </div>
          ) : point.has_previous_point ? (
            <div className="chart-tooltip-row">
              <span>Change vs prior point</span>
              <span>{fmt(point.net_change_annual_display)}/yr</span>
            </div>
          ) : null}
          {showMtr && point.marginal_tax_rate !== null && point.marginal_tax_rate !== undefined ? (
            <div className="chart-tooltip-row">
              <span>Marginal tax rate</span>
              <span>{fmtMtr(point.marginal_tax_rate)}</span>
            </div>
          ) : null}
        </div>
        {tooltipCliff?.drivers?.length ? (
          <div className="chart-tooltip-divider">
            {tooltipCliff.kind === 'upcoming' ? (
              <p className="chart-tooltip-subtle">
                At {fmt(tooltipCliff.targetIncomeAnnual)}/yr in wages and salaries
              </p>
            ) : null}
            <p className="chart-tooltip-label">Main cliff drivers</p>
            {tooltipCliff.drivers.slice(0, 3).map((driver) => (
              <div key={driver.key} className="chart-tooltip-row">
                <span>{driver.label}</span>
                <span>{fmt(Math.abs(driver.resource_effect_annual))}/yr</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const DetailTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) {
      return null
    }

    const point = payload[0].payload
    const tooltipCliff = getTooltipCliff(point)
    const seriesByKey = new Map(detailAreaSeries.map((series) => [series.key, series]))
    const activeSeries = DETAIL_TOOLTIP_ORDER
      .map((key) => seriesByKey.get(key))
      .filter((series) => (
        Boolean(series)
        && detailVisibleKeys[series.key]
        && Math.abs(Number(point[series.key] || 0)) > 0
      ))

    return (
      <div className="chart-tooltip">
        <p className="chart-tooltip-kicker">Wages and salaries: {fmt(label)}/yr</p>
        <p className="chart-tooltip-highlight">Net income: {fmt(point.detail_net_income_annual)}/yr</p>
        <div className="chart-tooltip-divider">
          {activeSeries.map((series) => (
            <div key={series.key} className="chart-tooltip-row">
              <span>{series.label}</span>
              <span>{fmt(point[series.key] || 0)}/yr</span>
            </div>
          ))}
          {showMtr && point.marginal_tax_rate !== null && point.marginal_tax_rate !== undefined ? (
            <div className="chart-tooltip-row">
              <span>Marginal tax rate</span>
              <span>{fmtMtr(point.marginal_tax_rate)}</span>
            </div>
          ) : null}
        </div>
        {tooltipCliff?.drivers?.length ? (
          <div className="chart-tooltip-divider">
            {tooltipCliff.kind === 'upcoming' ? (
              <p className="chart-tooltip-subtle">
                At {fmt(tooltipCliff.targetIncomeAnnual)}/yr in wages and salaries
              </p>
            ) : null}
            <p className="chart-tooltip-label">Main cliff drivers</p>
            {tooltipCliff.drivers.slice(0, 3).map((driver) => (
              <div key={driver.key} className="chart-tooltip-row">
                <span>{driver.label}</span>
                <span>{fmt(Math.abs(driver.resource_effect_annual))}/yr</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const legendSeries = chartMode === 'net_income'
    ? NET_VIEW_SERIES
    : detailLegendSeries

  return (
    <div className="chart-wrapper chart-wrapper--full">
      <div className="chart-panel-header">
        <div>
          <h4>{chartMode === 'net_income' ? 'Net income over wages and salaries' : 'Program detail over wages and salaries'}</h4>
          <p>
            {chartMode === 'net_income'
              ? 'Track how annual net income changes as wages and salaries rise, with earnings dead zones shaded and cliff markers anchored to the last sampled income before a drop.'
              : 'Turn programs on and off to see wages and salaries and supports above zero, federal and state taxes below zero, and the black line showing final annual net income.'}
          </p>
        </div>
        <div className="chart-view-toggle" role="tablist" aria-label="Chart view">
          {CHART_MODE_OPTIONS.map((option) => {
            const isActive = chartMode === option.key
            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`chart-view-button ${isActive ? 'active' : ''}`}
                onClick={() => setChartMode(option.key)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="chart-legend">
        {legendSeries.map((series) => {
          const isActive = chartMode === 'net_income'
            ? Boolean(netVisibleKeys[series.key])
            : Boolean(detailVisibleKeys[series.key])

          return (
            <button
              key={series.key}
              type="button"
              className={`chart-toggle ${isActive ? 'active' : ''}`}
              onClick={() => (
                chartMode === 'net_income'
                  ? toggleNetSeries(series.key)
                  : toggleDetailSeries(series.key)
              )}
              style={{
                '--legend-stroke': series.stroke,
              }}
            >
              <span
                className={`chart-legend-swatch ${series.type === 'line' ? 'chart-legend-swatch--line' : ''}`}
                style={{
                  '--legend-stroke': series.stroke,
                  '--legend-fill': series.fill || 'transparent',
                }}
              />
              <span>{series.label}</span>
            </button>
          )
        })}
        {highlightedCliffs.length ? (
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
        <button
          type="button"
          className={`chart-toggle ${showMtr ? 'active' : ''}`}
          onClick={() => setShowMtr((current) => !current)}
          style={{
            '--legend-stroke': MTR_COLOR,
          }}
        >
          <span
            className="chart-legend-swatch chart-legend-swatch--line"
            style={{
              '--legend-stroke': MTR_COLOR,
              '--legend-fill': 'transparent',
            }}
          />
          <span>Marginal tax rate</span>
        </button>
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
            data={annualizedData}
            margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
            stackOffset={chartMode === 'program_detail' ? 'sign' : undefined}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" vertical={false} />
            <XAxis
              dataKey="earned_income_annual"
              type="number"
              domain={[0, xTicks[xTicks.length - 1]]}
              ticks={xTicks}
              tickFormatter={fmt}
              label={{ value: 'Annual household wages and salaries', position: 'bottom', offset: -5, fill: '#6b7280', fontSize: 11 }}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={{ stroke: '#e5e2dd' }}
              tickLine={{ stroke: '#e5e2dd' }}
            />
            <YAxis
              yAxisId="left"
              domain={chartMode === 'net_income'
                ? [0, netYTicks[netYTicks.length - 1]]
                : detailDomain}
              ticks={chartMode === 'net_income' ? netYTicks : detailYTicks}
              tickFormatter={fmt}
              label={{
                value: 'Annual amount ($)',
                angle: -90,
                position: 'insideLeft',
                dx: -5,
                style: { textAnchor: 'middle', fill: '#6b7280', fontSize: 11 },
              }}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={{ stroke: '#e5e2dd' }}
              tickLine={{ stroke: '#e5e2dd' }}
            />
            {showMtr ? (
              <YAxis
                yAxisId="mtr"
                orientation="right"
                domain={[
                  (dataMin) => Math.min(0, dataMin),
                  (dataMax) => Math.max(1.5, dataMax),
                ]}
                tickFormatter={(value) => `${Math.round(value * 100)}%`}
                label={{
                  value: 'Marginal tax rate',
                  angle: 90,
                  position: 'insideRight',
                  dx: 10,
                  style: { textAnchor: 'middle', fill: MTR_COLOR, fontSize: 11 },
                }}
                tick={{ fill: MTR_COLOR, fontSize: 11 }}
                axisLine={{ stroke: '#e5e2dd' }}
                tickLine={{ stroke: '#e5e2dd' }}
              />
            ) : null}
            <Tooltip content={chartMode === 'net_income' ? <NetTooltip /> : <DetailTooltip />} />
            <ReferenceLine
              yAxisId="left"
              y={0}
              stroke={chartMode === 'program_detail' ? '#475569' : '#cbd5e1'}
              strokeWidth={chartMode === 'program_detail' ? 2.2 : 1.1}
            />

            {showCliffHighlights && chartMode === 'net_income'
              ? deadZoneBands.map((zone) => {
                return (
                  <ReferenceArea
                    key={`dead-zone-${zone.startIncomeAnnual}-${zone.recoveryIncomeAnnual}`}
                    yAxisId="left"
                    x1={zone.startIncomeAnnual}
                    x2={zone.recoveryIncomeAnnual}
                    fill="#FCA5A5"
                    fillOpacity={0.28}
                    strokeOpacity={0}
                    ifOverflow="extendDomain"
                  />
                )
              })
              : null}

            {chartMode === 'net_income' ? (
              visibleNetSeries.map((series) => (
                <Line
                  key={series.key}
                  yAxisId="left"
                  type="monotone"
                  dataKey={series.key}
                  stroke={series.stroke}
                  strokeWidth={series.strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  isAnimationActive={false}
                  activeDot={series.key === 'net_resources_annual'
                    ? { r: 6, fill: '#111827', stroke: '#ffffff', strokeWidth: 2 }
                    : false}
                />
              ))
            ) : (
              <>
                {visibleDetailAreaSeries.map((series) => (
                  <Area
                    key={series.key}
                    yAxisId="left"
                    type="linear"
                    dataKey={series.key}
                    stackId="income-stack"
                    stroke={series.hideStroke ? 'none' : series.stroke}
                    fill={series.fill}
                    fillOpacity={
                      series.key === 'federal_taxes_before_refundable_credits_annual'
                      || series.key === 'state_taxes_before_refundable_credits_annual'
                        ? 0.78
                        : 0.9
                    }
                    strokeOpacity={series.hideStroke ? 0 : 0.38}
                    strokeWidth={series.hideStroke ? 0 : 1.15}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
                {visibleDetailLineSeries.map((series) => (
                  <Line
                    key={series.key}
                    yAxisId="left"
                    type="monotone"
                    dataKey={series.key}
                    stroke={series.stroke}
                    strokeWidth={series.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 5, fill: '#111827', stroke: '#ffffff', strokeWidth: 2 }}
                  />
                ))}
              </>
            )}

            {showMtr ? (
              <Line
                yAxisId="mtr"
                type="monotone"
                dataKey="marginal_tax_rate"
                stroke={MTR_COLOR}
                strokeWidth={2}
                strokeDasharray="5 3"
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={{ r: 4, fill: MTR_COLOR, stroke: '#ffffff', strokeWidth: 2 }}
              />
            ) : null}

            {showCliffHighlights
              ? highlightedCliffs.map((cliff) => {
                const style = CLIFF_HIGHLIGHT_STYLES[cliff.severity?.tone] || CLIFF_HIGHLIGHT_STYLES.moderate
                return (
                  <ReferenceDot
                    key={`cliff-dot-${cliff.startIncomeAnnual}-${cliff.endIncomeAnnual}`}
                    yAxisId="left"
                    x={cliff.startIncomeAnnual}
                    y={cliff.beforeResourcesAnnual}
                    r={chartMode === 'program_detail' ? 5.5 : 4.75}
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

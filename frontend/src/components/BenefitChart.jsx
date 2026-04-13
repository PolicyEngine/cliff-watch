import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
} from 'recharts'
import { niceTicks } from '../utils/niceTicks'
import { buildCliffReport } from '../utils/cliffReport'

const fmt = (value) => value.toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const NET_LINE_SERIES = [
  {
    key: 'net_resources_annual',
    label: 'Net resources',
    type: 'line',
    stroke: '#111827',
    strokeWidth: 2.8,
    defaultVisible: true,
  },
  {
    key: 'earned_income_annual',
    label: 'Earnings',
    type: 'line',
    stroke: '#64748B',
    strokeWidth: 2,
    strokeDasharray: '6 4',
    defaultVisible: true,
  },
]

const DETAIL_VIEW_OPTIONS = [
  {
    key: 'support',
    label: 'Support only',
  },
  {
    key: 'net_income',
    label: 'Net income',
  },
]

const SUPPORT_DETAIL_LINE_SERIES = [
  {
    key: 'net_support_after_taxes_annual',
    label: 'Net support after taxes',
    type: 'line',
    stroke: '#111827',
    strokeWidth: 2.6,
    defaultVisible: true,
  },
]

const NET_INCOME_DETAIL_LINE_SERIES = [
  {
    key: 'detail_net_resources_annual',
    label: 'Net resources',
    type: 'line',
    stroke: '#111827',
    strokeWidth: 2.6,
    defaultVisible: true,
  },
  {
    key: 'taxes_annual',
    label: 'Taxes',
    type: 'line',
    stroke: '#B45309',
    strokeWidth: 2,
    strokeDasharray: '5 4',
    defaultVisible: true,
  },
]

const EARNINGS_AREA_SERIES = {
  key: 'earnings_after_taxes_annual',
  label: 'Earnings',
  type: 'area',
  stroke: '#6B7B93',
  fill: '#D8E1EC',
}

const BASE_DETAIL_AREA_SERIES = [
  {
    key: 'eitc_annual',
    label: 'Federal EITC',
    type: 'area',
    stroke: '#7A5CC8',
    fill: '#D8CAF5',
  },
  {
    key: 'ctc_annual',
    label: 'Federal CTC',
    type: 'area',
    stroke: '#6653BE',
    fill: '#CFC8F6',
  },
  {
    key: 'refundable_american_opportunity_credit_annual',
    label: 'Refundable American Opportunity Credit',
    type: 'area',
    stroke: '#8B5CF6',
    fill: '#E7D9FF',
  },
  {
    key: 'recovery_rebate_credit_annual',
    label: 'Recovery Rebate Credit',
    type: 'area',
    stroke: '#A855F7',
    fill: '#F0D9FF',
  },
  {
    key: 'refundable_payroll_tax_credit_annual',
    label: 'Refundable Payroll Tax Credit',
    type: 'area',
    stroke: '#9333EA',
    fill: '#EAD7FA',
  },
  {
    key: 'state_eitc_annual',
    label: 'State EITC',
    type: 'area',
    stroke: '#6D28D9',
    fill: '#DCCEF9',
  },
  {
    key: 'state_ctc_annual',
    label: 'State CTC',
    type: 'area',
    stroke: '#5B46B2',
    fill: '#CCC5F1',
  },
  {
    key: 'state_cdcc_annual',
    label: 'State CDCC',
    type: 'area',
    stroke: '#805AD5',
    fill: '#E4D7F8',
  },
  {
    key: 'state_property_tax_credit_annual',
    label: 'State property tax credit',
    type: 'area',
    stroke: '#A16207',
    fill: '#F9DB84',
  },
  {
    key: 'vt_renter_credit_annual',
    label: 'Vermont renter credit',
    type: 'area',
    stroke: '#A16207',
    fill: '#F3D18D',
  },
  {
    key: 'va_refundable_eitc_if_claimed_annual',
    label: 'Virginia refundable EITC',
    type: 'area',
    stroke: '#6D28D9',
    fill: '#D9CFFB',
  },
  {
    key: 'va_low_income_tax_credit_annual',
    label: 'Virginia low income tax credit',
    type: 'area',
    stroke: '#0F766E',
    fill: '#A7E4DB',
  },
  {
    key: 'nm_low_income_comprehensive_tax_rebate_annual',
    label: 'New Mexico low income tax rebate',
    type: 'area',
    stroke: '#0F766E',
    fill: '#91DDD3',
  },
  {
    key: 'tanf_annual',
    label: 'TANF',
    type: 'area',
    stroke: '#9A5A3C',
    fill: '#D7AE8E',
  },
  {
    key: 'snap_annual',
    label: 'SNAP',
    type: 'area',
    stroke: '#4A9B68',
    fill: '#9BD3A8',
  },
  {
    key: 'wic_annual',
    label: 'WIC',
    type: 'area',
    stroke: '#D17AA4',
    fill: '#F1C4D8',
  },
  {
    key: 'free_school_meals_annual',
    label: 'School meals',
    type: 'area',
    stroke: '#C9963E',
    fill: '#F0D29E',
  },
  {
    key: 'medicaid_annual',
    label: 'Medicaid',
    type: 'area',
    stroke: '#D66D7F',
    fill: '#F2B7C1',
  },
  {
    key: 'chip_annual',
    label: 'CHIP',
    type: 'area',
    stroke: '#7684D6',
    fill: '#C7CEF5',
  },
  {
    key: 'aca_ptc_annual',
    label: 'ACA',
    type: 'area',
    stroke: '#4F83CC',
    fill: '#B7D1F2',
  },
]

const REFUNDABLE_CREDIT_AREA_KEYS = new Set([
  'eitc_annual',
  'ctc_annual',
  'refundable_american_opportunity_credit_annual',
  'recovery_rebate_credit_annual',
  'refundable_payroll_tax_credit_annual',
  'state_eitc_annual',
  'state_ctc_annual',
  'state_cdcc_annual',
  'state_property_tax_credit_annual',
  'vt_renter_credit_annual',
  'va_refundable_eitc_if_claimed_annual',
  'va_low_income_tax_credit_annual',
  'nm_low_income_comprehensive_tax_rebate_annual',
])

const CLIFF_HIGHLIGHT_STYLES = {
  severe: {
    fill: '#F8B4B4',
    stroke: '#DC2626',
    dotFill: '#DC2626',
  },
  moderate: {
    fill: '#F7D08A',
    stroke: '#D97706',
    dotFill: '#D97706',
  },
  mild: {
    fill: '#FDE68A',
    stroke: '#CA8A04',
    dotFill: '#CA8A04',
  },
}

function chooseNiceStep(rawStep) {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const normalized = rawStep / magnitude

  if (normalized <= 1) return 1 * magnitude
  if (normalized <= 2) return 2 * magnitude
  if (normalized <= 2.5) return 2.5 * magnitude
  if (normalized <= 5) return 5 * magnitude
  return 10 * magnitude
}

function signedNiceTicks(minValue, maxValue, targetCount = 6) {
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

function BenefitChart({ data, currentIncome }) {
  const [netVisibleKeys, setNetVisibleKeys] = useState({})
  const [detailVisibleKeys, setDetailVisibleKeys] = useState({})
  const [detailView, setDetailView] = useState('support')
  const [showCliffHighlights, setShowCliffHighlights] = useState(true)

  const annualizedData = useMemo(() => (
    (data || []).map((point) => {
      const taxesAnnual = Number(point.taxes || 0)
      const coreSupportAnnual = Number(point.core_support || 0)

      return {
        ...point,
        earned_income_annual: Number(point.earned_income || 0),
        earnings_after_taxes_annual: Math.max(0, Number(point.earned_income || 0) - taxesAnnual),
        net_resources_annual: Number(point.net_resources || 0),
        detail_net_resources_annual: Number(point.net_resources || 0),
        core_support_annual: coreSupportAnnual,
        net_support_after_taxes_annual: coreSupportAnnual - taxesAnnual,
        medicaid_annual: Number(point.medicaid || 0),
        chip_annual: Number(point.chip || 0),
        aca_ptc_annual: Number(point.aca_ptc || 0),
        snap_annual: Number(point.snap || 0),
        eitc_annual: Number(point.eitc || 0),
        ctc_annual: Number(point.ctc || 0),
        refundable_american_opportunity_credit_annual: Number(point.refundable_american_opportunity_credit || 0),
        recovery_rebate_credit_annual: Number(point.recovery_rebate_credit || 0),
        refundable_payroll_tax_credit_annual: Number(point.refundable_payroll_tax_credit || 0),
        state_eitc_annual: Number(point.state_eitc || 0),
        state_ctc_annual: Number(point.state_ctc || 0),
        state_cdcc_annual: Number(point.state_cdcc || 0),
        state_property_tax_credit_annual: Number(point.state_property_tax_credit || 0),
        vt_renter_credit_annual: Number(point.vt_renter_credit || 0),
        va_refundable_eitc_if_claimed_annual: Number(point.va_refundable_eitc_if_claimed || 0),
        va_low_income_tax_credit_annual: Number(point.va_low_income_tax_credit || 0),
        nm_low_income_comprehensive_tax_rebate_annual: Number(point.nm_low_income_comprehensive_tax_rebate || 0),
        tanf_annual: Number(point.tanf || 0),
        free_school_meals_annual: Number(point.free_school_meals || 0),
        wic_annual: Number(point.wic || 0),
        taxes_annual: taxesAnnual,
        net_change_annual_display: Number(point.net_change_annual || 0),
        cliff_drop_annual: Number(point.cliff_drop_annual || 0),
      }
    })
  ), [data])

  const detailLineSeries = useMemo(() => (
    detailView === 'net_income' ? NET_INCOME_DETAIL_LINE_SERIES : SUPPORT_DETAIL_LINE_SERIES
  ), [detailView])

  const detailAreaCatalog = useMemo(() => (
    detailView === 'net_income'
      ? [EARNINGS_AREA_SERIES, ...BASE_DETAIL_AREA_SERIES]
      : BASE_DETAIL_AREA_SERIES
  ), [detailView])

  const detailAreaSeries = useMemo(() => {
    if (!annualizedData.length) {
      return []
    }

    const activeAreaKeys = new Set(
      detailAreaCatalog
        .map((series) => ({
          key: series.key,
          maxValue: Math.max(...annualizedData.map((item) => Math.abs(Number(item[series.key] || 0)))),
        }))
        .filter((series) => series.maxValue > 0)
        .sort((left, right) => right.maxValue - left.maxValue)
        .slice(0, 6)
        .map((series) => series.key),
    )

    return detailAreaCatalog
      .filter((series) => annualizedData.some((item) => Math.abs(Number(item[series.key] || 0)) > 0))
      .map((series) => ({
        ...series,
        defaultVisible:
          series.key === 'earnings_after_taxes_annual'
          || REFUNDABLE_CREDIT_AREA_KEYS.has(series.key)
          || activeAreaKeys.has(series.key),
      }))
  }, [annualizedData, detailAreaCatalog])

  const allDetailSeries = useMemo(() => (
    [...detailLineSeries, ...detailAreaSeries]
  ), [detailLineSeries, detailAreaSeries])

  useEffect(() => {
    setNetVisibleKeys((current) => {
      const next = {}
      NET_LINE_SERIES.forEach((series) => {
        next[series.key] = current[series.key] ?? series.defaultVisible
      })
      return next
    })
  }, [])

  useEffect(() => {
    if (!allDetailSeries.length) {
      setDetailVisibleKeys({})
      return
    }

    setDetailVisibleKeys((current) => {
      const next = {}
      allDetailSeries.forEach((series) => {
        next[series.key] = current[series.key] ?? series.defaultVisible
      })
      return next
    })
  }, [allDetailSeries])

  const visibleNetSeries = useMemo(() => (
    NET_LINE_SERIES.filter((series) => netVisibleKeys[series.key])
  ), [netVisibleKeys])

  const visibleDetailAreaSeries = useMemo(() => (
    detailAreaSeries.filter((series) => detailVisibleKeys[series.key])
  ), [detailAreaSeries, detailVisibleKeys])

  const visibleDetailLineSeries = useMemo(() => (
    detailLineSeries.filter((series) => detailVisibleKeys[series.key])
  ), [detailLineSeries, detailVisibleKeys])

  const detailLegendSeries = useMemo(() => {
    if (detailView !== 'net_income') {
      return [...detailLineSeries, ...detailAreaSeries]
    }

    const netResourcesSeries = detailLineSeries.find((series) => series.key === 'detail_net_resources_annual')
    const taxesSeries = detailLineSeries.find((series) => series.key === 'taxes_annual')
    const earningsSeries = detailAreaSeries.find((series) => series.key === 'earnings_after_taxes_annual')
    const remainingAreas = detailAreaSeries.filter((series) => series.key !== 'earnings_after_taxes_annual')

    return [
      netResourcesSeries,
      earningsSeries,
      taxesSeries,
      ...remainingAreas,
    ].filter(Boolean)
  }, [detailAreaSeries, detailLineSeries, detailView])

  const cliffReport = useMemo(() => buildCliffReport(annualizedData), [annualizedData])
  const highlightedZones = cliffReport.zones || []
  const highlightedCliffs = cliffReport.cliffs || []

  const {
    xTicks,
    mainYTicks,
    detailYTicks,
    detailDomain,
  } = useMemo(() => {
    if (!annualizedData.length) {
      return {
        xTicks: [0],
        mainYTicks: [0],
        detailYTicks: [0],
        detailDomain: [0, 0],
      }
    }

    const xMax = Math.max(...annualizedData.map((item) => item.earned_income_annual))
    const mainYMax = Math.max(
      0,
      ...annualizedData.map((item) => Math.max(
        ...visibleNetSeries.map((series) => Number(item[series.key] || 0)),
      )),
    )

    let detailMax = 0
    let detailMin = 0

    annualizedData.forEach((point) => {
      let positiveStack = 0
      let negativeStack = 0

      visibleDetailAreaSeries.forEach((series) => {
        const value = Number(point[series.key] || 0)
        if (value >= 0) {
          positiveStack += value
        } else {
          negativeStack += value
        }
      })

      const lineValues = visibleDetailLineSeries.map((series) => Number(point[series.key] || 0))

      detailMax = Math.max(detailMax, positiveStack, ...lineValues, 0)
      detailMin = Math.min(detailMin, negativeStack, ...lineValues, 0)
    })

    const computedDetailYTicks = signedNiceTicks(detailMin, detailMax)

    return {
      xTicks: niceTicks(xMax),
      mainYTicks: niceTicks(mainYMax),
      detailYTicks: computedDetailYTicks,
      detailDomain: [
        computedDetailYTicks[0],
        computedDetailYTicks[computedDetailYTicks.length - 1],
      ],
    }
  }, [annualizedData, visibleNetSeries, visibleDetailAreaSeries, visibleDetailLineSeries])

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

  const NetTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) {
      return null
    }

    const point = payload[0].payload

    return (
      <div className="chart-tooltip">
        <p className="chart-tooltip-kicker">Earnings: {fmt(label)}/yr</p>
        <p className="chart-tooltip-highlight">Net resources: {fmt(point.net_resources_annual)}/yr</p>
        <p className="chart-tooltip-subtle">
          Net support after taxes: {fmt(point.net_support_after_taxes_annual)}/yr
        </p>
        {point.has_previous_point ? (
          <p className="chart-tooltip-subtle">
            Change vs prior point: {fmt(point.net_change_annual_display)}/yr
          </p>
        ) : null}
        {point.is_cliff ? (
          <div className="chart-tooltip-divider">
            <p className="chart-tooltip-label">Main cliff drivers</p>
            {(point.cliff_drivers || []).slice(0, 3).map((driver) => (
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
    const activeSeries = detailLegendSeries.filter((series) => {
      const isVisible = detailVisibleKeys[series.key]
      if (!isVisible) {
        return false
      }
      return series.type === 'line' || Math.abs(Number(point[series.key] || 0)) > 0
    })

    return (
      <div className="chart-tooltip">
        <p className="chart-tooltip-kicker">Earnings: {fmt(label)}/yr</p>
        <p className="chart-tooltip-highlight">
          {detailView === 'net_income' ? 'Net resources' : 'Net support after taxes'}:
          {' '}
          {fmt(
            detailView === 'net_income'
              ? point.detail_net_resources_annual
              : point.net_support_after_taxes_annual,
          )}
          /yr
        </p>
        <div className="chart-tooltip-divider">
          {activeSeries.map((series) => (
            <div key={series.key} className="chart-tooltip-row">
              <span>{series.label}</span>
              <span>{fmt(point[series.key] || 0)}/yr</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="chart-stack">
      <div className="chart-wrapper chart-wrapper--primary">
        <div className="chart-legend">
          {NET_LINE_SERIES.map((series) => {
            const isActive = Boolean(netVisibleKeys[series.key])
            return (
              <button
                key={series.key}
                type="button"
                className={`chart-toggle ${isActive ? 'active' : ''}`}
                onClick={() => toggleNetSeries(series.key)}
                style={{
                  '--legend-stroke': series.stroke,
                }}
              >
                <span
                  className="chart-legend-swatch chart-legend-swatch--line"
                  style={{
                    '--legend-stroke': series.stroke,
                    '--legend-fill': 'transparent',
                    '--legend-dash': series.strokeDasharray || 'none',
                  }}
                />
                <span>{series.label}</span>
              </button>
            )
          })}
          {highlightedZones.length ? (
            <button
              type="button"
              className={`chart-toggle ${showCliffHighlights ? 'active' : ''}`}
              onClick={() => setShowCliffHighlights((current) => !current)}
              style={{
                '--legend-stroke': CLIFF_HIGHLIGHT_STYLES.severe.stroke,
              }}
            >
              <span
                className="chart-legend-swatch"
                style={{
                  '--legend-stroke': CLIFF_HIGHLIGHT_STYLES.severe.stroke,
                  '--legend-fill': CLIFF_HIGHLIGHT_STYLES.severe.fill,
                }}
              />
              <span>Cliff highlights</span>
            </button>
          ) : null}
        </div>

        <div className="chart-canvas">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={annualizedData}
              margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" />
              <XAxis
                dataKey="earned_income_annual"
                type="number"
                domain={[0, xTicks[xTicks.length - 1]]}
                ticks={xTicks}
                tickFormatter={fmt}
                label={{ value: 'Annual household earnings', position: 'bottom', offset: -5, fill: '#6b7280', fontSize: 11 }}
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e2dd' }}
                tickLine={{ stroke: '#e5e2dd' }}
              />
              <YAxis
                domain={[0, mainYTicks[mainYTicks.length - 1]]}
                ticks={mainYTicks}
                tickFormatter={fmt}
                label={{ value: 'Annual dollars', angle: -90, position: 'insideLeft', dx: -5, style: { textAnchor: 'middle', fill: '#6b7280', fontSize: 11 } }}
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e2dd' }}
                tickLine={{ stroke: '#e5e2dd' }}
              />
              <Tooltip content={<NetTooltip />} />
              <ReferenceLine y={0} stroke="#e5e2dd" />
              {showCliffHighlights
                ? highlightedZones.map((zone) => {
                  const style = CLIFF_HIGHLIGHT_STYLES[zone.severity?.tone] || CLIFF_HIGHLIGHT_STYLES.moderate
                  return (
                    <ReferenceArea
                      key={`net-zone-${zone.id}`}
                      x1={zone.startIncomeAnnual}
                      x2={zone.endIncomeAnnual}
                      ifOverflow="extendDomain"
                      isFront={false}
                      fill={style.fill}
                      fillOpacity={0.12}
                      strokeOpacity={0}
                    />
                  )
                })
                : null}
              {showCliffHighlights && netVisibleKeys.net_resources_annual
                ? highlightedCliffs.map((cliff) => {
                  const style = CLIFF_HIGHLIGHT_STYLES[cliff.severity?.tone] || CLIFF_HIGHLIGHT_STYLES.moderate
                  return (
                    <ReferenceDot
                      key={`net-point-${cliff.startIncomeAnnual}-${cliff.endIncomeAnnual}`}
                      x={cliff.endIncomeAnnual}
                      y={cliff.afterResourcesAnnual}
                      r={4.5}
                      fill={style.dotFill}
                      stroke="#ffffff"
                      strokeWidth={2}
                      ifOverflow="extendDomain"
                      isFront
                    />
                  )
                })
                : null}
              {showCliffHighlights
                ? highlightedZones.map((zone) => {
                  const style = CLIFF_HIGHLIGHT_STYLES[zone.severity?.tone] || CLIFF_HIGHLIGHT_STYLES.moderate
                  return (
                    <ReferenceLine
                      key={`net-line-${zone.id}`}
                      x={zone.highestRiskIncomeAnnual}
                      stroke={style.stroke}
                      strokeDasharray="3 4"
                      strokeOpacity={0.55}
                    />
                  )
                })
                : null}
              {visibleNetSeries.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  stroke={series.stroke}
                  strokeWidth={series.strokeWidth}
                  strokeDasharray={series.strokeDasharray}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  isAnimationActive={false}
                  activeDot={series.key === 'net_resources_annual'
                    ? { r: 6, fill: '#111827', stroke: '#ffffff', strokeWidth: 2 }
                    : false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-wrapper chart-wrapper--detail">
        <div className="chart-panel-header">
          <div>
            <h4>{detailView === 'net_income' ? 'Net income composition' : 'Program decomposition'}</h4>
            <p>
              {detailView === 'net_income'
                ? 'Colored bands stack after-tax earnings and modeled supports. The orange line shows annual taxes, and the black line shows final net resources.'
                : 'Colored bands show modeled supports. The black line is the household\'s net support after taxes, relative to earnings alone.'}
            </p>
          </div>
          <div className="chart-view-toggle" role="tablist" aria-label="Decomposition view">
            {DETAIL_VIEW_OPTIONS.map((option) => {
              const isActive = detailView === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`chart-view-button ${isActive ? 'active' : ''}`}
                  onClick={() => setDetailView(option.key)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="chart-legend chart-legend--detail">
          {detailLegendSeries.map((series) => {
            const isActive = Boolean(detailVisibleKeys[series.key])
            return (
              <button
                key={series.key}
                type="button"
                className={`chart-toggle ${isActive ? 'active' : ''}`}
                onClick={() => toggleDetailSeries(series.key)}
                style={{
                  '--legend-stroke': series.stroke,
                }}
              >
                <span
                  className={`chart-legend-swatch ${series.type === 'line' ? 'chart-legend-swatch--line' : ''}`}
                  style={{
                    '--legend-stroke': series.stroke,
                    '--legend-fill': series.fill || 'transparent',
                    '--legend-dash': series.strokeDasharray || 'none',
                  }}
                />
                <span>{series.label}</span>
              </button>
            )
          })}
        </div>

        <div className="chart-canvas">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={annualizedData}
              margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
              stackOffset="sign"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e2dd" />
              <XAxis
                dataKey="earned_income_annual"
                type="number"
                domain={[0, xTicks[xTicks.length - 1]]}
                ticks={xTicks}
                tickFormatter={fmt}
                label={{ value: 'Annual household earnings', position: 'bottom', offset: -5, fill: '#6b7280', fontSize: 11 }}
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e2dd' }}
                tickLine={{ stroke: '#e5e2dd' }}
              />
              <YAxis
                domain={detailDomain}
                ticks={detailYTicks}
                tickFormatter={fmt}
                label={{
                  value: detailView === 'net_income' ? 'Annual dollars' : 'Gain or loss beyond earnings',
                  angle: -90,
                  position: 'insideLeft',
                  dx: -5,
                  style: { textAnchor: 'middle', fill: '#6b7280', fontSize: 11 },
                }}
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e2dd' }}
                tickLine={{ stroke: '#e5e2dd' }}
              />
              <Tooltip content={<DetailTooltip />} />
              <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1.2} />
              {showCliffHighlights
                ? highlightedZones.map((zone) => {
                  const style = CLIFF_HIGHLIGHT_STYLES[zone.severity?.tone] || CLIFF_HIGHLIGHT_STYLES.moderate
                  return (
                    <ReferenceArea
                      key={`detail-zone-${zone.id}`}
                      x1={zone.startIncomeAnnual}
                      x2={zone.endIncomeAnnual}
                      ifOverflow="extendDomain"
                      isFront={false}
                      fill={style.fill}
                      fillOpacity={0.08}
                      strokeOpacity={0}
                    />
                  )
                })
                : null}
              {visibleDetailAreaSeries.map((series) => (
                <Area
                  key={series.key}
                  type="stepAfter"
                  dataKey={series.key}
                  stackId="impact-stack"
                  stroke={series.stroke}
                  fill={series.fill}
                  fillOpacity={0.92}
                  strokeWidth={1.2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
              {visibleDetailLineSeries.map((series) => (
                <Line
                  key={series.key}
                  type={series.key === 'taxes_annual' ? 'monotone' : 'stepAfter'}
                  dataKey={series.key}
                  stroke={series.stroke}
                  strokeWidth={series.strokeWidth}
                  strokeDasharray={series.strokeDasharray}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={series.key === 'taxes_annual'
                    ? { r: 4, fill: '#B45309', stroke: '#ffffff', strokeWidth: 2 }
                    : { r: 5, fill: '#111827', stroke: '#ffffff', strokeWidth: 2 }}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default BenefitChart

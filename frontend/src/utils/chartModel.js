import { filterMaterialCliffDrivers } from './cliffReport.js'
import {
  MTR_OTHER_KEY,
  appendMtrSeries,
  hasMaterialMtrValues,
  mtrKeyFor,
} from './mtrSeries.js'

// The chart draws one identity from two angles:
//
//   net income = earnings + sum(component values)
//
// where every component (benefit, credit, tax, household cost) stores its
// signed contribution to net income. Levels views plot the values; marginal
// tax rate views plot their first differences over earnings, which decompose
// exactly because differencing is linear. Everything downstream — series,
// legends, tooltips, axes — derives from this registry.

const num = (value) => Number(value) || 0

export const fmtUsd = (value) => num(value).toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export const fmtMtr = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—'
  }
  return `${(Number(value) * 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}%`
}

export const fmtMtrSigned = (value) => (
  `${num(value) < 0 ? '−' : '+'}${fmtMtr(Math.abs(num(value)))}`
)

export const valueKey = (component) => `val_${component.key}`
export const contributionKey = (component) => mtrKeyFor(valueKey(component))
export { MTR_OTHER_KEY }

const supportComponent = (key, label, stroke, fill, extra = {}) => ({
  key,
  label,
  stroke,
  fill,
  group: 'support',
  ...extra,
  getValue: (point) => num(point?.[key]),
})

const taxComponent = (key, source, label, stroke, fill) => ({
  key,
  label,
  stroke,
  fill,
  group: 'tax',
  hideStroke: true,
  getValue: (point) => -num(point?.[source]),
})

const costComponent = (key, label, stroke, fill) => ({
  key: `cost_${key}`,
  label,
  stroke,
  fill,
  group: 'cost',
  hideStroke: true,
  getValue: (point) => -num(point?.household_costs?.[key]),
})

export const SUPPORT_COMPONENTS = [
  supportComponent('federal_refundable_credits', 'Federal refundable tax credits', '#7C3AED', '#DDD6FE', { credit: true }),
  supportComponent('state_refundable_credits', 'State refundable tax credits', '#6D28D9', '#C4B5FD', { credit: true }),
  supportComponent('tanf', 'TANF', '#9A5A3C', '#D7AE8E'),
  supportComponent('snap', 'SNAP', '#4A9B68', '#9BD3A8'),
  supportComponent('wic', 'WIC', '#D17AA4', '#F1C4D8'),
  supportComponent('free_school_meals', 'School meals', '#C9963E', '#F0D29E'),
  supportComponent('head_start', 'Head Start', '#0E7490', '#A5F3FC'),
  supportComponent('early_head_start', 'Early Head Start', '#155E75', '#BAE6FD'),
  supportComponent('child_care_subsidies', 'Child care subsidies', '#8B5CF6', '#DDD6FE'),
  supportComponent('housing_assistance', 'Housing assistance', '#047857', '#A7F3D0'),
  supportComponent('ssi', 'SSI', '#B45309', '#FDE68A'),
  supportComponent('ssdi', 'SSDI', '#78350F', '#FCD34D'),
  supportComponent('medicaid', 'Medicaid', '#0F766E', '#A7E4DB'),
  supportComponent('chip', 'CHIP', '#6366F1', '#C7D2FE'),
  supportComponent('aca_ptc', 'ACA', '#3B82F6', '#BFDBFE'),
]

export const TAX_COMPONENTS = [
  taxComponent('federal_taxes', 'federal_taxes_before_refundable_credits', 'Federal taxes', '#DC2626', '#FECACA'),
  taxComponent('state_taxes', 'state_taxes_before_refundable_credits', 'State taxes', '#B91C1C', '#FCA5A5'),
]

const HOUSEHOLD_COST_COLORS = [
  { stroke: '#9F1239', fill: '#FBCFE8' },
  { stroke: '#BE185D', fill: '#F9A8D4' },
  { stroke: '#831843', fill: '#FDA4AF' },
]

const DEFAULT_HOUSEHOLD_COST_DEFINITIONS = [
  { key: 'chip_premium', label: 'CHIP premium' },
]

export function getHouseholdCostDefinitions(metadata) {
  const definitions = metadata?.household_costs
  if (Array.isArray(definitions) && definitions.length) {
    return definitions
  }
  return DEFAULT_HOUSEHOLD_COST_DEFINITIONS
}

export function buildComponents(metadata) {
  const costComponents = getHouseholdCostDefinitions(metadata).map((cost, index) => {
    const colors = HOUSEHOLD_COST_COLORS[index % HOUSEHOLD_COST_COLORS.length]
    return costComponent(cost.key, cost.label, colors.stroke, colors.fill)
  })

  return [...SUPPORT_COMPONENTS, ...costComponents, ...TAX_COMPONENTS]
}

export const EARNINGS_AREA = {
  key: 'earnings',
  label: 'Wages and salaries',
  stroke: '#6B7B93',
  fill: '#D8E1EC',
}

export const NET_LINE = {
  key: 'net',
  label: 'Net income',
  stroke: '#111827',
  strokeWidth: 2.8,
}

export const MTR_LINE = {
  key: 'marginal_tax_rate',
  label: 'Marginal tax rate',
  stroke: '#111827',
  strokeWidth: 2.8,
}

export const MTR_OTHER_AREA = {
  key: MTR_OTHER_KEY,
  label: 'Other changes',
  stroke: '#64748B',
  fill: '#CBD5E1',
  hideStroke: true,
}

export const MEASURE_OPTIONS = [
  { key: 'income', label: 'Net income' },
  { key: 'mtr', label: 'Marginal tax rate' },
]

export const COMPOSITION_OPTIONS = [
  { key: 'total', label: 'Total' },
  { key: 'by_program', label: 'By program' },
]

export const VIEW_COPY = {
  'income:total': {
    title: 'Net income over wages and salaries',
    description: 'Track how annual net income changes as wages and salaries rise, with earnings dead zones shaded and cliff markers anchored to the last sampled income before a drop.',
  },
  'income:by_program': {
    title: 'Program detail over wages and salaries',
    description: 'Turn programs on and off to see wages and salaries and supports above zero, household costs and taxes below zero, and the black line showing final annual net income.',
  },
  'mtr:total': {
    title: 'Marginal tax rate over wages and salaries',
    description: 'The marginal tax rate is the share of each additional $1 of wages lost to taxes and benefit phase-outs. The chart caps at 100% — cliffs push past it, so hover to see exact rates.',
  },
  'mtr:by_program': {
    title: 'Marginal tax rate by program',
    description: 'Stacked bands show how much each tax and phase-out adds to the marginal tax rate; bands below zero, like credit phase-ins, reduce it. The black line is the combined rate, capped at 100% on the chart.',
  },
}

export const MTR_CAP = 1
export const MTR_FLOOR = -1
export const MTR_TICK_STEP = 0.25

// Builds the canonical chart points: raw API fields pass through, and each
// point gains earnings, net, signed component values, and marginal-tax-rate
// contributions plus upcoming-cliff annotations for tooltips.
export function buildChartPoints(rawPoints, components) {
  if (!rawPoints?.length) {
    return []
  }

  const base = rawPoints.map((point) => {
    const out = {
      ...point,
      earnings: num(point.earned_income),
      net: num(point.net_resources),
      net_change_display: num(point.net_change_annual),
    }
    components.forEach((component) => {
      out[valueKey(component)] = component.getValue(point)
    })
    return out
  })

  const withMtr = appendMtrSeries(base, components.map(valueKey), {
    earnedKey: 'earnings',
    netKey: 'net',
  })

  return withMtr.map((point, index) => {
    const next = withMtr[index + 1]
    if (!next?.is_cliff) {
      return point
    }

    return {
      ...point,
      has_upcoming_cliff: true,
      upcoming_cliff_drop_annual: num(next.cliff_drop_annual),
      upcoming_cliff_income: num(next.earnings),
      upcoming_cliff_drivers: filterMaterialCliffDrivers(next.cliff_drivers || []),
    }
  })
}

export function materialLevelComponents(points, components) {
  return components.filter((component) => (
    points.some((point) => Math.abs(num(point?.[valueKey(component)])) > 0)
  ))
}

export function materialMtrComponents(points, components) {
  return components.filter((component) => (
    hasMaterialMtrValues(points, contributionKey(component))
  ))
}

export function hasMaterialMtrResidual(points) {
  return hasMaterialMtrValues(points, MTR_OTHER_KEY, 0.005)
}

// Summary rows for the total-income tooltip, grouped the way people talk
// about a budget: benefits, credits, costs, taxes.
export function summarizeLevels(point, components) {
  const summary = {
    benefits: 0,
    federalCredits: 0,
    stateCredits: 0,
    costs: 0,
    federalTaxes: 0,
    stateTaxes: 0,
  }

  components.forEach((component) => {
    const value = num(point?.[valueKey(component)])
    if (component.group === 'support' && !component.credit) {
      summary.benefits += value
    } else if (component.key === 'federal_refundable_credits') {
      summary.federalCredits += value
    } else if (component.key === 'state_refundable_credits') {
      summary.stateCredits += value
    } else if (component.group === 'cost') {
      summary.costs += -value
    } else if (component.key === 'federal_taxes') {
      summary.federalTaxes += -value
    } else if (component.key === 'state_taxes') {
      summary.stateTaxes += -value
    }
  })

  return summary
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

export function signedNiceTicks(minValue, maxValue, targetCount = 10) {
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

// The marginal-tax-rate axis is capped at MTR_CAP: cliffs produce rates far
// beyond 100%, and letting them set the scale would flatten everything else.
// Values above the cap clip against the axis (allowDataOverflow) and the
// tooltip reports the exact rate.
export function mtrAxisFor(points, visibleContributionKeys) {
  let minValue = 0

  points.forEach((point) => {
    const total = Number(point?.marginal_tax_rate)
    if (Number.isFinite(total)) {
      minValue = Math.min(minValue, total)
    }
    const negativeStack = visibleContributionKeys.reduce(
      (sum, key) => sum + Math.min(0, num(point?.[key])),
      0,
    )
    minValue = Math.min(minValue, negativeStack)
  })

  const floor = Math.max(MTR_FLOOR, Math.floor(minValue / MTR_TICK_STEP) * MTR_TICK_STEP)
  const ticks = []
  for (let value = floor; value <= MTR_CAP + MTR_TICK_STEP / 2; value += MTR_TICK_STEP) {
    ticks.push(Math.round(value * 100) / 100)
  }

  return { ticks, domain: [floor, MTR_CAP] }
}

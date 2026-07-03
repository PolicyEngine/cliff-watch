import assert from 'node:assert/strict'
import test from 'node:test'

import { MTR_OTHER_KEY } from './mtrSeries.js'
import {
  SUPPORT_COMPONENTS,
  buildChartPoints,
  buildComponents,
  contributionKey,
  materialLevelComponents,
  materialMtrComponents,
  mtrAxisFor,
  summarizeLevels,
  valueKey,
} from './chartModel.js'

const assertClose = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  )
}

// A raw API point in the shape the series endpoint returns, with
// net_resources consistent with the accounting identity.
const apiPoint = (overrides = {}) => {
  const point = {
    earned_income: 0,
    snap: 0,
    tanf: 0,
    wic: 0,
    free_school_meals: 0,
    head_start: 0,
    early_head_start: 0,
    child_care_subsidies: 0,
    housing_assistance: 0,
    ssi: 0,
    ssdi: 0,
    medicaid: 0,
    chip: 0,
    aca_ptc: 0,
    federal_refundable_credits: 0,
    state_refundable_credits: 0,
    federal_taxes_before_refundable_credits: 0,
    state_taxes_before_refundable_credits: 0,
    household_costs: { chip_premium: 0 },
    ...overrides,
  }

  const supports = SUPPORT_COMPONENTS.reduce(
    (sum, component) => sum + (point[component.key] || 0),
    0,
  )
  point.net_resources = point.earned_income
    + supports
    - point.federal_taxes_before_refundable_credits
    - point.state_taxes_before_refundable_credits
    - point.household_costs.chip_premium

  return point
}

test('the component registry covers every program in the API series, including SSDI', () => {
  const keys = SUPPORT_COMPONENTS.map((component) => component.key)
  assert.ok(keys.includes('ssdi'), 'SSDI missing from the support registry')
  assert.equal(new Set(keys).size, keys.length, 'duplicate component keys')
})

test('buildChartPoints reproduces the net income identity, leaving no residual', () => {
  const components = buildComponents(null)
  const points = buildChartPoints(
    [
      apiPoint({ earned_income: 0, snap: 6000, medicaid: 4000 }),
      apiPoint({
        earned_income: 1000,
        snap: 5700,
        medicaid: 4000,
        federal_taxes_before_refundable_credits: 80,
        state_taxes_before_refundable_credits: 20,
        household_costs: { chip_premium: 50 },
      }),
    ],
    components,
  )

  const target = points[1]
  const componentSum = components.reduce(
    (sum, component) => sum + target[valueKey(component)],
    0,
  )
  assertClose(target.earnings + componentSum, target.net)

  // SNAP -$300, taxes +$100, CHIP premium +$50 over a $1,000 step.
  assertClose(target.marginal_tax_rate, 0.45)
  assertClose(target[MTR_OTHER_KEY], 0)

  const snap = components.find((component) => component.key === 'snap')
  assertClose(target[contributionKey(snap)], 0.3)
})

test('a benefit cliff decomposes into that program and pushes the rate past 100%', () => {
  const components = buildComponents(null)
  const points = buildChartPoints(
    [
      apiPoint({ earned_income: 20000, medicaid: 8000 }),
      apiPoint({ earned_income: 21000, medicaid: 0 }),
    ],
    components,
  )

  const medicaid = components.find((component) => component.key === 'medicaid')
  assertClose(points[1].marginal_tax_rate, 8)
  assertClose(points[1][contributionKey(medicaid)], 8)
})

test('buildChartPoints annotates the point before a cliff', () => {
  const components = buildComponents(null)
  const points = buildChartPoints(
    [
      apiPoint({ earned_income: 20000, medicaid: 8000 }),
      {
        ...apiPoint({ earned_income: 21000, medicaid: 0 }),
        is_cliff: true,
        cliff_drop_annual: 7000,
        cliff_drivers: [],
      },
    ],
    components,
  )

  assert.equal(points[0].has_upcoming_cliff, true)
  assert.equal(points[0].upcoming_cliff_income, 21000)
  assert.equal(points[0].upcoming_cliff_drop_annual, 7000)
})

test('material component filters drop all-zero series in both measures', () => {
  const components = buildComponents(null)
  const points = buildChartPoints(
    [
      apiPoint({ earned_income: 0, snap: 6000 }),
      apiPoint({ earned_income: 1000, snap: 6000 }),
      apiPoint({ earned_income: 2000, snap: 5500 }),
    ],
    components,
  )

  const levelKeys = materialLevelComponents(points, components).map((c) => c.key)
  assert.deepEqual(levelKeys, ['snap'])

  // SNAP is flat then phases out: it is the only marginal-rate contributor.
  const mtrKeys = materialMtrComponents(points, components).map((c) => c.key)
  assert.deepEqual(mtrKeys, ['snap'])
})

test('mtrAxisFor caps the top at 100% and floors at -100%', () => {
  const capped = mtrAxisFor(
    [{ marginal_tax_rate: 12.4 }],
    [],
  )
  assert.deepEqual(capped.domain, [0, 1])
  assert.deepEqual(capped.ticks, [0, 0.25, 0.5, 0.75, 1])

  const floored = mtrAxisFor(
    [{ marginal_tax_rate: -3, mtr_val_snap: -3 }],
    ['mtr_val_snap'],
  )
  assert.deepEqual(floored.domain, [-1, 1])
})

test('summarizeLevels groups benefits, credits, costs, and taxes', () => {
  const components = buildComponents(null)
  const points = buildChartPoints(
    [
      apiPoint({
        earned_income: 10000,
        snap: 3000,
        medicaid: 2000,
        federal_refundable_credits: 1500,
        state_refundable_credits: 500,
        federal_taxes_before_refundable_credits: 700,
        state_taxes_before_refundable_credits: 300,
        household_costs: { chip_premium: 240 },
      }),
    ],
    components,
  )

  const summary = summarizeLevels(points[0], components)
  assertClose(summary.benefits, 5000)
  assertClose(summary.federalCredits, 1500)
  assertClose(summary.stateCredits, 500)
  assertClose(summary.federalTaxes, 700)
  assertClose(summary.stateTaxes, 300)
  assertClose(summary.costs, 240)
})

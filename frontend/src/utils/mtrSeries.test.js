import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MTR_OTHER_KEY,
  appendMtrSeries,
  hasMaterialMtrValues,
  mtrKeyFor,
} from './mtrSeries.js'

const COMPONENT_KEYS = ['snap_annual', 'federal_taxes_before_refundable_credits_annual']

const assertClose = (actual, expected) => {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be within 1e-9 of ${expected}`,
  )
}

const point = (earned, net, snap, federalTaxes) => ({
  earned_income_annual: earned,
  net_resources_annual: net,
  snap_annual: snap,
  // Tax series are stored as negative contributions to net income.
  federal_taxes_before_refundable_credits_annual: -federalTaxes,
})

test('appendMtrSeries computes the total marginal tax rate between points', () => {
  const points = appendMtrSeries(
    [point(0, 5000, 5000, 0), point(1000, 5750, 5000, 250)],
    COMPONENT_KEYS,
  )

  // $1,000 more earned, $750 more net: 25% marginal tax rate.
  assertClose(points[1].marginal_tax_rate, 0.25)
})

test('appendMtrSeries decomposes the rate into per-series contributions', () => {
  const points = appendMtrSeries(
    [point(0, 5000, 5000, 0), point(1000, 5450, 4700, 250)],
    COMPONENT_KEYS,
  )

  // SNAP fell $300 and taxes rose $250 over a $1,000 step.
  assertClose(points[1][mtrKeyFor('snap_annual')], 0.3)
  assertClose(points[1][mtrKeyFor('federal_taxes_before_refundable_credits_annual')], 0.25)
  assertClose(points[1].marginal_tax_rate, 0.55)
  assert.ok(Math.abs(points[1][MTR_OTHER_KEY]) < 1e-9)
})

test('appendMtrSeries reports phase-ins as negative contributions', () => {
  const points = appendMtrSeries(
    [point(0, 0, 0, 0), point(1000, 1400, 400, 0)],
    COMPONENT_KEYS,
  )

  // A benefit ramping up $400 over a $1,000 step subtracts 40 points.
  assertClose(points[1][mtrKeyFor('snap_annual')], -0.4)
  assertClose(points[1].marginal_tax_rate, -0.4)
})

test('appendMtrSeries routes unmapped changes into the other bucket', () => {
  const points = appendMtrSeries(
    [
      { ...point(0, 5000, 5000, 0), mystery_annual: 1000 },
      { ...point(1000, 5000, 5000, 0), mystery_annual: 0 },
    ],
    COMPONENT_KEYS,
  )

  // Net income flat over a $1,000 step is a 100% MTR; no mapped series moved.
  assertClose(points[1].marginal_tax_rate, 1)
  assertClose(points[1][MTR_OTHER_KEY], 1)
})

test('appendMtrSeries carries the first interval back onto the first point', () => {
  const points = appendMtrSeries(
    [point(0, 5000, 5000, 0), point(1000, 5750, 5000, 250)],
    COMPONENT_KEYS,
  )

  assertClose(points[0].marginal_tax_rate, 0.25)
  assertClose(points[0][mtrKeyFor('federal_taxes_before_refundable_credits_annual')], 0.25)
})

test('appendMtrSeries leaves rates null when earnings do not increase', () => {
  const points = appendMtrSeries(
    [point(0, 5000, 5000, 0), point(0, 5750, 5000, 250)],
    COMPONENT_KEYS,
  )

  assert.equal(points[1].marginal_tax_rate, null)
  assert.equal(points[1][mtrKeyFor('snap_annual')], null)
  assert.equal(points[0].marginal_tax_rate, null)
})

test('appendMtrSeries contributions and residual sum to the total', () => {
  const points = appendMtrSeries(
    [
      { ...point(0, 5000, 5000, 0), extra_annual: 250 },
      { ...point(500, 3000, 2600, 300), extra_annual: 0 },
    ],
    COMPONENT_KEYS,
  )

  const target = points[1]
  const sum = COMPONENT_KEYS.reduce(
    (acc, key) => acc + target[mtrKeyFor(key)],
    target[MTR_OTHER_KEY],
  )
  assert.ok(Math.abs(sum - target.marginal_tax_rate) < 1e-9)
  // A $2,000 net drop over a $500 step is a 500% MTR — kept raw here; the
  // chart caps the axis, not the data.
  assertClose(target.marginal_tax_rate, 5)
})

test('hasMaterialMtrValues screens out numerical noise', () => {
  const points = [
    { mtr_snap_annual: 0.00002 },
    { mtr_snap_annual: -0.0004 },
  ]

  assert.equal(hasMaterialMtrValues(points, 'mtr_snap_annual'), false)
  assert.equal(
    hasMaterialMtrValues([...points, { mtr_snap_annual: 0.02 }], 'mtr_snap_annual'),
    true,
  )
})

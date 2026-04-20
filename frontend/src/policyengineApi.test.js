import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCliffDrivers,
  buildHouseholdResultFromResponse,
  buildSeriesDataFromResponse,
} from './policyengineApi.js'

const metadata = {
  states: [{ code: 'GA', name: 'Georgia' }],
  programs: [],
  household_costs: [{ key: 'chip_premium', label: 'CHIP premium' }],
}

const descriptor = {
  id: 'custom_household',
  label: '1 adult + 1 dependent',
  short_label: '1A/1D',
  description: 'Custom household.',
  summary: 'Test household.',
  counts: {
    num_adults: 1,
    num_children: 1,
    household_size: 2,
  },
  people: [
    {
      id: 'adult_1',
      role: 'head',
      kind: 'adult',
      age: 34,
      is_pregnant: false,
    },
    {
      id: 'child_1',
      role: 'dependent',
      kind: 'child',
      age: 8,
      is_pregnant: false,
    },
  ],
}

function householdResponse() {
  return {
    result: {
      households: {
        household: {
          household_market_income: { 2026: 30000 },
          household_tax_before_refundable_credits: { 2026: 1000 },
          household_state_tax_before_refundable_credits: { 2026: 300 },
          household_refundable_state_tax_credits: { 2026: 200 },
          chip_premium: { 2026: 600 },
        },
      },
      tax_units: {
        tax_unit: {
          tax_unit_fpg: { 2026: 20000 },
          income_tax_refundable_credits: { 2026: 400 },
          premium_tax_credit: { '2026-01': 50 },
        },
      },
      spm_units: {
        spm_unit: {
          snap: { '2026-01': 100 },
          free_school_meals: { 2026: 200 },
        },
      },
      people: {
        adult_1: {
          wic: { '2026-01': 0 },
          medicaid: { 2026: 0 },
          chip: { 2026: 0 },
          is_aca_ptc_eligible: { 2026: 0 },
          is_medicaid_eligible: { 2026: 0 },
          is_chip_eligible: { 2026: 0 },
        },
        child_1: {
          wic: { '2026-01': 0 },
          medicaid: { 2026: 0 },
          chip: { 2026: 5000 },
          is_aca_ptc_eligible: { 2026: 0 },
          is_medicaid_eligible: { 2026: 0 },
          is_chip_eligible: { 2026: 1 },
        },
      },
    },
  }
}

function seriesResponse() {
  return {
    result: {
      households: {
        household: {
          household_market_income: { 2026: [1000, 1500] },
          household_tax_before_refundable_credits: { 2026: [0, 0] },
          household_state_tax_before_refundable_credits: { 2026: [0, 0] },
          household_refundable_state_tax_credits: { 2026: [0, 0] },
          chip_premium: { 2026: [0, 1800] },
        },
      },
      tax_units: {
        tax_unit: {
          income_tax_refundable_credits: { 2026: [0, 0] },
          premium_tax_credit: { '2026-01': [0, 0] },
        },
      },
      spm_units: {
        spm_unit: {
          snap: { '2026-01': [100, 100] },
          free_school_meals: { 2026: [0, 0] },
        },
      },
      people: {
        adult_1: {
          employment_income: { 2026: [1000, 1500] },
          wic: { '2026-01': [0, 0] },
          medicaid: { 2026: [0, 0] },
          chip: { 2026: [0, 0] },
        },
        child_1: {
          wic: { '2026-01': [0, 0] },
          medicaid: { 2026: [0, 0] },
          chip: { 2026: [2000, 2000] },
        },
      },
    },
  }
}

test('buildHouseholdResultFromResponse subtracts CHIP premiums from net resources', () => {
  const payload = {
    state: 'GA',
    year: 2026,
    earned_income: 30000,
    filing_status: 'HEAD_OF_HOUSEHOLD',
  }

  const result = buildHouseholdResultFromResponse(
    payload,
    metadata,
    householdResponse(),
    descriptor,
  )

  assert.equal(result.household_costs.chip_premium, 600)
  assert.equal(result.totals.household_costs, 600)
  assert.equal(result.totals.net_resources, 36000)
  assert.equal(result.monthly.household_costs, 50)
})

test('buildCliffDrivers reports household cost increases as cliff drivers', () => {
  const previousPoint = {
    programs: {},
    household_costs: { chip_premium: 0 },
    totals: { taxes: 0 },
  }
  const currentPoint = {
    programs: {},
    household_costs: { chip_premium: 900 },
    totals: { taxes: 0 },
  }

  assert.deepEqual(
    buildCliffDrivers(previousPoint, currentPoint, metadata),
    [
      {
        key: 'chip_premium',
        label: 'CHIP premium',
        kind: 'household_cost_increase',
        raw_change_annual: 900,
        raw_change_monthly: 75,
        resource_effect_annual: -900,
        resource_effect_monthly: -75,
      },
    ],
  )
})

test('buildSeriesDataFromResponse carries CHIP premiums into series net resources and cliff drivers', () => {
  const payload = {
    state: 'GA',
    year: 2026,
    filing_status: 'HEAD_OF_HOUSEHOLD',
  }
  const seriesMeta = {
    pointCount: 2,
    effectiveStep: 500,
    alignedMaxEarnedIncome: 1500,
  }

  const result = buildSeriesDataFromResponse(
    payload,
    metadata,
    seriesResponse(),
    descriptor,
    seriesMeta,
  )

  assert.equal(result.data[1].chip_premium, 1800)
  assert.equal(result.data[1].net_resources, 2900)
  assert.equal(result.data[1].cliff_drop_annual, 1300)
  assert.equal(result.data[1].cliff_drivers[0].kind, 'household_cost_increase')
  assert.equal(result.data[1].cliff_drivers[0].label, 'CHIP premium')
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildHouseholdPayload,
  calculateSeries,
  createInitialInputs,
  getZipState,
  hasCompleteRequiredInputs,
  hasValidZip,
  reconcileInputs,
} from './dataLookup.js'
import {
  buildCliffDrivers,
  buildHouseholdResultFromResponse,
  buildSeriesDataFromResponse,
} from './policyengineApi.js'
import {
  applyFilingStatusSelection,
  applyMaritalStatusSelection,
} from './utils/filingStatus.js'

const metadata = {
  year: 2026,
  states: [
    { code: 'GA', name: 'Georgia' },
    { code: 'AL', name: 'Alabama' },
  ],
  counties_by_state: {
    GA: [{ code: 'FULTON_COUNTY_GA', name: 'Fulton County' }],
    AL: [{ code: 'MONTGOMERY_COUNTY_AL', name: 'Montgomery County' }],
  },
  defaults: {
    chart_max_earned_income: 1000,
    max_adults: 6,
    max_dependents: 6,
    people: [{ kind: 'adult' }],
    series_step: 500,
  },
  programs: [
    { key: 'tanf', label: 'TANF', short_label: 'TANF', description: '' },
    { key: 'chip', label: 'CHIP', short_label: 'CHIP', description: '' },
    { key: 'medicaid', label: 'Medicaid', short_label: 'Medicaid', description: '' },
  ],
  state_program_overrides: {
    GA: {
      tanf: { label: 'Georgia Temporary Assistance for Needy Families (TANF)' },
      chip: { label: "Georgia Children's Health Insurance Program (CHIP)" },
      medicaid: { label: 'Georgia Medicaid' },
    },
  },
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

test('buildCliffDrivers uses state-specific benefit labels', () => {
  const previousPoint = {
    programs: { tanf: 1200 },
    household_costs: {},
    totals: { taxes: 0 },
  }
  const currentPoint = {
    programs: { tanf: 0 },
    household_costs: {},
    totals: { taxes: 0 },
  }

  const drivers = buildCliffDrivers(previousPoint, currentPoint, metadata, 'GA')

  assert.equal(drivers[0].label, 'Georgia Temporary Assistance for Needy Families (TANF)')
})

test('buildCliffDrivers identifies the person losing Medicaid', () => {
  const previousPoint = {
    programs: { medicaid: 6332 },
    household_costs: {},
    totals: { taxes: 0 },
    person_programs: {
      medicaid: {
        adult_1: { label: 'Adult 1 Medicaid', value: 6332 },
        child_1: { label: 'Child 1 Medicaid', value: 0 },
      },
    },
  }
  const currentPoint = {
    programs: { medicaid: 0 },
    household_costs: {},
    totals: { taxes: 0 },
    person_programs: {
      medicaid: {
        adult_1: { label: 'Adult 1 Medicaid', value: 0 },
        child_1: { label: 'Child 1 Medicaid', value: 0 },
      },
    },
  }

  assert.deepEqual(
    buildCliffDrivers(previousPoint, currentPoint, metadata, 'GA'),
    [
      {
        key: 'medicaid:adult_1',
        label: 'Adult 1 Medicaid',
        kind: 'benefit_loss',
        program_key: 'medicaid',
        person_id: 'adult_1',
        raw_change_annual: -6332,
        raw_change_monthly: -527.67,
        resource_effect_annual: -6332,
        resource_effect_monthly: -527.67,
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

test('buildSeriesDataFromResponse carries person-level Medicaid cliff drivers', () => {
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
  const response = JSON.parse(JSON.stringify(seriesResponse()))
  response.result.people.adult_1.medicaid = { 2026: [6332, 0] }

  const result = buildSeriesDataFromResponse(
    payload,
    metadata,
    response,
    descriptor,
    seriesMeta,
  )

  assert.equal(result.data[0].person_programs.medicaid.adult_1.value, 6332)
  assert.equal(result.data[0].person_programs.medicaid.adult_1.label, 'Adult 1 Medicaid')
  assert.equal(result.data[1].cliff_drivers[0].key, 'medicaid:adult_1')
  assert.equal(result.data[1].cliff_drivers[0].label, 'Adult 1 Medicaid')
})

test('applyFilingStatusSelection adds a spouse when selecting a married status', () => {
  const result = applyFilingStatusSelection(
    {
      people: [
        { kind: 'adult', age: 33 },
        { kind: 'child', age: 6 },
      ],
    },
    'JOINT',
    { defaults: { max_adults: 6 } },
  )

  assert.equal(result.filing_status, 'JOINT')
  assert.deepEqual(
    result.people.map((person) => person.kind),
    ['adult', 'adult', 'child'],
  )
})

test('applyFilingStatusSelection leaves existing household members alone for non-married statuses', () => {
  const result = applyFilingStatusSelection(
    {
      people: [
        { kind: 'adult', age: 33 },
        { kind: 'child', age: 6 },
      ],
    },
    'HEAD_OF_HOUSEHOLD',
    { defaults: { max_adults: 6 } },
  )

  assert.deepEqual(result, { filing_status: 'HEAD_OF_HOUSEHOLD' })
})

test('applyMaritalStatusSelection adds a blank spouse when marking a household married', () => {
  const result = applyMaritalStatusSelection(
    {
      people: [
        { kind: 'adult', age: 33 },
        { kind: 'child', age: 6 },
      ],
    },
    'MARRIED',
    { defaults: { max_adults: 6 } },
  )

  assert.equal(result.marital_status, 'MARRIED')
  assert.deepEqual(
    result.people.map((person) => person.kind),
    ['adult', 'adult', 'child'],
  )
  assert.equal(result.people[1].age, '')
})

test('required inputs include state, marital status, and all visible ages', () => {
  const initial = createInitialInputs(metadata)

  assert.equal(initial.state, '')
  assert.equal(initial.county, '')
  assert.equal(initial.zip, '')
  assert.equal(initial.marital_status, '')
  assert.equal(initial.people[0].age, '')
  assert.equal('ssi_amount' in initial.people[0], false)
  assert.equal('ssdi_amount' in initial.people[0], false)
  assert.equal(hasCompleteRequiredInputs(initial), false)

  assert.equal(hasCompleteRequiredInputs({
    ...initial,
    state: 'GA',
    zip: '30303',
    marital_status: 'UNMARRIED',
    people: [{ kind: 'adult', age: 33 }],
  }), true)

  assert.equal(hasCompleteRequiredInputs({
    ...initial,
    state: 'GA',
    zip: '3030',
    marital_status: 'UNMARRIED',
    people: [{ kind: 'adult', age: 33 }],
  }), false)

  assert.equal(hasCompleteRequiredInputs({
    ...initial,
    state: 'GA',
    zip: '00001',
    marital_status: 'UNMARRIED',
    people: [{ kind: 'adult', age: 33 }],
  }), false)

  assert.equal(hasCompleteRequiredInputs({
    ...initial,
    state: 'MN',
    zip: '30303',
    marital_status: 'UNMARRIED',
    people: [{ kind: 'adult', age: 33 }],
  }), false)
})

test('ZIP validation requires a known ZIP prefix matching the selected state', () => {
  assert.equal(getZipState('30303'), 'GA')
  assert.equal(hasValidZip('30303', 'GA'), true)
  assert.equal(hasValidZip('30303', 'MN'), false)
  assert.equal(hasValidZip('00001', 'GA'), false)
})

test('adult ages below 18 normalize to 18', () => {
  const initial = createInitialInputs(metadata)
  const result = reconcileInputs({
    ...initial,
    people: [
      { kind: 'adult', age: 1 },
      { kind: 'child', age: 1 },
    ],
  }, metadata)

  assert.equal(result.people[0].age, 18)
  assert.equal(result.people[1].age, 1)
})

test('reconcileInputs derives state from ZIP code', () => {
  const initial = createInitialInputs(metadata)
  const georgia = reconcileInputs({
    ...initial,
    state: 'AL',
    zip: '30303',
  }, metadata)
  const invalidZip = reconcileInputs({
    ...initial,
    state: 'GA',
    zip: '00001',
  }, metadata)

  assert.equal(georgia.state, 'GA')
  assert.equal(invalidZip.state, '')
})

test('zip input is normalized and included in household payload', () => {
  const initial = createInitialInputs(metadata)
  const reconciled = reconcileInputs({
    ...initial,
    state: 'GA',
    zip: '30303-1234',
  }, metadata)
  const payload = buildHouseholdPayload({
    ...reconciled,
    marital_status: 'UNMARRIED',
    people: [{ kind: 'adult', age: 33 }],
  }, metadata)

  assert.equal(reconciled.zip, '30303')
  assert.equal(payload.zip, '30303')
})

test('county input normalizes to the selected state dropdown code', () => {
  const initial = createInitialInputs(metadata)
  const georgia = reconcileInputs({
    ...initial,
    state: 'GA',
    county: 'Fulton',
  }, metadata)

  assert.equal(georgia.county, 'FULTON_COUNTY_GA')

  const alabama = reconcileInputs({
    ...georgia,
    state: 'AL',
  }, metadata)

  assert.equal(alabama.county, '')
})

test('household payload omits direct SSI and SSDI amount inputs', () => {
  const payload = buildHouseholdPayload({
    ...createInitialInputs(metadata),
    state: 'GA',
    marital_status: 'UNMARRIED',
    people: [{ kind: 'adult', age: 33, ssi_amount: 1200, ssdi_amount: 2400 }],
  }, metadata)

  assert.equal('ssi_amount' in payload.people[0], false)
  assert.equal('ssdi_amount' in payload.people[0], false)
})

test('calculateSeries quietly falls back after a PolicyEngine API error', async () => {
  const originalFetch = globalThis.fetch
  const originalConsoleError = console.error
  const consoleErrors = []
  const requests = []

  globalThis.fetch = async (url) => {
    requests.push(String(url))

    if (String(url).includes('api.policyengine.org')) {
      return new Response(
        JSON.stringify({ error: 'PolicyEngine API unavailable' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    assert.equal(String(url), '/api/series')
    return new Response(
      JSON.stringify({
        data: [],
        step_annual: 500,
        max_earned_income: 1000,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
  console.error = (...args) => consoleErrors.push(args)

  try {
    const result = await calculateSeries(
      {
        state: 'GA',
        people: [{ kind: 'adult', age: 33 }],
        filing_status: 'SINGLE',
        chart_max_earned_income: 1000,
      },
      metadata,
      { step: 500 },
    )

    assert.deepEqual(result.data, [])
    assert.deepEqual(consoleErrors, [])
    assert.deepEqual(requests, [
      'https://api.policyengine.org/us/calculate',
      '/api/series',
    ])
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
  }
})

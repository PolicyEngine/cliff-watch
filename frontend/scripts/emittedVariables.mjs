#!/usr/bin/env node
/**
 * List every PolicyEngine US variable `buildSituation` (src/policyengineApi.js)
 * can emit, grouped by situation entity group. `scripts/generate_variable_graph.py`
 * reads this list to seed the variable-graph snapshot that the payload
 * invariant tests check against:
 *
 *   node frontend/scripts/emittedVariables.mjs
 *
 * The grid sets every input field, every flag, every program mode and every
 * state with a state-specific TANF variable, on both the single-household and
 * the earnings-series paths.
 */
import { fileURLToPath } from 'node:url'

import { HEAD_INCOME_INPUTS, buildSituation } from '../src/policyengineApi.js'

const STATES = [
  'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA',
  'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS',
  'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY',
]

const PROGRAM_KEYS = [
  'snap', 'free_school_meals', 'wic', 'tanf', 'child_care_subsidies',
  'head_start', 'early_head_start', 'housing_assistance', 'medicaid', 'chip',
  'aca_ptc', 'federal_refundable_credits', 'state_refundable_credits', 'ssi',
  'ssdi',
]

const COST_FIELDS = [
  'childcare_expenses', 'rent_annual', 'utility_expense_annual',
  'food_expense_annual', 'transportation_expense_annual',
  'health_insurance_premium_annual', 'technology_expense_annual',
  'debt_payment_annual', 'education_expense_annual', 'other_expense_annual',
]

const person = (kind, age) => ({
  kind,
  age,
  is_pregnant: kind === 'adult',
  is_disabled: true,
  is_blind: true,
  is_full_time_student: true,
  is_incapable_of_self_care: true,
  earned_income: 1000,
  ssi_amount: 100,
  ssdi_amount: 200,
})

const METADATA = {
  public_assistance_programs: PROGRAM_KEYS.map((key) => ({ key, label: key })),
  ccdf_modeled_states: STATES,
}

function gridPayloads() {
  const payloads = []
  for (const state of STATES) {
    for (const marital_status of ['MARRIED', 'UNMARRIED']) {
      payloads.push({
        state,
        county: 'Some County',
        year: 2026,
        earned_income: 20000,
        marital_status,
        people: [person('adult', 40), person('adult', 38), person('adult', 70), person('child', 4)],
        programs_mode: 'custom',
        selected_programs: PROGRAM_KEYS,
        has_employer_health_insurance: true,
        liquid_assets: 1000,
        ...Object.fromEntries(COST_FIELDS.map((field) => [field, 1000])),
        ...Object.fromEntries(Object.keys(HEAD_INCOME_INPUTS).map((field) => [field, 1000])),
      })
    }
  }
  return payloads
}

export function collectEmittedVariables() {
  const byGroup = {}
  const add = (group, name) => {
    byGroup[group] ??= new Set()
    byGroup[group].add(name)
  }
  for (const payload of gridPayloads()) {
    for (const options of [
      { includeIncomeOverrides: true, metadata: METADATA },
      { includeIncomeOverrides: false, withAxes: true, maxEarnedIncome: 50000, metadata: METADATA },
    ]) {
      const { situation } = buildSituation(payload, options)
      for (const [group, instances] of Object.entries(situation)) {
        if (group === 'axes') continue
        for (const record of Object.values(instances)) {
          for (const [name, value] of Object.entries(record)) {
            if (name !== 'members' && value !== undefined) add(group, name)
          }
        }
      }
      for (const axis of situation.axes?.flat() ?? []) add('axes', axis.name)
    }
  }
  return Object.fromEntries(
    Object.keys(byGroup).sort().map((group) => [group, [...byGroup[group]].sort()]),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(collectEmittedVariables(), null, 2)}\n`)
}

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import graph from './__fixtures__/policyengine-us-variable-graph.json'
import { HEAD_INCOME_INPUTS, buildSituation } from './policyengineApi.js'

/**
 * Invariants of `buildSituation` over arbitrary payloads, checked against a
 * snapshot of the PolicyEngine US variable graph for the pinned policyengine-us
 * (`uv run python scripts/generate_variable_graph.py` refreshes it, and
 * tests/test_payload_invariants.py checks it against the installed engine).
 *
 * PolicyEngine US computes some variables as the sum of components (`adds`,
 * `subtracts`). An input on such a total replaces the sum, so (a) components
 * sent alongside it drop out of the total and (b) every rule that reads a
 * component sees zero: sending `pension_income` left `taxable_pension_income`
 * and AGI at 0.
 */

const VARIABLES = graph.variables
const REGENERATE_HINT = 'run `uv run python scripts/generate_variable_graph.py` after changing the builder'

const GROUP_ENTITIES = {
  people: 'person',
  families: 'family',
  marital_units: 'marital_unit',
  tax_units: 'tax_unit',
  spm_units: 'spm_unit',
  households: 'household',
}

/**
 * Totals the builder sets directly on purpose, and why each is safe. Adding a
 * mapping to any other total fails the tests below until it is reviewed here.
 * Keep in sync with REVIEWED_TOTAL_INPUTS in cliff_watch/variable_graph.py.
 */
const REVIEWED_TOTAL_INPUTS = {
  employment_income:
    "policyengine-us's Simulation moves this input onto employment_income_before_lsr, which rules read.",
  self_employment_income:
    "policyengine-us's Simulation moves this input onto self_employment_income_before_lsr, which rules read.",
}

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

const METADATA = {
  public_assistance_programs: PROGRAM_KEYS.map((key) => ({ key, label: key })),
}

const COST_FIELDS = [
  'childcare_expenses', 'rent_annual', 'utility_expense_annual',
  'food_expense_annual', 'transportation_expense_annual',
  'health_insurance_premium_annual', 'technology_expense_annual',
  'debt_payment_annual', 'education_expense_annual', 'other_expense_annual',
]

const INCOME_FIELDS = Object.keys(HEAD_INCOME_INPUTS)

function nodeOf(variable) {
  const node = VARIABLES[variable]
  if (!node) {
    throw new Error(`${variable} is missing from the variable graph: ${REGENERATE_HINT}`)
  }
  return node
}

function componentsOf(variable, found = new Set()) {
  const node = nodeOf(variable)
  for (const child of [...node.adds, ...node.subtracts]) {
    if (!found.has(child)) {
      found.add(child)
      componentsOf(child, found)
    }
  }
  return found
}

const isTotal = (variable) => {
  const node = nodeOf(variable)
  return node.adds.length > 0 || node.subtracts.length > 0
}

const hasValue = (values) => values !== undefined && values !== null
  && Object.values(values).some((value) => value !== null)

/** `[group, instance, variable]` for every variable given a value. */
function inputsOf(situation) {
  return Object.entries(situation)
    .filter(([group]) => group in GROUP_ENTITIES)
    .flatMap(([group, instances]) => Object.entries(instances).flatMap(
      ([instance, record]) => Object.entries(record)
        .filter(([variable, values]) => variable !== 'members' && hasValue(values))
        .map(([variable]) => [group, instance, variable]),
    ))
}

// Amounts may be absent, null (payloads parsed from JSON), zero, negative, or
// numeric strings.
const amountArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 1, arbitrary: fc.integer({ min: -50_000, max: -1 }) },
  { weight: 6, arbitrary: fc.integer({ min: 1, max: 2_000_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 100_000 }).map(String) },
)

const personArb = (kind) => fc.record({
  kind: fc.constant(kind),
  age: kind === 'adult' ? fc.integer({ min: 18, max: 120 }) : fc.integer({ min: 0, max: 17 }),
  is_pregnant: fc.boolean(),
  is_disabled: fc.boolean(),
  is_blind: fc.boolean(),
  is_full_time_student: fc.boolean(),
  is_incapable_of_self_care: fc.boolean(),
  earned_income: amountArb,
  ssi_amount: amountArb,
  ssdi_amount: amountArb,
})

const payloadArb = fc
  .record({
    state: fc.constantFrom(...STATES),
    married: fc.boolean(),
    adults: fc.array(personArb('adult'), { minLength: 1, maxLength: 4 }),
    children: fc.array(personArb('child'), { maxLength: 4 }),
    earned_income: fc.integer({ min: 0, max: 300_000 }),
    programs_mode: fc.constantFrom('all', 'none', 'custom'),
    selected_programs: fc.subarray(PROGRAM_KEYS),
    has_employer_health_insurance: fc.boolean(),
    liquid_assets: amountArb,
    costs: fc.tuple(...COST_FIELDS.map(() => amountArb)),
    incomes: fc.tuple(...INCOME_FIELDS.map(() => amountArb)),
  })
  .filter(({ married, adults }) => !married || adults.length >= 2)
  .map(({ married, adults, children, costs, incomes, ...rest }) => ({
    ...rest,
    year: 2026,
    marital_status: married ? 'MARRIED' : 'UNMARRIED',
    people: [...adults, ...children],
    ...Object.fromEntries(COST_FIELDS.map((field, index) => [field, costs[index]])),
    ...Object.fromEntries(INCOME_FIELDS.map((field, index) => [field, incomes[index]])),
  }))

const optionsArb = fc.oneof(
  fc.constant({ includeIncomeOverrides: true, metadata: METADATA }),
  fc.record({
    includeIncomeOverrides: fc.constant(false),
    withAxes: fc.constant(true),
    maxEarnedIncome: fc.integer({ min: 0, max: 300_000 }),
    minEarnedIncome: fc.integer({ min: 0, max: 300_000 }),
    step: fc.constantFrom(500, 2500),
    metadata: fc.constant(METADATA),
  }),
)

const positive = (value) => Math.max(0, Number(value) || 0)

describe('buildSituation payload invariants', () => {
  test('the variable graph snapshot is closed under components', () => {
    for (const [name, node] of Object.entries(VARIABLES)) {
      for (const child of [...node.adds, ...node.subtracts]) {
        expect(VARIABLES, `${name} -> ${child}: ${REGENERATE_HINT}`).toHaveProperty(child)
      }
    }
  })

  test('head income fields each map to a distinct component, never a total', () => {
    const targets = Object.values(HEAD_INCOME_INPUTS)
    expect(new Set(targets).size).toBe(targets.length)
    for (const variable of targets) {
      expect(nodeOf(variable).entity, variable).toBe('person')
      if (isTotal(variable)) {
        expect(REVIEWED_TOTAL_INPUTS, `${variable} is a total`).toHaveProperty(variable)
      }
    }
  })

  test('emits only PolicyEngine US variables, each on its own entity', () => {
    fc.assert(fc.property(payloadArb, optionsArb, (payload, options) => {
      const { situation } = buildSituation(payload, options)
      for (const [group, instances] of Object.entries(situation)) {
        if (group === 'axes') {
          for (const axis of instances.flat()) nodeOf(axis.name)
          continue
        }
        for (const record of Object.values(instances)) {
          for (const [variable, values] of Object.entries(record)) {
            if (variable === 'members' || values === undefined) continue
            expect(nodeOf(variable).entity, `${group}.${variable}`).toBe(GROUP_ENTITIES[group])
          }
        }
      }
    }), { numRuns: 300 })
  })

  test('never sets a total, except the reviewed ones', () => {
    fc.assert(fc.property(payloadArb, optionsArb, (payload, options) => {
      const { situation } = buildSituation(payload, options)
      for (const [group, , variable] of inputsOf(situation)) {
        if (isTotal(variable)) {
          expect(REVIEWED_TOTAL_INPUTS, `${group}.${variable} is a total input`).toHaveProperty(variable)
        }
      }
    }), { numRuns: 300 })
  })

  test('never sets a total together with one of its components', () => {
    fc.assert(fc.property(payloadArb, optionsArb, (payload, options) => {
      const { situation } = buildSituation(payload, options)
      const inputs = inputsOf(situation)
      for (const [group, instance, variable] of inputs) {
        const components = componentsOf(variable)
        const clashes = inputs
          .filter(([g, i, other]) => g === group && i === instance && components.has(other))
          .map(([, , other]) => other)
        expect(clashes, `${group}.${instance}.${variable}`).toEqual([])
      }
    }), { numRuns: 300 })
  })

  test('each entered head income amount lands once, on its mapped component', () => {
    fc.assert(fc.property(payloadArb, optionsArb, (payload, options) => {
      const { situation } = buildSituation(payload, options)
      const people = Object.entries(situation.people)
      const [headId, head] = people[0]
      let entered = 0
      let sent = 0
      for (const [field, variable] of Object.entries(HEAD_INCOME_INPUTS)) {
        const amount = positive(payload[field])
        entered += amount
        if (amount > 0) {
          expect(head[variable], `${field} -> ${variable}`).toEqual({ 2026: amount })
          sent += head[variable][2026]
        } else {
          expect(head, `${field} -> ${variable}`).not.toHaveProperty(variable)
        }
        for (const [personId, record] of people) {
          if (personId !== headId) expect(record, `${personId}.${variable}`).not.toHaveProperty(variable)
        }
      }
      expect(sent).toBe(entered)
    }), { numRuns: 300 })
  })
})

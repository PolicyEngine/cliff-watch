import assert from 'node:assert/strict'
import { test } from 'vitest'
import { hasCompleteRequiredInputs } from '../dataLookup'
import { decodeInputs, encodeInputs } from '../utils/urlState'
import { combineDraftAndScenarioToInputs, createInitialScenario, inputsToDraft, inputsToScenario, isDraftReady } from './cliffWatchDraft'
import { drawCliffWatchSample } from './sampleHousehold'
import { projectSample } from './projectSample'

test('the installed catalog supplies an editable sample without inventing a ZIP', async () => {
  const sample = await drawCliffWatchSample({ stateCode: 'GA', random: () => 0.5 })
  const draft = sample.draft
  const metadata = { year: 2026 }
  const toInputs = draft => combineDraftAndScenarioToInputs(draft, createInitialScenario(metadata), metadata)
  assert.equal(draft.state, 'GA')
  assert.equal(draft.zip, null)
  assert.equal(draft.county, null)
  assert.equal(hasCompleteRequiredInputs(toInputs(draft)), false)

  // The user supplies their scenario location at the calculator's policy year.
  const located = { ...draft, zip: '30303', year: metadata.year }
  const projected = projectSample(sample, located, metadata)
  const original = combineDraftAndScenarioToInputs(projected.draft, projected.scenario, metadata)
  const decoded = decodeInputs(encodeInputs(original))
  const reopened = combineDraftAndScenarioToInputs(inputsToDraft(decoded), inputsToScenario(decoded, metadata), metadata)
  assert.equal(hasCompleteRequiredInputs(reopened), true)
  assert.deepEqual(reopened.people, original.people)
  assert.equal(reopened.zip, located.zip)
  assert.equal(reopened.self_employment_income_annual, original.self_employment_income_annual)
  assert.equal(reopened.social_security_annual, original.social_security_annual)
  assert.equal(reopened.pension_income_annual, original.pension_income_annual)
  assert.ok(Number.isInteger(sample.provenance.year))
  assert.ok(new URL(sample.provenance.url).protocol === 'https:')
  const moved = projectSample(sample, { zip: '23219', county: 'RICHMOND_CITY_VA' }, metadata)
  assert.equal(moved.draft.zip, null)
  assert.equal(moved.draft.county, null)
})

test('a legacy unclaimed SSI amount remains a valid wizard draft', () => {
  const draft = inputsToDraft({
    state: 'GA', zip: '30303', marital_status: 'UNMARRIED',
    people: [{ kind: 'adult', age: 30, earned_income: 0, ssi_amount: 0, ssdi_amount: 0 }],
  })
  assert.equal(isDraftReady(draft), true)
})

// PolicyBench's published cases 039 and 025 exercise the two income conditions
// the CliffWatch backend cannot express: losses, and a non-head recipient.
test('a head’s losses are omitted while retirement and private pension are preserved', () => {
  const person = {
    id: 'adult-1', kind: 'adult', age: 61, employmentIncome: 0, selfEmploymentIncome: -6260.029296875,
    socialSecurityIncome: 36105, privatePensionIncome: 2030,
  }
  const { scenario, source } = projectSample({ draft: { state: 'VA', people: [person] } }, {}, { year: 2026 })
  assert.equal(scenario.self_employment_income_annual, 0)
  assert.equal(scenario.social_security_annual, 36105)
  assert.equal(scenario.pension_income_annual, 2030)
  assert.deepEqual(source.nonwageIncome.filter(item => !item.included).map(item => item.amount), [-6260.029296875])
})

test('a spouse’s pension is disclosed separately and never assigned to the head', () => {
  const people = [
    { id: 'adult-1', kind: 'adult', age: 61, employmentIncome: 0 },
    { id: 'adult-2', kind: 'adult', age: 57, employmentIncome: 62725.29296875, privatePensionIncome: 32200 },
  ]
  const { scenario, draft, source } = projectSample({ draft: { state: 'OH', people } }, {}, { year: 2026 })
  assert.equal(scenario.pension_income_annual, 0)
  assert.equal(draft.people[1].employmentIncome, people[1].employmentIncome)
  assert.deepEqual(source.nonwageIncome, [{
    personId: 'adult-2', amount: 32200, label: 'taxable private pension', included: false,
  }])
})

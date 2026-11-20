import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'vitest'
import { buildSeriesPayload, getZipState, hasCompleteRequiredInputs } from '../dataLookup'
import { decodeInputs, encodeInputs } from '../utils/urlState'
import { combineDraftAndScenarioToInputs, createInitialScenario, inputsToDraft, inputsToScenario, isDraftReady } from './cliffWatchDraft'
import { drawCliffWatchSample } from './sampleHousehold'
import { projectSample } from './projectSample'
import { EXAMPLE_ZIP_BY_STATE } from './sampleZips'

test('a sample projects into a ready scenario with either a user or example ZIP', async () => {
  const sample = await drawCliffWatchSample({ stateCode: 'GA', random: () => 0.5 })
  const draft = sample.draft
  const metadata = { year: 2026 }
  const toInputs = draft => combineDraftAndScenarioToInputs(draft, createInitialScenario(metadata), metadata)
  assert.equal(draft.state, 'GA')
  assert.equal(draft.zip, null)
  assert.equal(draft.county, null)
  assert.equal(hasCompleteRequiredInputs(toInputs(draft)), false)

  // The user supplies their scenario location at the calculator's policy year.
  const located = { ...draft, zip: '30303', county: 'FULTON_COUNTY_GA', year: metadata.year }
  const projected = projectSample(sample, located, metadata)
  assert.equal(projected.source.exampleZip, null)
  assert.equal(projected.draft.county, located.county)
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
  assert.equal(moved.draft.zip, '30044')
  assert.equal(moved.source.exampleZip, moved.draft.zip)
  assert.equal(moved.draft.county, null)
  assert.equal(hasCompleteRequiredInputs(toInputs(moved.draft)), true)
  assert.deepEqual(projectSample(sample, {}, metadata), moved)
  assert.equal(sample.draft.zip, null)
})

test('every example uses the most populous single-county ZIP accepted in its state', () => {
  const tablePath = new URL('../../../cliff_watch/data/zip_county.json.gz', import.meta.url)
  const table = JSON.parse(gunzipSync(readFileSync(tablePath)).toString('utf8'))
  const byState = {}
  for (const [zip, rows] of Object.entries(table.zips)) {
    if (rows.length !== 1) continue
    const [[countyIndex, residents]] = rows
    const state = table.counties[countyIndex][0].slice(-2)
    if (!(residents > 0) || getZipState(zip) !== state) continue
    const previous = byState[state]
    if (!previous || residents > previous.residents || (residents === previous.residents && zip < previous.zip)) {
      byState[state] = { zip, residents }
    }
  }
  assert.equal(Object.keys(byState).length, 51)
  assert.deepEqual(EXAMPLE_ZIP_BY_STATE, Object.fromEntries(
    Object.entries(byState).map(([state, choice]) => [state, choice.zip]),
  ))
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

test('disability and full-time student status stay with the person through calculation and sharing', () => {
  const metadata = { year: 2026 }
  const people = [
    { id: 'adult-1', kind: 'adult', age: 40, isDisabled: true },
    { id: 'dependent-1', kind: 'dependent', age: 17, isFullTimeStudent: true },
    { id: 'dependent-2', kind: 'dependent', age: 12 },
  ]
  const { draft, scenario } = projectSample({ draft: { state: 'OH', maritalStatus: 'single', people } }, {}, metadata)
  const inputs = combineDraftAndScenarioToInputs(draft, scenario, metadata)
  const decoded = decodeInputs(encodeInputs(inputs))
  const reopened = combineDraftAndScenarioToInputs(inputsToDraft(decoded), inputsToScenario(decoded, metadata), metadata)
  const payload = buildSeriesPayload(inputs, metadata)
  assert.deepEqual(buildSeriesPayload(reopened, metadata), payload)
  assert.deepEqual(payload.people.map(p => [p.is_disabled, p.is_full_time_student]), [
    [true, false], [false, true], [false, false],
  ])
})

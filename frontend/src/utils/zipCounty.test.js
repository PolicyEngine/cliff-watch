// Share links and the form's ZIP rule, against the table the API reads.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'vitest'

import { buildHouseholdPayload, getZipState, hasValidZip } from '../dataLookup.js'
import {
  combineDraftAndScenarioToInputs,
  createInitialScenario,
  inputsToDraft,
  inputsToScenario,
} from '../wizard/cliffWatchDraft.js'
import { decodeInputs, encodeInputs } from './urlState.js'

const metadata = {
  year: 2026,
  defaults: { chart_max_earned_income: 100000, series_step: 500 },
  states: [{ code: 'MA', name: 'Massachusetts' }],
}

const ZIP_LINK = '?s=MA&zip=02139&ms=unmarried&p=33:a::0,6:c::0,10:c::0'
const COUNTY = 'MIDDLESEX_COUNTY_MA'

function linkToInputs(search) {
  const decoded = decodeInputs(search)
  return combineDraftAndScenarioToInputs(
    inputsToDraft(decoded),
    { ...createInitialScenario(metadata), ...inputsToScenario(decoded, metadata) },
    metadata,
  )
}

test('a link with only a ZIP sends the ZIP and no county', () => {
  const payload = buildHouseholdPayload(linkToInputs(ZIP_LINK), metadata)

  assert.equal(payload.zip, '02139')
  assert.equal(payload.county, null)
})

test('a link naming a county sends it and keeps it when re-encoded', () => {
  const inputs = linkToInputs(`${ZIP_LINK}&county=${COUNTY}`)
  const payload = buildHouseholdPayload(inputs, metadata)

  assert.equal(payload.county, COUNTY)
  assert.equal(payload.zip, '02139')
  assert.equal(new URLSearchParams(encodeInputs(inputs)).get('county'), COUNTY)
})

test('a link with only a ZIP gains no county when re-encoded', () => {
  const params = new URLSearchParams(encodeInputs(linkToInputs(ZIP_LINK)))

  assert.equal(params.has('county'), false)
  assert.equal(params.get('zip'), '02139')
})

test('the two links differ only in the county they send', () => {
  const zipOnly = buildHouseholdPayload(linkToInputs(ZIP_LINK), metadata)
  const named = buildHouseholdPayload(linkToInputs(`${ZIP_LINK}&county=${COUNTY}`), metadata)

  assert.deepEqual({ ...zipOnly, county: COUNTY }, named)
})

// The form takes a household's state from the ZIP. These ZIPs get a state that the
// table can't place them in, so the API answers `source: "none"` and the page says
// so. Northern Virginia's 201xx ZIPs form most of the list, because the wizard's
// ZIP-prefix table sends them to DC, and it sends DC's 569xx government ZIPs to
// Minnesota. Any other ZIP joining this list is a new disagreement to look at; the
// wizard fixing some of these fails nothing.
const KNOWN_FORM_STATE_MISMATCHES = new Set([
  '05501', '05544', '06390', '20588', '20598', '72643', '73301', '73344', '73960', '83414',
])
const isKnownMismatchRange = (zip) => zip.startsWith('201') || zip.startsWith('569')

test('the form picks a state the table agrees with, apart from the known ZIPs', () => {
  const tablePath = new URL('../../../cliff_watch/data/zip_county.json.gz', import.meta.url)
  const table = JSON.parse(gunzipSync(readFileSync(tablePath)).toString('utf8'))
  const stateOf = (index) => table.counties[index][0].slice(-2)

  const unexpected = []
  let checked = 0
  for (const [zip, rows] of Object.entries(table.zips)) {
    const formState = getZipState(zip)
    if (!formState) continue
    checked += 1
    assert.equal(hasValidZip(zip, formState), true)

    const tableStates = new Set(rows.map(([index]) => stateOf(index)))
    if (
      !tableStates.has(formState)
      && !KNOWN_FORM_STATE_MISMATCHES.has(zip)
      && !isKnownMismatchRange(zip)
    ) {
      unexpected.push(`${zip}: form ${formState}, table ${[...tableStates].join('/')}`)
    }
  }

  assert.ok(checked > 40_000, `checked ${checked} ZIPs`)
  assert.deepEqual(unexpected, [])
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { countyContext, countyDraftValue } from './countyContext.js'

const MIDDLESEX = {
  code: 'MIDDLESEX_COUNTY_MA',
  name: 'Middlesex County',
  residents: 9116,
  resident_share: 0.4,
}
const NORFOLK = {
  code: 'NORFOLK_COUNTY_MA',
  name: 'Norfolk County',
  residents: 9024,
  resident_share: 0.396,
}
const SUFFOLK = {
  code: 'SUFFOLK_COUNTY_MA',
  name: 'Suffolk County',
  residents: 4486,
  resident_share: 0.197,
}

const location = (overrides) => ({
  zip: '02467',
  county: 'MIDDLESEX_COUNTY_MA',
  county_name: 'Middlesex County',
  source: 'zip',
  counties: [MIDDLESEX, NORFOLK, SUFFOLK],
  ...overrides,
})

test('countyContext says nothing before a series arrives', () => {
  assert.deepEqual(countyContext(undefined), {
    countyName: null,
    note: null,
    options: [],
    selected: null,
  })
})

test('a ZIP in one county names it and offers no choice', () => {
  const context = countyContext(location({
    zip: '02139',
    counties: [{ ...MIDDLESEX, resident_share: 1 }],
  }))

  assert.equal(context.countyName, 'Middlesex County')
  assert.equal(context.note, null)
  assert.deepEqual(context.options, [])
})

test('a ZIP across counties states the rule and offers each county', () => {
  const context = countyContext(location())

  assert.equal(
    context.note,
    'ZIP 02467 covers more than one county. This chart uses Middlesex County, home to 40% of its residents.',
  )
  assert.deepEqual(context.options, [
    { code: 'MIDDLESEX_COUNTY_MA', label: 'Middlesex County (40% of residents)' },
    { code: 'NORFOLK_COUNTY_MA', label: 'Norfolk County (40% of residents)' },
    { code: 'SUFFOLK_COUNTY_MA', label: 'Suffolk County (20% of residents)' },
  ])
  assert.equal(context.selected, 'MIDDLESEX_COUNTY_MA')
})

test('a county chosen from the ZIP’s list reads like the default', () => {
  const context = countyContext(location({
    county: 'NORFOLK_COUNTY_MA',
    county_name: 'Norfolk County',
    source: 'explicit',
  }))

  assert.equal(
    context.note,
    'ZIP 02467 covers more than one county. This chart uses Norfolk County, home to 40% of its residents.',
  )
  assert.equal(context.selected, 'NORFOLK_COUNTY_MA')
})

test('a link naming a county outside the ZIP says so and offers the ZIP’s county', () => {
  const context = countyContext(location({
    zip: '02139',
    county: 'BARNSTABLE_COUNTY_MA',
    county_name: 'Barnstable County',
    source: 'explicit',
    counties: [{ ...MIDDLESEX, resident_share: 1 }],
  }))

  assert.equal(
    context.note,
    'This link names Barnstable County, so this chart uses it. ZIP 02139 lies in Middlesex County.',
  )
  assert.deepEqual(context.options.map((option) => option.code), [
    'BARNSTABLE_COUNTY_MA',
    'MIDDLESEX_COUNTY_MA',
  ])
})

test('a link naming a county for an unplaced ZIP offers nothing else', () => {
  const context = countyContext(location({
    zip: '99999',
    county: 'BARNSTABLE_COUNTY_MA',
    county_name: 'Barnstable County',
    source: 'explicit',
    counties: [],
  }))

  assert.equal(context.note, 'This link names Barnstable County, so this chart uses it.')
  assert.deepEqual(context.options, [])
})

test('a ZIP with no county in the state says the default applies', () => {
  const context = countyContext(
    location({ zip: '20147', county: null, county_name: null, source: 'none', counties: [] }),
    'District of Columbia',
  )

  assert.equal(context.countyName, null)
  assert.equal(
    context.note,
    "CliffWatch can't place ZIP 20147 in a county in the District of Columbia, so rules that vary by county use the first county alphabetically there.",
  )

  assert.equal(
    countyContext(
      location({ zip: '02139', county: null, county_name: null, source: 'none', counties: [] }),
      'California',
    ).note,
    "CliffWatch can't place ZIP 02139 in a county in California, so rules that vary by county use the first county alphabetically there.",
  )
})

test('a household with no ZIP says the same without naming one', () => {
  const context = countyContext(
    location({ zip: null, county: null, county_name: null, source: 'none', counties: [] }),
    'Massachusetts',
  )

  assert.equal(
    context.note,
    'This household has no ZIP code, so rules that vary by county use the first county alphabetically in Massachusetts.',
  )
})

test('a ZIP with no residents falls back to land in its wording', () => {
  const context = countyContext(location({
    counties: [
      { ...MIDDLESEX, residents: null, resident_share: null },
      { ...NORFOLK, residents: null, resident_share: null },
    ],
  }))

  assert.equal(
    context.note,
    'ZIP 02467 covers more than one county. This chart uses Middlesex County, which has the largest share of its land.',
  )
  assert.deepEqual(context.options.map((option) => option.label), [
    'Middlesex County',
    'Norfolk County',
  ])
})

test('a picked county in a ZIP with no residents claims nothing about land', () => {
  const context = countyContext(location({
    county: 'NORFOLK_COUNTY_MA',
    county_name: 'Norfolk County',
    source: 'explicit',
    counties: [
      { ...MIDDLESEX, residents: null, resident_share: null },
      { ...NORFOLK, residents: null, resident_share: null },
    ],
  }))

  assert.equal(
    context.note,
    'ZIP 02467 covers more than one county. This chart uses Norfolk County.',
  )
})

test('shares never round to a misleading 0% or 100%', () => {
  const context = countyContext(location({
    counties: [
      { ...MIDDLESEX, resident_share: 0.998 },
      { ...NORFOLK, resident_share: 0.002 },
    ],
  }))

  assert.deepEqual(context.options.map((option) => option.label), [
    'Middlesex County (over 99% of residents)',
    'Norfolk County (under 1% of residents)',
  ])
})

test('a county with no benchmark premium says the chart shows no credit', () => {
  const context = countyContext(location({
    zip: '29824',
    county: 'EDGEFIELD_COUNTY_SC',
    county_name: 'Edgefield County',
    has_benchmark_premium: false,
    counties: [{
      code: 'EDGEFIELD_COUNTY_SC',
      name: 'Edgefield County',
      residents: 11000,
      resident_share: 1,
    }],
  }))

  assert.equal(context.countyName, 'Edgefield County')
  assert.equal(
    context.note,
    'CliffWatch has no benchmark premium for Edgefield County, so this chart shows no premium tax credit.',
  )
  assert.deepEqual(context.options, [])
})

test('a ZIP across counties keeps its note when its county has no benchmark premium', () => {
  const context = countyContext(location({ has_benchmark_premium: false }))

  assert.equal(
    context.note,
    'ZIP 02467 covers more than one county. This chart uses Middlesex County, home to 40% of its residents. CliffWatch has no benchmark premium for Middlesex County, so this chart shows no premium tax credit.',
  )
  assert.equal(context.options.length, 3)
})

test('a county with a benchmark premium adds nothing', () => {
  const context = countyContext(location({ has_benchmark_premium: true }))

  assert.doesNotMatch(context.note, /benchmark premium/)
})

test('choosing the ZIP’s own county clears the override', () => {
  assert.equal(countyDraftValue('MIDDLESEX_COUNTY_MA', location()), null)
  assert.equal(countyDraftValue('NORFOLK_COUNTY_MA', location()), 'NORFOLK_COUNTY_MA')
})

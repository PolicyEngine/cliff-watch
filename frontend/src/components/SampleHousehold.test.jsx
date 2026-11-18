// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, test, vi } from 'vitest'
import App from '../App'
import { decodeInputs } from '../utils/urlState'
import { drawCliffWatchSample } from '../wizard/sampleHousehold'
import { calculateSeries } from '../dataLookup'

const metadata = {
  year: 2026,
  states: [{ code: 'GA', name: 'Georgia' }, { code: 'VA', name: 'Virginia' }],
}
vi.mock('../wizard/sampleHousehold', () => ({
  drawCliffWatchSample: vi.fn(),
}))
vi.mock('../dataLookup', async importOriginal => ({
  ...await importOriginal(), loadMetadata: async () => metadata, calculateSeries: vi.fn(),
}))
// Results are exercised separately. Observe whether the real App submits a series request.
vi.mock('./ResultsPanel', () => ({ default: () => null }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  window.history.replaceState(null, '', '/')
  Element.prototype.scrollIntoView = vi.fn()
  calculateSeries.mockResolvedValue({ data: [], step_annual: 500 })
})
afterEach(async () => {
  await act(() => root.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})
async function mount(query = '') {
  window.history.replaceState(null, '', '/' + query)
  await act(() => root.render(<App />))
}
const drawButton = () => host.querySelector('.sample-household button')
const current = () => decodeInputs(window.location.search)
const click = element => act(() => element.click())
async function fillZip(value) {
  const input = host.querySelector('#zip')
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// Public PolicyBench 2024 input, scenario_066, as the sampler would project it.
// The mock keeps UI assertions stable across sample-catalog updates.
const virginiaSample = {
  id: 'test-va-066', provenance: { year: 2024 },
  draft: {
    state: 'VA', zip: null, county: null, maritalStatus: 'single', year: 2024,
    people: [{ id: 'adult-1', kind: 'adult', age: 40, employmentIncome: 520 }],
  },
}

test('manual and existing shared scenarios do not load or draw a sample', async () => {
  await mount('?s=GA&zip=30303&ms=unmarried&p=30:a::0&rent=10800')
  assert.equal(drawButton().textContent, 'Try a sample household')
  assert.equal(drawCliffWatchSample.mock.calls.length, 0)
  assert.equal(calculateSeries.mock.calls[0][0].rent_annual, 10800)
  assert.equal(calculateSeries.mock.calls[0][0].people[0].ssi_amount, 0)
})

test('a pending draw cannot override manual entry and a failed draw can be retried', async () => {
  let finish
  drawCliffWatchSample.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await mount()
  await click(drawButton())
  assert.equal(drawButton().disabled, true)
  await fillZip('30303')
  await act(() => finish(null))
  assert.equal(host.querySelector('#zip').value, '30303')
  assert.equal(host.querySelector('[role=alert]'), null)
  drawCliffWatchSample.mockRejectedValueOnce(new Error('test network error'))
  await click(drawButton())
  assert.ok(host.querySelector('[role=alert]'))
  assert.equal(drawButton().disabled, false)
})

test('draws in the selected state, keeps the pool for redraws, and asks for ZIP', async () => {
  drawCliffWatchSample.mockResolvedValue(virginiaSample)
  await mount()
  const filter = host.querySelector('.sample-filter select')
  await act(() => {
    filter.value = 'VA'
    filter.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click(drawButton())
  assert.deepEqual(drawCliffWatchSample.mock.calls[0][0], { stateCode: 'VA', excludeId: undefined })
  assert.equal(current().state, 'VA')
  assert.equal(current().people[0].age, 40)
  assert.equal(current().people[0].earned_income, 520)
  assert.equal(host.querySelector('#zip').value, '')
  assert.equal(host.querySelector('[type=submit]').disabled, true)
  assert.equal(calculateSeries.mock.calls.length, 0)
  assert.match(host.querySelector('.sample-details').textContent, /2024/)
  assert.match(host.querySelector('.sample-details > p').textContent, /All selectable programs start turned on/)
  assert.match(host.querySelector('.sample-details').textContent, /2026 rules/)
  await click(drawButton())
  assert.deepEqual(drawCliffWatchSample.mock.calls[1][0], { stateCode: 'VA', excludeId: virginiaSample.id })
  await fillZip('30303')
  assert.equal(current().state, 'GA')
  assert.match(host.querySelector('.sample-details').textContent, /household from Virginia/)
  assert.equal(filter.value, 'GA')
  assert.equal(host.querySelector('[type=submit]').textContent, 'Review household')
})

test('a draw retains matching scenario ZIP, replaces old assumptions and stays editable', async () => {
  drawCliffWatchSample.mockResolvedValue(virginiaSample)
  await mount('?s=VA&zip=23219&ms=unmarried&p=55:a::0&rent=10800&pm=none')
  const originalCalls = calculateSeries.mock.calls.length
  await click(drawButton())
  assert.equal(drawCliffWatchSample.mock.calls[0][0].stateCode, 'VA')
  assert.equal(current().zip, '23219')
  assert.equal(current().rent_annual, undefined)
  assert.equal(current().programs_mode, undefined) // URL omits the default “all”
  assert.equal(calculateSeries.mock.calls.length, originalCalls)
  // The sample is ready for review. All household sections are still editable.
  assert.equal(host.querySelector('[type=submit]').textContent, 'Review household')
  await click(host.querySelector('[type=submit]'))
  assert.equal(host.querySelector('[type=submit]').textContent, 'Find cliffs')
  await click([...host.querySelectorAll('.wizard-review-item')].find(button => button.textContent.startsWith('Adults')))
  const age = host.querySelector('[aria-label="Adult 1 age"]')
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(age, '41')
    age.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(host.querySelector('[type=submit]'))
  await click(host.querySelector('[type=submit]'))
  await click(host.querySelector('[type=submit]'))
  const submitted = calculateSeries.mock.lastCall[0]
  assert.equal(submitted.year, metadata.year)
  assert.equal(submitted.people[0].age, 41)
  assert.equal(submitted.people[0].earned_income, 520)
  assert.equal(submitted.rent_annual, 0)
  assert.equal(submitted.programs_mode, 'all')
})

test('a national redraw stays national, and reset restores a blank manual start', async () => {
  drawCliffWatchSample.mockResolvedValue(virginiaSample)
  await mount()
  await click(drawButton())
  await click(drawButton())
  assert.equal(drawCliffWatchSample.mock.calls[1][0].stateCode, undefined)
  assert.equal(drawCliffWatchSample.mock.calls[1][0].excludeId, virginiaSample.id)
  const reset = [...host.querySelectorAll('button')].find(button => button.textContent === 'Reset')
  await click(reset)
  assert.equal(drawButton().textContent, 'Try a sample household')
  assert.equal(host.querySelector('.sample-details'), null)
  assert.equal(current()?.people, undefined)
})

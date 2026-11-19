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
vi.mock('../sampleSeries', () => ({
  calculateSeriesForSample: (...args) => calculateSeries(...args),
}))
// Keep the real results panel and substitute only the SVG chart.
vi.mock('./BenefitChart', () => ({
  default: ({ data, loading }) => <div data-testid="cliff-chart">{loading ? 'loading' : data[0]?.net_resources}</div>,
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  window.history.replaceState(null, '', '/')
  Element.prototype.scrollIntoView = vi.fn()
  calculateSeries.mockResolvedValue({ data: [{ earned_income: 0, net_resources: 1234 }], step_annual: 100 })
})
afterEach(async () => {
  await act(() => root.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})
async function mount(query = '') {
  window.history.replaceState(null, '', '/' + query)
  await act(async () => root.render(<App />))
  await act(async () => { await vi.dynamicImportSettled() })
}
const drawButton = () => host.querySelector('.sample-household button')
const current = () => decodeInputs(window.location.search)
const click = element => act(async () => element.click())
const button = label => [...host.querySelectorAll('button')].find(item => item.textContent === label)
const chart = () => host.querySelector('[data-testid="cliff-chart"]')
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

test('one click opens the chart in the selected state using a labeled example ZIP', async () => {
  drawCliffWatchSample.mockResolvedValue(virginiaSample)
  await mount()
  const filter = host.querySelector('.sample-filter select')
  await act(() => {
    filter.value = 'VA'
    filter.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click(drawButton())
  assert.deepEqual(drawCliffWatchSample.mock.calls[0][0], { stateCode: 'VA', excludeId: undefined })
  assert.equal(calculateSeries.mock.calls.length, 1)
  const inputs = calculateSeries.mock.lastCall[0]
  assert.equal(inputs.zip, current().zip)
  assert.equal(inputs.state, 'VA')
  assert.equal(inputs.people[0].age, 40)
  assert.equal(inputs.people[0].earned_income, 520)
  assert.match(host.querySelector('.sample-details').textContent, new RegExp('example ZIP ' + inputs.zip))
  assert.match(host.querySelector('.sample-details').textContent, /All selectable programs start turned on/)
  assert.match(host.querySelector('.sample-details').textContent, /2026 rules/)
  assert.equal(host.querySelector('form'), null)
  assert.equal(document.activeElement, host.querySelector('.sample-results-controls'))
  assert.equal(chart().textContent, '1234')
  await click(drawButton())
  assert.deepEqual(drawCliffWatchSample.mock.calls[1][0], { stateCode: 'VA', excludeId: virginiaSample.id })
})

test('a draw retains the entered ZIP, resets scenario assumptions, and can be edited from the chart', async () => {
  drawCliffWatchSample.mockResolvedValue(virginiaSample)
  await mount('?s=VA&zip=23219&ms=unmarried&p=55:a::0&rent=10800&pm=none')
  const originalCalls = calculateSeries.mock.calls.length
  await click(drawButton())
  assert.equal(drawCliffWatchSample.mock.calls[0][0].stateCode, 'VA')
  assert.equal(current().zip, '23219')
  assert.equal(current().rent_annual, undefined)
  assert.equal(current().programs_mode, undefined)
  assert.doesNotMatch(host.querySelector('.sample-details').textContent, /example ZIP/)
  assert.equal(calculateSeries.mock.calls.length, originalCalls + 1)
  await click(button('Edit household'))
  await click([...host.querySelectorAll('.wizard-review-item')].find(item => item.textContent.startsWith('Adults')))
  const age = host.querySelector('[aria-label="Adult 1 age"]')
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(age, '41')
    age.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(button('Update chart'))
  const submitted = calculateSeries.mock.lastCall[0]
  assert.equal(submitted.year, metadata.year)
  assert.equal(submitted.people[0].age, 41)
  assert.equal(submitted.people[0].earned_income, 520)
  assert.equal(submitted.rent_annual, 0)
  assert.equal(submitted.programs_mode, 'all')
  assert.equal(host.querySelector('form'), null)
  assert.equal(chart().textContent, '1234')
})

test('an example ZIP keeps the national pool until the user enters their own location', async () => {
  drawCliffWatchSample.mockResolvedValue(virginiaSample)
  await mount()
  await click(drawButton())
  await click(drawButton())
  assert.equal(drawCliffWatchSample.mock.calls[1][0].stateCode, undefined)
  assert.equal(drawCliffWatchSample.mock.calls[1][0].excludeId, virginiaSample.id)
  assert.equal(host.querySelector('.sample-filter select').disabled, false)
  await click(button('Edit household'))
  await click([...host.querySelectorAll('.wizard-review-item')].find(item => item.textContent.startsWith('Location')))
  await fillZip('30303')
  assert.equal(current().state, 'GA')
  await click(button('Update chart'))
  assert.equal(calculateSeries.mock.lastCall[0].zip, '30303')
  assert.equal(host.querySelector('.sample-filter select').value, 'GA')
  assert.equal(host.querySelector('.sample-filter select').disabled, true)
  assert.doesNotMatch(host.querySelector('.sample-details').textContent, /example ZIP/)
  await click(button('Edit household'))
  await click(button('Reset'))
  assert.equal(drawButton().textContent, 'Try a sample household')
  assert.equal(host.querySelector('.sample-details'), null)
  assert.equal(current()?.people, undefined)
})

test('a slower sample calculation cannot replace the next household’s result', async () => {
  drawCliffWatchSample.mockResolvedValueOnce(virginiaSample).mockResolvedValueOnce({
    ...virginiaSample, id: 'test-ga', draft: { ...virginiaSample.draft, state: 'GA' },
  })
  let finishFirst
  calculateSeries.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve }))
  await mount()
  await click(drawButton())
  assert.equal(chart().textContent, 'loading')
  assert.ok(button('Edit household'))
  await click(drawButton())
  assert.equal(chart().textContent, '1234')
  await act(() => finishFirst({ data: [{ earned_income: 0, net_resources: 5678 }], step_annual: 100 }))
  assert.equal(current().state, 'GA')
  assert.equal(chart().textContent, '1234')
})

test('failed sample calculations can be retried directly from the chart', async () => {
  drawCliffWatchSample.mockResolvedValue(virginiaSample)
  const failure = new Error('service temporarily unavailable')
  calculateSeries.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await mount()
    await click(drawButton())
    assert.ok(button('Retry calculation'))
    await click(button('Retry calculation'))
    assert.equal(chart().textContent, '1234')
    assert.equal(drawCliffWatchSample.mock.calls.length, 1)
  } finally {
    log.mockRestore()
  }
})

test('reopening a saved sample URL displays its chart without another calculation', async () => {
  const { webcrypto } = await import('node:crypto')
  const entries = new Map()
  vi.stubGlobal('crypto', webcrypto)
  vi.stubEnv('NEXT_PUBLIC_SERIES_BUILD', 'test-build')
  vi.stubGlobal('caches', { open: async () => ({
    match: async key => entries.get(key)?.clone(),
    put: async (key, response) => entries.set(key, response),
    keys: async () => [...entries.keys()],
  }) })
  metadata.engine = { 'policyengine-us': '1', 'policyengine-core': '2', 'spm-calculator': '3' }
  try {
    drawCliffWatchSample.mockResolvedValue(virginiaSample)
    calculateSeries.mockResolvedValue({
      data: [{ earned_income: 0, net_resources: 1234 }], point_count: 1, step_annual: 100,
    })
    await mount()
    await act(async () => {
      drawButton().click()
      await vi.waitFor(() => assert.equal(entries.size, 1))
    })
    const query = window.location.search
    assert.equal(chart().textContent, '1234')
    assert.equal(calculateSeries.mock.calls.length, 1)
    await act(() => root.unmount())
    root = createRoot(host)
    await mount(query)
    await act(async () => {
      await vi.waitFor(() => assert.equal(chart()?.textContent, '1234'))
    })
    assert.equal(calculateSeries.mock.calls.length, 1)
  } finally {
    delete metadata.engine
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

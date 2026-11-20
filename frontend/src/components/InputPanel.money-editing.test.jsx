// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, test, vi } from 'vitest'
import App from '../App'
import { calculateSeries } from '../dataLookup'
import { decodeInputs } from '../utils/urlState'

vi.mock('../dataLookup', async importOriginal => ({
  ...await importOriginal(),
  loadMetadata: async () => ({ year: 2026, defaults: { chart_max_earned_income: 160000 } }),
  calculateSeries: vi.fn(),
}))
vi.mock('./ResultsPanel', () => ({ default: () => null }))

let host, root
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = vi.fn()
  window.history.replaceState(null, '', '/?s=GA&zip=30303&ms=unmarried&p=30:a::0&rent=10001&max=125000')
  calculateSeries.mockResolvedValue({ data: [], step_annual: 500 })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () => { await vi.dynamicImportSettled() })
  for (let i = 0; i < 4; i++) {
    await act(async () => host.querySelector('[type=submit]').click())
  }
  assert.equal(host.querySelector('[type=submit]').textContent, 'Find cliffs')
  host.querySelector('details').open = true
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})

const current = () => decodeInputs(window.location.search)
const blur = field => act(async () => field.blur())
const submit = () => act(async () => host.querySelector('form').requestSubmit())

async function input(field, raw) {
  await act(async () => {
    field.focus()
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(field, raw)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function changePeriod(value) {
  const period = host.querySelector('#expense-period')
  await act(async () => {
    period.focus()
    period.value = value
    period.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

test('clearing an annual amount stays blank and decimal keystrokes update the link and chart', async () => {
  const rent = host.querySelector('#rent_annual')
  await input(rent, '')
  assert.equal(rent.value, '')
  assert.equal(current().rent_annual, undefined)
  await blur(rent)
  assert.equal(rent.value, '')

  for (const raw of ['1', '12', '12.5', '12.50']) {
    await input(rent, raw)
    assert.equal(rent.value, raw)
    assert.equal(current().rent_annual, Number(raw))
  }
  // Enter can submit a focused number field without a blur.
  await submit()
  assert.equal(calculateSeries.mock.lastCall[0].rent_annual, 12.5)
  await blur(rent)
  assert.equal(rent.value, '12.5')
})

test('a native incomplete number leaves the last valid amount intact until typing resumes', async () => {
  const rent = host.querySelector('#rent_annual')
  await input(rent, '12')
  // jsdom's programmatic setter cannot produce an engine's native badInput
  // buffer. Browsers expose an empty value for unfinished tokens such as "-".
  Object.defineProperty(rent, 'validity', { configurable: true, value: { valid: false, badInput: true } })
  try {
    await input(rent, '')
    assert.equal(rent.value, '')
    assert.equal(current().rent_annual, 12)
    await blur(rent)
    assert.equal(rent.value, '')
  } finally {
    delete rent.validity
  }
  await input(rent, '12.05')
  assert.equal(current().rent_annual, 12.05)
})

test('monthly editing holds fractional cents until blur without changing the submitted annual amount', async () => {
  await changePeriod('month')
  const rent = host.querySelector('#rent_annual')
  assert.equal(rent.value, '833.42')
  await act(async () => rent.focus())
  await blur(rent)
  assert.equal(current().rent_annual, 10001)

  for (const raw of ['1', '12', '12.3', '12.34', '12.345']) {
    await input(rent, raw)
    assert.equal(rent.value, raw)
  }
  assert.equal(current().rent_annual, 148.14)
  await submit()
  assert.equal(calculateSeries.mock.lastCall[0].rent_annual, 148.14)
  await blur(rent)
  assert.equal(rent.value, '12.35')
  await changePeriod('year')
  assert.equal(rent.value, '148.14')
  assert.equal(current().rent_annual, 148.14)
})

test('an invalid chart limit stays visible on blur and clearing restores the configured default', async () => {
  const limit = host.querySelector('#chart_max_earned_income')
  await input(limit, '0')
  await blur(limit)
  assert.equal(limit.value, '0')
  assert.equal(limit.validity.rangeUnderflow, true)
  assert.equal(current().chart_max_earned_income, 125000)
  const count = calculateSeries.mock.calls.length
  await submit()
  assert.equal(calculateSeries.mock.calls.length, count)

  await input(limit, '')
  assert.equal(limit.value, '')
  assert.equal(current().chart_max_earned_income, 160000)
  await blur(limit)
  assert.equal(limit.value, '160000')
  await submit()
  assert.equal(calculateSeries.mock.lastCall[0].chart_max_earned_income, 160000)
})

test('switching to monthly entry keeps invalid rent visible until corrected', async () => {
  const rent = host.querySelector('#rent_annual')
  const annual = current().rent_annual
  await input(rent, '-5')
  await blur(rent)
  await changePeriod('month')
  assert.equal(rent.value, '-5')
  assert.equal(current().rent_annual, annual)
  const count = calculateSeries.mock.calls.length
  await submit()
  assert.equal(calculateSeries.mock.calls.length, count)
  await input(rent, '800')
  await submit()
  assert.equal(calculateSeries.mock.lastCall[0].rent_annual, 9600)
})

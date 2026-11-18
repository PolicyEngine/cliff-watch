// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, test, vi } from 'vitest'
import InputPanel from './InputPanel'
import { decodeInputs, encodeInputs } from '../utils/urlState'
import { inputsToDraft, inputsToScenario } from '../wizard/cliffWatchDraft'
import { normalizeInputs } from '../dataLookup'

const metadata = { year: 2026 }
let root

afterEach(() => {
  root?.unmount()
  document.body.replaceChildren()
})

function openReview(search) {
  const inputs = decodeInputs(search)
  const draft = inputsToDraft(inputs)
  const calculate = vi.fn()
  function Wizard() {
    const [scenario, setScenario] = useState(() => inputsToScenario(inputs, metadata))
    return <InputPanel
      metadata={metadata}
      draft={draft}
      scenario={scenario}
      onScenarioChange={change => setScenario(current => ({ ...current, ...change }))}
      onCalculate={() => calculate(normalizeInputs({ ...inputs, ...scenario }, metadata))}
    />
  }
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  flushSync(() => root.render(<Wizard />))
  const submit = () => flushSync(() => host.querySelector('[type=submit]').click())
  // Location, marital status, adults and dependents already have valid values.
  for (let i = 0; i < 4; i++) submit()
  assert.equal(host.querySelector('[type=submit]').textContent, 'Find cliffs')
  return { host, submit, calculate }
}

const household = '?s=GA&zip=30303&ms=unmarried&p=30:a::0'

function enterAmount(input, amount) {
  flushSync(() => {
    // Use the native setter to reproduce a user edit without updating React's value tracker.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(input, amount)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('a legacy annual rent with Advanced closed can submit', () => {
  const { host, submit, calculate } = openReview(household + '&rent=10800')
  assert.equal(host.querySelector('details').open, false)
  submit()
  assert.equal(calculate.mock.calls.length, 1)
  assert.equal(calculate.mock.calls[0][0].rent_annual, 10800)
})

test('a negative amount stays invalid and reopens Advanced on submit', () => {
  const { host, submit, calculate } = openReview(household)
  const advanced = host.querySelector('details')
  const rent = host.querySelector('#rent_annual')
  advanced.open = true
  enterAmount(rent, '-5')
  advanced.open = false
  submit()
  assert.equal(calculate.mock.calls.length, 0)
  assert.equal(rent.validity.rangeUnderflow, true)
  assert.equal(advanced.open, true)
})

test('monthly expense entry, annual payload and share link agree to the cent', () => {
  const { host, submit, calculate } = openReview(household + '&rent=10001&assets=1234.56&pen=7000.83')
  const advanced = host.querySelector('details')
  advanced.open = true
  const period = host.querySelector('#expense-period')
  const setPeriod = value => flushSync(() => {
    period.value = value
    period.dispatchEvent(new Event('change', { bubbles: true }))
  })
  setPeriod('month')
  const rent = host.querySelector('#rent_annual')
  assert.equal(rent.value, '833.42')
  setPeriod('year')
  assert.equal(rent.value, '10001')
  setPeriod('month')
  enterAmount(rent, '900.17')
  assert.match(rent.labels[0].textContent, /\$\/month/)
  assert.match(host.querySelector('#liquid_assets').labels[0].textContent, /\(\$\)/)
  assert.equal(host.querySelector('#liquid_assets').value, '1234.56')
  assert.equal(host.querySelector('#pension_income_annual').value, '7000.83')
  advanced.open = false
  submit()
  const annual = calculate.mock.calls[0][0]
  assert.equal(annual.rent_annual, 10802.04)
  assert.equal(annual.liquid_assets, 1234.56)
  assert.equal(decodeInputs(encodeInputs(annual)).rent_annual, 10802.04)
})

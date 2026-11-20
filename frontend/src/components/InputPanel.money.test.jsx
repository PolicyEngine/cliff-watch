// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, test, vi } from 'vitest'
import InputPanel from './InputPanel'
import { decodeInputs, encodeInputs } from '../utils/urlState'
import { combineDraftAndScenarioToInputs, inputsToDraft, inputsToScenario } from '../wizard/cliffWatchDraft'
import { buildHouseholdPayload } from '../dataLookup'

const metadata = { year: 2026 }
let root

afterEach(() => {
  root?.unmount()
  document.body.replaceChildren()
})

function openReview(search) {
  const inputs = decodeInputs(search)
  const calculate = vi.fn()
  function Wizard() {
    const [draft, setDraft] = useState(() => inputsToDraft(inputs))
    const [scenario, setScenario] = useState(() => inputsToScenario(inputs, metadata))
    return <InputPanel
      metadata={metadata}
      draft={draft}
      scenario={scenario}
      onDraftChange={setDraft}
      onScenarioChange={change => setScenario(current => ({ ...current, ...change }))}
      onCalculate={() => calculate(combineDraftAndScenarioToInputs(draft, scenario, metadata))}
      onReset={() => {
        setDraft(inputsToDraft(null))
        setScenario(inputsToScenario(null, metadata))
      }}
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

function enterValue(input, value) {
  flushSync(() => input.focus())
  flushSync(() => {
    // Use the native setter to reproduce a user edit without updating React's value tracker.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  flushSync(() => input.blur())
}

function selectPeriod(host, value) {
  const select = host.querySelector('#expense-period')
  flushSync(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function clickButton(host, label) {
  const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent.startsWith(label))
  assert.ok(button, `Missing button: ${label}`)
  flushSync(() => button.click())
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
  enterValue(rent, '-5')
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
  selectPeriod(host, 'month')
  const rent = host.querySelector('#rent_annual')
  assert.equal(rent.value, '833.42')
  selectPeriod(host, 'year')
  assert.equal(rent.value, '10001')
  selectPeriod(host, 'month')
  enterValue(rent, '900.17')
  assert.match(rent.labels[0].textContent, /\$\/month/)
  assert.match(host.querySelector('#liquid_assets').labels[0].textContent, /\(\$\)/)
  assert.equal(host.querySelector('#liquid_assets').value, '1234.56')
  assert.equal(host.querySelector('#pension_income_annual').value, '7000.83')
  advanced.open = false
  submit()
  const inputs = calculate.mock.calls[0][0]
  const payload = buildHouseholdPayload(inputs, metadata)
  assert.equal(payload.rent_annual, 10802.04)
  assert.equal(payload.liquid_assets, 1234.56)
  assert.equal(decodeInputs(encodeInputs(inputs)).rent_annual, 10802.04)
})

test('a chart maximum below $10,000 blocks submission until corrected', () => {
  const { host, submit, calculate } = openReview(household)
  const advanced = host.querySelector('details')
  advanced.open = true
  const maximum = host.querySelector('#chart_max_earned_income')
  enterValue(maximum, '9999.99')
  advanced.open = false
  submit()
  assert.equal(maximum.validity.rangeUnderflow, true)
  assert.equal(advanced.open, true)
  assert.equal(calculate.mock.calls.length, 0)

  enterValue(maximum, '10000')
  submit()
  assert.equal(calculate.mock.calls.length, 1)
  assert.equal(calculate.mock.calls[0][0].chart_max_earned_income, 10000)
})

test('adult 2 wages entered in the wizard retain cents in the API payload and share link', () => {
  const { host, submit, calculate } = openReview('?s=GA&zip=30303&ms=married&p=30:a::0,35:a::0')
  clickButton(host, 'Adults')
  enterValue(host.querySelector('#adult-1-earned-income'), '32123.45')
  submit() // Adults to dependents.
  submit() // Dependents to review.
  submit()
  assert.equal(calculate.mock.calls.length, 1)
  const inputs = calculate.mock.calls[0][0]
  const payload = buildHouseholdPayload(inputs, metadata)
  assert.deepEqual(payload.people.map(person => person.earned_income), [0, 32123.45])
  const reopened = decodeInputs(encodeInputs(inputs))
  assert.deepEqual(buildHouseholdPayload(reopened, metadata).people, payload.people)
})

test('resetting the wizard restores yearly expense entry for the next household', () => {
  const { host, submit } = openReview(household)
  host.querySelector('details').open = true
  selectPeriod(host, 'month')
  assert.equal(host.querySelector('#expense-period').value, 'month')
  clickButton(host, 'Reset')
  const zip = host.querySelector('#zip')
  assert.equal(zip.value, '')
  enterValue(zip, '30303')
  submit()
  clickButton(host, 'Unmarried')
  enterValue(host.querySelector('[aria-label="Adult 1 age"]'), '30')
  submit()
  clickButton(host, 'No dependents')
  host.querySelector('details').open = true
  assert.equal(host.querySelector('#expense-period').value, 'year')
  assert.match(host.querySelector('#rent_annual').labels[0].textContent, /\$\/year/)
})

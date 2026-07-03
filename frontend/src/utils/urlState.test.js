import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeInputs, encodeInputs } from './urlState.js'

const unmarriedHousehold = {
  state: 'NC',
  zip: '27601',
  marital_status: 'UNMARRIED',
  people: [
    { kind: 'adult', age: 30, earned_income: 0 },
    { kind: 'child', age: 4, earned_income: 0 },
    { kind: 'child', age: 8, earned_income: 0 },
  ],
}

test('encodeInputs writes marital status for unmarried households', () => {
  const params = new URLSearchParams(encodeInputs(unmarriedHousehold))
  assert.equal(params.get('ms'), 'unmarried')
})

test('encodeInputs writes marital status for married households', () => {
  const params = new URLSearchParams(encodeInputs({
    ...unmarriedHousehold,
    marital_status: 'MARRIED',
  }))
  assert.equal(params.get('ms'), 'married')
})

test('share links round-trip with enough to auto-calculate', () => {
  const decoded = decodeInputs(`?${encodeInputs(unmarriedHousehold)}`)
  assert.equal(decoded.state, 'NC')
  assert.equal(decoded.zip, '27601')
  assert.equal(decoded.marital_status, 'UNMARRIED')
  assert.equal(decoded.people.length, 3)
  assert.ok(decoded.people.every((person) => Number.isFinite(person.age)))
})

test('legacy share links without ms default to unmarried when people are present', () => {
  // Links shared before ms=unmarried existed encoded nothing for single filers.
  const decoded = decodeInputs('?s=NC&zip=27601&p=30:a::0,4:c::0,8:c::0')
  assert.equal(decoded.marital_status, 'UNMARRIED')
})

test('legacy links without ms still decode married from filing status', () => {
  const decoded = decodeInputs('?s=NC&zip=27601&fs=JOINT&p=30:a::0,32:a::0')
  assert.equal(decoded.marital_status, 'MARRIED')
})

test('links without a household do not invent a marital status', () => {
  const decoded = decodeInputs('?s=NC')
  assert.equal(decoded.marital_status, undefined)
})

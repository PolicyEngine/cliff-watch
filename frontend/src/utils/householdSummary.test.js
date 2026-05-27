import assert from 'node:assert/strict'
import test from 'node:test'

import { householdSummary } from './householdSummary.js'

const metadata = {
  states: [
    { code: 'MN', name: 'Minnesota' },
    { code: 'GA', name: 'Georgia' },
  ],
}

test('householdSummary preserves the compact count summary without modifiers', () => {
  assert.equal(
    householdSummary({
      state: 'MN',
      people: [
        { kind: 'adult', age: 34 },
        { kind: 'adult', age: 36 },
        { kind: 'child', age: 8 },
      ],
    }, metadata),
    'Minnesota · 2 adults · 1 dependent',
  )
})

test('householdSummary includes selected household member modifiers', () => {
  assert.equal(
    householdSummary({
      state: 'MN',
      people: [
        { kind: 'adult', age: 34, is_pregnant: true, is_disabled: true },
        { kind: 'adult', age: 36 },
        { kind: 'child', age: 8, is_disabled: true, is_full_time_student: true },
        { kind: 'child', age: 16, is_blind: true, is_incapable_of_self_care: true },
      ],
    }, metadata),
    'Minnesota · 2 adults (1 pregnant, 1 disabled) · 2 dependents (1 disabled, 1 blind, 1 full-time student, 1 needs care)',
  )
})

test('householdSummary ignores pregnancy modifiers for dependents', () => {
  assert.equal(
    householdSummary({
      state: 'GA',
      people: [
        { kind: 'adult', age: 34 },
        { kind: 'child', age: 8, is_pregnant: true },
      ],
    }, metadata),
    'Georgia · 1 adult · 1 dependent',
  )
})

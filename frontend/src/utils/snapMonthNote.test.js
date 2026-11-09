import assert from 'node:assert/strict'
import fc from 'fast-check'
import { test } from 'vitest'

import { SNAP_MONTH_NOTE, SNAP_MONTH_PROGRAMS, snapMonthNote } from './snapMonthNote.js'

// A series point as /api/series returns it: each program's annual value under
// its own key, beside the point's earnings.
const point = (programs, earned_income = 0) => ({ earned_income, ...programs })

test('snapMonthNote says nothing before a series arrives', () => {
  assert.equal(snapMonthNote(undefined), null)
  assert.equal(snapMonthNote(null), null)
  assert.equal(snapMonthNote([]), null)
})

test('snapMonthNote appears where the household gets SNAP and Head Start or school meals', () => {
  for (const key of SNAP_MONTH_PROGRAMS) {
    assert.equal(
      snapMonthNote([point({ snap: 0, [key]: 0 }), point({ snap: 1200, [key]: 900 }, 500)]),
      SNAP_MONTH_NOTE,
    )
  }
})

test('snapMonthNote appears for a point taken from a real Georgia series', () => {
  // /api/series for a Georgia single parent of a 4-year-old, at $0 and $27,000
  // of earnings (policyengine-us 1.755.5).
  const georgia = [
    point({ snap: 6458.4, head_start: 13086, early_head_start: 0, free_school_meals: 0, tanf: 2820 }),
    point({ snap: 824.4, head_start: 13086, early_head_start: 0, free_school_meals: 0, tanf: 0 }, 27000),
  ]
  assert.equal(snapMonthNote(georgia), SNAP_MONTH_NOTE)
})

test('snapMonthNote stays off without SNAP, or without these programs', () => {
  // Head Start through income eligibility alone, with no SNAP at that point.
  assert.equal(snapMonthNote([point({ snap: 0, head_start: 12000 })]), null)
  // SNAP at one point, Head Start only at another.
  assert.equal(
    snapMonthNote([point({ snap: 1500, head_start: 0 }), point({ snap: 0, head_start: 12000 }, 500)]),
    null,
  )
  assert.equal(snapMonthNote([point({ snap: 1500, wic: 600, tanf: 2000 })]), null)
  // The values sit on the point itself, not under a nested programs object.
  assert.equal(snapMonthNote([{ programs: { snap: 1500, head_start: 12000 } }]), null)
  assert.equal(
    snapMonthNote([null, {}, point(undefined), point({ snap: 'n/a', head_start: 10 })]),
    null,
  )
})

const programValue = fc.oneof(fc.constant(0), fc.double({ min: 0.01, max: 50_000, noNaN: true }))
const programs = fc.record({
  snap: programValue,
  head_start: programValue,
  early_head_start: programValue,
  free_school_meals: programValue,
  wic: programValue,
  tanf: programValue,
})

test('snapMonthNote appears exactly when some point has SNAP and one of the programs', () => {
  fc.assert(
    fc.property(fc.array(programs, { maxLength: 30 }), (rows) => {
      const expected = rows.some(
        (row) => row.snap > 0 && SNAP_MONTH_PROGRAMS.some((key) => row[key] > 0),
      )
      const series = rows.map((row, index) => point(row, index * 500))
      const note = snapMonthNote(series)
      assert.equal(note, expected ? SNAP_MONTH_NOTE : null)
      // Reordering the points never changes the answer.
      assert.equal(snapMonthNote([...series].reverse()), note)
    }),
  )
})

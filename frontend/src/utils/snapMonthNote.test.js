import assert from 'node:assert/strict'
import fc from 'fast-check'
import { test } from 'vitest'

import georgia from '../__fixtures__/series-georgia-snap-from-october.json'
import { formatCurrency } from '../dataLookup.js'
import { SNAP_MONTH_PROGRAMS, partYearPrograms, snapMonthNote } from './snapMonthNote.js'

const RULE_START = "We count January's SNAP for all twelve months"
const OCTOBER_ON = [10, 11, 12]

// A series point as /api/series returns it, with the fields the note reads.
const point = (earned_income, { snap_months = [], part_year_snap_programs = [], ...values } = {}) => ({
  earned_income,
  snap: 0,
  head_start: 0,
  early_head_start: 0,
  free_school_meals: 0,
  ...values,
  snap_months,
  part_year_snap_programs,
})

const marked = (earned_income, programs, values, snap_months = OCTOBER_ON) =>
  point(earned_income, { snap_months, part_year_snap_programs: programs, ...values })

test('the note covers Head Start, Early Head Start and free school meals', () => {
  assert.deepEqual(SNAP_MONTH_PROGRAMS, ['head_start', 'early_head_start', 'free_school_meals'])
})

test('snapMonthNote says nothing without a series', () => {
  for (const data of [undefined, null, [], {}, { data: [] }, 'series', 0]) {
    assert.equal(snapMonthNote(data), null)
  }
})

test('snapMonthNote explains the Georgia points where SNAP starts in October', () => {
  // /api/series for a Georgia single parent of a 4-year-old in ZIP 30303, from
  // $26,000 to $29,000 of wages (policyengine-us 1.755.5). $27,500 and $28,000
  // get SNAP from October to December and a full year of Head Start.
  assert.equal(
    snapMonthNote(georgia),
    "From $27,500 to $28,000 of annual wages, you'll see Head Start without SNAP. "
      + "This household gets no SNAP until October, when USDA updates SNAP's income limits and benefits. "
      + "We count January's SNAP for all twelve months, and a full year of Head Start for any household that gets SNAP in any month.",
  )
})

test('snapMonthNote stays off where the household gets SNAP all year', () => {
  // The same Georgia series up to $27,000, where SNAP runs all twelve months
  // beside Head Start.
  const allYear = georgia.filter((row) => row.earned_income <= 27000)
  assert.ok(allYear.every((row) => row.snap > 0 && row.head_start > 0))
  assert.equal(snapMonthNote(allYear), null)
})

test('snapMonthNote names each program in its own words', () => {
  const names = {
    head_start: 'Head Start',
    early_head_start: 'Early Head Start',
    free_school_meals: 'free school meals',
  }
  for (const [key, name] of Object.entries(names)) {
    const note = snapMonthNote([point(42000), marked(42500, [key], { [key]: 9000 })])
    assert.ok(note.startsWith(`At $42,500 of annual wages, you'll see ${name} without SNAP.`), note)
    assert.ok(note.endsWith(`a full year of ${name} for any household that gets SNAP in any month.`), note)
  }
  const all = { head_start: 1, early_head_start: 1, free_school_meals: 1 }
  assert.match(
    snapMonthNote([marked(70000, ['free_school_meals', 'head_start'], all)]),
    /see Head Start and free school meals without SNAP/,
  )
  assert.match(
    snapMonthNote([marked(70000, ['head_start'], all), marked(70500, SNAP_MONTH_PROGRAMS, all)]),
    /see Head Start, Early Head Start and free school meals without SNAP/,
  )
})

test('snapMonthNote names each run of wages', () => {
  const series = [
    point(27000),
    marked(27500, ['head_start'], { head_start: 13086 }),
    marked(28000, ['head_start'], { head_start: 13086 }),
    point(28500),
    marked(41000, ['head_start'], { head_start: 13086 }),
  ]
  assert.match(snapMonthNote(series), /^From \$27,500 to \$28,000 and at \$41,000 of annual wages, /)
})

test('snapMonthNote describes the months the household gets SNAP', () => {
  const at = (snap_months) => snapMonthNote([marked(30000, ['head_start'], { head_start: 13086 }, snap_months)])
  assert.match(at([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), /This household gets no SNAP until March\. We count/)
  assert.match(at([3, 4, 5, 6, 7, 8, 9]), /This household gets SNAP only from March to September\. We count/)
  assert.match(at([3, 4, 10, 11]), /This household gets SNAP there in some months, but not in January\. We count/)
  // SNAP in January shows on the chart, so the note doesn't say the chart lacks it.
  assert.equal(
    at([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    'At $30,000 of annual wages, this household gets SNAP in only part of the year. '
      + "We count January's SNAP for all twelve months, and a full year of Head Start for any household that gets SNAP in any month.",
  )
  // Points with different months share the general sentence.
  const mixed = snapMonthNote([
    marked(30000, ['head_start'], { head_start: 1 }, [10, 11, 12]),
    marked(30500, ['head_start'], { head_start: 1 }, [11, 12]),
  ])
  assert.match(mixed, /some months, but not in January\./)
})

test('snapMonthNote ignores points the API leaves unmarked or marks wrongly', () => {
  const allYear = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  assert.equal(snapMonthNote([marked(1, ['head_start'], { head_start: 1 }, allYear)]), null)
  assert.equal(snapMonthNote([marked(1, ['head_start'], { head_start: 1 }, [])]), null)
  assert.equal(snapMonthNote([marked(1, ['head_start'], { head_start: 0 })]), null)
  assert.equal(snapMonthNote([marked(1, ['wic', 'tanf'], { wic: 1, tanf: 1 })]), null)
  // Months outside 1 to 12, and months that aren't whole numbers, drop out.
  assert.deepEqual(partYearPrograms(marked(1, ['head_start'], { head_start: 1 }, [0, 13, '10', 2.5])), [])
  assert.equal(
    snapMonthNote([null, {}, point(undefined), { snap_months: 'x', part_year_snap_programs: 'head_start' }]),
    null,
  )
})

// Whether the note names these wages as a whole figure: "$2,000" but not the
// start of "$2,000,000" or "$20,000".
const namesWages = (note, wages) => {
  const figure = formatCurrency(wages).replace(/[$]/g, '\\$&')
  return new RegExp(`${figure}(?!\\d|,\\d)`).test(note)
}

const month = fc.integer({ min: 1, max: 12 })
const row = fc.record({
  snap_months: fc.uniqueArray(month, { maxLength: 12 }).map((months) => months.sort((a, b) => a - b)),
  part_year_snap_programs: fc.subarray([...SNAP_MONTH_PROGRAMS, 'wic']),
  head_start: fc.constantFrom(0, 13086),
  early_head_start: fc.constantFrom(0, 24960),
  free_school_meals: fc.constantFrom(0, 3710),
})

test('snapMonthNote appears exactly when a point marks a program it carries', () => {
  fc.assert(
    fc.property(fc.array(row, { maxLength: 25 }), (rows) => {
      const series = rows.map((values, index) => point(index * 500, values))
      const isMarked = series.map((values) =>
        values.snap_months.length > 0
        && values.snap_months.length < 12
        && SNAP_MONTH_PROGRAMS.some((key) => values.part_year_snap_programs.includes(key) && values[key] > 0))
      const note = snapMonthNote(series)
      if (!isMarked.some(Boolean)) {
        assert.equal(note, null)
        return
      }
      assert.ok(note.includes(RULE_START), note)
      // The note names the first and last marked wages.
      assert.ok(namesWages(note, isMarked.indexOf(true) * 500), note)
      assert.ok(namesWages(note, isMarked.lastIndexOf(true) * 500), note)
      // It names only programs some marked point carries.
      const named = SNAP_MONTH_PROGRAMS.filter((key) =>
        series.some((values, index) => isMarked[index] && values.part_year_snap_programs.includes(key) && values[key] > 0))
      assert.equal(note.includes('Early Head Start'), named.includes('early_head_start'), note)
      assert.equal(note.includes('free school meals'), named.includes('free_school_meals'), note)
      // It points to Head Start without SNAP only where no marked point has January.
      const january = series.some((values, index) => isMarked[index] && values.snap_months.includes(1))
      assert.equal(note.includes('without SNAP'), !january, note)
    }),
  )
})

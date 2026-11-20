import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  COARSE_SAMPLING_NOTE,
  cliffRefinementStep,
  getRefinementWindows,
  refineCliffZones,
  refinementWindowKey,
  refinementFailureNote,
  refinementNote,
} from './seriesRefine.js'

const COARSE_STEP = 2500
const REFINE_STEP = 500
// Net resources rise $0.40 per dollar earned, except for two $3,000 cliffs
// at $7,000 and $16,000 that land between coarse points.
const CLIFFS = [7000, 16000]
const netResources = (income) => (
  10000 + 0.4 * income - 3000 * CLIFFS.filter((cliff) => income >= cliff).length
)

const metadata = { programs: [{ key: 'snap', label: 'SNAP' }] }
const inputs = { state: 'GA' }

function seriesPoints(min, max, step) {
  const points = []
  for (let income = min; income <= max; income += step) {
    const previous = points[points.length - 1]
    const net = netResources(income)
    const drop = previous ? Math.max(0, previous.net_resources - net) : 0
    points.push({
      earned_income: income,
      net_resources: net,
      snap: 6000 - 3000 * CLIFFS.filter(cliff => income >= cliff).length,
      is_cliff: drop > 0,
      cliff_drop_annual: drop,
    })
  }
  return points
}

const coarseSeries = () => ({
  data: seriesPoints(0, 25000, COARSE_STEP),
  step_annual: COARSE_STEP,
  max_earned_income: 25000,
})

const refineWith = (calculateSeriesFn) => refineCliffZones({
  coarseSeries: coarseSeries(),
  inputs,
  metadata,
  refineStep: REFINE_STEP,
  calculateSeriesFn,
})

const fakeCalculateSeries = ({ failAround = [] } = {}) => {
  const calls = []
  const fn = async (_inputs, _metadata, options) => {
    calls.push(options)
    if (failAround.some((income) => (
      income >= options.minEarnedIncome && income <= options.maxEarnedIncome
    ))) {
      throw new Error('Calculation failed: simulated server error')
    }
    return {
      data: seriesPoints(options.minEarnedIncome, options.maxEarnedIncome, options.step),
    }
  }
  return { fn, calls }
}

test('refineCliffZones refines every cliff zone and reports no failures', async () => {
  const { fn, calls } = fakeCalculateSeries()
  const refined = await refineWith(fn)

  assert.equal(calls.length, 2)
  assert.equal(refined.refined_zone_count, 2)
  assert.equal(refined.refinement_zone_count, 2)
  assert.equal(refined.refinement_failed_zone_count, 0)
  // Each cliff is now bracketed by points one refine step apart.
  for (const cliff of CLIFFS) {
    const after = refined.data.find((point) => point.earned_income >= cliff)
    const index = refined.data.indexOf(after)
    assert.equal(after.earned_income - refined.data[index - 1].earned_income, REFINE_STEP)
    assert.equal(after.is_cliff, true)
  }
  assert.equal(refinementNote(refined), null)
  assert.equal(refinementNote(refined, { usedFallbackStep: true }), COARSE_SAMPLING_NOTE)
})

test('saved windows produce the same merged points and cliff drivers as live refinements', async () => {
  const coarse = coarseSeries()
  const refineStep = cliffRefinementStep(coarse.step_annual)
  const windows = getRefinementWindows(coarse, refineStep)
  const recorded = fakeCalculateSeries()
  const expected = await refineWith(recorded.fn)
  assert.equal(expected.data.find(point => point.is_cliff).cliff_drivers[0].key, 'snap')
  assert.deepEqual(windows.map(window => window.request), recorded.calls)
  const saved = Object.fromEntries(recorded.calls.map(request => [
    refinementWindowKey(request),
    seriesPoints(request.minEarnedIncome, request.maxEarnedIncome, request.step),
  ]))
  for (const unavailable of ['none', 'missing', 'invalid']) {
    const sampleRefinements = { ...saved }
    const secondKey = refinementWindowKey(windows[1].request)
    if (unavailable === 'missing') delete sampleRefinements[secondKey]
    if (unavailable === 'invalid') sampleRefinements[secondKey] = [{ earned_income: -1 }]
    const live = fakeCalculateSeries()
    const result = await refineCliffZones({
      coarseSeries: coarse, inputs, metadata, refineStep, sampleRefinements, calculateSeriesFn: live.fn,
    })
    assert.deepEqual(result, expected)
    assert.deepEqual(live.calls, unavailable === 'none' ? [] : [windows[1].request])
  }
})

test('refineCliffZones reports a zone whose refinement request fails', async () => {
  const { fn } = fakeCalculateSeries({ failAround: [16000] })
  const refined = await refineWith(fn)

  assert.equal(refined.refined_zone_count, 1)
  assert.equal(refined.refinement_zone_count, 2)
  assert.equal(refined.refinement_failed_zone_count, 1)
  // The failed zone keeps its coarse points: the cliff still sits in a $2,500 gap.
  const after = refined.data.find((point) => point.earned_income >= 16000)
  const index = refined.data.indexOf(after)
  assert.equal(after.earned_income - refined.data[index - 1].earned_income, COARSE_STEP)
  assert.equal(
    refinementNote(refined),
    "Couldn't refine 1 of 2 cliff zones, so cliff edges there may be off by up to $2,500. Reload the page to try again.",
  )
})

test('refineCliffZones reports failures even when every zone fails', async () => {
  const { fn } = fakeCalculateSeries({ failAround: CLIFFS })
  const coarse = coarseSeries()
  const refined = await refineCliffZones({
    coarseSeries: coarse,
    inputs,
    metadata,
    refineStep: REFINE_STEP,
    calculateSeriesFn: fn,
  })

  assert.deepEqual(refined.data, coarse.data)
  assert.equal(refined.refinement_failed_zone_count, 2)
  assert.equal(refined.refinement_zone_count, 2)
  assert.match(refinementNote(refined), /^Couldn't refine 2 of 2 cliff zones, so cliff edges there may be off by up to \$2,500\./)
  // A failure note wins over the coarse-sampling note.
  assert.match(refinementNote(refined, { usedFallbackStep: true }), /^Couldn't refine/)
})

test('refineCliffZones returns the coarse series untouched when there is nothing to refine', async () => {
  const { fn, calls } = fakeCalculateSeries()
  const coarse = {
    data: seriesPoints(0, 5000, COARSE_STEP),
    step_annual: COARSE_STEP,
  }
  const refined = await refineCliffZones({
    coarseSeries: coarse,
    inputs,
    metadata,
    refineStep: REFINE_STEP,
    calculateSeriesFn: fn,
  })

  assert.equal(refined, coarse)
  assert.equal(calls.length, 0)
  assert.equal(refinementNote(refined), null)
})

test('refinementFailureNote names the step a cliff edge can be off by', () => {
  assert.equal(
    refinementFailureNote(500, 1, 1),
    "Couldn't refine 1 of 1 cliff zone, so cliff edges there may be off by up to $500. Reload the page to try again.",
  )
  assert.equal(
    refinementFailureNote(2500),
    "Couldn't refine the chart around its cliffs, so cliff edges there may be off by up to $2,500. Reload the page to try again.",
  )
})

test('refinement requests vary the primary earner and measure returned gaps', async () => {
  const fixedWages = 10000
  const coarse = coarseSeries()
  for (const point of coarse.data) point.earned_income += fixedWages
  const calls = []
  const refined = await refineCliffZones({
    coarseSeries: coarse,
    inputs,
    metadata,
    refineStep: REFINE_STEP,
    calculateSeriesFn: async (_inputs, _metadata, options) => {
      calls.push(options)
      const points = seriesPoints(options.minEarnedIncome, options.maxEarnedIncome, 1000)
      for (const point of points) point.earned_income += fixedWages
      return { data: points, step_annual: 1 }
    },
  })
  assert.equal(calls[0].minEarnedIncome, 3750)
  assert.equal(refined.refined_zone_count, 2)
  assert.equal(refined.refined_step_annual, 1000)
  assert.equal(refined.data[0].earned_income, fixedWages)
})

test('empty, incomplete, or unchanged coverage preserves the coarse zone and reports failure', async () => {
  for (const data of [[], seriesPoints(7000, 7500, 100), coarseSeries().data]) {
    const refined = await refineWith(async () => ({ data }))
    assert.equal(refined.refinement_failed_zone_count, 2)
    assert.deepEqual(refined.data, coarseSeries().data)
    assert.equal(refined.refined_step_annual, undefined)
  }
})

test('a mixed grid reports the largest measured refined gap and preserves coarse points', async () => {
  const refined = await refineWith(async (_inputs, _metadata, options) => {
    const points = seriesPoints(options.minEarnedIncome, options.maxEarnedIncome, 250)
    // Drop two adjacent samples inside the second original cliff interval.
    return { data: points.filter((p) => ![15750, 16000].includes(p.earned_income)) }
  })
  assert.equal(refined.refined_zone_count, 2)
  assert.equal(refined.refined_step_annual, 750)
  for (const coarse of coarseSeries().data) {
    assert.ok(refined.data.some((point) => point.earned_income === coarse.earned_income))
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COARSE_SAMPLING_NOTE,
  refineCliffZones,
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

const metadata = { programs: [] }
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

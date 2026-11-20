import { formatCurrency } from '../dataLookup.js'
import { buildCliffDrivers } from '../policyengineApi.js'
import { buildCliffReport } from './cliffReport.js'
import { applyStateProgramLabels } from './programLabels.js'

export const COARSE_SAMPLING_NOTE = 'Sampled coarsely for speed.'
export const COARSE_SAMPLING_REFINING_NOTE = 'Sampled coarsely for speed; refining around detected cliffs.'

// Shown when refinement requests still fail after retrying: those zones keep
// the coarse step, so a cliff there can sit anywhere within one step.
export function refinementFailureNote(stepAnnual, failedZoneCount = 0, zoneCount = 0) {
  const scope = failedZoneCount && zoneCount
    ? `${failedZoneCount} of ${zoneCount} cliff ${zoneCount === 1 ? 'zone' : 'zones'}`
    : 'the chart around its cliffs'
  return `Couldn't refine ${scope}, so cliff edges there may be off by up to ${formatCurrency(Number(stepAnnual) || 0)}. Reload the page to try again.`
}

// The chart note once refinement has finished, or null for none.
export function refinementNote(series, { usedFallbackStep = false } = {}) {
  const failedZoneCount = Number(series?.refinement_failed_zone_count) || 0
  if (failedZoneCount) {
    return refinementFailureNote(
      series.step_annual,
      failedZoneCount,
      Number(series.refinement_zone_count) || failedZoneCount,
    )
  }
  return usedFallbackStep ? COARSE_SAMPLING_NOTE : null
}

const round = (value) => Math.round((Number(value) || 0) * 100) / 100

function dedupeSorted(points) {
  if (!points.length) return points
  const out = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].earned_income !== out[out.length - 1].earned_income) {
      out.push(points[i])
    }
  }
  return out
}

function pointForDrivers(point, programKeys) {
  return {
    programs: Object.fromEntries(
      programKeys.map((key) => [key, Number(point?.[key]) || 0]),
    ),
    household_costs: point?.household_costs || {},
    totals: {
      taxes: Number(point?.taxes) || 0,
    },
    person_programs: point?.person_programs || {},
  }
}

function recomputeDeltas(sortedData, programKeys, metadata, stateCode) {
  return sortedData.map((point, index) => {
    if (index === 0) {
      return {
        ...point,
        net_change_annual: 0,
        cliff_drop_annual: 0,
        is_cliff: false,
        cliff_drivers: [],
        has_previous_point: false,
      }
    }

    const prev = sortedData[index - 1]
    const netChange = round(point.net_resources - prev.net_resources)
    const stepAnnual = round(point.earned_income - prev.earned_income)
    const isCliff = netChange < 0
    const cliffDrop = isCliff ? -netChange : 0

    let drivers = []
    if (isCliff) {
      drivers = buildCliffDrivers(
        pointForDrivers(prev, programKeys),
        pointForDrivers(point, programKeys),
        metadata,
        stateCode,
      )
    }

    return {
      ...point,
      net_change_annual: netChange,
      step_annual: stepAnnual,
      cliff_drop_annual: cliffDrop,
      is_cliff: isCliff,
      cliff_drivers: drivers,
      has_previous_point: true,
    }
  })
}

export function cliffRefinementStep(step) {
  return Math.max(100, Math.floor(step / 5))
}

export function refinementWindowKey({ minEarnedIncome, maxEarnedIncome, step }) {
  return `${minEarnedIncome}:${maxEarnedIncome}:${step}`
}

export function getRefinementWindows(coarseSeries, refineStep) {
  const coarseStep = Number(coarseSeries?.step_annual) || 0
  if (!coarseSeries?.data?.length || coarseStep <= refineStep) return []
  const report = buildCliffReport(coarseSeries.data)

  // The chart shows household wages. The model varies the primary earner
  // from zero and keeps everyone else's wages fixed at the first point.
  const fixedWages = coarseSeries.data[0].earned_income
  const lastWages = coarseSeries.data[coarseSeries.data.length - 1].earned_income
  return report.zones.map(zone => {
    const margin = Math.max(coarseStep / 2, refineStep)
    const start = Math.max(fixedWages, zone.startIncomeAnnual - margin)
    const end = Math.min(lastWages, zone.endIncomeAnnual + margin)
    return {
      zone, start, end,
      request: {
        minEarnedIncome: Math.floor(round(start - fixedWages)),
        maxEarnedIncome: Math.ceil(round(end - fixedWages)),
        step: refineStep,
      },
    }
  })
}

export function validateRefinement(coarseSeries, { start, end, zone }, data) {
  if (!Array.isArray(data)) return null
  const points = data.filter((point) => (
    Number.isFinite(point?.earned_income)
    && Number.isFinite(point.net_resources)
    && point.earned_income >= start
    && point.earned_income <= end
  )).sort((a, b) => a.earned_income - b.earned_income)
  if (
    points.length < 2
    || points[0].earned_income > zone.startIncomeAnnual
    || points.at(-1).earned_income < zone.endIncomeAnnual
  ) return null

  // Measure the resulting grid in the original zone. Keep the coarse
  // observations too: a refined grid need not line up with them.
  const wages = [...coarseSeries.data, ...points]
    .map((point) => point.earned_income)
    .filter((income) => income >= zone.startIncomeAnnual && income <= zone.endIncomeAnnual)
    .sort((a, b) => a - b)
  let maxGap = 0
  for (let i = 1; i < wages.length; i += 1) {
    maxGap = Math.max(maxGap, round(wages[i] - wages[i - 1]))
  }
  return maxGap > 0 && maxGap < coarseSeries.step_annual ? { points, maxGap } : null
}

export async function refineCliffZones({
  coarseSeries,
  inputs,
  metadata,
  calculateSeriesFn,
  sampleRefinements,
  refineStep = 250,
  isCancelled = () => false,
}) {
  const windows = getRefinementWindows(coarseSeries, refineStep)
  if (!windows.length) return coarseSeries
  const programs = applyStateProgramLabels(metadata?.programs || [], metadata, inputs?.state)
  const programKeys = programs.map((p) => p.key)
  const refinementJobs = windows.map(async window => {
    const saved = sampleRefinements?.[refinementWindowKey(window.request)]
    const batch = validateRefinement(coarseSeries, window, saved)
    if (batch) return batch
    try {
      const refined = await calculateSeriesFn(inputs, metadata, window.request)
      return validateRefinement(coarseSeries, window, refined?.data)
    } catch (err) {
      console.error('Cliff refinement failed', err)
      return null
    }
  })

  const batches = await Promise.all(refinementJobs)
  if (isCancelled()) return coarseSeries

  const refined = batches.filter(Boolean)
  const refinementStatus = {
    refinement_zone_count: batches.length,
    refinement_failed_zone_count: batches.length - refined.length,
  }
  if (!refined.length) return { ...coarseSeries, ...refinementStatus }

  const mergedRaw = [...coarseSeries.data, ...refined.flatMap((batch) => batch.points)]
    .sort((a, b) => a.earned_income - b.earned_income)

  const deduped = dedupeSorted(mergedRaw)
  const withDeltas = recomputeDeltas(
    deduped,
    programKeys,
    metadata,
    inputs?.state,
  )

  return {
    ...coarseSeries,
    data: withDeltas,
    point_count: withDeltas.length,
    max_net_resources: Math.max(
      ...withDeltas.map((p) => Number(p.net_resources) || 0),
      0,
    ),
    refined_zone_count: refined.length,
    refined_step_annual: Math.max(...refined.map((batch) => batch.maxGap)),
    ...refinementStatus,
  }
}

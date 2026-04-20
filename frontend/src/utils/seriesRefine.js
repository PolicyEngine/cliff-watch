import { buildCliffReport } from './cliffReport'

const round = (value) => Math.round((Number(value) || 0) * 100) / 100
const monthly = (value) => round(value / 12)
const DEFAULT_HOUSEHOLD_COST_DEFINITIONS = [
  {
    key: 'chip_premium',
    label: 'CHIP premium',
  },
]

function getHouseholdCostDefinitions(metadata) {
  const definitions = metadata?.household_costs
  if (Array.isArray(definitions) && definitions.length) {
    return definitions
  }
  return DEFAULT_HOUSEHOLD_COST_DEFINITIONS
}

function getHouseholdCostValue(point, key) {
  return Number(point?.household_costs?.[key] ?? point?.[key]) || 0
}

function dedupeSorted(points) {
  if (!points.length) return points
  const out = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    if (Math.round(points[i].earned_income) !== Math.round(out[out.length - 1].earned_income)) {
      out.push(points[i])
    }
  }
  return out
}

function recomputeDeltas(sortedData, programKeys, programLabels, householdCostKeys, householdCostLabels) {
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
      programKeys.forEach((key) => {
        const change = round((point[key] || 0) - (prev[key] || 0))
        if (change < 0) {
          drivers.push({
            key,
            label: programLabels[key] || key,
            kind: 'benefit_loss',
            raw_change_annual: change,
            raw_change_monthly: monthly(change),
            resource_effect_annual: change,
            resource_effect_monthly: monthly(change),
          })
        }
      })
      householdCostKeys.forEach((key) => {
        const change = round(getHouseholdCostValue(point, key) - getHouseholdCostValue(prev, key))
        if (change > 0) {
          drivers.push({
            key,
            label: householdCostLabels[key] || key,
            kind: 'household_cost_increase',
            raw_change_annual: change,
            raw_change_monthly: monthly(change),
            resource_effect_annual: round(-change),
            resource_effect_monthly: monthly(-change),
          })
        }
      })
      const taxChange = round(point.taxes - prev.taxes)
      if (taxChange > 0) {
        drivers.push({
          key: 'taxes',
          label: 'Higher taxes',
          kind: 'tax_increase',
          raw_change_annual: taxChange,
          raw_change_monthly: monthly(taxChange),
          resource_effect_annual: round(-taxChange),
          resource_effect_monthly: monthly(-taxChange),
        })
      }
      drivers.sort((a, b) => a.resource_effect_annual - b.resource_effect_annual)
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

export async function refineCliffZones({
  coarseSeries,
  inputs,
  metadata,
  calculateSeriesFn,
  refineStep = 250,
  isCancelled = () => false,
}) {
  if (!coarseSeries?.data?.length) return coarseSeries

  const coarseStep = Number(coarseSeries.step_annual) || 0
  if (coarseStep <= refineStep) return coarseSeries

  const report = buildCliffReport(coarseSeries.data)
  if (!report.zones?.length) return coarseSeries

  const programs = metadata?.programs || []
  const programKeys = programs.map((p) => p.key)
  const programLabels = Object.fromEntries(programs.map((p) => [p.key, p.label]))
  const householdCosts = getHouseholdCostDefinitions(metadata)
  const householdCostKeys = householdCosts.map((cost) => cost.key)
  const householdCostLabels = Object.fromEntries(householdCosts.map((cost) => [cost.key, cost.label]))

  const refinementJobs = report.zones.map(async (zone) => {
    const margin = Math.max(coarseStep / 2, refineStep)
    const start = Math.max(0, zone.startIncomeAnnual - margin)
    const end = zone.endIncomeAnnual + margin
    try {
      const refined = await calculateSeriesFn(inputs, metadata, {
        minEarnedIncome: start,
        maxEarnedIncome: end,
        step: refineStep,
      })
      return refined?.data || []
    } catch (err) {
      console.error('Cliff refinement failed', err)
      return []
    }
  })

  const refinedBatches = await Promise.all(refinementJobs)
  if (isCancelled()) return coarseSeries

  const ranges = refinedBatches
    .map((batch) => {
      if (!batch.length) return null
      const first = batch[0].earned_income
      const last = batch[batch.length - 1].earned_income
      return { min: first, max: last, points: batch }
    })
    .filter(Boolean)

  if (!ranges.length) return coarseSeries

  const keptCoarse = coarseSeries.data.filter((point) => {
    const income = point.earned_income
    return !ranges.some((range) => income >= range.min && income <= range.max)
  })

  const mergedRaw = [...keptCoarse, ...ranges.flatMap((range) => range.points)]
    .sort((a, b) => a.earned_income - b.earned_income)

  const deduped = dedupeSorted(mergedRaw)
  const withDeltas = recomputeDeltas(
    deduped,
    programKeys,
    programLabels,
    householdCostKeys,
    householdCostLabels,
  )

  return {
    ...coarseSeries,
    data: withDeltas,
    point_count: withDeltas.length,
    max_net_resources: Math.max(
      ...withDeltas.map((p) => Number(p.net_resources) || 0),
      0,
    ),
    refined_zone_count: ranges.length,
    refined_step_annual: refineStep,
  }
}

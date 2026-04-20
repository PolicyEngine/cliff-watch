const round = (value) => Math.round((Number(value) || 0) * 100) / 100
const MIN_REPORTABLE_DROP_ANNUAL = 500
const MIN_REPORTABLE_DRIVER_LOSS_ANNUAL = 500
const ZONE_GAP_MULTIPLIER = 1.5
const MATERIAL_DRIVER_KINDS = new Set(['benefit_loss', 'household_cost_increase'])
const driverImpactAnnual = (driver) => Math.abs(Number(driver?.resource_effect_annual) || 0)

const sortDrivers = (drivers) => drivers.sort((left, right) => {
  if (right.totalImpactAnnual !== left.totalImpactAnnual) {
    return right.totalImpactAnnual - left.totalImpactAnnual
  }

  if (right.occurrences !== left.occurrences) {
    return right.occurrences - left.occurrences
  }

  return left.label.localeCompare(right.label)
})

const sortStepDrivers = (drivers) => [...drivers].sort((left, right) => {
  const impactDifference = driverImpactAnnual(right) - driverImpactAnnual(left)
  if (impactDifference !== 0) {
    return impactDifference
  }

  return (left?.label || '').localeCompare(right?.label || '')
})

export function getCliffSeverity(dropAnnual, stepAnnual) {
  const drop = Math.max(0, Number(dropAnnual) || 0)
  const step = Math.max(1, Number(stepAnnual) || 0)
  const lossRate = drop / step

  if (lossRate >= 2 || drop >= 300) {
    return {
      tone: 'severe',
      label: 'Cliff',
      shortLabel: 'Cliff',
      lossRate,
    }
  }

  if (lossRate >= 1 || drop >= 125) {
    return {
      tone: 'moderate',
      label: 'Cliff',
      shortLabel: 'Cliff',
      lossRate,
    }
  }

  return {
    tone: 'mild',
    label: 'Cliff',
    shortLabel: 'Cliff',
    lossRate,
  }
}

export function formatLossRate(lossRate) {
  if (!Number.isFinite(lossRate) || lossRate <= 0) {
    return '$0.00 lost per $1 earned'
  }

  return `$${lossRate.toFixed(2)} lost per $1 earned`
}

export function rollupCliffDrivers(drivers = []) {
  const aggregates = new Map()

  drivers.forEach((driver) => {
    const key = driver?.key || driver?.label
    if (!key) return

    const current = aggregates.get(key) || {
      key,
      label: driver.label,
      kind: driver.kind,
      totalImpactAnnual: 0,
      occurrences: 0,
    }

    current.totalImpactAnnual = round(
      current.totalImpactAnnual
        + Math.abs(Number(driver.resource_effect_annual) || 0),
    )
    current.occurrences += 1
    aggregates.set(key, current)
  })

  return sortDrivers([...aggregates.values()])
}

export function filterMaterialCliffDrivers(drivers = []) {
  return sortStepDrivers(
    drivers.filter((driver) => (
      MATERIAL_DRIVER_KINDS.has(driver?.kind)
      && driverImpactAnnual(driver) >= MIN_REPORTABLE_DRIVER_LOSS_ANNUAL
    )),
  )
}

function isReportableCliff(cliff) {
  const hasMajorProgramLoss = filterMaterialCliffDrivers(cliff.cliff_drivers || []).length > 0

  return (
    cliff.dropAnnual >= MIN_REPORTABLE_DROP_ANNUAL
    || hasMajorProgramLoss
  )
}

export function describeDrivers(drivers = [], limit = 2) {
  const labels = drivers
    .slice(0, limit)
    .map((driver) => driver.label)
    .filter(Boolean)

  if (labels.length === 0) {
    return 'mixed program losses'
  }

  if (labels.length === 1) {
    return labels[0]
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`
  }

  return `${labels[0]}, ${labels[1]}, and other changes`
}

export function buildCliffReport(data = []) {
  const rawCliffs = data.flatMap((point, index) => {
    if (!point?.is_cliff || index === 0) return []

    const previousPoint = data[index - 1]
    const dropAnnual = Math.max(
      0,
      Number(point.cliff_drop_annual)
        || round(
          (Number(previousPoint?.net_resources) || 0)
            - (Number(point.net_resources) || 0),
        ),
    )
    const stepAnnual = Math.max(
      0,
      Number(point.step_annual)
        || round(
          (Number(point.earned_income) || 0)
            - (Number(previousPoint?.earned_income) || 0),
        ),
    )
    const severity = getCliffSeverity(dropAnnual, stepAnnual)

    return [
      {
        ...point,
        material_cliff_drivers: filterMaterialCliffDrivers(point.cliff_drivers || []),
        dropAnnual,
        stepAnnual,
        severity,
        lossRate: severity.lossRate,
        startIncomeAnnual: Number(previousPoint?.earned_income) || 0,
        endIncomeAnnual: Number(point.earned_income) || 0,
        beforeResourcesAnnual: Number(previousPoint?.net_resources) || 0,
        afterResourcesAnnual: Number(point.net_resources) || 0,
        beforeSupportAnnual: Number(previousPoint?.core_support) || 0,
        afterSupportAnnual: Number(point.core_support) || 0,
        beforeTaxesAnnual: Number(previousPoint?.taxes) || 0,
        afterTaxesAnnual: Number(point.taxes) || 0,
      },
    ]
  })

  const cliffs = rawCliffs.filter(isReportableCliff)

  if (cliffs.length === 0) {
    return {
      cliffs: [],
      zones: [],
      dominantDrivers: [],
      largestCliff: null,
      firstCliff: null,
      worstLossRateCliff: null,
      hiddenCliffCount: rawCliffs.length,
      thresholds: {
        minDropAnnual: MIN_REPORTABLE_DROP_ANNUAL,
        minDriverLossAnnual: MIN_REPORTABLE_DRIVER_LOSS_ANNUAL,
      },
    }
  }

  const rawZones = []

  cliffs.forEach((cliff) => {
    const lastZone = rawZones[rawZones.length - 1]
    const continuesLastZone = (
      lastZone
      && cliff.startIncomeAnnual
        <= lastZone.endIncomeAnnual + (cliff.stepAnnual * ZONE_GAP_MULTIPLIER)
    )

    if (!continuesLastZone) {
      rawZones.push({
        startIncomeAnnual: cliff.startIncomeAnnual,
        endIncomeAnnual: cliff.endIncomeAnnual,
        beforeResourcesAnnual: cliff.beforeResourcesAnnual,
        afterResourcesAnnual: cliff.afterResourcesAnnual,
        cliffs: [cliff],
      })
      return
    }

    lastZone.endIncomeAnnual = cliff.endIncomeAnnual
    lastZone.afterResourcesAnnual = cliff.afterResourcesAnnual
    lastZone.cliffs.push(cliff)
  })

  const lastDataIncomeAnnual = Number(data[data.length - 1]?.earned_income) || 0

  const zones = rawZones.map((zone) => {
    const dominantDrivers = rollupCliffDrivers(
      zone.cliffs.flatMap((cliff) => cliff.material_cliff_drivers || []),
    )
    const largestCliff = zone.cliffs.reduce((largest, cliff) => (
      cliff.dropAnnual > largest.dropAnnual ? cliff : largest
    ), zone.cliffs[0])
    const totalDropAnnual = round(
      zone.cliffs.reduce((sum, cliff) => sum + cliff.dropAnnual, 0),
    )

    const recoveryPoint = data.find((point) => (
      Number(point.earned_income || 0) > zone.endIncomeAnnual
      && Number(point.net_resources || 0) >= zone.beforeResourcesAnnual
    ))
    const recoveryIncomeAnnual = recoveryPoint
      ? Number(recoveryPoint.earned_income) || 0
      : null
    const recoveryGapAnnual = recoveryIncomeAnnual !== null
      ? round(recoveryIncomeAnnual - zone.endIncomeAnnual)
      : null

    return {
      id: `${Math.round(zone.startIncomeAnnual)}-${Math.round(zone.endIncomeAnnual)}`,
      startIncomeAnnual: zone.startIncomeAnnual,
      endIncomeAnnual: zone.endIncomeAnnual,
      beforeResourcesAnnual: zone.beforeResourcesAnnual,
      afterResourcesAnnual: zone.afterResourcesAnnual,
      totalDropAnnual,
      netResourceChangeAnnual: round(
        zone.afterResourcesAnnual - zone.beforeResourcesAnnual,
      ),
      largestDropAnnual: largestCliff.dropAnnual,
      cliffCount: zone.cliffs.length,
      worstLossRate: largestCliff.lossRate,
      highestRiskIncomeAnnual: largestCliff.endIncomeAnnual,
      severity: largestCliff.severity,
      dominantDrivers,
      topDriver: dominantDrivers[0] || null,
      driverSummary: describeDrivers(dominantDrivers),
      cliffs: zone.cliffs,
      recoveryIncomeAnnual,
      recoveryGapAnnual,
      recoveredWithinChart: recoveryIncomeAnnual !== null,
      chartMaxIncomeAnnual: lastDataIncomeAnnual,
    }
  })

  const dominantDrivers = rollupCliffDrivers(
    cliffs.flatMap((cliff) => cliff.material_cliff_drivers || []),
  )
  const largestCliff = cliffs.reduce((largest, cliff) => (
    cliff.dropAnnual > largest.dropAnnual ? cliff : largest
  ), cliffs[0])
  const worstLossRateCliff = cliffs.reduce((largest, cliff) => (
    cliff.lossRate > largest.lossRate ? cliff : largest
  ), cliffs[0])

  return {
    cliffs,
    zones,
    dominantDrivers,
    largestCliff,
    firstCliff: cliffs[0],
    worstLossRateCliff,
    hiddenCliffCount: Math.max(0, rawCliffs.length - cliffs.length),
    thresholds: {
      minDropAnnual: MIN_REPORTABLE_DROP_ANNUAL,
      minDriverLossAnnual: MIN_REPORTABLE_DRIVER_LOSS_ANNUAL,
    },
  }
}

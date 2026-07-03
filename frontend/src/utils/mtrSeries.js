export const MTR_KEY_PREFIX = 'mtr_'
export const MTR_OTHER_KEY = 'mtr_other'

export const mtrKeyFor = (seriesKey) => `${MTR_KEY_PREFIX}${seriesKey}`

// Every component key holds the series' contribution to net income at each
// point (supports positive, taxes and household costs already negated), so a
// component's marginal-tax-rate contribution is -delta(value) / delta(earnings)
// and the contributions plus the residual sum exactly to the total MTR.
export function appendMtrSeries(points, componentKeys, {
  earnedKey = 'earned_income_annual',
  netKey = 'net_resources_annual',
} = {}) {
  const withMtr = points.map((point, index) => {
    const prev = points[index - 1]
    const next = { ...point, marginal_tax_rate: null, [MTR_OTHER_KEY]: null }
    componentKeys.forEach((key) => {
      next[mtrKeyFor(key)] = null
    })

    if (!prev) {
      return next
    }

    const deltaEarn = Number(point[earnedKey] || 0) - Number(prev[earnedKey] || 0)
    if (!(deltaEarn > 0)) {
      return next
    }

    const deltaNet = Number(point[netKey] || 0) - Number(prev[netKey] || 0)
    const total = 1 - deltaNet / deltaEarn
    next.marginal_tax_rate = total

    let contributionSum = 0
    componentKeys.forEach((key) => {
      const delta = Number(point[key] || 0) - Number(prev[key] || 0)
      const contribution = -delta / deltaEarn
      next[mtrKeyFor(key)] = contribution
      contributionSum += contribution
    })
    next[MTR_OTHER_KEY] = total - contributionSum

    return next
  })

  // The first point has no backward interval, so carry the first computed
  // rates back onto it: step rendering then spans the opening interval, and
  // the tooltip reports the rate a household faces on its first earned dollars.
  const first = withMtr[0]
  const second = withMtr[1]
  if (first && second && second.marginal_tax_rate !== null) {
    first.marginal_tax_rate = second.marginal_tax_rate
    first[MTR_OTHER_KEY] = second[MTR_OTHER_KEY]
    componentKeys.forEach((key) => {
      first[mtrKeyFor(key)] = second[mtrKeyFor(key)]
    })
  }

  return withMtr
}

export function hasMaterialMtrValues(points, key, threshold = 0.001) {
  return points.some((point) => Math.abs(Number(point?.[key] || 0)) >= threshold)
}

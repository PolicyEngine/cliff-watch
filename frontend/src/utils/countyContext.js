// What the results panel says about the county a calculation used, from the
// `location` block the API returns with a series. A pure function, so the wording
// and the choices stay testable without rendering React.

function formatShare(share) {
  if (share === null || share === undefined) return null
  const percent = Math.round(share * 100)
  if (percent < 1) return 'under 1%'
  if (percent >= 100) return share < 1 ? 'over 99%' : '100%'
  return `${percent}%`
}

function optionLabel(county) {
  const share = formatShare(county.resident_share)
  return share ? `${county.name} (${share} of residents)` : county.name
}

function usedCountyClause(county, isFirst) {
  const share = formatShare(county.resident_share)
  if (share) return `This chart uses ${county.name}, home to ${share} of its residents.`
  // A ZIP with no residents ranks its counties by land area.
  return isFirst
    ? `This chart uses ${county.name}, which has the largest share of its land.`
    : `This chart uses ${county.name}.`
}

const EMPTY_CONTEXT = Object.freeze({
  countyName: null,
  note: null,
  options: [],
  selected: null,
})

export function countyContext(location, stateName = '') {
  if (!location) return EMPTY_CONTEXT

  const context = countyChoices(location, stateName)
  if (location.has_benchmark_premium !== false) return context

  const gap = `CliffWatch has no benchmark premium for ${context.countyName}, so this chart shows no premium tax credit.`
  return { ...context, note: context.note ? `${context.note} ${gap}` : gap }
}

function countyChoices(location, stateName) {
  const { county, source, zip } = location
  const countyName = location.county_name || county || null
  const counties = location.counties || []

  if (source === 'none' || !county) {
    const place = stateName === 'District of Columbia' ? `the ${stateName}` : stateName
    return {
      ...EMPTY_CONTEXT,
      note: zip
        ? `CliffWatch can't place ZIP ${zip} in a county in ${place}, so rules that vary by county use the first county alphabetically there.`
        : `This household has no ZIP code, so rules that vary by county use the first county alphabetically in ${place}.`,
    }
  }

  const used = counties.find((option) => option.code === county)

  if (!used) {
    // A share link named a county the ZIP doesn't cover.
    const zipLine = counties.length
      ? ` ZIP ${zip} lies ${counties.length > 1 ? 'mostly ' : ''}in ${counties[0].name}.`
      : ''
    return {
      countyName,
      note: `This link names ${countyName}, so this chart uses it.${zipLine}`,
      options: counties.length
        ? [
            { code: county, label: countyName },
            ...counties.map((option) => ({
              code: option.code,
              label: optionLabel(option),
            })),
          ]
        : [],
      selected: county,
    }
  }

  if (counties.length === 1) {
    return { ...EMPTY_CONTEXT, countyName, selected: county }
  }

  return {
    countyName,
    note: `ZIP ${zip} covers more than one county. ${usedCountyClause(used, used === counties[0])}`,
    options: counties.map((option) => ({
      code: option.code,
      label: optionLabel(option),
    })),
    selected: county,
  }
}

// What a county choice stores in the draft: the ZIP's own county goes back to
// null, so a share link names a county only when it overrides the ZIP.
export function countyDraftValue(code, location) {
  return code === location?.counties?.[0]?.code ? null : code
}

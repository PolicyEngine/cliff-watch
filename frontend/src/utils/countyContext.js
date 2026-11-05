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

function usedCountyClause(county) {
  const share = formatShare(county.resident_share)
  return share
    ? `This chart uses ${county.name}, home to ${share} of its residents.`
    : `This chart uses ${county.name}, which holds most of its land.`
}

const EMPTY_CONTEXT = Object.freeze({
  countyName: null,
  note: null,
  options: [],
  selected: null,
})

export function countyContext(location, stateName = '') {
  if (!location) return EMPTY_CONTEXT

  const { county, source, zip } = location
  const countyName = location.county_name || county || null
  const counties = location.counties || []

  if (source === 'none' || !county) {
    return {
      ...EMPTY_CONTEXT,
      note: `CliffWatch can't place ZIP ${zip} in a ${stateName} county, so rules that vary by county use PolicyEngine's default county for the state.`,
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
    note: `ZIP ${zip} covers more than one county. ${usedCountyClause(used)}`,
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

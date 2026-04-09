const parseErrorMessage = async (response) => {
  try {
    const payload = await response.json()
    return payload.error || `Request failed with status ${response.status}`
  } catch {
    return `Request failed with status ${response.status}`
  }
}

const postJson = async (path, payload) => {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  return response.json()
}

export const formatCurrency = (value, digits = 0) => new Intl.NumberFormat(
  'en-US',
  {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  },
).format(value || 0)

export const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`

export async function loadMetadata() {
  const response = await fetch('/api/metadata')
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
  return response.json()
}

const normalizePeople = (people = []) => people.map((person) => ({
  kind: person?.kind === 'child' ? 'child' : 'adult',
  age: Math.max(0, Number(person?.age) || 0),
}))

export function createInitialInputs(metadata) {
  return {
    state: metadata?.defaults?.state || 'GA',
    people: normalizePeople(metadata?.defaults?.people || []),
    earned_income_yearly:
      metadata?.defaults?.earned_income_yearly
      || (metadata?.defaults?.earned_income_monthly
        ? metadata.defaults.earned_income_monthly * 12
        : 30000),
  }
}

export function normalizeInputs(inputs, metadata) {
  return {
    state: inputs.state,
    people: normalizePeople(inputs.people || []),
    earned_income_yearly: Math.max(0, Number(inputs.earned_income_yearly) || 0),
    year: metadata?.year || 2026,
  }
}

export function buildHouseholdPayload(inputs, metadata) {
  const normalized = normalizeInputs(inputs, metadata)
  return {
    state: normalized.state,
    people: normalized.people,
    earned_income: Math.round(normalized.earned_income_yearly),
    year: normalized.year,
  }
}

export async function calculateStateResult(inputs, metadata) {
  const response = await postJson('/api/calculate', buildHouseholdPayload(inputs, metadata))
  return response.result
}

export async function calculateAllStates(inputs, metadata) {
  return postJson('/api/states', buildHouseholdPayload(inputs, metadata))
}

export async function calculateSeries(inputs, metadata, options = {}) {
  const payload = buildHouseholdPayload(inputs, metadata)
  payload.max_earned_income = (metadata?.defaults?.series_max_earned_income || 90000)
  payload.step = options.step || metadata?.defaults?.series_step || 2500
  return postJson('/api/series', payload)
}

export async function calculateHouseholdTypes(inputs, metadata) {
  return postJson('/api/households', buildHouseholdPayload(inputs, metadata))
}

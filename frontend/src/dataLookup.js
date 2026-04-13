import {
  calculateAllStatesViaPolicyEngine,
  calculateHouseholdViaPolicyEngine,
  calculateSeriesViaPolicyEngine,
} from './policyengineApi'

const VALID_FILING_STATUSES = new Set([
  'SINGLE',
  'HEAD_OF_HOUSEHOLD',
  'JOINT',
  'SEPARATE',
])

const MARRIED_FILING_STATUSES = new Set(['JOINT', 'SEPARATE'])

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
export const filingStatusRequiresSpouse = (status) => MARRIED_FILING_STATUSES.has(status)

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

const deriveFilingStatus = (people = []) => {
  const adults = people.filter((person) => person.kind === 'adult').length
  const children = people.filter((person) => person.kind === 'child').length

  if (adults >= 2) {
    return 'JOINT'
  }
  if (children > 0) {
    return 'HEAD_OF_HOUSEHOLD'
  }
  return 'SINGLE'
}

const normalizeFilingStatus = (filingStatus, people = []) => (
  VALID_FILING_STATUSES.has(filingStatus)
    ? filingStatus
    : deriveFilingStatus(people)
)

const buildAutoSpouse = (firstAdult) => ({
  kind: 'adult',
  age: Math.max(18, Number(firstAdult?.age) || 30),
})

const reconcilePeopleForFilingStatus = (people = [], filingStatus) => {
  if (!filingStatusRequiresSpouse(filingStatus)) {
    return people
  }

  const adultIndexes = people.reduce((indexes, person, index) => {
    if (person.kind === 'adult') {
      indexes.push(index)
    }
    return indexes
  }, [])

  if (!adultIndexes.length) {
    return people
  }

  const [firstAdultIndex, secondAdultIndex] = adultIndexes
  const firstAdult = people[firstAdultIndex]
  const spouse = secondAdultIndex != null
    ? people[secondAdultIndex]
    : buildAutoSpouse(firstAdult)

  return [
    firstAdult,
    spouse,
    ...people.filter((_, index) => (
      index !== firstAdultIndex && index !== secondAdultIndex
    )),
  ]
}

export function reconcileInputs(inputs, metadata) {
  const normalizedPeople = normalizePeople(inputs?.people || [])
  const filing_status = normalizeFilingStatus(
    inputs?.filing_status,
    normalizedPeople,
  )

  return {
    ...inputs,
    state: inputs?.state || metadata?.defaults?.state || 'GA',
    people: reconcilePeopleForFilingStatus(normalizedPeople, filing_status),
    filing_status,
    earned_income_yearly: Math.max(
      0,
      Number(inputs?.earned_income_yearly) || 0,
    ),
    year: metadata?.year || 2026,
  }
}

export function createInitialInputs(metadata) {
  return reconcileInputs({
    state: metadata?.defaults?.state || 'GA',
    people: normalizePeople(metadata?.defaults?.people || []),
    filing_status: metadata?.defaults?.filing_status,
    earned_income_yearly: metadata?.defaults?.earned_income_yearly || 30000,
  }, metadata)
}

export function normalizeInputs(inputs, metadata) {
  const reconciled = reconcileInputs(inputs, metadata)
  return {
    state: reconciled.state,
    people: reconciled.people,
    filing_status: reconciled.filing_status,
    earned_income_yearly: reconciled.earned_income_yearly,
    year: reconciled.year,
  }
}

export function buildHouseholdPayload(inputs, metadata) {
  const normalized = normalizeInputs(inputs, metadata)
  return {
    state: normalized.state,
    people: normalized.people,
    filing_status: normalized.filing_status,
    earned_income: Math.round(normalized.earned_income_yearly),
    year: normalized.year,
  }
}

export async function calculateStateResult(inputs, metadata) {
  const payload = buildHouseholdPayload(inputs, metadata)
  try {
    return await calculateHouseholdViaPolicyEngine(payload, metadata)
  } catch (error) {
    console.error(error)
    const response = await postJson('/api/calculate', payload)
    return response.result
  }
}

export async function calculateAllStates(inputs, metadata) {
  const payload = buildHouseholdPayload(inputs, metadata)
  try {
    return await calculateAllStatesViaPolicyEngine(payload, metadata)
  } catch (error) {
    console.error(error)
    return postJson('/api/states', payload)
  }
}

export async function calculateSeries(inputs, metadata, options = {}) {
  const payload = buildHouseholdPayload(inputs, metadata)
  const seriesBuffer = metadata?.defaults?.series_earnings_buffer || 30000
  const minimumWindow = metadata?.defaults?.series_min_earnings_window || 40000
  const requestedMax = metadata?.defaults?.series_max_earned_income || 90000
  payload.max_earned_income = Math.min(
    requestedMax,
    Math.max(
      payload.earned_income + seriesBuffer,
      minimumWindow,
    ),
  )
  payload.step = options.step || metadata?.defaults?.series_step || 2500
  try {
    return await calculateSeriesViaPolicyEngine(payload, metadata)
  } catch (error) {
    console.error(error)
    return postJson('/api/series', payload)
  }
}

export async function calculateHouseholdTypes(inputs, metadata) {
  return postJson('/api/households', buildHouseholdPayload(inputs, metadata))
}

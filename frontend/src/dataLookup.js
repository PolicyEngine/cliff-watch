import {
  calculateHouseholdViaPolicyEngine,
  calculateSeriesViaPolicyEngine,
} from './policyengineApi'

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

const MAX_ADULTS = 2
const normalizePeople = (people = []) => {
  let adultCount = 0

  return people.map((person) => {
    const requestedAdult = person?.kind !== 'child'
    const kind = requestedAdult && adultCount < MAX_ADULTS ? 'adult' : 'child'

    if (kind === 'adult') {
      adultCount += 1
    }

    return {
      kind,
      age: Math.max(0, Number(person?.age) || 0),
      is_pregnant: kind === 'adult' ? Boolean(person?.is_pregnant) : false,
    }
  })
}

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

export function reconcileInputs(inputs, metadata) {
  const normalizedPeople = normalizePeople(inputs?.people || [])
  const filing_status = deriveFilingStatus(normalizedPeople)
  const defaultChartMax = Math.max(
    10000,
    Number(metadata?.defaults?.chart_max_earned_income)
      || Number(metadata?.defaults?.series_max_earned_income)
      || 100000,
  )

  return {
    ...inputs,
    state: inputs?.state || metadata?.defaults?.state || 'GA',
    people: normalizedPeople,
    filing_status,
    chart_max_earned_income: Math.max(
      10000,
      Number(inputs?.chart_max_earned_income) || defaultChartMax,
    ),
    childcare_expenses: Math.max(0, Number(inputs?.childcare_expenses) || 0),
    rent_annual: Math.max(0, Number(inputs?.rent_annual) || 0),
    year: metadata?.year || 2026,
  }
}

export function createInitialInputs(metadata) {
  return reconcileInputs({
    state: metadata?.defaults?.state || 'GA',
    people: normalizePeople(metadata?.defaults?.people || []),
    chart_max_earned_income:
      metadata?.defaults?.chart_max_earned_income
      || metadata?.defaults?.series_max_earned_income
      || 100000,
    childcare_expenses: 0,
    rent_annual: 0,
  }, metadata)
}

export function normalizeInputs(inputs, metadata) {
  const reconciled = reconcileInputs(inputs, metadata)
  return {
    state: reconciled.state,
    people: reconciled.people,
    filing_status: reconciled.filing_status,
    chart_max_earned_income: reconciled.chart_max_earned_income,
    childcare_expenses: reconciled.childcare_expenses,
    rent_annual: reconciled.rent_annual,
    year: reconciled.year,
  }
}

export function buildHouseholdPayload(inputs, metadata) {
  const normalized = normalizeInputs(inputs, metadata)
  return {
    state: normalized.state,
    people: normalized.people,
    filing_status: normalized.filing_status,
    earned_income: 0,
    year: normalized.year,
    childcare_expenses: normalized.childcare_expenses,
    rent_annual: normalized.rent_annual,
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

export async function calculateSeries(inputs, metadata, options = {}) {
  const normalized = normalizeInputs(inputs, metadata)
  const payload = buildHouseholdPayload(inputs, metadata)
  payload.max_earned_income = Math.round(
    options.maxEarnedIncome ?? normalized.chart_max_earned_income,
  )
  payload.step = options.step || metadata?.defaults?.series_step || 2500
  if (options.minEarnedIncome) {
    payload.min_earned_income = Math.max(0, Math.round(options.minEarnedIncome))
  }
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

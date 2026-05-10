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

const appPath = (path) => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}${path}`

const postJson = async (path, payload) => {
  const response = await fetch(appPath(path), {
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
  const response = await fetch(appPath('/api/metadata'))
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
  return response.json()
}

const MAX_ADULTS_FALLBACK = 6
const MAX_DEPENDENTS_FALLBACK = 6

const VALID_FILING_STATUSES = new Set([
  'SINGLE',
  'HEAD_OF_HOUSEHOLD',
  'JOINT',
  'SEPARATE',
])

const MARRIED_FILING_STATUSES = new Set(['JOINT', 'SEPARATE'])

const COST_FIELDS = [
  'childcare_expenses',
  'rent_annual',
  'utility_expense_annual',
  'food_expense_annual',
  'transportation_expense_annual',
  'health_insurance_premium_annual',
  'technology_expense_annual',
  'debt_payment_annual',
  'education_expense_annual',
  'other_expense_annual',
]

const INCOME_AND_ASSET_FIELDS = [
  'self_employment_income_annual',
  'child_support_annual',
  'taxable_interest_income_annual',
  'dividend_income_annual',
  'rental_income_annual',
  'unemployment_compensation_annual',
  'pension_income_annual',
  'social_security_annual',
  'miscellaneous_income_annual',
  'liquid_assets',
]

const nonnegative = (value) => Math.max(0, Number(value) || 0)

const getPublicAssistanceProgramKeys = (metadata) => {
  const options = metadata?.public_assistance_programs
  if (Array.isArray(options) && options.length) {
    return options.map((program) => program.key)
  }
  return (metadata?.programs || []).map((program) => program.key)
}

const normalizePeople = (people = [], metadata) => {
  let adultCount = 0
  let dependentCount = 0
  const maxAdults = Math.max(
    1,
    Number(metadata?.defaults?.max_adults) || MAX_ADULTS_FALLBACK,
  )
  const maxDependents = Math.max(
    0,
    Number(metadata?.defaults?.max_dependents) || MAX_DEPENDENTS_FALLBACK,
  )

  return people.flatMap((person) => {
    const requestedAdult = person?.kind !== 'child'
    const kind = requestedAdult && adultCount < maxAdults ? 'adult' : 'child'

    if (kind === 'child' && dependentCount >= maxDependents) {
      return []
    }

    if (kind === 'adult') {
      adultCount += 1
    } else {
      dependentCount += 1
    }

    return [{
      kind,
      age: Math.max(0, Number(person?.age) || 0),
      is_pregnant: kind === 'adult' ? Boolean(person?.is_pregnant) : false,
      is_disabled: Boolean(person?.is_disabled),
      is_blind: Boolean(person?.is_blind),
      is_full_time_student: Boolean(person?.is_full_time_student),
      is_incapable_of_self_care: Boolean(person?.is_incapable_of_self_care),
      earned_income: nonnegative(person?.earned_income),
      ssi_amount: nonnegative(person?.ssi_amount),
      ssdi_amount: nonnegative(person?.ssdi_amount),
    }]
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
  const normalizedPeople = normalizePeople(inputs?.people || [], metadata)
  const requestedFilingStatus = inputs?.filing_status
  const adultCount = normalizedPeople.filter((person) => person.kind === 'adult').length
  const canUseRequestedFilingStatus = (
    VALID_FILING_STATUSES.has(requestedFilingStatus)
    && (!MARRIED_FILING_STATUSES.has(requestedFilingStatus) || adultCount >= 2)
  )
  const filing_status = canUseRequestedFilingStatus
    ? requestedFilingStatus
    : deriveFilingStatus(normalizedPeople)
  const defaultChartMax = Math.max(
    10000,
    Number(metadata?.defaults?.chart_max_earned_income)
      || Number(metadata?.defaults?.series_max_earned_income)
      || 100000,
  )

  const publicAssistanceProgramKeys = getPublicAssistanceProgramKeys(metadata)
  const selectedProgramSet = new Set(
    Array.isArray(inputs?.selected_programs)
      ? inputs.selected_programs.filter((key) => publicAssistanceProgramKeys.includes(key))
      : publicAssistanceProgramKeys,
  )
  const programsMode = ['all', 'none', 'custom'].includes(inputs?.programs_mode)
    ? inputs.programs_mode
    : metadata?.defaults?.programs_mode || 'all'

  const next = {
    ...inputs,
    state: inputs?.state || metadata?.defaults?.state || 'GA',
    county: String(inputs?.county || '').trim(),
    people: normalizedPeople,
    filing_status,
    chart_max_earned_income: Math.max(
      10000,
      Number(inputs?.chart_max_earned_income) || defaultChartMax,
    ),
    programs_mode: programsMode,
    selected_programs: publicAssistanceProgramKeys.filter((key) => selectedProgramSet.has(key)),
    has_employer_health_insurance: Boolean(inputs?.has_employer_health_insurance),
    year: metadata?.year || 2026,
  }

  COST_FIELDS.forEach((field) => {
    next[field] = nonnegative(inputs?.[field])
  })
  INCOME_AND_ASSET_FIELDS.forEach((field) => {
    next[field] = nonnegative(inputs?.[field])
  })

  return next
}

export function createInitialInputs(metadata) {
  return reconcileInputs({
    state: metadata?.defaults?.state || 'GA',
    county: '',
    people: normalizePeople(metadata?.defaults?.people || [], metadata),
    chart_max_earned_income:
      metadata?.defaults?.chart_max_earned_income
      || metadata?.defaults?.series_max_earned_income
      || 100000,
    programs_mode: metadata?.defaults?.programs_mode || 'all',
    selected_programs: getPublicAssistanceProgramKeys(metadata),
    has_employer_health_insurance: false,
    ...Object.fromEntries(COST_FIELDS.map((field) => [field, 0])),
    ...Object.fromEntries(INCOME_AND_ASSET_FIELDS.map((field) => [field, 0])),
  }, metadata)
}

export function normalizeInputs(inputs, metadata) {
  const reconciled = reconcileInputs(inputs, metadata)
  return {
    state: reconciled.state,
    county: reconciled.county,
    people: reconciled.people,
    filing_status: reconciled.filing_status,
    chart_max_earned_income: reconciled.chart_max_earned_income,
    programs_mode: reconciled.programs_mode,
    selected_programs: reconciled.selected_programs,
    has_employer_health_insurance: reconciled.has_employer_health_insurance,
    ...Object.fromEntries(COST_FIELDS.map((field) => [field, reconciled[field]])),
    ...Object.fromEntries(
      INCOME_AND_ASSET_FIELDS.map((field) => [field, reconciled[field]]),
    ),
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
    county: normalized.county || null,
    programs_mode: normalized.programs_mode,
    selected_programs: normalized.selected_programs,
    has_employer_health_insurance: normalized.has_employer_health_insurance,
    ...Object.fromEntries(COST_FIELDS.map((field) => [field, normalized[field]])),
    ...Object.fromEntries(
      INCOME_AND_ASSET_FIELDS.map((field) => [field, normalized[field]]),
    ),
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

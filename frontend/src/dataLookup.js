import { getStateFromZip } from 'policyengine-household-wizard'

const parseErrorMessage = async (response) => {
  try {
    const payload = await response.json()
    return payload.error || `Request failed with status ${response.status}`
  } catch {
    return `Request failed with status ${response.status}`
  }
}

const apiPath = (path) => {
  const origin = process.env.NEXT_PUBLIC_CLIFF_WATCH_API_ORIGIN || ''
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  const prefix = origin || basePath
  if (!prefix) return path
  return `${prefix.replace(/\/$/, '')}${path}`
}

const postJson = async (path, payload) => {
  const response = await fetch(apiPath(path), {
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
  const response = await fetch(apiPath('/api/metadata'))
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }
  return response.json()
}

const MAX_ADULTS_FALLBACK = 6
const MAX_DEPENDENTS_FALLBACK = 6
const MIN_ADULT_AGE = 18
const MAX_AGE = 120

const VALID_FILING_STATUSES = new Set([
  'SINGLE',
  'HEAD_OF_HOUSEHOLD',
  'JOINT',
  'SEPARATE',
])

const DEFAULT_MARITAL_STATUS = 'UNMARRIED'
const MARITAL_STATUS_CODES = new Set([DEFAULT_MARITAL_STATUS, 'MARRIED'])
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

const normalizeZip = (zip) => String(zip || '').replace(/\D/g, '').slice(0, 5)

const normalizeAge = (age, minimum = 0) => {
  if (age === '' || age === null || age === undefined) {
    return ''
  }
  const normalized = Number(age)
  return Number.isFinite(normalized)
    ? Math.min(MAX_AGE, Math.max(minimum, normalized))
    : ''
}

const normalizeMaritalStatus = (status) => (
  MARITAL_STATUS_CODES.has(status) ? status : ''
)

const normalizeCountyText = (county) => String(county || '')
  .trim()
  .toLowerCase()
  .replace(/[.,']/g, '')
  .replace(/-/g, ' ')
  .replace(/\s+/g, ' ')

const countySearchKeys = (county) => {
  const normalizedName = normalizeCountyText(county.name)
  const baseName = normalizedName
    .replace(/\s+(city and borough|census area|county|parish|borough|municipality|city)$/u, '')
  return new Set([
    normalizeCountyText(county.code),
    normalizedName,
    baseName,
  ].filter(Boolean))
}

const normalizeCounty = (county, state, metadata) => {
  const requested = String(county || '').trim()
  if (!requested || !state) return ''

  const options = metadata?.counties_by_state?.[state] || []
  if (!options.length) return requested

  const requestedKey = normalizeCountyText(requested)
  const requestedCodeKey = requested.toUpperCase()
  const match = options.find((option) => countySearchKeys(option).has(requestedKey))
    || options.find((option) => option.code === requestedCodeKey)
  return match?.code || ''
}

const getPublicAssistanceProgramKeys = (metadata) => {
  const options = metadata?.public_assistance_programs
  if (Array.isArray(options) && options.length) {
    return options.map((program) => program.key)
  }
  return (metadata?.programs || []).map((program) => program.key)
}

export const hasValidAge = (age) => {
  if (age === '' || age === null || age === undefined) return false
  const normalized = Number(age)
  return Number.isFinite(normalized) && normalized >= 0 && normalized <= 120
}

export const getZipState = (zip) => {
  const normalized = normalizeZip(zip)
  return normalized.length === 5 ? getStateFromZip(normalized) : null
}

export const hasValidZip = (zip, state) => {
  const zipState = getZipState(zip)
  if (!zipState) return false
  return !state || zipState === state
}

export function hasCompleteHouseholdAges(inputs) {
  const people = inputs?.people || []
  return people.length > 0
    && people.some((person) => person.kind === 'adult')
    && people.every((person) => hasValidAge(person.age))
}

export function hasCompleteRequiredInputs(inputs) {
  return Boolean(inputs?.state)
    && hasValidZip(inputs?.zip, inputs?.state)
    && MARITAL_STATUS_CODES.has(inputs?.marital_status)
    && hasCompleteHouseholdAges(inputs)
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
      age: normalizeAge(person?.age, kind === 'adult' ? MIN_ADULT_AGE : 0),
      is_pregnant: kind === 'adult' ? Boolean(person?.is_pregnant) : false,
      is_disabled: Boolean(person?.is_disabled),
      is_blind: Boolean(person?.is_blind),
      is_full_time_student: Boolean(person?.is_full_time_student),
      is_incapable_of_self_care: Boolean(person?.is_incapable_of_self_care),
      earned_income: nonnegative(person?.earned_income),
    }]
  })
}

const deriveMaritalStatus = (people = []) => {
  const adults = people.filter((person) => person.kind === 'adult').length
  return adults >= 2 ? 'MARRIED' : DEFAULT_MARITAL_STATUS
}

const effectiveMaritalStatus = (inputs, people = []) => {
  if (MARITAL_STATUS_CODES.has(inputs?.marital_status)) {
    return inputs.marital_status
  }
  if (MARRIED_FILING_STATUSES.has(inputs?.filing_status)) {
    return 'MARRIED'
  }
  if (VALID_FILING_STATUSES.has(inputs?.filing_status)) {
    return DEFAULT_MARITAL_STATUS
  }
  return deriveMaritalStatus(people)
}

const deriveFilingStatus = (people = [], maritalStatus = DEFAULT_MARITAL_STATUS) => {
  const children = people.filter((person) => person.kind === 'child').length

  if (maritalStatus === 'MARRIED') {
    return 'JOINT'
  }
  if (children > 0) {
    return 'HEAD_OF_HOUSEHOLD'
  }
  return 'SINGLE'
}

export function reconcileInputs(inputs, metadata) {
  const normalizedPeople = normalizePeople(inputs?.people || [], metadata)
  const normalizedZip = normalizeZip(inputs?.zip ?? inputs?.zip_code)
  const stateFromZip = getZipState(normalizedZip)
  const normalizedState = stateFromZip || (normalizedZip ? '' : inputs?.state || '')
  let maritalStatus = ''
  if (MARITAL_STATUS_CODES.has(inputs?.marital_status)) {
    maritalStatus = inputs.marital_status
  } else if (
    inputs?.marital_status === undefined
    || VALID_FILING_STATUSES.has(inputs?.filing_status)
  ) {
    maritalStatus = effectiveMaritalStatus(inputs, normalizedPeople)
  } else {
    maritalStatus = normalizeMaritalStatus(inputs?.marital_status)
  }
  let adultCount = normalizedPeople.filter((person) => person.kind === 'adult').length
  while (maritalStatus === 'MARRIED' && adultCount < 2) {
    const lastAdultIndex = normalizedPeople.reduce((lastIndex, person, index) => (
      person.kind === 'adult' ? index : lastIndex
    ), -1)
    normalizedPeople.splice(lastAdultIndex + 1, 0, {
      kind: 'adult',
      age: '',
      is_pregnant: false,
      is_disabled: false,
      is_blind: false,
      is_full_time_student: false,
      is_incapable_of_self_care: false,
      earned_income: 0,
    })
    adultCount += 1
  }
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
    state: normalizedState,
    marital_status: maritalStatus,
    people: normalizedPeople,
    chart_max_earned_income: Math.max(
      10000,
      Number(inputs?.chart_max_earned_income) || defaultChartMax,
    ),
    programs_mode: programsMode,
    selected_programs: publicAssistanceProgramKeys.filter((key) => selectedProgramSet.has(key)),
    has_employer_health_insurance: Boolean(inputs?.has_employer_health_insurance),
    year: metadata?.year || 2026,
    zip: normalizedZip,
  }
  next.county = normalizeCounty(inputs?.county, next.state, metadata)

  COST_FIELDS.forEach((field) => {
    next[field] = nonnegative(inputs?.[field])
  })
  INCOME_AND_ASSET_FIELDS.forEach((field) => {
    next[field] = nonnegative(inputs?.[field])
  })

  return next
}

export function createInitialInputs(metadata) {
  const defaultPeople = Array.isArray(metadata?.defaults?.people) && metadata.defaults.people.length
    ? metadata.defaults.people
    : []

  return reconcileInputs({
    state: '',
    county: '',
    zip: '',
    marital_status: '',
    people: normalizePeople(defaultPeople, metadata),
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
    zip: reconciled.zip,
    marital_status: reconciled.marital_status,
    people: reconciled.people,
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
    marital_status: normalized.marital_status,
    people: normalized.people,
    earned_income: 0,
    year: normalized.year,
    county: normalized.county || null,
    zip: normalized.zip || null,
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
  const response = await postJson('/api/calculate', payload)
  return response.result
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
  return postJson('/api/series', payload)
}

export async function calculateHouseholdTypes(inputs, metadata) {
  return postJson('/api/households', buildHouseholdPayload(inputs, metadata))
}

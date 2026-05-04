const LEGACY_PERSON_PATTERN = /^(\d+)([ac])(p)?$/i

const PERSON_FLAG_KEYS = {
  p: 'is_pregnant',
  d: 'is_disabled',
  b: 'is_blind',
  s: 'is_full_time_student',
  x: 'is_incapable_of_self_care',
}

const NUMERIC_FIELDS = [
  ['cc', 'childcare_expenses'],
  ['rent', 'rent_annual'],
  ['util', 'utility_expense_annual'],
  ['food', 'food_expense_annual'],
  ['trans', 'transportation_expense_annual'],
  ['hp', 'health_insurance_premium_annual'],
  ['tech', 'technology_expense_annual'],
  ['debt', 'debt_payment_annual'],
  ['edu', 'education_expense_annual'],
  ['oe', 'other_expense_annual'],
  ['se', 'self_employment_income_annual'],
  ['cs', 'child_support_annual'],
  ['int', 'taxable_interest_income_annual'],
  ['div', 'dividend_income_annual'],
  ['ri', 'rental_income_annual'],
  ['ui', 'unemployment_compensation_annual'],
  ['pen', 'pension_income_annual'],
  ['ss', 'social_security_annual'],
  ['mi', 'miscellaneous_income_annual'],
  ['assets', 'liquid_assets'],
  ['max', 'chart_max_earned_income'],
]

const parseNonnegative = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function encodePerson(person) {
  const kind = person.kind === 'adult' ? 'a' : 'c'
  const flags = Object.entries(PERSON_FLAG_KEYS)
    .filter(([, field]) => Boolean(person[field]))
    .map(([flag]) => flag)
    .join('')
  return [
    Math.max(0, Number(person.age) || 0),
    kind,
    flags,
    Math.round(Number(person.earned_income) || 0),
    Math.round(Number(person.ssi_amount) || 0),
    Math.round(Number(person.ssdi_amount) || 0),
  ].join(':')
}

function decodePerson(token) {
  const value = token.trim()
  if (value.includes(':')) {
    const [age, kind, flags = '', earnedIncome, ssiAmount, ssdiAmount] = value.split(':')
    const person = {
      age: parseInt(age, 10),
      kind: kind?.toLowerCase() === 'a' ? 'adult' : 'child',
      is_pregnant: false,
      is_disabled: false,
      is_blind: false,
      is_full_time_student: false,
      is_incapable_of_self_care: false,
      earned_income: parseNonnegative(earnedIncome) || 0,
      ssi_amount: parseNonnegative(ssiAmount) || 0,
      ssdi_amount: parseNonnegative(ssdiAmount) || 0,
    }
    if (!Number.isFinite(person.age)) return null
    flags.split('').forEach((flag) => {
      const field = PERSON_FLAG_KEYS[flag]
      if (field) person[field] = true
    })
    return person
  }

  const match = value.match(LEGACY_PERSON_PATTERN)
  if (!match) return null
  return {
    age: parseInt(match[1], 10),
    kind: match[2].toLowerCase() === 'a' ? 'adult' : 'child',
    is_pregnant: Boolean(match[3]),
  }
}

export function encodeInputs(inputs) {
  if (!inputs) return ''
  const params = new URLSearchParams()

  if (inputs.state) {
    params.set('s', inputs.state)
  }

  if (inputs.county) {
    params.set('county', inputs.county)
  }

  if (inputs.filing_status) {
    params.set('fs', inputs.filing_status)
  }

  const people = (inputs.people || []).map(encodePerson).filter(Boolean)
  if (people.length) {
    params.set('p', people.join(','))
  }

  if (inputs.programs_mode && inputs.programs_mode !== 'all') {
    params.set('pm', inputs.programs_mode)
  }

  if (inputs.programs_mode === 'custom' && inputs.selected_programs?.length) {
    params.set('sp', inputs.selected_programs.join(','))
  }

  if (inputs.has_employer_health_insurance) {
    params.set('esi', '1')
  }

  NUMERIC_FIELDS.forEach(([param, field]) => {
    const value = Number(inputs[field]) || 0
    if (value > 0) {
      params.set(param, String(Math.round(value)))
    }
  })

  return params.toString()
}

export function decodeInputs(search) {
  if (!search) return null
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  if (![...params.keys()].length) return null

  const decoded = {}

  if (params.has('s')) {
    decoded.state = params.get('s').toUpperCase()
  }

  if (params.has('county')) {
    decoded.county = params.get('county')
  }

  if (params.has('fs')) {
    decoded.filing_status = params.get('fs')
  }

  if (params.has('p')) {
    const people = params.get('p').split(',').map(decodePerson).filter(Boolean)
    if (people.length) decoded.people = people
  }

  if (params.has('pm')) {
    decoded.programs_mode = params.get('pm')
  }

  if (params.has('sp')) {
    decoded.selected_programs = params.get('sp').split(',').filter(Boolean)
  }

  if (params.has('esi')) {
    decoded.has_employer_health_insurance = params.get('esi') === '1'
  }

  NUMERIC_FIELDS.forEach(([param, field]) => {
    if (!params.has(param)) return
    const value = parseNonnegative(params.get(param))
    if (value === null) return
    if (field === 'chart_max_earned_income' && value < 10000) return
    decoded[field] = value
  })

  return Object.keys(decoded).length ? decoded : null
}

export function buildShareUrl(inputs) {
  const encoded = encodeInputs(inputs)
  const { origin, pathname } = window.location
  return encoded ? `${origin}${pathname}?${encoded}` : `${origin}${pathname}`
}

export function syncUrlToInputs(inputs) {
  if (typeof window === 'undefined') return
  const encoded = encodeInputs(inputs)
  const next = encoded ? `${window.location.pathname}?${encoded}` : window.location.pathname
  const current = `${window.location.pathname}${window.location.search}`
  if (next !== current) {
    window.history.replaceState(null, '', next)
  }
}

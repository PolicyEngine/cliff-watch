const PERSON_PATTERN = /^(\d+)([ac])(p)?$/i

function encodePerson(person) {
  const kind = person.kind === 'adult' ? 'a' : 'c'
  const pregnant = person.is_pregnant ? 'p' : ''
  return `${Math.max(0, Number(person.age) || 0)}${kind}${pregnant}`
}

function decodePerson(token) {
  const match = token.trim().match(PERSON_PATTERN)
  if (!match) return null
  return {
    age: parseInt(match[1], 10),
    kind: match[2].toLowerCase() === 'a' ? 'adult' : 'child',
    is_pregnant: Boolean(match[3]),
  }
}

export function encodeInputs(inputs) {
  if (!inputs) return ''
  const parts = []

  if (inputs.state) {
    parts.push(`s=${encodeURIComponent(inputs.state)}`)
  }

  const people = (inputs.people || []).map(encodePerson).filter(Boolean)
  if (people.length) {
    parts.push(`p=${people.join(',')}`)
  }

  const childcare = Number(inputs.childcare_expenses) || 0
  if (childcare > 0) parts.push(`cc=${Math.round(childcare)}`)

  const rent = Number(inputs.rent_annual) || 0
  if (rent > 0) parts.push(`rent=${Math.round(rent)}`)

  const chartMax = Number(inputs.chart_max_earned_income) || 0
  if (chartMax > 0) parts.push(`max=${Math.round(chartMax)}`)

  return parts.join('&')
}

export function decodeInputs(search) {
  if (!search) return null
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  if (![...params.keys()].length) return null

  const decoded = {}

  if (params.has('s')) {
    decoded.state = params.get('s').toUpperCase()
  }

  if (params.has('p')) {
    const people = params.get('p').split(',').map(decodePerson).filter(Boolean)
    if (people.length) decoded.people = people
  }

  if (params.has('cc')) {
    const n = Number(params.get('cc'))
    if (Number.isFinite(n) && n >= 0) decoded.childcare_expenses = n
  }

  if (params.has('rent')) {
    const n = Number(params.get('rent'))
    if (Number.isFinite(n) && n >= 0) decoded.rent_annual = n
  }

  if (params.has('max')) {
    const n = Number(params.get('max'))
    if (Number.isFinite(n) && n >= 10000) decoded.chart_max_earned_income = n
  }

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

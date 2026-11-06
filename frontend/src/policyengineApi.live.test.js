import { describe, expect, test } from 'vitest'

import { buildHouseholdResultFromResponse, buildSituation } from './policyengineApi.js'

/**
 * Differential check of `buildSituation` against the live PolicyEngine API:
 * the API must accept the full situation (inputs and output requests), and
 * every entered income amount must reach the component that rules read.
 * Skipped unless POLICYENGINE_LIVE_API=1, because it needs the network:
 *
 *   bun run test:live
 */

const CALCULATE_URL = 'https://api.policyengine.org/us/calculate'
const YEAR = 2026
const OUTPUTS = [
  'taxable_private_pension_income',
  'taxable_public_pension_income',
  'taxable_pension_income',
  'pension_income',
  'qualified_dividend_income',
  'dividend_income',
  'social_security_retirement',
  'social_security_disability',
  'social_security',
  'irs_gross_income',
]

const adult = (age, extra = {}) => ({ kind: 'adult', age, ...extra })

const CASES = [
  {
    name: 'NY retiree, private pension and Social Security',
    payload: { state: 'NY', people: [adult(67)], pension_income_annual: 30000, social_security_annual: 18000 },
  },
  {
    name: 'NY retiree, government pension',
    payload: { state: 'NY', people: [adult(67)], public_pension_income_annual: 30000 },
  },
  {
    name: 'CA retiree, dividends and Social Security',
    payload: { state: 'CA', people: [adult(67)], dividend_income_annual: 20000, social_security_annual: 15000 },
  },
  {
    name: 'TX Social Security retirement plus SSDI',
    payload: { state: 'TX', people: [adult(60, { ssdi_amount: 6000 })], social_security_annual: 12000 },
  },
]

describe.skipIf(process.env.POLICYENGINE_LIVE_API !== '1')('buildSituation against api.policyengine.org', () => {
  test.each(CASES)('$name', async ({ payload }) => {
    const fullPayload = { year: YEAR, marital_status: 'UNMARRIED', earned_income: 0, ...payload }
    const { situation, descriptor } = buildSituation(fullPayload, { includeIncomeOverrides: true })
    const head = situation.people.adult_1
    for (const variable of OUTPUTS) head[variable] ??= { [YEAR]: null }

    const response = await fetch(CALCULATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ household: situation }),
    })
    const body = await response.json()
    expect(response.status, JSON.stringify(body).slice(0, 500)).toBe(200)
    expect(() => buildHouseholdResultFromResponse(fullPayload, {}, body, descriptor)).not.toThrow()

    const result = Object.fromEntries(
      OUTPUTS.map((variable) => [variable, body.result.people.adult_1[variable][YEAR]]),
    )
    const privatePension = payload.pension_income_annual ?? 0
    const publicPension = payload.public_pension_income_annual ?? 0
    const dividends = payload.dividend_income_annual ?? 0
    const retirement = payload.social_security_annual ?? 0
    const ssdi = payload.people[0].ssdi_amount ?? 0
    expect(result.taxable_private_pension_income).toBeCloseTo(privatePension)
    expect(result.taxable_public_pension_income).toBeCloseTo(publicPension)
    expect(result.taxable_pension_income).toBeCloseTo(privatePension + publicPension)
    expect(result.pension_income).toBeCloseTo(privatePension + publicPension)
    expect(result.qualified_dividend_income).toBeCloseTo(dividends)
    expect(result.dividend_income).toBeCloseTo(dividends)
    expect(result.social_security_retirement).toBeCloseTo(retirement)
    expect(result.social_security_disability).toBeCloseTo(ssdi)
    expect(result.social_security).toBeCloseTo(retirement + ssdi)

    // Each entered taxable dollar reaches federal gross income once; at most
    // 85% of Social Security benefits are taxable.
    const taxableSocialSecurity = result.irs_gross_income - privatePension - publicPension - dividends
    expect(taxableSocialSecurity).toBeGreaterThanOrEqual(-0.01)
    expect(taxableSocialSecurity).toBeLessThanOrEqual(0.85 * (retirement + ssdi) + 0.01)
  }, 60_000)
})

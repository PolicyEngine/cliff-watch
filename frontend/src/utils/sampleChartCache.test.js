import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readSampleChart, sampleChartKey, writeSampleChart } from './sampleChartCache'

const metadata = {
  year: 2026,
  series_revision: 'calculator-v1',
  engine: { 'policyengine-us': '1', 'policyengine-core': '2', 'spm-calculator': '3' },
}
const inputs = { zip: '30303', marital_status: 'SINGLE', people: [{ kind: 'adult', age: 30 }] }
const chart = {
  data: [{ earned_income: 0, net_resources: 3500 }, { earned_income: 500, net_resources: 3750 }],
  point_count: 2,
  refined_zone_count: 1,
  refined_step_annual: 100,
}
let entries
beforeEach(() => {
  entries = new Map()
  vi.stubEnv('NEXT_PUBLIC_SERIES_BUILD', 'frontend-a')
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('caches', { open: async () => ({
    match: async key => entries.get(key)?.clone(),
    put: async (key, response) => entries.set(key, response),
    keys: async () => [...entries.keys()],
    delete: async key => entries.delete(key),
  }) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

test('identical calculation requests reuse the entire refined chart', async () => {
  const key = await sampleChartKey(inputs, metadata, 500)
  expect(key).toBeTruthy()
  expect(await readSampleChart(key)).toBeNull()
  await writeSampleChart(key, chart, metadata)
  const reloaded = { ...inputs, zip: undefined, zip_code: inputs.zip }
  expect(await readSampleChart(await sampleChartKey(reloaded, metadata, 500))).toEqual(chart)
})

test('each calculation input and model or frontend revision scopes the result', async () => {
  const original = await sampleChartKey(inputs, metadata, 500)
  const keys = await Promise.all([
    sampleChartKey({ ...inputs, zip: '30309' }, metadata, 500),
    sampleChartKey({ ...inputs, county: 'DEKALB_COUNTY_GA' }, metadata, 500),
    sampleChartKey({ ...inputs, people: [{ kind: 'adult', age: 31 }] }, metadata, 500),
    sampleChartKey({ ...inputs, self_employment_income_annual: 200 }, metadata, 500),
    sampleChartKey({ ...inputs, chart_max_earned_income: 60000 }, metadata, 500),
    sampleChartKey({ ...inputs, programs_mode: 'none' }, metadata, 500),
    sampleChartKey(inputs, metadata, 1000),
    sampleChartKey(inputs, { ...metadata, year: 2027 }, 500),
    sampleChartKey(inputs, { ...metadata, engine: { ...metadata.engine, 'policyengine-us': '9' } }, 500),
    sampleChartKey(inputs, { ...metadata, series_revision: 'calculator-v2' }, 500),
  ])
  vi.stubEnv('NEXT_PUBLIC_SERIES_BUILD', 'frontend-b')
  keys.push(await sampleChartKey(inputs, metadata, 500))
  expect(keys).not.toContain(original)
  expect(await sampleChartKey(inputs, { ...metadata, engine: {} }, 500)).toBeNull()
})

test('incomplete series are retried and unreadable or unavailable storage is harmless', async () => {
  for (const incomplete of [
    { ...chart, refinement_failed_zone_count: 1 },
    { ...chart, truncated: true },
    { ...chart, point_count: 3 },
  ]) {
    await writeSampleChart('test', incomplete, metadata)
    expect(await readSampleChart('test')).toBeNull()
  }
  entries.set('test', new Response('invalid-json', { headers: { 'x-cliffwatch-expires': String(Date.now() + 60000) } }))
  expect(await readSampleChart('test')).toBeNull()
  expect(entries.has('test')).toBe(false)
  vi.stubGlobal('caches', { open: () => Promise.reject(new Error('storage unavailable')) })
  await writeSampleChart('test', chart, metadata)
  expect(await readSampleChart('test')).toBeNull()
})

test('the cache evicts old samples and expires unversioned servers earlier', async () => {
  for (let i = 0; i < 17; i++) await writeSampleChart(String(i), chart, metadata)
  expect(entries.size).toBe(16)
  expect(await readSampleChart('0')).toBeNull()
  const now = Date.now()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  await writeSampleChart('legacy', chart, { ...metadata, series_revision: null })
  vi.setSystemTime(now + 2 * 60 * 60 * 1000)
  expect(await readSampleChart('legacy')).toBeNull()
  expect(await readSampleChart('16')).toEqual(chart)
})

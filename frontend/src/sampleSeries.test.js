import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { buildSeriesPayload } from './dataLookup'
import { calculateSeriesForSample, matchesOriginalSample, sampleRequestDigest } from './sampleSeries'
import { encodeInputs } from './utils/urlState'

const inputs = { state: 'GA', zip: '30044', people: [{ kind: 'adult', age: 33 }] }
const metadata = { year: 2026, series_revision: 'current', defaults: { series_step: 500 } }
const options = { step: 500 }
const sample = { exampleZip: inputs.zip, originalInputs: inputs, originalQuery: encodeInputs(inputs) }
const curve = { point_count: 1, data: [{ earned_income: 0, net_resources: 12345 }] }

async function mockBundle(modify = bundle => bundle) {
  const key = await sampleRequestDigest(buildSeriesPayload(inputs, metadata, options))
  const packed = gzipSync(JSON.stringify(curve)).toString('base64')
  const fetch = vi.fn(async (_, init) => init?.method === 'POST'
    ? Response.json({ live: true })
    : Response.json(modify({ revision: 'current', charts: { [key]: packed } })))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('gets only the individual curve for a verified default sample', async () => {
  vi.stubEnv('NEXT_PUBLIC_SERIES_BUILD', 'catalog-build')
  const fetch = await mockBundle()
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  const key = await sampleRequestDigest(buildSeriesPayload(inputs, metadata, options))
  expect(await calculateSeriesForSample(inputs, metadata, options, { sample })).toEqual(curve)
  expect(timeout).toHaveBeenCalledWith(15000)
  expect(fetch.mock.calls).toEqual([[
    `/sample-charts/curves/GA/${key}.json?v=current&build=catalog-build`,
    { cache: 'force-cache', signal: expect.any(AbortSignal) },
  ]])
})

it('opens a fresh share link using its normalized inputs without a catalog ID or browser cache', async () => {
  const fetch = await mockBundle()
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  const fromLink = { zip_code: inputs.zip, people: inputs.people }
  expect(await calculateSeriesForSample(fromLink, metadata, options)).toEqual(curve)
  expect(timeout).toHaveBeenCalledWith(5000)
  expect(fetch.mock.calls).toEqual([[
    '/sample-charts/GA.json?v=current', { cache: 'default', signal: expect.any(AbortSignal) },
  ]])
})

it.each([
  ['old model', bundle => ({ ...bundle, revision: 'previous' })],
  ['unavailable profile', bundle => ({ ...bundle, charts: {} })],
  ['damaged response', bundle => ({ ...bundle, charts: Object.fromEntries(Object.keys(bundle.charts).map(key => [key, 'bad'])) })],
])('uses the live series for a %s', async (_, modify) => {
  const fetch = await mockBundle(modify)
  expect(await calculateSeriesForSample(inputs, metadata, options)).toEqual({ live: true })
  expect(fetch.mock.calls.at(-1)[1].method).toBe('POST')
})

it('uses the live series for an edited amount or a personally chosen ZIP', async () => {
  const fetch = await mockBundle()
  expect(await calculateSeriesForSample({ ...inputs, rent_annual: 15000 }, metadata, options)).toEqual({ live: true })
  expect(fetch.mock.calls[0]).toEqual([
    '/sample-charts/GA.json?v=current', { cache: 'default', signal: expect.any(AbortSignal) },
  ])
  expect(fetch.mock.calls[1][1].method).toBe('POST')
  fetch.mockClear()
  expect(await calculateSeriesForSample({ ...inputs, zip: '30303' }, metadata, options)).toEqual({ live: true })
  expect(fetch.mock.calls).toHaveLength(1)
  expect(fetch.mock.calls[0][1].method).toBe('POST')
})

it.each([
  ['outdated revision', bundle => ({ ...bundle, revision: 'outdated' })],
  ['wrong request digest', () => ({ revision: 'current', charts: { wrong: 'wrong' } })],
  ['missing net resources', bundle => ({
    ...bundle, charts: { [Object.keys(bundle.charts)[0]]: gzipSync(JSON.stringify({ point_count: 1, data: [{}] })).toString('base64') },
  })],
  ['corrupt compressed curve', bundle => ({ ...bundle, charts: { [Object.keys(bundle.charts)[0]]: 'bad' } })],
])('falls back to live once when the individual curve has a %s', async (_, modify) => {
  const fetch = await mockBundle(modify)
  expect(await calculateSeriesForSample(inputs, metadata, options, { sample })).toEqual({ live: true })
  expect(fetch.mock.calls).toHaveLength(2)
  expect(fetch.mock.calls[0][0]).toMatch(/^\/sample-charts\/curves\/GA\/[a-f0-9]{64}\.json\?v=current$/)
  expect(fetch.mock.calls[1][1].method).toBe('POST')
})

it('retries the individual chart on the next request after a timeout', async () => {
  const fetch = await mockBundle()
  fetch.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
  expect(await calculateSeriesForSample(inputs, metadata, options, { sample })).toEqual({ live: true })
  expect(await calculateSeriesForSample(inputs, metadata, options, { sample })).toEqual(curve)
  expect(fetch.mock.calls).toHaveLength(3)
  expect(fetch.mock.calls[2][0]).toBe(fetch.mock.calls[0][0])
})

it.each(['ssi_amount', 'ssdi_amount'])('keeps a change to %s private even when its share query is identical', async field => {
  const fetch = await mockBundle()
  const edited = { ...inputs, people: [{ ...inputs.people[0], [field]: 1234 }] }
  expect(encodeInputs(edited)).toBe(sample.originalQuery)
  expect(matchesOriginalSample(sample, edited)).toBe(false)
  await calculateSeriesForSample(edited, metadata, options, { sample })
  expect(fetch.mock.calls[0][0]).toBe('/sample-charts/GA.json?v=current')
  expect(fetch.mock.calls.filter(([_, init]) => init.method !== 'POST')).toHaveLength(1)
})

it('checks a stale sample query, an edited amount and an alternate ZIP without sending their digests', async () => {
  const fetch = await mockBundle()
  await calculateSeriesForSample(inputs, metadata, options, { sample: { ...sample, originalQuery: 'stale' } })
  await calculateSeriesForSample({ ...inputs, rent_annual: 1234 }, metadata, options, { sample })
  await calculateSeriesForSample({ ...inputs, zip: '30303' }, metadata, options, { sample })
  expect(fetch.mock.calls.filter(([_, init]) => init.method !== 'POST').map(([path]) => path))
    .toEqual(['/sample-charts/GA.json?v=current', '/sample-charts/GA.json?v=current'])
})

it('keeps a custom earnings range private even for the unchanged public household', async () => {
  const fetch = await mockBundle()
  const custom = { ...options, maxEarnedIncome: 34567 }
  expect(await calculateSeriesForSample(inputs, metadata, custom, { sample })).toEqual({ live: true })
  expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/sample-charts/GA.json?v=current', '/api/series'])
})

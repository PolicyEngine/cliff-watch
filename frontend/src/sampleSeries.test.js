import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { buildSeriesPayload } from './dataLookup'
import { calculateSeriesForSample, sampleRequestDigest } from './sampleSeries'

const inputs = { state: 'GA', zip: '30044', people: [{ kind: 'adult', age: 33 }] }
const metadata = { year: 2026, series_revision: 'current', defaults: { series_step: 500 } }
const options = { step: 500 }
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

afterEach(() => vi.unstubAllGlobals())

it('opens the saved curve for the exact public inputs without a simulation request', async () => {
  const fetch = await mockBundle()
  expect(await calculateSeriesForSample(inputs, metadata, options)).toEqual(curve)
  expect(fetch.mock.calls).toEqual([['/sample-charts/GA.json?v=current']])
})

it('opens a fresh share link using its normalized inputs without a catalog ID or browser cache', async () => {
  const fetch = await mockBundle()
  const fromLink = { zip_code: inputs.zip, people: inputs.people }
  expect(await calculateSeriesForSample(fromLink, metadata, options)).toEqual(curve)
  expect(fetch.mock.calls).toEqual([['/sample-charts/GA.json?v=current']])
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
  expect(fetch.mock.calls[0]).toEqual(['/sample-charts/GA.json?v=current'])
  expect(fetch.mock.calls[1][1].method).toBe('POST')
  fetch.mockClear()
  expect(await calculateSeriesForSample({ ...inputs, zip: '30303' }, metadata, options)).toEqual({ live: true })
  expect(fetch.mock.calls).toHaveLength(1)
  expect(fetch.mock.calls[0][1].method).toBe('POST')
})

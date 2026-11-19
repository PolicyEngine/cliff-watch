import { buildSeriesPayload } from '../dataLookup'
import { jsonDigest } from './jsonDigest'

const CACHE_NAME = 'cliffwatch-sample-charts-v1'
const MAX_CHARTS = 16
const MAX_CHART_BYTES = 1024 * 1024
const LIFETIME = 30 * 24 * 60 * 60 * 1000

// Two profiles with identical calculation inputs have the same chart. A
// shared URL can therefore reopen a saved sample without a catalog ID in it.
export async function sampleChartKey(inputs, metadata, step) {
  const build = process.env.NEXT_PUBLIC_SERIES_BUILD
  const engine = metadata?.engine
  if (!build || !metadata?.series_revision
    || !['policyengine-us', 'policyengine-core', 'spm-calculator'].every(name => engine?.[name])) {
    return null
  }

  try {
    if (!globalThis.caches || !globalThis.crypto?.subtle) return null
    const hash = await jsonDigest([
      build,
      metadata.series_revision,
      Object.entries(engine).sort(([a], [b]) => a.localeCompare(b)),
      buildSeriesPayload(inputs, metadata, { step }),
    ])
    return `/__cliffwatch_sample_charts__/${hash}`
  } catch {
    return null
  }
}

function isComplete(series) {
  return Array.isArray(series?.data) && series.data.length > 0
    && series.point_count === series.data.length
    && !series.truncated && !series.refinement_failed_zone_count
    && series.data.every(point => Number.isFinite(point?.earned_income) && Number.isFinite(point?.net_resources))
}

export async function readSampleChart(key) {
  if (!key) return null
  try {
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(key)
    if (!response) return null
    if (Number(response.headers.get('x-cliffwatch-expires')) > Date.now()) {
      const series = await response.json().catch(() => null)
      if (isComplete(series)) return series
    }
    await cache.delete(key)
  } catch {
    // A disabled store or unreadable entry falls back to a live calculation.
  }
  return null
}

export async function writeSampleChart(key, series) {
  if (!key || !isComplete(series)) return
  try {
    const body = JSON.stringify(series)
    if (new Blob([body]).size > MAX_CHART_BYTES) return
    const cache = await caches.open(CACHE_NAME)
    await cache.put(key, new Response(body, {
      headers: { 'x-cliffwatch-expires': String(Date.now() + LIFETIME) },
    }))
    // Cache.keys() returns insertion order. This store only holds sample charts.
    const keys = await cache.keys()
    for (const oldest of keys.slice(0, Math.max(0, keys.length - MAX_CHARTS))) {
      await cache.delete(oldest)
    }
  } catch {
    // Storage limits and private browsing must not interrupt the shown chart.
  }
}

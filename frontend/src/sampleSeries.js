import { buildSeriesPayload, calculateSeries } from './dataLookup'
import { jsonDigest } from './utils/jsonDigest'
import { encodeInputs } from './utils/urlState'
import { EXAMPLE_ZIP_BY_STATE } from './wizard/sampleZips'

export { jsonDigest as sampleRequestDigest }

// Share links omit some person-level fields, including SSI and SSDI amounts.
// The app constructs originalInputs and inputs with the same draft adapter.
export function matchesOriginalSample(sample, inputs) {
  return Boolean(sample?.originalInputs && inputs
    && sample.originalQuery === encodeInputs(inputs)
    && JSON.stringify(sample.originalInputs) === JSON.stringify(inputs))
}

export async function calculateSeriesForSample(inputs, metadata, options, { sample, onCatalogMatch } = {}) {
  const payload = buildSeriesPayload(inputs, metadata, options)
  if (metadata.series_revision && payload.zip && EXAMPLE_ZIP_BY_STATE[payload.state] === payload.zip) {
    try {
      const key = await jsonDigest(payload)
      const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
      const build = process.env.NEXT_PUBLIC_SERIES_BUILD
      const query = new URLSearchParams({ v: metadata.series_revision })
      if (build) query.set('build', build)
      // A validated default draw identifies a public chart. For every other
      // request, send only the state and match the payload digest on this device.
      const stock = sample?.exampleZip === payload.zip && matchesOriginalSample(sample, inputs)
        && JSON.stringify(payload) === JSON.stringify(buildSeriesPayload(sample.originalInputs, metadata))
      const path = stock ? `curves/${payload.state}/${key}` : payload.state
      const response = await fetch(`${base}/sample-charts/${path}.json?${query}`, {
        cache: build ? 'force-cache' : 'default',
        signal: AbortSignal.timeout(stock ? 15000 : 5000),
      })
      if (response.ok) {
        const bundle = await response.json()
        const encoded = bundle.revision === metadata.series_revision && bundle.charts?.[key]
        if (encoded) {
          const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
          const chart = await new Response(stream).json()
          if (Array.isArray(chart.data) && chart.data.length && chart.point_count === chart.data.length
            && chart.data.every(point => Number.isFinite(point?.earned_income) && Number.isFinite(point?.net_resources))) {
            onCatalogMatch?.()
            return chart
          }
        }
      }
    } catch {
      // Older browsers and deployments can always use the live calculator.
    }
  }
  return calculateSeries(inputs, metadata, options)
}

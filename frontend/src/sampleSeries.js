import { buildSeriesPayload, calculateSeries } from './dataLookup'
import { jsonDigest } from './utils/jsonDigest'
import { EXAMPLE_ZIP_BY_STATE } from './wizard/sampleZips'

export { jsonDigest as sampleRequestDigest }

// A state bundle holds the initial curves for its catalog slots. Each curve is
// compressed separately so a draw only decodes its own 201-point response.
export async function calculateSeriesForSample(inputs, metadata, options, onCatalogMatch) {
  const payload = buildSeriesPayload(inputs, metadata, options)
  // A shared URL carries the household inputs without a sample ID. Only its
  // public state is requested; match the complete calculation on this device.
  if (metadata.series_revision && payload.zip && EXAMPLE_ZIP_BY_STATE[payload.state] === payload.zip) {
    try {
      const key = await jsonDigest(payload)
      const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
      const build = process.env.NEXT_PUBLIC_SERIES_BUILD
      const query = new URLSearchParams({ v: metadata.series_revision })
      if (build) query.set('build', build)
      // All draws in a state share this file. A new catalog build or model
      // revision gets its own URL even when it keeps the same example ZIP.
      const response = await fetch(`${base}/sample-charts/${payload.state}.json?${query}`, {
        cache: build ? 'force-cache' : 'default',
        signal: AbortSignal.timeout(5000),
      })
      if (response.ok) {
        const bundle = await response.json()
        const encoded = bundle.revision === metadata.series_revision && bundle.charts?.[key]
        if (encoded) {
          const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
          const chart = await new Response(stream).json()
          if (chart.data?.length && chart.point_count === chart.data.length) {
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

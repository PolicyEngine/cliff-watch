import { buildSeriesPayload, calculateSeries } from './dataLookup'
import { jsonDigest } from './utils/jsonDigest'

export { jsonDigest as sampleRequestDigest }

// A state bundle holds the initial curves for its catalog slots. Each curve is
// compressed separately so a draw only decodes its own 201-point response.
export async function calculateSeriesForSample(inputs, metadata, { sample, ...options }) {
  if (sample?.exampleZip === inputs.zip && metadata.series_revision && /^[A-Z]{2}$/.test(inputs.state)) {
    try {
      const key = await jsonDigest(buildSeriesPayload(inputs, metadata, options))
      const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
      const response = await fetch(`${base}/sample-charts/${inputs.state}.json?v=${metadata.series_revision}`)
      if (response.ok) {
        const bundle = await response.json()
        const encoded = bundle.revision === metadata.series_revision && bundle.charts?.[key]
        if (encoded) {
          const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
          const chart = await new Response(stream).json()
          if (chart.data?.length && chart.point_count === chart.data.length) return chart
        }
      }
    } catch {
      // Older browsers and deployments can always use the live calculator.
    }
  }
  return calculateSeries(inputs, metadata, options)
}

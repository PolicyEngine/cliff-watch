// Enumerate the same requests as the first click for a sample, preserving the
// wizard's full set of weighted slots. Duplicate payloads share one result.
import { readFileSync } from 'node:fs'
import { buildSeriesPayload, hasCompleteRequiredInputs } from '../src/dataLookup.js'
import { sampleRequestDigest } from '../src/sampleSeries.js'
import { combineDraftAndScenarioToInputs } from '../src/wizard/cliffWatchDraft.js'
import { projectSample } from '../src/wizard/projectSample.js'
import { drawCliffWatchSample } from '../src/wizard/sampleHousehold.js'

const metadata = JSON.parse(readFileSync(0, 'utf8'))
const requests = {}
for (const { code: stateCode } of metadata.states) {
  const first = await drawCliffWatchSample({ stateCode, random: () => 0 })
  const slotCount = first.provenance.drawsPerState
  const ids = new Set()
  const byDigest = {}
  for (let slot = 0; slot < slotCount; slot++) {
    const sample = await drawCliffWatchSample({ stateCode, random: () => (slot + 0.5) / slotCount })
    ids.add(sample.id)
    const { draft, scenario } = projectSample(sample, {}, metadata)
    const inputs = combineDraftAndScenarioToInputs(draft, scenario, metadata)
    if (!hasCompleteRequiredInputs(inputs)) throw new Error(`Incomplete sample ${sample.id}`)
    const payload = buildSeriesPayload(inputs, metadata, { step: metadata.defaults.series_step })
    byDigest[await sampleRequestDigest(payload)] = payload
  }
  if (ids.size !== slotCount) throw new Error(`Did not enumerate every sample in ${stateCode}`)
  requests[stateCode] = byDigest
}
process.stdout.write(JSON.stringify(requests))

// Enumerate the same catalog slots, normalization and chart windows as the app.
// Identical model inputs share one primary curve and its bounded refinements.
import { deepStrictEqual, ok } from 'node:assert'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { buildSeriesPayload, hasCompleteRequiredInputs } from '../src/dataLookup.js'
import { matchesOriginalSample, sampleRequestDigest } from '../src/sampleSeries.js'
import {
  cliffRefinementStep, getRefinementWindows, refinementWindowKey, validateRefinement,
} from '../src/utils/seriesRefine.js'
import { combineDraftAndScenarioToInputs, inputsToDraft, inputsToScenario } from '../src/wizard/cliffWatchDraft.js'
import { decodeInputs, encodeInputs } from '../src/utils/urlState.js'
import { projectSample } from '../src/wizard/projectSample.js'
import { drawCliffWatchSample } from '../src/wizard/sampleHousehold.js'

const data = JSON.parse(readFileSync(0, 'utf8'))
const windows = process.argv.includes('--windows')
const metadata = windows ? data.metadata : data
const primaryOptions = { step: metadata.defaults.series_step }
const states = windows ? [data.state] : metadata.states.map(state => state.code)
const requests = {}

for (const stateCode of states) {
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
    const payload = buildSeriesPayload(inputs, metadata, primaryOptions)
    if (!windows) {
      const decoded = decodeInputs(encodeInputs(inputs))
      const reopened = combineDraftAndScenarioToInputs(
        inputsToDraft(decoded), inputsToScenario(decoded, metadata), metadata,
      )
      ok(
        matchesOriginalSample({ originalInputs: inputs, originalQuery: encodeInputs(inputs) }, reopened),
        `Shared URL loses the public sample identity for ${sample.id}`,
      )
      deepStrictEqual(
        buildSeriesPayload(reopened, metadata, primaryOptions), payload,
        `Shared URL changes the model inputs for ${sample.id}`,
      )
      deepStrictEqual(
        payload.people.map(p => [p.is_disabled, p.is_full_time_student]),
        sample.draft.people.map(p => [Boolean(p.isDisabled), Boolean(p.isFullTimeStudent)]),
        `Projection changes a person's disability or student status for ${sample.id}`,
      )
    }
    const digest = await sampleRequestDigest(payload)
    if (Object.hasOwn(byDigest, digest)) continue
    if (!windows) {
      byDigest[digest] = payload
      continue
    }

    const primary = JSON.parse(gunzipSync(Buffer.from(data.charts[digest], 'base64')).toString())
    byDigest[digest] = {}
    for (const window of getRefinementWindows(primary, cliffRefinementStep(primary.step_annual))) {
      const key = refinementWindowKey(window.request)
      const saved = primary.sample_refinements?.[key]
      const bounded = buildSeriesPayload(inputs, metadata, window.request)
      byDigest[digest][key] = { payload: bounded, valid: Boolean(validateRefinement(primary, window, saved)) }
    }
  }
  if (ids.size !== slotCount) throw new Error(`Did not enumerate every sample in ${stateCode}`)
  requests[stateCode] = byDigest
}
process.stdout.write(JSON.stringify(requests))

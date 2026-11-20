// The committed state bundles are the only chart inputs. Split them into the
// same transport envelope so an individual curve can be fetched on demand.
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { US_STATES } from 'policyengine-household-wizard/us-household'

const defaultSource = fileURLToPath(new URL('../public/sample-charts/', import.meta.url))
const stateCodes = US_STATES.map(state => state.code).sort()
const sha256 = /^[0-9a-f]{64}$/

function readBundles(source) {
  const filenames = readdirSync(source).filter(name => name.endsWith('.json')).sort()
  if (JSON.stringify(filenames) !== JSON.stringify(stateCodes.map(state => state + '.json'))) {
    throw new Error('Expected one canonical sample chart bundle for each US state and DC')
  }
  const bundles = new Map()
  let revision
  for (const state of stateCodes) {
    const bundle = JSON.parse(readFileSync(join(source, state + '.json'), 'utf8'))
    if (typeof bundle.revision !== 'string' || !sha256.test(bundle.revision) ||
        (revision !== undefined && bundle.revision !== revision)) {
      throw new Error(`Invalid or inconsistent sample chart revision in ${state}`)
    }
    revision = bundle.revision
    if (!bundle.charts || typeof bundle.charts !== 'object' || Array.isArray(bundle.charts) ||
        Object.keys(bundle.charts).length === 0) {
      throw new Error(`Missing sample charts in ${state}`)
    }
    for (const [digest, encoded] of Object.entries(bundle.charts)) {
      if (!sha256.test(digest)) throw new Error(`Invalid sample chart digest in ${state}: ${digest}`)
      if (typeof encoded !== 'string' || !encoded || Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
        throw new Error(`Invalid base64 sample chart in ${state}: ${digest}`)
      }
    }
    bundles.set(state, bundle)
  }
  return bundles
}

export function materializeSampleCurves(source = defaultSource) {
  // Reject invalid inputs before changing any public asset. Each file is
  // staged outside public, then renamed on the same filesystem in one step.
  const bundles = readBundles(source)
  const output = join(source, 'curves')
  const staging = mkdtempSync(join(dirname(dirname(source)), '.sample-chart-assets-'))
  const temporaryFile = join(staging, 'curve.json')
  try {
    for (const [state, { revision, charts }] of bundles) {
      const directory = join(output, state)
      mkdirSync(directory, { recursive: true })
      for (const [digest, encoded] of Object.entries(charts)) {
        const target = join(directory, digest + '.json')
        const contents = JSON.stringify({ revision, charts: { [digest]: encoded } })
        if (existsSync(target) && readFileSync(target, 'utf8') === contents) continue
        writeFileSync(temporaryFile, contents)
        renameSync(temporaryFile, target)
      }
      for (const filename of readdirSync(directory)) {
        if (!filename.endsWith('.json') || !Object.hasOwn(charts, filename.slice(0, -5))) {
          rmSync(join(directory, filename), { recursive: true, force: true })
        }
      }
    }
    for (const entry of readdirSync(output)) {
      if (!bundles.has(entry)) rmSync(join(output, entry), { recursive: true, force: true })
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

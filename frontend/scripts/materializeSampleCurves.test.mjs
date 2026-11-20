import { afterEach, beforeEach, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { US_STATES } from 'policyengine-household-wizard/us-household'
import { materializeSampleCurves } from './materializeSampleCurves.mjs'

const revision = 'a'.repeat(64)
const oldDigest = 'b'.repeat(64)
const newDigest = 'c'.repeat(64)
const encoded = gzipSync('sample series').toString('base64')
let fixture, source

function writeBundle(state, charts, version = revision) {
  writeFileSync(join(source, state + '.json'), JSON.stringify({ revision: version, charts }))
}

function asset(state, digest) {
  return join(source, 'curves', state, digest + '.json')
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'cliffwatch-curve-test-'))
  source = join(fixture, 'public', 'sample-charts')
  mkdirSync(source, { recursive: true })
  for (const { code } of US_STATES) writeBundle(code, { [oldDigest]: encoded })
})

afterEach(() => rmSync(fixture, { recursive: true, force: true }))

it('emits one envelope per digest and synchronizes the generated tree on repeated runs', () => {
  writeBundle('GA', { [oldDigest]: encoded, [newDigest]: encoded })
  materializeSampleCurves(source)
  const expected = { revision, charts: { [newDigest]: encoded } }
  expect(JSON.parse(readFileSync(asset('GA', newDigest), 'utf8'))).toEqual(expected)
  const previous = statSync(asset('GA', newDigest), { bigint: true })
  writeBundle('GA', { [newDigest]: encoded })
  writeFileSync(asset('WY', oldDigest), 'truncated')
  mkdirSync(join(source, 'curves', 'ZZ'))

  materializeSampleCurves(source)
  expect(existsSync(asset('GA', oldDigest))).toBe(false)
  expect(existsSync(join(source, 'curves', 'ZZ'))).toBe(false)
  expect(statSync(asset('GA', newDigest), { bigint: true }).mtimeNs).toBe(previous.mtimeNs)
  expect(JSON.parse(readFileSync(asset('WY', oldDigest), 'utf8'))).toEqual({ revision, charts: { [oldDigest]: encoded } })
})

it.each([
  ['unsafe digest', { '../outside': encoded }, revision, /digest/],
  ['invalid base64', { [oldDigest]: 'not base64' }, revision, /base64/],
  ['mixed revisions', { [oldDigest]: encoded }, newDigest, /revision/],
  ['empty bundle', {}, revision, /Missing sample charts/],
])('preserves the previous assets if a canonical bundle has %s', (_case, charts, version, error) => {
  materializeSampleCurves(source)
  writeBundle('AL', { [newDigest]: encoded })
  writeBundle('WY', charts, version)
  expect(() => materializeSampleCurves(source)).toThrow(error)
  expect(existsSync(asset('AL', newDigest))).toBe(false)
  expect(existsSync(asset('AL', oldDigest))).toBe(true)
})

it('rejects missing states and unexpected source filenames', () => {
  rmSync(join(source, 'GA.json'))
  writeBundle('Georgia', { [oldDigest]: encoded })
  expect(() => materializeSampleCurves(source)).toThrow(/each US state and DC/)
  expect(existsSync(join(source, 'curves'))).toBe(false)
})

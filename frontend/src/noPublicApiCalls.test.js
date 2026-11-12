import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

// Everything a page can load: the App Router files and the React app under
// src/. Tests run in Node, not in the page, so they are left out. The Public
// API (api.policyengine.org) serves only PolicyEngine's servers; the page's
// calculations go to CliffWatch's own /api routes.
const BROWSER_SOURCE_DIRECTORIES = ['app', 'src']
const SOURCE_FILE_PATTERN = /\.(js|jsx|mjs|ts|tsx)$/
const TEST_FILE_PATTERN = /\.test\.[a-z]+$/
const PUBLIC_API_HOST_PATTERN = /api\.policyengine\.org/

const frontendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sourceFilesUnder(directory) {
  return readdirSync(directory).flatMap((entryName) => {
    const entryPath = path.join(directory, entryName)
    if (statSync(entryPath).isDirectory()) {
      return sourceFilesUnder(entryPath)
    }
    return SOURCE_FILE_PATTERN.test(entryName) && !TEST_FILE_PATTERN.test(entryName)
      ? [entryPath]
      : []
  })
}

describe('browser source', () => {
  test('given the pages and the React app then no file names the Public API', () => {
    // Given
    const sourceFiles = BROWSER_SOURCE_DIRECTORIES.flatMap((directoryName) =>
      sourceFilesUnder(path.join(frontendDirectory, directoryName)),
    )

    // When
    const filesNamingPublicApi = sourceFiles
      .filter((sourceFile) => PUBLIC_API_HOST_PATTERN.test(readFileSync(sourceFile, 'utf8')))
      .map((sourceFile) => path.relative(frontendDirectory, sourceFile))

    // Then
    const scannedFiles = sourceFiles.map((sourceFile) => path.relative(frontendDirectory, sourceFile))
    expect(scannedFiles).toContain('src/dataLookup.js')
    expect(filesNamingPublicApi).toEqual([])
  })
})

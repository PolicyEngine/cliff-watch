import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createBlankDraft } from 'policyengine-household-wizard'
import InputPanel from './components/InputPanel'
import { getCliffWatchSample } from './wizard/sampleHousehold'
import { projectSample } from './wizard/projectSample'
// Lazy-load the chart-heavy ResultsPanel (and its recharts dependencies) so
// the initial JS bundle is small. The panel is only mounted after the user
// hits "Find cliffs," so this defers ~hundreds of KB of chart code.
const ResultsPanel = lazy(() => import('./components/ResultsPanel'))
import {
  calculateSeries,
  hasCompleteRequiredInputs,
  loadMetadata,
} from './dataLookup'
import { decodeInputs, encodeInputs, syncUrlToInputs } from './utils/urlState'
import { calculateSeriesForSample, matchesOriginalSample } from './sampleSeries'
import { readSampleChart, sampleChartKey, writeSampleChart } from './utils/sampleChartCache'
import {
  COARSE_SAMPLING_REFINING_NOTE,
  cliffRefinementStep,
  refineCliffZones,
  refinementFailureNote,
  refinementNote,
} from './utils/seriesRefine'
import {
  combineDraftAndScenarioToInputs,
  createInitialScenario,
  inputsToDraft,
  inputsToScenario,
} from './wizard/cliffWatchDraft.js'

function cleanSeriesErrorMessage(error) {
  const message = error?.message?.trim()
  if (!message) {
    return 'The cliff chart is unavailable right now.'
  }

  if (message.startsWith('Calculation failed:')) {
    return message
  }

  return `Chart calculation failed: ${message}`
}

function sampleOrigin(projected, metadata) {
  const { source, draft, scenario } = projected
  const inputs = combineDraftAndScenarioToInputs(draft, scenario, metadata)
  return {
    ...source,
    originalInputs: inputs,
    originalQuery: encodeInputs(inputs),
    marker: [source.provenance.buildId, source.id, source.exampleZip ? 'example' : 'user'].join(':'),
  }
}

async function restoreSample(params, inputs, draft, metadata) {
  const [marker, ...duplicates] = params.getAll('sample')
  if (!marker || duplicates.length) return null
  const [build, id, location] = marker.split(':')
  if (!/^[A-Z]{2}-\d{1,3}$/.test(id) || !['example', 'user'].includes(location)) return null
  const household = await getCliffWatchSample(id)
  if (!household || household.provenance.buildId !== build) return null
  const projected = projectSample(household, location === 'example' ? {} : draft, metadata)
  const source = sampleOrigin(projected, metadata)
  // Check the raw household fields too: decoding can drop duplicate or
  // unsupported values. Unrelated URL metadata has no bearing on the chart.
  const expected = new URLSearchParams(source.originalQuery)
  expected.set('sample', source.marker)
  const householdFields = new Set([...Object.keys(inputs), ...inputs.people.flatMap(Object.keys)])
  const supplied = new URLSearchParams()
  for (const [key, value] of params) {
    const singleField = new URLSearchParams([[key, value]])
    if (expected.has(key) || householdFields.has(key) || decodeInputs(singleField.toString())) {
      supplied.append(key, value)
    }
  }
  expected.sort()
  supplied.sort()
  return expected.toString() === supplied.toString() && matchesOriginalSample(source, inputs)
    ? { ...source, restored: true } : null
}

function App() {
  const [metadata, setMetadata] = useState(null)
  const [draft, setDraft] = useState(() => createBlankDraft())
  const [scenario, setScenario] = useState(null)
  const [sample, setSample] = useState(null)
  const [catalogMatch, setCatalogMatch] = useState(false)
  const [seriesData, setSeriesData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [hasCalculated, setHasCalculated] = useState(false)
  const [error, setError] = useState(null)
  const [seriesError, setSeriesError] = useState(null)
  const resultsRef = useRef(null)
  const sampleResultsRef = useRef(null)
  const requestVersionRef = useRef(0)
  const handleCalculateRef = useRef(null)
  const lastCalculationOptions = useRef({})
  const autoCalculateRef = useRef(null)
  const pendingAutoScrollRef = useRef(false)

  useEffect(() => {
    let active = true
    loadMetadata()
      .then(async (meta) => {
        if (!active) return
        const fromUrl = typeof window !== 'undefined'
          ? decodeInputs(window.location.search)
          : null
        const initialScenario = createInitialScenario(meta)
        if (fromUrl) {
          const seededDraft = inputsToDraft(fromUrl)
          const seededScenario = {
            ...initialScenario,
            ...inputsToScenario(fromUrl, meta),
          }
          const seededInputs = combineDraftAndScenarioToInputs(
            seededDraft,
            seededScenario,
            meta,
          )
          const params = new URLSearchParams(window.location.search)
          const source = await restoreSample(params, seededInputs, seededDraft, meta).catch(() => null)
          if (!active) return
          setDraft(seededDraft)
          setScenario(seededScenario)
          setSample(source)
          autoCalculateRef.current = { inputs: seededInputs, sample: source }
        } else {
          setScenario(initialScenario)
        }
        setMetadata(meta)
      })
      .catch((err) => { if (active) setError(err.message || 'Failed to load app metadata.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (draft && scenario && metadata) {
      const combined = combineDraftAndScenarioToInputs(draft, scenario, metadata)
      syncUrlToInputs(combined, matchesOriginalSample(sample, combined) ? sample : null)
    }
  }, [draft, scenario, metadata, sample])

  // On share-link auto-calculation the browser's initial-load scroll
  // restoration overrides handleCalculate's one-shot scroll, so retry as the
  // results section renders — but never move a user who has already scrolled.
  useEffect(() => {
    if (!pendingAutoScrollRef.current) return undefined
    if (!(loading || seriesData)) return undefined

    const requestVersion = requestVersionRef.current
    const id = setTimeout(() => {
      if (requestVersion === requestVersionRef.current && window.scrollY < 50) {
        // Instant, not smooth: this fires during page load, where browsers
        // throttle animated scrolling in background tabs and scroll
        // restoration competes with it.
        resultsRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
      }
    }, 300)
    if (seriesData) {
      pendingAutoScrollRef.current = false
    }
    return () => clearTimeout(id)
  }, [loading, seriesData])

  const clearResults = () => {
    pendingAutoScrollRef.current = false
    requestVersionRef.current += 1
    setSeriesData(null)
    setSeriesLoading(false)
    setLoading(false)
    setHasCalculated(false)
    setCatalogMatch(false)
    setError(null)
    setSeriesError(null)
  }

  const handleDraftChange = (nextDraft) => {
    if (sample?.exampleZip && nextDraft.zip !== draft.zip) {
      setSample({ ...sample, exampleZip: null })
    }
    setDraft(nextDraft)
    clearResults()
  }

  const handleScenarioChange = (partial) => {
    setScenario((current) => ({ ...current, ...partial }))
    clearResults()
  }

  const handleReset = () => {
    if (!metadata) return
    setDraft(createBlankDraft())
    setScenario(createInitialScenario(metadata))
    setSample(null)
    clearResults()
  }

  const handleSample = (nextSample) => {
    pendingAutoScrollRef.current = false
    // An example ZIP belongs to the draw. Carry only a user-selected location
    // into a new sample, including its county when one was chosen.
    const next = projectSample(nextSample, sample?.exampleZip ? {} : draft, metadata)
    setDraft(next.draft)
    setScenario(next.scenario)
    const source = sampleOrigin(next, metadata)
    setSample(source)
    handleCalculate(
      combineDraftAndScenarioToInputs(next.draft, next.scenario, metadata),
      { sample: source },
    )
  }

  const runSeries = async (
    nextInputs,
    requestVersion = requestVersionRef.current,
    { sample, reopen = false } = {},
  ) => {
    if (requestVersion !== requestVersionRef.current) return
    setCatalogMatch(false)
    setSeriesLoading(true)
    setSeriesData(null)
    setSeriesError(null)

    const defaultStep = metadata?.defaults?.series_step || 1000
    const fallbackStep = Math.max(defaultStep, 2500)
    const isCancelled = () => requestVersion !== requestVersionRef.current
    let cacheKey = null
    if (sample?.exampleZip || reopen) {
      cacheKey = await sampleChartKey(nextInputs, metadata, defaultStep)
      const cached = await readSampleChart(cacheKey)
      if (isCancelled()) return
      if (cached) {
        if (reopen && !sample) setCatalogMatch(true)
        setSeriesData(cached)
        setSeriesLoading(false)
        return
      }
    }

    let primary = null
    let primaryError = null
    let usedFallbackStep = false
    try {
      primary = sample?.exampleZip || reopen
        ? await calculateSeriesForSample(nextInputs, metadata, { step: defaultStep }, {
          sample,
          onCatalogMatch: () => {
            if (reopen && !sample && !isCancelled()) setCatalogMatch(true)
          },
        })
        : await calculateSeries(nextInputs, metadata, { step: defaultStep })
    } catch (err) {
      primaryError = err
      console.error(err)
    }

    if (isCancelled()) return

    if (!primary) {
      let fallbackError = null
      try {
        primary = await calculateSeries(nextInputs, metadata, { step: fallbackStep })
        if (isCancelled()) return
        usedFallbackStep = true
        setSeriesError(COARSE_SAMPLING_REFINING_NOTE)
      } catch (err) {
        fallbackError = err
        console.error(err)
        if (isCancelled()) return
        setSeriesError(cleanSeriesErrorMessage(fallbackError || primaryError))
        setSeriesLoading(false)
        return
      }
    }

    // Saved windows are raw model points for refinement, outside the displayed
    // chart and the finished-chart cache.
    const { sample_refinements: sampleRefinements, ...coarseSeries } = primary
    setSeriesData(coarseSeries)
    setSeriesLoading(false)

    const refineStep = cliffRefinementStep(coarseSeries.step_annual || defaultStep)
    let refined
    try {
      refined = await refineCliffZones({
        coarseSeries,
        inputs: nextInputs,
        metadata,
        refineStep,
        sampleRefinements,
        calculateSeriesFn: calculateSeries,
        isCancelled,
      })
    } catch (err) {
      console.error('Refinement error', err)
      if (isCancelled()) return
      setSeriesError(refinementFailureNote(coarseSeries.step_annual))
      return
    }
    if (isCancelled()) return
    if (refined !== coarseSeries) {
      setSeriesData(refined)
    }
    setSeriesError(refinementNote(refined, { usedFallbackStep }))
    if (sample?.exampleZip && matchesOriginalSample(sample, nextInputs) && !usedFallbackStep) {
      void writeSampleChart(cacheKey, refined)
    }
  }

  const handleCalculate = async (
    nextInputs = (draft && scenario && metadata
      ? combineDraftAndScenarioToInputs(draft, scenario, metadata)
      : null),
    options = {},
  ) => {
    if (!metadata || !nextInputs || !hasCompleteRequiredInputs(nextInputs)) return

    lastCalculationOptions.current = options
    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    setSeriesData(null)
    setSeriesError(null)
    setLoading(true)
    setHasCalculated(true)
    setError(null)
    setTimeout(() => {
      if (requestVersion === requestVersionRef.current) {
        (sampleResultsRef.current || resultsRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 50)

    try {
      await runSeries(nextInputs, requestVersion, options)
      if (requestVersion !== requestVersionRef.current) return
      setLoading(false)
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return
      setError(err.message || 'Calculation failed. Please try again.')
      setLoading(false)
    }
  }

  // The county picker in the results reruns the chart at once. Editing the ZIP
  // clears the choice, since a county belongs to the ZIP it was chosen under.
  const handleCountyChange = (county) => {
    const nextDraft = { ...draft, county }
    setDraft(nextDraft)
    handleCalculate(combineDraftAndScenarioToInputs(nextDraft, scenario, metadata))
  }

  useEffect(() => {
    handleCalculateRef.current = handleCalculate
  })

  // This must run after the effect above: effects fire in declaration order,
  // and firing before the ref refresh would call a stale closure whose
  // metadata is still null — the auto-calculation then bails silently and the
  // pending inputs are consumed. Dev's StrictMode double-mount hid exactly
  // that by re-arming the trigger for a second, fresh-closure pass.
  useEffect(() => {
    if (metadata && autoCalculateRef.current && handleCalculateRef.current) {
      const pending = autoCalculateRef.current
      autoCalculateRef.current = null
      pendingAutoScrollRef.current = true
      handleCalculateRef.current(pending.inputs, { reopen: true, sample: pending.sample })
    }
  })

  const combinedInputs = metadata && scenario
    ? combineDraftAndScenarioToInputs(draft, scenario, metadata)
    : null

  return (
    <div className="app-shell">
      <header className="app-hero">
        <div className="app-hero-inner">
          <h1>CliffWatch</h1>
          <p>See where benefits, refundable tax credits, and taxes create resource cliffs as wages and salaries rise.</p>
        </div>
      </header>

      <main className="app">
        <InputPanel
          metadata={metadata}
          draft={draft}
          scenario={scenario}
          loading={loading}
          onCalculate={inputs => handleCalculate(inputs, { sample })}
          onDraftChange={handleDraftChange}
          onScenarioChange={handleScenarioChange}
          onReset={handleReset}
          sample={sample}
          onSample={handleSample}
          sampleResultsRef={sampleResultsRef}
        />

        <div ref={resultsRef} />
        <Suspense
          fallback={
            <div
              className="results-panel-loading"
              style={{ padding: '32px 16px', textAlign: 'center', color: '#475569' }}
            >
              Loading cliff chart…
            </div>
          }
        >
          {catalogMatch && !sample && <p>These inputs match a chart from PolicyEngine’s 2024 synthetic US population. The sample catalog supplies the state. The chart uses an example ZIP and applies {metadata.year} rules to the original dollar amounts.</p>}
          <ResultsPanel
            sample={matchesOriginalSample(sample, combinedInputs) ? sample : null}
            metadata={metadata}
            inputs={combinedInputs}
            seriesData={seriesData}
            loading={loading}
            seriesLoading={seriesLoading}
            hasCalculated={hasCalculated}
            error={error}
            seriesError={seriesError}
            onCountyChange={handleCountyChange}
            onRetry={() => handleCalculate(undefined, lastCalculationOptions.current)}
          />
        </Suspense>
      </main>
    </div>
  )
}

export default App

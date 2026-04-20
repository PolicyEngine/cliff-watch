import { useEffect, useRef, useState } from 'react'
import InputPanel from './components/InputPanel'
import ResultsPanel from './components/ResultsPanel'
import {
  calculateSeries,
  createInitialInputs,
  loadMetadata,
  reconcileInputs,
} from './dataLookup'
import { decodeInputs, syncUrlToInputs } from './utils/urlState'
import { refineCliffZones } from './utils/seriesRefine'

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

function App() {
  const [metadata, setMetadata] = useState(null)
  const [inputs, setInputs] = useState(null)
  const [seriesData, setSeriesData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [hasCalculated, setHasCalculated] = useState(false)
  const [error, setError] = useState(null)
  const [seriesError, setSeriesError] = useState(null)
  const resultsRef = useRef(null)
  const requestVersionRef = useRef(0)
  const handleCalculateRef = useRef(null)
  const autoCalculateRef = useRef(null)

  useEffect(() => {
    loadMetadata()
      .then((meta) => {
        setMetadata(meta)
        const fromUrl = typeof window !== 'undefined'
          ? decodeInputs(window.location.search)
          : null
        const initial = createInitialInputs(meta)
        const nextInputs = fromUrl
          ? reconcileInputs({ ...initial, ...fromUrl }, meta)
          : initial
        setInputs(nextInputs)
        syncUrlToInputs(nextInputs)
        if (fromUrl) {
          autoCalculateRef.current = nextInputs
        }
      })
      .catch((err) => setError(err.message || 'Failed to load app metadata.'))
  }, [])

  useEffect(() => {
    if (inputs) syncUrlToInputs(inputs)
  }, [inputs])

  useEffect(() => {
    if (metadata && autoCalculateRef.current && handleCalculateRef.current) {
      const pending = autoCalculateRef.current
      autoCalculateRef.current = null
      handleCalculateRef.current(pending)
    }
  })

  const clearResults = () => {
    requestVersionRef.current += 1
    setSeriesData(null)
    setSeriesLoading(false)
    setLoading(false)
    setHasCalculated(false)
    setError(null)
    setSeriesError(null)
  }

  const handleInputChange = (partial) => {
    setInputs((current) => reconcileInputs({ ...current, ...partial }, metadata))
    clearResults()
  }

  const handleReset = () => {
    if (!metadata) return
    setInputs(createInitialInputs(metadata))
    clearResults()
  }

  const runSeries = async (
    nextInputs,
    requestVersion = requestVersionRef.current,
  ) => {
    if (requestVersion !== requestVersionRef.current) return
    setSeriesLoading(true)
    setSeriesData(null)
    setSeriesError(null)

    const defaultStep = metadata?.defaults?.series_step || 1000
    const fallbackStep = Math.max(defaultStep, 2500)
    const isCancelled = () => requestVersion !== requestVersionRef.current

    let primary = null
    let primaryError = null
    try {
      primary = await calculateSeries(nextInputs, metadata, { step: defaultStep })
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
        setSeriesError('Sampled coarsely for speed; refining around detected cliffs.')
      } catch (err) {
        fallbackError = err
        console.error(err)
        if (isCancelled()) return
        setSeriesError(cleanSeriesErrorMessage(fallbackError || primaryError))
        setSeriesLoading(false)
        return
      }
    }

    setSeriesData(primary)
    setSeriesLoading(false)

    const refineStep = Math.max(100, Math.floor((primary?.step_annual || defaultStep) / 5))
    try {
      const refined = await refineCliffZones({
        coarseSeries: primary,
        inputs: nextInputs,
        metadata,
        refineStep,
        calculateSeriesFn: calculateSeries,
        isCancelled,
      })
      if (isCancelled()) return
      if (refined !== primary) {
        setSeriesData(refined)
      }
    } catch (err) {
      console.error('Refinement error', err)
    }
  }

  const handleCalculate = async (nextInputs = inputs) => {
    if (!metadata || !nextInputs) return

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    setSeriesData(null)
    setSeriesError(null)
    setLoading(true)
    setHasCalculated(true)
    setError(null)
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)

    try {
      await runSeries(nextInputs, requestVersion)
      if (requestVersion !== requestVersionRef.current) return
      setLoading(false)
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return
      setError(err.message || 'Calculation failed. Please try again.')
      setLoading(false)
    }
  }

  useEffect(() => {
    handleCalculateRef.current = handleCalculate
  })

  return (
    <div className="app-shell">
      <header className="app-hero">
        <div className="app-hero-inner">
          <h1>Cliff Watch</h1>
          <p>See where benefits, refundable tax credits, and taxes create resource cliffs as wages and salaries rise.</p>
        </div>
      </header>

      <main className="app">
        <InputPanel
          metadata={metadata}
          inputs={inputs}
          loading={loading}
          onCalculate={handleCalculate}
          onChange={handleInputChange}
          onReset={handleReset}
        />

        <div ref={resultsRef} />
        <ResultsPanel
          metadata={metadata}
          inputs={inputs}
          seriesData={seriesData}
          loading={loading}
          seriesLoading={seriesLoading}
          hasCalculated={hasCalculated}
          error={error}
          seriesError={seriesError}
        />
      </main>
    </div>
  )
}

export default App

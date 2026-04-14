import { useEffect, useRef, useState } from 'react'
import InputPanel from './components/InputPanel'
import ResultsPanel from './components/ResultsPanel'
import {
  calculateSeries,
  createInitialInputs,
  loadMetadata,
  reconcileInputs,
} from './dataLookup'

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

  useEffect(() => {
    loadMetadata()
      .then((meta) => {
        setMetadata(meta)
        setInputs(createInitialInputs(meta))
      })
      .catch((err) => setError(err.message || 'Failed to load app metadata.'))
  }, [])

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

    try {
      const nextSeries = await calculateSeries(nextInputs, metadata, {
        step: defaultStep,
      })
      if (requestVersion !== requestVersionRef.current) return
      setSeriesData(nextSeries)
      setSeriesLoading(false)
      return
    } catch (err) {
      console.error(err)
    }

    if (requestVersion !== requestVersionRef.current) return

    try {
      const fallbackSeries = await calculateSeries(nextInputs, metadata, {
        step: fallbackStep,
      })
      if (requestVersion !== requestVersionRef.current) return
      setSeriesData(fallbackSeries)
      setSeriesError('Showing a coarser cliff chart because the detailed curve timed out.')
    } catch (err) {
      console.error(err)
      if (requestVersion !== requestVersionRef.current) return
      setSeriesError('The cliff chart timed out. Try a smaller chart max and run it again.')
    }

    if (requestVersion !== requestVersionRef.current) return
    setSeriesLoading(false)
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

  return (
    <div className="app-shell">
      <header className="app-hero">
        <div className="app-hero-inner">
          <h1>Cliff Watch</h1>
          <p>See where benefits, refundable tax credits, and taxes create resource cliffs as wages and salaries rise.</p>
        </div>
      </header>

      <div className="app">
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
      </div>
    </div>
  )
}

export default App

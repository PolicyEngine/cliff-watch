import { useEffect, useRef, useState } from 'react'
import InputPanel from './components/InputPanel'
import ResultsPanel from './components/ResultsPanel'
import {
  calculateHouseholdTypes,
  calculateSeries,
  calculateStateResult,
  createInitialInputs,
  loadMetadata,
  reconcileInputs,
} from './dataLookup'

function App() {
  const [metadata, setMetadata] = useState(null)
  const [inputs, setInputs] = useState(null)
  const [result, setResult] = useState(null)
  const [seriesData, setSeriesData] = useState(null)
  const [householdComparison, setHouseholdComparison] = useState(null)
  const [loading, setLoading] = useState(false)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [householdComparisonLoading, setHouseholdComparisonLoading] = useState(false)
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
    setResult(null)
    setSeriesData(null)
    setHouseholdComparison(null)
    setSeriesLoading(false)
    setHouseholdComparisonLoading(false)
    setLoading(false)
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

  const runHouseholdComparison = async (
    nextInputs,
    requestVersion = requestVersionRef.current,
  ) => {
    if (requestVersion !== requestVersionRef.current) return
    setHouseholdComparisonLoading(true)
    try {
      const households = await calculateHouseholdTypes(nextInputs, metadata)
      if (requestVersion !== requestVersionRef.current) return
      setHouseholdComparison(households)
    } catch (err) {
      console.error(err)
    } finally {
      if (requestVersion !== requestVersionRef.current) return
      setHouseholdComparisonLoading(false)
    }
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
      setSeriesError('Showing a coarser earnings curve because the detailed series timed out.')
    } catch (err) {
      console.error(err)
      if (requestVersion !== requestVersionRef.current) return
      setSeriesError('The earnings curve timed out. The household result above is still valid.')
    }

    if (requestVersion !== requestVersionRef.current) return
    setSeriesLoading(false)
  }

  const handleCalculate = async (nextInputs = inputs) => {
    if (!metadata || !nextInputs) return

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    setSeriesData(null)
    setHouseholdComparison(null)
    setSeriesError(null)
    setHouseholdComparisonLoading(false)
    setLoading(true)
    setError(null)

    try {
      const nextResult = await calculateStateResult(nextInputs, metadata)
      if (requestVersion !== requestVersionRef.current) return

      setResult(nextResult)
      setLoading(false)

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

      runSeries(nextInputs, requestVersion).finally(() => {
        if (requestVersion !== requestVersionRef.current) return
        runHouseholdComparison(nextInputs, requestVersion)
      })
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return
      setError(err.message || 'Calculation failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Benefit Cliff Calculator</h1>
        <p>Estimate net income, benefits, and refundable tax credits across incomes and states</p>
      </header>

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
        result={result}
        seriesData={seriesData}
        householdComparison={householdComparison}
        loading={loading}
        seriesLoading={seriesLoading}
        householdComparisonLoading={householdComparisonLoading}
        error={error}
        seriesError={seriesError}
      />
    </div>
  )
}

export default App

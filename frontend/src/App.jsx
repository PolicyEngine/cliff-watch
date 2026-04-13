import { useEffect, useRef, useState } from 'react'
import InputPanel from './components/InputPanel'
import ResultsPanel from './components/ResultsPanel'
import StateMap from './components/StateMap'
import {
  calculateAllStates,
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
  const [stateComparison, setStateComparison] = useState(null)
  const [householdComparison, setHouseholdComparison] = useState(null)
  const [stateComparisonRequested, setStateComparisonRequested] = useState(false)
  const [householdComparisonRequested, setHouseholdComparisonRequested] = useState(false)
  const [loading, setLoading] = useState(false)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [householdComparisonLoading, setHouseholdComparisonLoading] = useState(false)
  const [error, setError] = useState(null)
  const [seriesError, setSeriesError] = useState(null)
  const [lastSubmitted, setLastSubmitted] = useState(null)
  const resultsRef = useRef(null)
  const requestVersionRef = useRef(0)
  const householdComparisonRequestedRef = useRef(false)

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
    setStateComparison(null)
    setHouseholdComparison(null)
    setStateComparisonRequested(false)
    setHouseholdComparisonRequested(false)
    householdComparisonRequestedRef.current = false
    setSeriesLoading(false)
    setComparisonLoading(false)
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
    setLastSubmitted(null)
    clearResults()
  }

  const runComparisons = async (
    nextInputs,
    requestVersion = requestVersionRef.current,
  ) => {
    if (requestVersion !== requestVersionRef.current) return
    setStateComparisonRequested(true)
    setComparisonLoading(true)
    try {
      const states = await calculateAllStates(nextInputs, metadata)
      if (requestVersion !== requestVersionRef.current) return
      setStateComparison(states)
    } catch (err) {
      console.error(err)
    } finally {
      if (requestVersion !== requestVersionRef.current) return
      setComparisonLoading(false)
    }
  }

  const runHouseholdComparison = async (
    nextInputs,
    requestVersion = requestVersionRef.current,
  ) => {
    if (requestVersion !== requestVersionRef.current) return
    setHouseholdComparisonRequested(true)
    householdComparisonRequestedRef.current = true
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

  const requestHouseholdComparison = () => {
    const requestVersion = requestVersionRef.current
    const comparisonInputs = lastSubmitted || inputs

    if (!comparisonInputs) return
    if (householdComparisonRequestedRef.current || householdComparisonLoading || householdComparison) {
      return
    }

    setHouseholdComparisonRequested(true)
    householdComparisonRequestedRef.current = true

    if (seriesLoading) return

    runHouseholdComparison(comparisonInputs, requestVersion)
  }

  const handleCalculate = async (nextInputs = inputs) => {
    if (!metadata || !nextInputs) return

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    setStateComparisonRequested(false)
    setHouseholdComparisonRequested(false)
    householdComparisonRequestedRef.current = false
    setSeriesData(null)
    setStateComparison(null)
    setHouseholdComparison(null)
    setSeriesError(null)
    setComparisonLoading(false)
    setHouseholdComparisonLoading(false)
    setLoading(true)
    setError(null)
    setLastSubmitted(nextInputs)

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
        runComparisons(nextInputs, requestVersion)
        if (householdComparisonRequestedRef.current) {
          runHouseholdComparison(nextInputs, requestVersion)
        }
      })
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return
      setError(err.message || 'Calculation failed. Please try again.')
      setLoading(false)
    }
  }

  const handleStateSelect = async (stateCode) => {
    const nextInputs = reconcileInputs({ ...inputs, state: stateCode }, metadata)
    setInputs(nextInputs)
    if (lastSubmitted) {
      await handleCalculate(nextInputs)
    }
  }

  const states = metadata?.states || []

  return (
    <div className="app">
      <header className="app-header">
        <h1>Benefit Cliff Calculator</h1>
        <p>Estimate household resources across incomes and states</p>
      </header>

      <div className="top-layout">
        <InputPanel
          metadata={metadata}
          inputs={inputs}
          loading={loading}
          onCalculate={handleCalculate}
          onChange={handleInputChange}
          onReset={handleReset}
        />

        <section className="map-section">
          <h2>{stateComparison ? 'State comparison' : 'Select your state'}</h2>
          {comparisonLoading && (
            <div className="loading">Loading state comparison...</div>
          )}
          <StateMap
            selectedState={inputs?.state}
            availableStates={states}
            comparisonData={stateComparison?.states}
            maxNetResources={stateComparison?.max_net_resources}
            onStateSelect={handleStateSelect}
          />
        </section>
      </div>

      <div ref={resultsRef} />
      <ResultsPanel
        result={result}
        seriesData={seriesData}
        stateComparison={stateComparison}
        householdComparison={householdComparison}
        availableStates={states}
        stateComparisonRequested={stateComparisonRequested}
        householdComparisonRequested={householdComparisonRequested}
        loading={loading}
        seriesLoading={seriesLoading}
        comparisonLoading={comparisonLoading}
        householdComparisonLoading={householdComparisonLoading}
        error={error}
        seriesError={seriesError}
        onStateSelect={handleStateSelect}
        onRequestHouseholdComparison={requestHouseholdComparison}
      />
    </div>
  )
}

export default App

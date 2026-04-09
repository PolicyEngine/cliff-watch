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
} from './dataLookup'

function App() {
  const [metadata, setMetadata] = useState(null)
  const [inputs, setInputs] = useState(null)
  const [result, setResult] = useState(null)
  const [seriesData, setSeriesData] = useState(null)
  const [stateComparison, setStateComparison] = useState(null)
  const [householdComparison, setHouseholdComparison] = useState(null)
  const [loading, setLoading] = useState(false)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [householdComparisonLoading, setHouseholdComparisonLoading] = useState(false)
  const [error, setError] = useState(null)
  const [seriesError, setSeriesError] = useState(null)
  const [lastSubmitted, setLastSubmitted] = useState(null)
  const resultsRef = useRef(null)

  useEffect(() => {
    loadMetadata()
      .then((meta) => {
        setMetadata(meta)
        setInputs(createInitialInputs(meta))
      })
      .catch((err) => setError(err.message || 'Failed to load app metadata.'))
  }, [])

  const clearResults = () => {
    setResult(null)
    setSeriesData(null)
    setStateComparison(null)
    setHouseholdComparison(null)
    setError(null)
    setSeriesError(null)
  }

  const handleInputChange = (partial) => {
    setInputs((current) => ({ ...current, ...partial }))
    clearResults()
  }

  const handleReset = () => {
    if (!metadata) return
    setInputs(createInitialInputs(metadata))
    setLastSubmitted(null)
    clearResults()
  }

  const runComparisons = async (nextInputs) => {
    setComparisonLoading(true)
    try {
      const states = await calculateAllStates(nextInputs, metadata)
      setStateComparison(states)
    } catch (err) {
      console.error(err)
    } finally {
      setComparisonLoading(false)
    }
  }

  const runHouseholdComparison = async (nextInputs) => {
    setHouseholdComparisonLoading(true)
    try {
      const households = await calculateHouseholdTypes(nextInputs, metadata)
      setHouseholdComparison(households)
    } catch (err) {
      console.error(err)
    } finally {
      setHouseholdComparisonLoading(false)
    }
  }

  const runSeries = async (nextInputs) => {
    setSeriesLoading(true)
    setSeriesData(null)
    setSeriesError(null)

    const defaultStep = metadata?.defaults?.series_step || 1000
    const fallbackStep = Math.max(defaultStep, 2500)

    try {
      const nextSeries = await calculateSeries(nextInputs, metadata, {
        step: defaultStep,
      })
      setSeriesData(nextSeries)
      setSeriesLoading(false)
      return
    } catch (err) {
      console.error(err)
    }

    try {
      const fallbackSeries = await calculateSeries(nextInputs, metadata, {
        step: fallbackStep,
      })
      setSeriesData(fallbackSeries)
      setSeriesError('Showing a coarser earnings curve because the detailed series timed out.')
    } catch (err) {
      console.error(err)
      setSeriesError('The earnings curve timed out. The household result above is still valid.')
    }

    setSeriesLoading(false)
  }

  const handleCalculate = async (nextInputs = inputs) => {
    if (!metadata || !nextInputs) return

    setLoading(true)
    setError(null)
    setLastSubmitted(nextInputs)

    try {
      const nextResult = await calculateStateResult(nextInputs, metadata)

      setResult(nextResult)
      setLoading(false)

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

      runSeries(nextInputs)
      runComparisons(nextInputs)
      runHouseholdComparison(nextInputs)
    } catch (err) {
      setError(err.message || 'Calculation failed. Please try again.')
      setLoading(false)
    }
  }

  const handleStateSelect = async (stateCode) => {
    const nextInputs = { ...inputs, state: stateCode }
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
            maxNetResources={stateComparison?.max_net_resources_monthly}
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
        loading={loading}
        seriesLoading={seriesLoading}
        comparisonLoading={comparisonLoading}
        householdComparisonLoading={householdComparisonLoading}
        error={error}
        seriesError={seriesError}
        onStateSelect={handleStateSelect}
      />
    </div>
  )
}

export default App

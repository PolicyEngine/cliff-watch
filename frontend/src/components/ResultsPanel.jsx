import BenefitChart from './BenefitChart'
import CliffInsights from './CliffInsights'
import { formatCurrency } from '../dataLookup'

function householdSummary(inputs, metadata) {
  const people = inputs?.people || []
  const adults = people.filter((person) => person.kind === 'adult').length
  const dependents = people.filter((person) => person.kind === 'child').length
  const stateName = metadata?.states?.find((state) => state.code === inputs?.state)?.name || inputs?.state || ''

  const parts = [
    stateName,
    `${adults} adult${adults === 1 ? '' : 's'}`,
    `${dependents} dependent${dependents === 1 ? '' : 's'}`,
  ].filter(Boolean)

  return parts.join(' · ')
}

function ResultsPanel({
  metadata,
  inputs,
  seriesData,
  loading,
  seriesLoading,
  hasCalculated,
  error,
  seriesError,
}) {
  if (error) {
    return (
      <section className="results-panel">
        <div className="error">
          {error}
        </div>
      </section>
    )
  }

  if (loading) {
    return (
      <section className="results-panel">
        <div className="chart-container full-width">
          <h3>Cliff chart</h3>
          <p className="chart-subtitle">
            Building the income curve for this household now.
          </p>
          <div className="chart-empty">Finding cliffs...</div>
        </div>
      </section>
    )
  }

  if (!hasCalculated) {
    return (
      <section className="results-panel">
        <div className="placeholder">
          Enter your household information and click Find cliffs to see where resources drop as wages and salaries rise.
        </div>
      </section>
    )
  }

  return (
    <section className="results-panel">
      <div className="charts-grid">
        <div className="chart-container full-width">
          <h3>Cliff chart</h3>
          <p className="chart-subtitle">
            {householdSummary(inputs, metadata)}
          </p>
          {seriesData ? (
            <>
              <p className="chart-subtitle">
                Calculated through {formatCurrency(seriesData?.max_earned_income || 0)}/year in {formatCurrency(seriesData?.step_annual || 0)}/year wage and salary steps.
              </p>
              {seriesData?.truncated && (
                <p className="chart-note warning">
                  Showing the part of the curve we could calculate quickly enough for this household. Open Advanced if you want to explore farther up the range.
                </p>
              )}
              {seriesError && <p className="chart-note warning">{seriesError}</p>}
              <BenefitChart
                data={seriesData?.data || []}
              />
              <CliffInsights
                data={seriesData?.data || []}
                stepAnnual={seriesData?.step_annual}
              />
            </>
          ) : seriesLoading ? (
            <>
              <p className="chart-subtitle">
                Loading the cliff chart in the background.
              </p>
              <div className="chart-empty">The curve is still loading.</div>
            </>
          ) : (
            <>
              {seriesError && <p className="chart-note warning">{seriesError}</p>}
              <div className="chart-empty">The cliff chart is unavailable right now.</div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

export default ResultsPanel

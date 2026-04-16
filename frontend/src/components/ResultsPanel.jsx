import { useState } from 'react'
import BenefitChart from './BenefitChart'
import CliffInsights from './CliffInsights'
import { formatCurrency } from '../dataLookup'
import { buildShareUrl } from '../utils/urlState'

function ShareButton({ inputs }) {
  const [copied, setCopied] = useState(false)

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(inputs))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.error('Clipboard write failed', err)
    }
  }

  return (
    <button
      type="button"
      className="share-link-btn"
      onClick={handleClick}
      title="Copy a link that reproduces this scenario"
    >
      {copied ? 'Link copied' : 'Copy share link'}
    </button>
  )
}

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
          <div className="chart-header-row">
            <h3>Cliff chart</h3>
            <ShareButton inputs={inputs} />
          </div>
          <p className="chart-subtitle">
            {householdSummary(inputs, metadata)}
          </p>
          {seriesData ? (
            <>
              <p className="chart-subtitle">
                Calculated through {formatCurrency(seriesData?.max_earned_income || 0)}/year in {formatCurrency(seriesData?.step_annual || 0)}/year wage and salary steps
                {seriesData?.refined_zone_count
                  ? `, refined to ${formatCurrency(seriesData.refined_step_annual || 0)}/year around ${seriesData.refined_zone_count} cliff ${seriesData.refined_zone_count === 1 ? 'zone' : 'zones'}`
                  : ''}
                .
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
          ) : (loading || seriesLoading) ? (
            <>
              <p className="chart-subtitle">
                Calculating through {formatCurrency(inputs?.chart_max_earned_income || metadata?.defaults?.chart_max_earned_income || 0)}/year in {formatCurrency(metadata?.defaults?.series_step || 0)}/year wage and salary steps.
              </p>
              <BenefitChart
                data={[]}
                loading
                placeholderMaxEarnedIncome={inputs?.chart_max_earned_income || metadata?.defaults?.chart_max_earned_income || 100000}
              />
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

import { useEffect, useMemo, useState } from 'react'
import BenefitChart from './BenefitChart'
import CliffInsights from './CliffInsights'
import HouseholdComparison from './HouseholdComparison'
import ProgramBreakdown from './ProgramBreakdown'
import StateMap from './StateMap'
import StateRanking from './StateRanking'
import { formatCurrency } from '../dataLookup'

function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function formatFilingStatus(filingStatus) {
  switch (filingStatus) {
    case 'JOINT':
      return 'Married filing jointly'
    case 'SEPARATE':
      return 'Married filing separately'
    case 'HEAD_OF_HOUSEHOLD':
      return 'Head of household'
    default:
      return 'Single'
  }
}

function ResultsPanel({
  result,
  seriesData,
  stateComparison,
  householdComparison,
  availableStates,
  stateComparisonRequested,
  householdComparisonRequested,
  loading,
  seriesLoading,
  comparisonLoading,
  householdComparisonLoading,
  error,
  seriesError,
  onStateSelect,
  onRequestHouseholdComparison,
}) {
  const [activeTab, setActiveTab] = useState('State comparison')

  useEffect(() => {
    if (activeTab === 'Household comparison') {
      onRequestHouseholdComparison?.()
    }
  }, [activeTab, onRequestHouseholdComparison])

  const stateRank = useMemo(() => {
    if (!stateComparison?.states || !result?.input?.state) return null
    const index = stateComparison.states.findIndex((item) => item.state === result.input.state)
    if (index === -1) return null
    return stateComparison.states[index]
  }, [stateComparison, result])

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
        <div className="loading">Calculating benefits...</div>
      </section>
    )
  }

  if (!result) {
    return (
      <section className="results-panel">
        <div className="placeholder">
          Enter your household information and click Calculate to see estimated annual net resources.
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="results-panel">
        <div className="result-banner">
          <div className="result-banner-main">
            <h3>Estimated Annual Net Resources</h3>
            <div className="amount">{formatCurrency(result.totals.net_resources)}</div>
            <div className="amount-annual">At {formatCurrency(result.totals.market_income)}/yr earnings</div>
          </div>

          <div className="result-banner-details">
            <span className={`eligibility-status ${result.eligible ? 'eligible' : 'not-eligible'}`}>
              {result.eligible ? 'Modeled support available' : 'No modeled support'}
            </span>
            <div className="result-meta">
              <span>{result.state_name} ({result.input.state})</span>
              <span>{formatFilingStatus(result.input.filing_status)}</span>
              <span>{result.template.label}</span>
              <span>{result.template.description}</span>
              <span>{Math.round(result.context.resources_pct_fpg)}% of FPG after support</span>
            </div>
          </div>

          <div className="result-banner-stats">
            <div className="stat-item">
              <span className="stat-label">Core support</span>
              <span className="stat-value">{formatCurrency(result.totals.core_support)}/yr</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Taxes</span>
              <span className="stat-value">{formatCurrency(result.totals.taxes)}/yr</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Cliff gap</span>
              <span className="stat-value">
                {result.cliff.is_on_cliff ? `${formatCurrency(result.cliff.gap_annual)}/yr` : 'None'}
              </span>
            </div>
            {stateRank && (
              <div className="stat-item">
                <span className="stat-label">State rank</span>
                <span className="stat-value">#{stateRank.rank}</span>
              </div>
            )}
          </div>
        </div>

        <details className="benefit-breakdown" open>
          <summary>Modeled program breakdown</summary>
          <div className="breakdown-content">
            <ProgramBreakdown programs={result.program_breakdown} />
          </div>
        </details>

        <div className="poverty-context">
          <h4>Poverty context</h4>
          <p className="poverty-subtitle">
            Market income is {Math.round(result.context.income_pct_fpg)}% of FPG. Net resources rise to {Math.round(result.context.resources_pct_fpg)}% of FPG after modeled supports and taxes.
          </p>
          <div className="breakdown-row total">
            <span className="breakdown-label">Effective marginal rate on next earnings step</span>
            <span className={`breakdown-value ${result.cliff.is_on_cliff ? 'negative' : 'positive'}`}>
              {(result.cliff.effective_marginal_rate * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-container full-width">
            <h3>Net resources by earnings</h3>
            {seriesData ? (
              <>
                <p className="chart-subtitle">
                  Calculated through {formatCurrency(seriesData?.max_earned_income || 0)}/year in {formatCurrency(seriesData?.step_annual || 0)}/year earnings steps.
                </p>
                {seriesData?.truncated && (
                  <p className="chart-note warning">
                    Showing the part of the curve we could calculate quickly enough for this household. Increase earnings and recalculate if you want to explore farther up the income range.
                  </p>
                )}
                {seriesError && <p className="chart-note warning">{seriesError}</p>}
                <BenefitChart
                  data={seriesData?.data || []}
                  currentIncome={result.totals.market_income}
                />
                <CliffInsights
                  data={seriesData?.data || []}
                  stepAnnual={seriesData?.step_annual}
                />
              </>
            ) : seriesLoading ? (
              <>
                <p className="chart-subtitle">
                  Loading the earnings curve in the background.
                </p>
                <div className="chart-empty">The household result is ready. The income series is still loading.</div>
              </>
            ) : (
              <>
                {seriesError && <p className="chart-note warning">{seriesError}</p>}
                <div className="chart-empty">The earnings curve is unavailable right now.</div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="tabbed-section">
        <div className="tab-bar">
          {['State comparison', 'Household comparison'].map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="tab-content">
          {activeTab === 'State comparison' ? (
            <>
              <p className="chart-subtitle">
                {stateRank
                  ? `${result.state_name} provides the ${getOrdinal(stateRank.rank)} highest modeled annual net resources for this household.`
                  : stateComparisonRequested
                    ? 'State comparison is loading.'
                    : 'State comparison will load after the earnings curve finishes.'}
              </p>
              {!stateComparisonRequested && !stateComparison?.states ? (
                <p className="ranking-empty">
                  We wait until the earnings curve settles before running the 50-state comparison.
                </p>
              ) : comparisonLoading && !stateComparison?.states ? (
                <div className="loading">Loading state comparison...</div>
              ) : (
                <div className="state-comparison-grid">
                  <div className="comparison-map-panel">
                    <StateMap
                      selectedState={result.input.state}
                      availableStates={availableStates}
                      comparisonData={stateComparison?.states}
                      maxNetResources={stateComparison?.max_net_resources}
                      onStateSelect={onStateSelect}
                    />
                  </div>
                  <StateRanking
                    data={stateComparison?.states || []}
                    selectedState={result.input.state}
                    onStateSelect={onStateSelect}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <p className="chart-subtitle">
                Annual net resources for five preset household compositions at the same earnings and state. This comparison loads on demand.
              </p>
              {(householdComparisonLoading || (!householdComparisonRequested && !householdComparison)) ? (
                <div className="loading">Loading household comparison...</div>
              ) : (
                <HouseholdComparison
                  households={householdComparison?.households || []}
                  currentType={null}
                />
              )}
            </>
          )}
        </div>
      </section>
    </>
  )
}

export default ResultsPanel

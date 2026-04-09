import { useMemo, useState } from 'react'
import BenefitChart from './BenefitChart'
import CliffInsights from './CliffInsights'
import HouseholdComparison from './HouseholdComparison'
import ProgramBreakdown from './ProgramBreakdown'
import StateRanking from './StateRanking'
import { formatCurrency } from '../dataLookup'

function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function ResultsPanel({
  result,
  seriesData,
  stateComparison,
  householdComparison,
  loading,
  seriesLoading,
  comparisonLoading,
  householdComparisonLoading,
  error,
  seriesError,
  onStateSelect,
}) {
  const [activeTab, setActiveTab] = useState('State comparison')

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
          Enter your household information and click Calculate to see estimated monthly net resources.
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="results-panel">
        <div className="result-banner">
          <div className="result-banner-main">
            <h3>Estimated Monthly Net Resources</h3>
            <div className="amount">{formatCurrency(result.monthly.net_resources)}</div>
            <div className="amount-annual">{formatCurrency(result.totals.net_resources)}/yr</div>
          </div>

          <div className="result-banner-details">
            <span className={`eligibility-status ${result.eligible ? 'eligible' : 'not-eligible'}`}>
              {result.eligible ? 'Modeled support available' : 'No modeled support'}
            </span>
            <div className="result-meta">
              <span>{result.state_name} ({result.input.state})</span>
              <span>{result.template.label}</span>
              <span>{result.template.description}</span>
              <span>{Math.round(result.context.resources_pct_fpg)}% of FPG after support</span>
            </div>
          </div>

          <div className="result-banner-stats">
            <div className="stat-item">
              <span className="stat-label">Core support</span>
              <span className="stat-value">{formatCurrency(result.monthly.core_support)}/mo</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Taxes</span>
              <span className="stat-value">{formatCurrency(result.monthly.taxes)}/mo</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Cliff gap</span>
              <span className="stat-value">
                {result.cliff.is_on_cliff ? `${formatCurrency(result.cliff.gap_monthly)}/mo` : 'None'}
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
                  Calculated in {formatCurrency(seriesData?.step_annual || 0)}/year earnings steps, or about {formatCurrency(seriesData?.step_monthly || 0)}/month.
                </p>
                {seriesError && <p className="chart-note warning">{seriesError}</p>}
                <BenefitChart
                  data={seriesData?.data || []}
                  currentIncome={result.monthly.market_income}
                />
                <CliffInsights
                  data={seriesData?.data || []}
                  stepAnnual={seriesData?.step_annual}
                  stepMonthly={seriesData?.step_monthly}
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
                  ? `${result.state_name} provides the ${getOrdinal(stateRank.rank)} highest modeled monthly net resources for this household.`
                  : 'State comparison is loading.'}
              </p>
              {comparisonLoading && !stateComparison?.states ? (
                <div className="loading">Loading state comparison...</div>
              ) : (
                <StateRanking
                  data={stateComparison?.states || []}
                  selectedState={result.input.state}
                  onStateSelect={onStateSelect}
                />
              )}
            </>
          ) : (
            <>
              <p className="chart-subtitle">
                Monthly net resources for five preset household compositions at the same earnings and state.
              </p>
              {householdComparisonLoading && !householdComparison ? (
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

import BenefitChart from './BenefitChart'
import HouseholdComparison from './HouseholdComparison'
import ProgramBreakdown from './ProgramBreakdown'
import { formatCurrency } from '../dataLookup'

function ResultsPanel({
  result,
  seriesData,
  householdComparison,
  loading,
  seriesLoading,
  householdComparisonLoading,
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
        <div className="loading">Calculating benefits...</div>
      </section>
    )
  }

  if (!result) {
    return (
      <section className="results-panel">
        <div className="placeholder">
          Enter your household information and click Calculate to see estimated annual net income.
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="results-panel">
        <div className="result-banner">
          <div className="result-banner-main">
            <h3>Estimated Annual Net Income</h3>
            <div className="amount">{formatCurrency(result.totals.net_resources)}</div>
            <div className="amount-annual">At {formatCurrency(result.totals.market_income)}/yr earnings</div>
          </div>

          <div className="result-banner-details">
            <div className="result-meta">
              <span>{result.state_name} ({result.input.state})</span>
              <span>{result.template.label}</span>
              <span>{result.template.description}</span>
              <span>{Math.round(result.context.resources_pct_fpg)}% of FPG in net income</span>
            </div>
          </div>

          <div className="result-banner-stats">
            <div className="stat-item">
              <span className="stat-label">Benefits + refundable tax credits</span>
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
          </div>
        </div>

        <details className="benefit-breakdown" open>
          <summary>Benefits and refundable tax credits</summary>
          <div className="breakdown-content">
            <ProgramBreakdown programs={result.program_breakdown} />
          </div>
        </details>

        <div className="poverty-context">
          <h4>Poverty context</h4>
          <p className="poverty-subtitle">
            Market income is {Math.round(result.context.income_pct_fpg)}% of FPG. Net income rises to {Math.round(result.context.resources_pct_fpg)}% of FPG after benefits, refundable tax credits, and taxes.
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
            <h3>Earnings curve</h3>
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

      <section className="results-panel">
        <h3>Household comparison</h3>
        <p className="chart-subtitle">
          Annual net income for five preset household compositions at the same earnings and state.
        </p>
        {householdComparisonLoading && !householdComparison ? (
          <div className="loading">Loading household comparison...</div>
        ) : (
          <HouseholdComparison
            households={householdComparison?.households || []}
            currentType={null}
          />
        )}
      </section>
    </>
  )
}

export default ResultsPanel

import { useMemo } from 'react'
import { formatCurrency } from '../dataLookup'

const MAX_CLIFFS = 3

function CliffInsights({ data, stepAnnual, stepMonthly }) {
  const largestCliffs = useMemo(() => {
    if (!data || data.length === 0) return []

    return [...data]
      .filter((item) => item.is_cliff)
      .sort((left, right) => right.cliff_drop_monthly - left.cliff_drop_monthly)
      .slice(0, MAX_CLIFFS)
  }, [data])

  return (
    <div className="cliff-insights">
      <div className="cliff-insights-header">
        <h4>What is driving the cliffs?</h4>
        {stepAnnual ? (
          <p className="chart-subtitle">
            The earnings curve is calculated in {formatCurrency(stepAnnual)}/year increments, or about {formatCurrency(stepMonthly)}/month.
          </p>
        ) : null}
      </div>

      {largestCliffs.length === 0 ? (
        <p className="chart-subtitle">
          No downward cliffs were detected at this resolution.
        </p>
      ) : (
        <div className="cliff-card-list">
          {largestCliffs.map((cliff) => (
            <div key={cliff.earned_income} className="cliff-card">
              <div className="cliff-card-header">
                <span className="cliff-card-income">
                  Around {formatCurrency(cliff.earned_income_monthly)}/mo earnings
                </span>
                <span className="cliff-card-drop">
                  {formatCurrency(cliff.cliff_drop_monthly)}/mo drop
                </span>
              </div>

              <p className="cliff-card-copy">
                Compared with the prior earnings step, net resources change by {formatCurrency(cliff.net_change_monthly)}/mo.
              </p>

              {cliff.cliff_drivers?.length ? (
                <div className="cliff-driver-list">
                  {cliff.cliff_drivers.slice(0, 3).map((driver) => (
                    <div key={`${cliff.earned_income}-${driver.key}`} className="cliff-driver">
                      <span className="cliff-driver-label">{driver.label}</span>
                      <span className="cliff-driver-impact">
                        {formatCurrency(Math.abs(driver.resource_effect_monthly))}/mo
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="cliff-card-copy">No single dominant driver was identified for this drop.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default CliffInsights

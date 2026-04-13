import { useMemo } from 'react'
import { formatCurrency } from '../dataLookup'
import {
  buildCliffReport,
  describeDrivers,
  formatLossRate,
} from '../utils/cliffReport'

const MAX_ZONE_CARDS = 4

function CliffSummaryCard({ label, value, detail }) {
  return (
    <div className="cliff-summary-card">
      <span className="cliff-summary-label">{label}</span>
      <strong className="cliff-summary-value">{value}</strong>
      <span className="cliff-summary-detail">{detail}</span>
    </div>
  )
}

function CliffInsights({ data, stepAnnual }) {
  const report = useMemo(() => buildCliffReport(data), [data])

  const highlightedZones = useMemo(() => (
    [...report.zones]
      .sort((left, right) => right.largestDropAnnual - left.largestDropAnnual)
      .slice(0, MAX_ZONE_CARDS)
  ), [report.zones])

  const thresholdCopy = `${formatCurrency(report.thresholds?.minDropAnnual || 0)}/yr down or ${formatLossRate(report.thresholds?.minLossRate || 0)}`

  if (report.cliffs.length === 0) {
    return (
      <div className="cliff-insights">
        <div className="cliff-insights-header">
          <div>
            <h4>Where the cliffs hit</h4>
            <p className="chart-subtitle">
              The report only calls out meaningful losses: {thresholdCopy}.
            </p>
          </div>
          {stepAnnual ? (
            <p className="chart-subtitle cliff-resolution-note">
              Calculated in {formatCurrency(stepAnnual)}/year increments.
            </p>
          ) : null}
        </div>
        <div className="cliff-empty-panel">
          <strong>No cliffs detected at this resolution.</strong>
          <p>
            {report.hiddenCliffCount > 0
              ? 'We only found smaller phase-downs below the reporting threshold, so the curve does not show a meaningful benefit cliff.'
              : 'Net resources rise steadily across the sampled earnings curve. Smaller cliffs can still exist between the plotted earnings steps.'}
          </p>
        </div>
      </div>
    )
  }

  const largestCliff = report.largestCliff
  const worstLossRateCliff = report.worstLossRateCliff
  const firstCliff = report.firstCliff
  const dominantDriver = report.dominantDrivers[0]
  const overview = `The first meaningful cliff appears near ${formatCurrency(firstCliff.endIncomeAnnual)}/yr earnings. The biggest drop is ${formatCurrency(largestCliff.dropAnnual)}/yr, driven mostly by ${describeDrivers(largestCliff.cliff_drivers || report.dominantDrivers)}.`

  return (
    <div className="cliff-insights">
      <div className="cliff-insights-header">
        <div>
          <h4>Where the cliffs hit</h4>
          <p className="chart-subtitle">
            The report only calls out meaningful losses: {thresholdCopy}.
          </p>
        </div>
        {stepAnnual ? (
          <p className="chart-subtitle cliff-resolution-note">
            Calculated in {formatCurrency(stepAnnual)}/year increments.
          </p>
        ) : null}
      </div>

      <p className="cliff-overview">
        {overview}
      </p>

      {report.hiddenCliffCount > 0 ? (
        <p className="cliff-threshold-note">
          {report.hiddenCliffCount} smaller drop{report.hiddenCliffCount === 1 ? '' : 's'} below that threshold {report.hiddenCliffCount === 1 ? 'was' : 'were'} hidden to keep the focus on material cliffs.
        </p>
      ) : null}

      <div className="cliff-summary-grid">
        <CliffSummaryCard
          label="First cliff"
          value={`${formatCurrency(firstCliff.endIncomeAnnual)}/yr`}
          detail={`Begins after about ${formatCurrency(firstCliff.startIncomeAnnual)}/yr earnings`}
        />
        <CliffSummaryCard
          label="Largest annual drop"
          value={`${formatCurrency(largestCliff.dropAnnual)}/yr`}
          detail={`Near ${formatCurrency(largestCliff.endIncomeAnnual)}/yr earnings`}
        />
        <CliffSummaryCard
          label="Worst payback"
          value={formatLossRate(worstLossRateCliff.lossRate)}
          detail={`At roughly ${formatCurrency(worstLossRateCliff.endIncomeAnnual)}/yr earnings`}
        />
        <CliffSummaryCard
          label="Dominant driver"
          value={dominantDriver?.label || 'Mixed losses'}
          detail={
            dominantDriver
              ? `${formatCurrency(dominantDriver.totalImpactAnnual)}/yr of recurring loss across the reported cliffs`
              : `${report.zones.length} earnings band${report.zones.length === 1 ? '' : 's'} to watch`
          }
        />
      </div>

      <div className="cliff-card-list">
        {highlightedZones.map((zone) => (
          <div
            key={zone.id}
            className={`cliff-card cliff-card--${zone.severity.tone}`}
          >
            <div className="cliff-card-topline">
              <span className={`cliff-severity cliff-severity--${zone.severity.tone}`}>
                {zone.severity.label}
              </span>
              {' '}
              <span className="cliff-card-count">
                {zone.cliffCount} {zone.cliffCount === 1 ? 'step' : 'steps'}
              </span>
            </div>

            <div className="cliff-card-header">
              <span className="cliff-card-income">
                {formatCurrency(zone.startIncomeAnnual)} to {formatCurrency(zone.endIncomeAnnual)}/yr earnings
              </span>
              {' '}
              <span className="cliff-card-drop">
                {formatCurrency(zone.largestDropAnnual)}/yr largest drop
              </span>
            </div>

            <div className="cliff-card-grid">
              <div>
                <p className="cliff-card-copy">
                  In this earnings band, net resources move from {formatCurrency(zone.beforeResourcesAnnual)}/yr to {formatCurrency(zone.afterResourcesAnnual)}/yr. The sharpest single-step loss is {formatCurrency(zone.largestDropAnnual)}/yr, and the main driver is {zone.driverSummary}.
                </p>

                <div className="cliff-card-stats">
                  <div className="cliff-card-stat">
                    <span className="cliff-card-stat-label">Total losses in band</span>
                    {' '}
                    <strong className="cliff-card-stat-value">
                      {formatCurrency(zone.totalDropAnnual)}/yr
                    </strong>
                  </div>
                  <div className="cliff-card-stat">
                    <span className="cliff-card-stat-label">Worst payback</span>
                    {' '}
                    <strong className="cliff-card-stat-value">
                      {formatLossRate(zone.worstLossRate)}
                    </strong>
                  </div>
                  <div className="cliff-card-stat">
                    <span className="cliff-card-stat-label">Peak risk point</span>
                    {' '}
                    <strong className="cliff-card-stat-value">
                      {formatCurrency(zone.highestRiskIncomeAnnual)}/yr earnings
                    </strong>
                  </div>
                  <div className="cliff-card-stat">
                    <span className="cliff-card-stat-label">Reported drops</span>
                    {' '}
                    <strong className="cliff-card-stat-value">
                      {zone.cliffCount} {zone.cliffCount === 1 ? 'step' : 'steps'}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="cliff-driver-panel">
                <h5>What is driving this cliff?</h5>
                {zone.dominantDrivers.length ? (
                  <div className="cliff-driver-list">
                    {zone.dominantDrivers.slice(0, 3).map((driver) => (
                      <div key={`${zone.id}-${driver.key}`} className="cliff-driver">
                        <span className="cliff-driver-label">
                          {driver.label}
                          {driver.occurrences > 1 ? ` (${driver.occurrences} hits)` : ''}
                        </span>
                        {' '}
                        <span className="cliff-driver-impact">
                          {formatCurrency(driver.totalImpactAnnual)}/yr
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="cliff-card-copy">
                    No single dominant driver was identified for this zone.
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default CliffInsights

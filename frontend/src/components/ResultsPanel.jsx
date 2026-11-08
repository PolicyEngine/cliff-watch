import { useState } from 'react'
import BenefitChart from './BenefitChart'
import CliffInsights from './CliffInsights'
import { formatCurrency } from '../dataLookup'
import { countyContext, countyDraftValue } from '../utils/countyContext'
import { householdStateName, householdSummary } from '../utils/householdSummary'
import { buildShareUrl } from '../utils/urlState'

function copyTextFallback(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy command was not accepted.')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch (err) {
    console.warn('Clipboard API write failed; trying fallback copy.', err)
  }

  copyTextFallback(text)
}

function ShareButton({ inputs }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const shareUrl = buildShareUrl(inputs)

  const handleClick = async () => {
    try {
      await copyTextToClipboard(shareUrl)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.error('Clipboard write failed', err)
      setCopyFailed(true)
      setCopied(false)
      setTimeout(() => setCopyFailed(false), 1800)
    }
  }

  return (
    <div className="share-link-control">
      <button
        type="button"
        className="share-link-btn"
        onClick={handleClick}
        title="Copy a link that reproduces this scenario"
      >
        {copied ? 'Link copied' : copyFailed ? 'Copy failed' : 'Copy share link'}
      </button>
      {copyFailed ? (
        <input
          className="share-link-fallback"
          type="text"
          readOnly
          value={shareUrl}
          aria-label="Share link"
          onFocus={(event) => event.target.select()}
        />
      ) : null}
    </div>
  )
}

function CountyNote({ context, location, onCountyChange }) {
  if (!context.note) return null

  return (
    <div className="county-note">
      <p className="chart-note">{context.note}</p>
      {context.options.length > 1 && (
        <div className="form-group county-picker">
          <label htmlFor="county-picker">County</label>
          <select
            id="county-picker"
            value={context.selected}
            onChange={(event) => onCountyChange(countyDraftValue(event.target.value, location))}
          >
            {context.options.map((option) => (
              <option key={option.code} value={option.code}>{option.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
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
  onCountyChange,
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

  const location = seriesData?.location
  const county = countyContext(location, householdStateName(inputs, metadata))

  return (
    <section className="results-panel">
      <div className="charts-grid">
        <div className="chart-container full-width">
          <div className="chart-header-row">
            <h3>Cliff chart</h3>
            <ShareButton inputs={inputs} />
          </div>
          <p className="chart-subtitle">
            {householdSummary(inputs, metadata, county.countyName)}
          </p>
          {seriesData ? (
            <>
              <CountyNote
                context={county}
                location={location}
                onCountyChange={onCountyChange}
              />
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
                metadata={metadata}
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
                metadata={metadata}
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

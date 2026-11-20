import { useEffect, useRef, useState } from 'react'
import { formatCurrency, getZipState } from '../dataLookup'
import { drawCliffWatchSample } from '../wizard/sampleHousehold'

const dollars = amount => formatCurrency(amount, Number.isInteger(amount) ? 0 : 2)
const participation = {
  all: 'All selectable programs start turned on.',
  none: 'All selectable programs start turned off.',
  custom: 'Program selection starts with the calculator’s custom defaults.',
}

export function SampleDetails({ sample, metadata }) {
  const state = metadata.states?.find(option => option.code === sample.draft.state)?.name || sample.draft.state
  const omitted = sample.nonwageIncome.filter(item => !item.included)
  return (
    <div className="sample-details">
      <p role="status">
        Sample household from {state} in PolicyEngine’s {sample.provenance.year} synthetic US population.
        {sample.exampleZip && ` The sample catalog supplies the state. The chart uses example ZIP ${sample.exampleZip}.`}
        {' '}CliffWatch applies {metadata.year} rules to the original {sample.provenance.year} dollar amounts.
      </p>
      {omitted.length > 0 && (
        <p>
          The starting scenario left out {omitted.map(item => {
            const person = sample.draft.people.find(member => member.id === item.personId)
            return `${dollars(item.amount)} in ${item.label} (age ${person.age})`
          }).join(', ')}. CliffWatch accepts positive nonwage income for Adult 1 only.
        </p>
      )}
      <details>
        <summary>Source income and calculation assumptions</summary>
        <p>{participation[metadata.defaults?.programs_mode || 'all']}</p>
        <ul>
          {sample.draft.people.map(person => (
            <li key={person.id}>
              {person.kind === 'adult' ? 'Adult' : 'Dependent'}, age {person.age}
              {person.isFullTimeStudent && ' · full-time student'}
              {person.isDisabled && ' · has a disability'}
              {' · '}{dollars(person.employmentIncome || 0)} annual wages in {sample.provenance.year} dollars
              {sample.nonwageIncome.filter(item => item.included && item.personId === person.id).map(item =>
                <span key={item.label}> · {dollars(item.amount)} in {item.label}</span>
              )}
            </li>
          ))}
        </ul>
        <p>
          The weighted catalog contains {sample.provenance.drawsPerState || 32} draws per state and DC from {sample.provenance.dataset} ({sample.provenance.buildId}). CliffWatch varies Adult 1’s wages and holds other wages fixed.
          Expenses and unlisted income start at zero.
        </p>
        <a href={sample.provenance.url}>Source dataset and release</a>
      </details>
    </div>
  )
}

export default function SampleHousehold({
  metadata, draft, sample, filter, setFilter, onSample, onEdit,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const request = useRef(0)
  const zipState = sample?.exampleZip ? null : getZipState(draft.zip)
  const stateCode = zipState || (filter ?? (sample ? '' : draft.state)) || ''

  // An edit, a reset, a change of pool or leaving this step supersedes a pending draw.
  useEffect(() => {
    setLoading(false)
    setError(false)
    return () => { request.current += 1 }
  }, [draft, filter])

  async function draw() {
    const id = ++request.current
    setLoading(true)
    setError(false)
    try {
      const next = await drawCliffWatchSample({
        stateCode: stateCode || undefined,
        excludeId: sample?.id,
      })
      if (id === request.current) {
        if (filter === null) setFilter(stateCode)
        onSample(next)
      }
    } catch {
      if (id === request.current) setError(true)
    } finally {
      if (id === request.current) setLoading(false)
    }
  }
  return (
    <div className="sample-household" aria-busy={loading}>
      <div className="sample-controls">
        <button type="button" className="reset-btn" disabled={loading} onClick={draw}>
          {loading ? 'Loading sample…' : sample ? 'Draw another household' : 'Try a sample household'}
        </button>
        <label className="sample-filter">{zipState ? 'Sample state from ZIP' : 'Sample from'}
          <select
            value={stateCode}
            disabled={Boolean(zipState)}
            onChange={event => setFilter(event.target.value)}
          >
            <option value="">Any state</option>
            {metadata.states?.map(state => <option key={state.code} value={state.code}>{state.name}</option>)}
          </select>
        </label>
        {onEdit && <button type="button" className="reset-btn" onClick={onEdit}>Edit household</button>}
      </div>
      {error && <p role="alert">No sample could be loaded. Try again or enter the household manually.</p>}
      {sample && <SampleDetails sample={sample} metadata={metadata} />}
    </div>
  )
}

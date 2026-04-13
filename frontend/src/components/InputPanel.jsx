import { useMemo } from 'react'

function InfoTooltip({ text }) {
  return (
    <span className="info-tooltip-wrapper">
      <span className="info-tooltip-icon">i</span>
      <span className="info-tooltip-text">{text}</span>
    </span>
  )
}

function InputPanel({ metadata, inputs, loading, onCalculate, onChange, onReset }) {
  const people = inputs?.people || []
  const adultCount = people.filter((person) => person.kind === 'adult').length

  const rowMeta = useMemo(() => {
    let adultCount = 0
    let dependantCount = 0

    return people.map((person) => {
      if (person.kind === 'child') {
        dependantCount += 1
        return {
          label: `Dependant ${dependantCount}`,
          isManagedSpouse: false,
        }
      }

      adultCount += 1
      return {
        label: adultCount === 2
          ? 'Adult 2 (spouse)'
          : `Adult ${adultCount}`,
      }
    })
  }, [people])

  const updatePerson = (index, partial) => {
    onChange({
      people: people.map((person, currentIndex) => (
        currentIndex === index
          ? { ...person, ...partial }
          : person
      )),
    })
  }

  const addPerson = (kind) => {
    if (kind === 'adult') {
      if (adultCount >= 2) {
        return
      }

      const lastAdultIndex = people.reduce((lastIndex, person, index) => (
        person.kind === 'adult' ? index : lastIndex
      ), -1)

      const nextAdult = { kind, age: 30, is_pregnant: false }
      const nextPeople = [...people]
      nextPeople.splice(lastAdultIndex + 1, 0, nextAdult)

      onChange({
        people: nextPeople,
      })
      return
    }

    onChange({
      people: [
        ...people,
        { kind, age: kind === 'adult' ? 30 : 6, is_pregnant: false },
      ],
    })
  }

  const removePerson = (index) => {
    onChange({
      people: people.filter((_, currentIndex) => currentIndex !== index),
    })
  }

  if (!metadata || !inputs) {
    return (
      <section className="input-panel">
        <h2>Household information</h2>
        <div className="loading">Loading calculator controls...</div>
      </section>
    )
  }

  return (
    <section className="input-panel">
      <h2>Household information</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onCalculate()
        }}
      >
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="state">State</label>
            <select
              id="state"
              value={inputs.state}
              onChange={(event) => onChange({ state: event.target.value })}
            >
              {metadata.states.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="earned_income_yearly">
              Earned income ($/year)
              <InfoTooltip text="The first adult is treated as the primary earner. If you add a second adult, the calculator treats the two adults as a married tax unit." />
            </label>
            <input
              type="number"
              id="earned_income_yearly"
              min="0"
              step="1000"
              value={inputs.earned_income_yearly}
              onChange={(event) => onChange({ earned_income_yearly: Number(event.target.value) || 0 })}
            />
            <small>Used for all tax and benefit calculations in this scenario.</small>
          </div>
        </div>

        <div className="member-section">
          <div className="member-section-header">
            <label>
              Household members
              <InfoTooltip text="Add up to two adults, then add any other household members as dependants. Dependants can be children or adults. Pregnancy can be marked for adults and may affect WIC, Medicaid, and related eligibility." />
            </label>
            <div className="member-actions-inline">
              <button
                type="button"
                className="member-add-btn"
                onClick={() => addPerson('adult')}
                disabled={adultCount >= 2}
                title={adultCount >= 2 ? 'This calculator supports up to two adults in the tax unit.' : 'Add adult'}
              >
                Add adult
              </button>
              <button type="button" className="member-add-btn" onClick={() => addPerson('child')}>
                Add dependant
              </button>
            </div>
          </div>

          <div className="member-list">
            {people.map((person, index) => (
              <div key={`member-${index}`} className="member-row">
                <div className="member-row-title">{rowMeta[index]?.label}</div>
                <div className="member-row-fields">
                  <input
                    type="number"
                    aria-label={`${rowMeta[index]?.label || 'Household member'} age`}
                    placeholder="Age"
                    min="0"
                    max="120"
                    step="1"
                    value={person.age}
                    onChange={(event) => updatePerson(index, { age: Number(event.target.value) || 0 })}
                  />

                  {person.kind === 'adult' ? (
                    <label className="member-checkbox-label">
                      <input
                        type="checkbox"
                        checked={Boolean(person.is_pregnant)}
                        onChange={(event) => updatePerson(index, { is_pregnant: event.target.checked })}
                      />
                      <span>Pregnant</span>
                    </label>
                  ) : (
                    <span className="member-row-spacer" aria-hidden="true" />
                  )}

                  <button
                    type="button"
                    className="member-remove-btn"
                    onClick={() => removePerson(index)}
                    aria-label={`Remove ${rowMeta[index]?.label || 'household member'}`}
                    title={`Remove ${rowMeta[index]?.label || 'household member'}`}
                    disabled={
                      person.kind === 'adult' && adultCount <= 1
                    }
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 10h2v8H7v-8Zm-1 10h12l1-13H5l1 13Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <small>
            Tax filing status is inferred from the household you enter. Up to two adults are treated as the tax unit, and any other household members are treated as dependants.
          </small>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="reset-btn"
            onClick={onReset}
          >
            Reset
          </button>
          <button
            type="submit"
            className="calculate-btn"
            disabled={loading}
          >
            {loading ? 'Calculating...' : 'Calculate benefits'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default InputPanel

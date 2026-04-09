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

  const memberLabels = useMemo(() => {
    let adultCount = 0
    let childCount = 0

    return people.map((person) => {
      if (person.kind === 'child') {
        childCount += 1
        return `Child ${childCount}`
      }

      adultCount += 1
      return `Adult ${adultCount}`
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
    onChange({
      people: [
        ...people,
        { kind, age: kind === 'adult' ? 30 : 6 },
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
              <InfoTooltip text="The first adult in the household is treated as the primary earner. A second adult is treated as a spouse in the same household unit." />
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
              <InfoTooltip text="Add each person individually with a type and age. This replaces the old household-type dropdown so the calculator can model the actual family ages you enter." />
            </label>
            <div className="member-actions-inline">
              <button type="button" className="member-add-btn" onClick={() => addPerson('adult')}>
                Add adult
              </button>
              <button type="button" className="member-add-btn" onClick={() => addPerson('child')}>
                Add child
              </button>
            </div>
          </div>

          <div className="member-list">
            {people.map((person, index) => (
              <div key={`member-${index}`} className="member-row">
                <div className="member-row-title">{memberLabels[index]}</div>
                <div className="member-row-fields">
                  <select
                    value={person.kind}
                    onChange={(event) => updatePerson(index, { kind: event.target.value })}
                  >
                    <option value="adult">Adult</option>
                    <option value="child">Child</option>
                  </select>

                  <input
                    type="number"
                    min="0"
                    max="120"
                    step="1"
                    value={person.age}
                    onChange={(event) => updatePerson(index, { age: Number(event.target.value) || 0 })}
                  />

                  <button
                    type="button"
                    className="member-remove-btn"
                    onClick={() => removePerson(index)}
                    disabled={people.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <small>
            At least one adult is required. Adults beyond the second are modeled as additional household members in the same household unit.
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

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
    let dependentCount = 0

    return people.map((person) => {
      if (person.kind === 'child') {
        dependentCount += 1
        return {
          label: `Dependent ${dependentCount}`,
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

  const adultMembers = people
    .map((person, index) => ({ person, index, label: rowMeta[index]?.label || `Adult ${index + 1}` }))
    .filter(({ person }) => person.kind === 'adult')

  const dependentMembers = people
    .map((person, index) => ({ person, index, label: rowMeta[index]?.label || `Dependent ${index + 1}` }))
    .filter(({ person }) => person.kind === 'child')

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
        <div className="form-grid form-grid--single">
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
        </div>

        <div className="member-section">
          <div className="member-section-header">
            <label>
              Household members
              <InfoTooltip text="Tax filing status is inferred from the household you enter. Add up to two adults, then add any other household members as dependents. Dependents can be children or adults. Pregnancy can be marked for adults and may affect WIC, Medicaid, and related eligibility." />
            </label>
          </div>

          <div className="member-layout">
            <div className="member-subsection">
              <div className="member-subsection-header">
                <div>
                  <div className="member-subsection-title">Adults</div>
                  <div className="member-subsection-copy">
                    {adultCount === 1
                      ? '1 adult in the tax unit.'
                      : 'Up to two adults in the tax unit.'}
                  </div>
                </div>
                <button
                  type="button"
                  className="member-add-btn"
                  onClick={() => addPerson('adult')}
                  disabled={adultCount >= 2}
                  title={adultCount >= 2 ? 'This calculator supports up to two adults in the tax unit.' : 'Add adult'}
                >
                  Add adult
                </button>
              </div>

              <div className="adult-card-grid">
                {adultMembers.map(({ person, index, label }) => (
                  <div key={`adult-${index}`} className="adult-card">
                    <div className="adult-card-header">
                      <div className="adult-card-title">{label}</div>
                      <button
                        type="button"
                        className="member-chip-remove"
                        onClick={() => removePerson(index)}
                        aria-label={`Remove ${label}`}
                        title={`Remove ${label}`}
                        disabled={adultCount <= 1}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="adult-card-fields">
                      <label className="compact-field">
                        <span>Age</span>
                        <input
                          type="number"
                          aria-label={`${label} age`}
                          min="0"
                          max="120"
                          step="1"
                          value={person.age}
                          onChange={(event) => updatePerson(index, { age: Number(event.target.value) || 0 })}
                        />
                      </label>

                      <label className="member-checkbox-label member-checkbox-label--card">
                        <input
                          type="checkbox"
                          checked={Boolean(person.is_pregnant)}
                          onChange={(event) => updatePerson(index, { is_pregnant: event.target.checked })}
                        />
                        <span>Pregnant</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="member-subsection">
              <div className="member-subsection-header">
                <div>
                  <div className="member-subsection-title">Dependents</div>
                  <div className="member-subsection-copy">
                    {dependentMembers.length === 0
                      ? 'No dependents added.'
                      : `${dependentMembers.length} ${dependentMembers.length === 1 ? 'dependent' : 'dependents'}`}
                  </div>
                </div>
                <button type="button" className="member-add-btn" onClick={() => addPerson('child')}>
                  Add dependent
                </button>
              </div>

              {dependentMembers.length > 0 ? (
                <div className="dependent-chip-grid">
                  {dependentMembers.map(({ person, index, label }) => (
                    <div key={`dependent-${index}`} className="dependent-chip">
                      <label className="compact-field compact-field--dependent">
                        <span>{label}</span>
                        <input
                          type="number"
                          aria-label={`${label} age`}
                          min="0"
                          max="120"
                          step="1"
                          value={person.age}
                          onChange={(event) => updatePerson(index, { age: Number(event.target.value) || 0 })}
                        />
                      </label>
                      <button
                        type="button"
                        className="member-chip-remove"
                        onClick={() => removePerson(index)}
                        aria-label={`Remove ${label}`}
                        title={`Remove ${label}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="member-empty-state">
                  <div className="member-empty-state-title">No dependents yet</div>
                  <div className="member-empty-state-copy">Add a dependent to include children or other household members in the household.</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <details className="advanced-panel">
          <summary className="advanced-summary">Advanced options</summary>
          <div className="advanced-grid">
            <div className="form-group">
              <label htmlFor="chart_max_earned_income">
                Chart max wages and salaries ($/year)
                <InfoTooltip text="Optional. Use this if you want to look farther up the income range than the default chart window." />
              </label>
              <input
                type="number"
                id="chart_max_earned_income"
                min="10000"
                step="10000"
                value={inputs.chart_max_earned_income}
                onChange={(event) => onChange({ chart_max_earned_income: Number(event.target.value) || 100000 })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="childcare_expenses">
                Child care expenses ($/year)
                <InfoTooltip text="Annual out-of-pocket child care costs. Feeds SNAP's dependent care deduction and CCDF subsidy eligibility. CCDF subsidies are currently modeled for CA, CO, DE, MA, ME, NE, NH, PA, RI, and VT." />
              </label>
              <input
                type="number"
                id="childcare_expenses"
                min="0"
                step="500"
                value={inputs.childcare_expenses ?? 0}
                onChange={(event) => onChange({ childcare_expenses: Number(event.target.value) || 0 })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="rent_annual">
                Rent ($/year)
                <InfoTooltip text="Annual rent. Feeds SNAP's excess shelter deduction, which can meaningfully raise SNAP for households with high rent relative to income." />
              </label>
              <input
                type="number"
                id="rent_annual"
                min="0"
                step="500"
                value={inputs.rent_annual ?? 0}
                onChange={(event) => onChange({ rent_annual: Number(event.target.value) || 0 })}
              />
            </div>
          </div>
        </details>

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
            {loading ? 'Building chart...' : 'Find cliffs'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default InputPanel

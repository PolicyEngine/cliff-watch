import { useMemo } from 'react'
import { applyStateProgramLabels } from '../utils/programLabels.js'

const PROGRAM_MODES = [
  { key: 'all', label: 'All' },
  { key: 'none', label: 'None' },
  { key: 'custom', label: 'Custom' },
]

const PERSON_FLAGS = [
  { key: 'is_disabled', label: 'Disabled' },
  { key: 'is_blind', label: 'Blind' },
  { key: 'is_full_time_student', label: 'Student' },
  { key: 'is_incapable_of_self_care', label: 'Needs care' },
]

const OTHER_INCOME_FIELDS = [
  { key: 'self_employment_income_annual', label: 'Self-employment' },
  { key: 'child_support_annual', label: 'Child support' },
  { key: 'taxable_interest_income_annual', label: 'Interest' },
  { key: 'dividend_income_annual', label: 'Dividends' },
  { key: 'rental_income_annual', label: 'Rental income' },
  { key: 'unemployment_compensation_annual', label: 'Unemployment' },
  { key: 'pension_income_annual', label: 'Pension' },
  { key: 'social_security_annual', label: 'Social Security' },
  { key: 'miscellaneous_income_annual', label: 'Other income' },
]

const EXPENSE_FIELDS = [
  { key: 'childcare_expenses', label: 'Child care' },
  { key: 'rent_annual', label: 'Rent or mortgage' },
  { key: 'utility_expense_annual', label: 'Utilities' },
  { key: 'food_expense_annual', label: 'Food' },
  { key: 'transportation_expense_annual', label: 'Transportation' },
  { key: 'health_insurance_premium_annual', label: 'Health premiums' },
  { key: 'technology_expense_annual', label: 'Phone and internet' },
  { key: 'debt_payment_annual', label: 'Debt payments' },
  { key: 'education_expense_annual', label: 'Education and training' },
  { key: 'other_expense_annual', label: 'Other expenses' },
]

const newPerson = (kind) => ({
  kind,
  age: kind === 'adult' ? 30 : 6,
  is_pregnant: false,
  is_disabled: false,
  is_blind: false,
  is_full_time_student: false,
  is_incapable_of_self_care: false,
  earned_income: 0,
  ssi_amount: 0,
  ssdi_amount: 0,
})

function InfoTooltip({ text }) {
  return (
    <span className="info-tooltip-wrapper">
      <span className="info-tooltip-icon">i</span>
      <span className="info-tooltip-text">{text}</span>
    </span>
  )
}

function CurrencyField({
  id,
  label,
  value,
  onChange,
  compact = false,
  step = 500,
  tooltip,
}) {
  const input = (
    <input
      type="number"
      id={id}
      min="0"
      step={step}
      value={value ?? 0}
      onChange={(event) => onChange(Number(event.target.value) || 0)}
    />
  )

  if (compact) {
    return (
      <label className="compact-field">
        <span>{label}</span>
        {input}
      </label>
    )
  }

  return (
    <div className="form-group">
      <label htmlFor={id}>
        {label} ($/year)
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </label>
      {input}
    </div>
  )
}

function PersonFlagGrid({ person, updatePerson }) {
  return (
    <div className="person-flag-grid">
      {PERSON_FLAGS.map((flag) => (
        <label key={flag.key} className="member-checkbox-label member-checkbox-label--compact">
          <input
            type="checkbox"
            checked={Boolean(person[flag.key])}
            onChange={(event) => updatePerson({ [flag.key]: event.target.checked })}
          />
          <span>{flag.label}</span>
        </label>
      ))}
    </div>
  )
}

function InputPanel({ metadata, inputs, loading, onCalculate, onChange, onReset }) {
  const people = inputs?.people || []
  const adultCount = people.filter((person) => person.kind === 'adult').length
  const dependentCount = people.filter((person) => person.kind === 'child').length
  const maxAdults = Math.max(1, Number(metadata?.defaults?.max_adults) || 6)
  const maxDependents = Math.max(0, Number(metadata?.defaults?.max_dependents) || 6)
  const baseProgramOptions = metadata?.public_assistance_programs || metadata?.programs || []
  const programOptions = useMemo(
    () => applyStateProgramLabels(baseProgramOptions, metadata, inputs?.state),
    [baseProgramOptions, metadata, inputs?.state],
  )
  const selectedPrograms = new Set(inputs?.selected_programs || programOptions.map((program) => program.key))

  const rowMeta = useMemo(() => {
    let adultOrdinal = 0
    let dependentOrdinal = 0

    return people.map((person) => {
      if (person.kind === 'child') {
        dependentOrdinal += 1
        return {
          ordinal: dependentOrdinal,
          label: `Dependent ${dependentOrdinal}`,
        }
      }

      adultOrdinal += 1
      return {
        ordinal: adultOrdinal,
        label: adultOrdinal === 1
          ? 'Adult 1'
          : adultOrdinal === 2
            ? 'Adult 2'
            : `Adult ${adultOrdinal}`,
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
      if (adultCount >= maxAdults) return

      const lastAdultIndex = people.reduce((lastIndex, person, index) => (
        person.kind === 'adult' ? index : lastIndex
      ), -1)

      const nextPeople = [...people]
      nextPeople.splice(lastAdultIndex + 1, 0, newPerson('adult'))
      onChange({ people: nextPeople })
      return
    }

    if (dependentCount >= maxDependents) return
    onChange({ people: [...people, newPerson('child')] })
  }

  const removePerson = (index) => {
    onChange({
      people: people.filter((_, currentIndex) => currentIndex !== index),
    })
  }

  const toggleProgram = (key) => {
    const next = new Set(selectedPrograms)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    onChange({ selected_programs: programOptions.map((program) => program.key).filter((programKey) => next.has(programKey)) })
  }

  const adultMembers = people
    .map((person, index) => ({ person, index, meta: rowMeta[index] }))
    .filter(({ person }) => person.kind === 'adult')

  const dependentMembers = people
    .map((person, index) => ({ person, index, meta: rowMeta[index] }))
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
        <div className="form-grid form-grid--three">
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
            <label htmlFor="county">County</label>
            <input
              id="county"
              type="text"
              value={inputs.county || ''}
              onChange={(event) => onChange({ county: event.target.value })}
              placeholder="Optional"
            />
          </div>

          <div className="form-group">
            <label htmlFor="filing_status">Tax filing status</label>
            <select
              id="filing_status"
              value={inputs.filing_status}
              onChange={(event) => onChange({ filing_status: event.target.value })}
            >
              {metadata.filing_statuses.map((status) => (
                <option key={status.code} value={status.code}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="member-section">
          <div className="member-section-header">
            <label>
              Household members
              <InfoTooltip text={`Add up to ${maxAdults} adults and ${maxDependents} dependents. Adult 1 is the wage axis on the chart; other adult earnings stay fixed.`} />
            </label>
          </div>

          <div className="member-layout">
            <div className="member-subsection">
              <div className="member-subsection-header">
                <div>
                  <div className="member-subsection-title">Adults</div>
                  <div className="member-subsection-copy">
                    {adultCount} of {maxAdults}
                  </div>
                </div>
                <button
                  type="button"
                  className="member-add-btn"
                  onClick={() => addPerson('adult')}
                  disabled={adultCount >= maxAdults}
                  title={adultCount >= maxAdults ? `This calculator supports up to ${maxAdults} adults.` : 'Add adult'}
                >
                  Add adult
                </button>
              </div>

              <div className="adult-card-grid">
                {adultMembers.map(({ person, index, meta }) => (
                  <div key={`adult-${index}`} className="adult-card">
                    <div className="adult-card-header">
                      <div className="adult-card-title">{meta?.label}</div>
                      <button
                        type="button"
                        className="member-chip-remove"
                        onClick={() => removePerson(index)}
                        aria-label={`Remove ${meta?.label}`}
                        title={`Remove ${meta?.label}`}
                        disabled={adultCount <= 1}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="person-card-fields">
                      <label className="compact-field">
                        <span>Age</span>
                        <input
                          type="number"
                          aria-label={`${meta?.label} age`}
                          min="0"
                          max="120"
                          step="1"
                          value={person.age}
                          onChange={(event) => updatePerson(index, { age: Number(event.target.value) || 0 })}
                        />
                      </label>

                      {meta?.ordinal > 1 ? (
                        <CurrencyField
                          id={`adult-${index}-earned-income`}
                          label="Wages"
                          compact
                          value={person.earned_income}
                          onChange={(value) => updatePerson(index, { earned_income: value })}
                        />
                      ) : null}

                      <CurrencyField
                        id={`adult-${index}-ssi`}
                        label="SSI"
                        compact
                        value={person.ssi_amount}
                        onChange={(value) => updatePerson(index, { ssi_amount: value })}
                      />

                      <CurrencyField
                        id={`adult-${index}-ssdi`}
                        label="SSDI"
                        compact
                        value={person.ssdi_amount}
                        onChange={(value) => updatePerson(index, { ssdi_amount: value })}
                      />
                    </div>

                    <div className="person-option-grid">
                      <label className="member-checkbox-label member-checkbox-label--compact">
                        <input
                          type="checkbox"
                          checked={Boolean(person.is_pregnant)}
                          onChange={(event) => updatePerson(index, { is_pregnant: event.target.checked })}
                        />
                        <span>Pregnant</span>
                      </label>
                      <PersonFlagGrid
                        person={person}
                        updatePerson={(partial) => updatePerson(index, partial)}
                      />
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
                    {dependentCount} of {maxDependents}
                  </div>
                </div>
                <button
                  type="button"
                  className="member-add-btn"
                  onClick={() => addPerson('child')}
                  disabled={dependentCount >= maxDependents}
                  title={dependentCount >= maxDependents ? `This calculator supports up to ${maxDependents} dependents.` : 'Add dependent'}
                >
                  Add dependent
                </button>
              </div>

              {dependentMembers.length > 0 ? (
                <div className="dependent-card-grid">
                  {dependentMembers.map(({ person, index, meta }) => (
                    <div key={`dependent-${index}`} className="dependent-card">
                      <div className="adult-card-header">
                        <div className="adult-card-title">{meta?.label}</div>
                        <button
                          type="button"
                          className="member-chip-remove"
                          onClick={() => removePerson(index)}
                          aria-label={`Remove ${meta?.label}`}
                          title={`Remove ${meta?.label}`}
                        >
                          Remove
                        </button>
                      </div>

                      <div className="person-card-fields person-card-fields--dependent">
                        <label className="compact-field">
                          <span>Age</span>
                          <input
                            type="number"
                            aria-label={`${meta?.label} age`}
                            min="0"
                            max="120"
                            step="1"
                            value={person.age}
                            onChange={(event) => updatePerson(index, { age: Number(event.target.value) || 0 })}
                          />
                        </label>
                        <CurrencyField
                          id={`dependent-${index}-ssi`}
                          label="SSI"
                          compact
                          value={person.ssi_amount}
                          onChange={(value) => updatePerson(index, { ssi_amount: value })}
                        />
                        <CurrencyField
                          id={`dependent-${index}-ssdi`}
                          label="SSDI"
                          compact
                          value={person.ssdi_amount}
                          onChange={(value) => updatePerson(index, { ssdi_amount: value })}
                        />
                      </div>

                      <PersonFlagGrid
                        person={person}
                        updatePerson={(partial) => updatePerson(index, partial)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="member-empty-state">
                  <div className="member-empty-state-title">No dependents yet</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <details className="advanced-panel">
          <summary className="advanced-summary">Advanced inputs</summary>
          <div className="advanced-grid">
            <section className="advanced-section">
              <h3 className="advanced-section-title">Program participation</h3>
              <div className="program-mode-toggle" role="group" aria-label="Program participation">
                {PROGRAM_MODES.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    className={inputs.programs_mode === mode.key ? 'program-mode-button active' : 'program-mode-button'}
                    onClick={() => onChange({ programs_mode: mode.key })}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {inputs.programs_mode === 'custom' ? (
                <div className="program-checkbox-grid">
                  {programOptions.map((program) => (
                    <label key={program.key} className="member-checkbox-label member-checkbox-label--program">
                      <input
                        type="checkbox"
                        checked={selectedPrograms.has(program.key)}
                        onChange={() => toggleProgram(program.key)}
                      />
                      <span>{program.label}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="advanced-section">
              <h3 className="advanced-section-title">Scenario</h3>
              <div className="advanced-field-grid advanced-field-grid--two">
                <CurrencyField
                  id="chart_max_earned_income"
                  label="Chart max wages"
                  step={10000}
                  value={inputs.chart_max_earned_income}
                  onChange={(value) => onChange({ chart_max_earned_income: value || 100000 })}
                  tooltip="Optional upper bound for the wage chart."
                />
                <div className="form-group checkbox-form-group">
                  <label className="member-checkbox-label member-checkbox-label--standalone">
                    <input
                      type="checkbox"
                      checked={Boolean(inputs.has_employer_health_insurance)}
                      onChange={(event) => onChange({ has_employer_health_insurance: event.target.checked })}
                    />
                    <span>Employer health insurance offer</span>
                  </label>
                </div>
              </div>
            </section>

            <section className="advanced-section">
              <h3 className="advanced-section-title">Other income and assets</h3>
              <div className="advanced-field-grid">
                {OTHER_INCOME_FIELDS.map((field) => (
                  <CurrencyField
                    key={field.key}
                    id={field.key}
                    label={field.label}
                    value={inputs[field.key]}
                    onChange={(value) => onChange({ [field.key]: value })}
                  />
                ))}
                <CurrencyField
                  id="liquid_assets"
                  label="Checking and savings"
                  value={inputs.liquid_assets}
                  onChange={(value) => onChange({ liquid_assets: value })}
                  tooltip="Liquid assets used by asset-tested programs such as SNAP where modeled."
                />
              </div>
            </section>

            <section className="advanced-section">
              <h3 className="advanced-section-title">Budget costs</h3>
              <div className="advanced-field-grid">
                {EXPENSE_FIELDS.map((field) => (
                  <CurrencyField
                    key={field.key}
                    id={field.key}
                    label={field.label}
                    value={inputs[field.key]}
                    onChange={(value) => onChange({ [field.key]: value })}
                  />
                ))}
              </div>
            </section>
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

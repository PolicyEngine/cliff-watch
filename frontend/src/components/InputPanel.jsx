import { useMemo, useState } from 'react'
import {
  hasCompleteRequiredInputs,
  hasValidAge,
} from '../dataLookup.js'
import { applyStateProgramLabels } from '../utils/programLabels.js'
import { maxAdultsForMetadata } from '../utils/filingStatus.js'
import {
  WizardOptionCard,
  WizardProgress,
  applyMaritalStatusChange,
  addPerson as addPersonToDraft,
  getCountiesByState,
  removePerson as removePersonFromDraft,
  updatePerson as updatePersonInDraft,
} from 'policyengine-household-wizard'
import {
  combineDraftAndScenarioToInputs,
  inputsToDraft,
} from '../wizard/cliffWatchDraft.js'

const PERSON_FIELD_TO_DRAFT_KEY = {
  age: 'age',
  is_pregnant: 'isPregnant',
  is_disabled: 'isDisabled',
  is_blind: 'isBlind',
  is_full_time_student: 'isFullTimeStudent',
  is_incapable_of_self_care: 'needsCare',
  earned_income: 'employmentIncome',
  ssi_amount: 'ssiAmount',
  ssdi_amount: 'ssdiAmount',
}

function mapLegacyPersonPartial(partial) {
  const out = {}
  for (const [legacy, value] of Object.entries(partial)) {
    const draftKey = PERSON_FIELD_TO_DRAFT_KEY[legacy] || legacy
    out[draftKey] = value
  }
  return out
}

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

const WIZARD_STEPS = [
  { id: 'location', label: 'Location' },
  { id: 'marital', label: 'Marital status' },
  { id: 'adults', label: 'Adults' },
  { id: 'dependents', label: 'Dependents' },
  { id: 'review', label: 'Review' },
]

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

function InputPanel({
  metadata,
  draft,
  scenario,
  loading,
  onCalculate,
  onDraftChange,
  onScenarioChange,
  onReset,
}) {
  const [currentStepId, setCurrentStepId] = useState('location')
  const inputs = useMemo(
    () => (metadata && draft && scenario
      ? combineDraftAndScenarioToInputs(draft, scenario, metadata)
      : null),
    [draft, scenario, metadata],
  )
  const people = inputs?.people || []
  const maritalStatus = inputs?.marital_status || ''
  const isMarried = maritalStatus === 'MARRIED'
  const hasMaritalStatus = maritalStatus === 'UNMARRIED' || maritalStatus === 'MARRIED'
  const adultCount = people.filter((person) => person.kind === 'adult').length
  const dependentCount = people.filter((person) => person.kind === 'child').length
  const canCalculate = hasCompleteRequiredInputs(inputs)
  const currentStepIndex = Math.max(0, WIZARD_STEPS.findIndex((step) => step.id === currentStepId))
  const maxAdults = maxAdultsForMetadata(metadata)
  const maxDependents = Math.max(0, Number(metadata?.defaults?.max_dependents) || 6)
  const baseProgramOptions = metadata?.public_assistance_programs || metadata?.programs || []
  const programOptions = useMemo(
    () => applyStateProgramLabels(baseProgramOptions, metadata, inputs?.state),
    [baseProgramOptions, metadata, inputs?.state],
  )
  const countyOptions = getCountiesByState(inputs?.state || null)
  const countyNameByCode = new Map(countyOptions.map((county) => [county.code, county.name]))
  const countyLabel = inputs?.county
    ? countyNameByCode.get(inputs.county) || inputs.county
    : ''
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
          : adultOrdinal === 2 && isMarried
            ? 'Adult 2 (spouse)'
            : adultOrdinal === 2
            ? 'Adult 2'
            : `Adult ${adultOrdinal}`,
      }
    })
  }, [isMarried, people])

  const setStateCode = (code) => {
    onDraftChange({ ...draft, state: code || null })
  }

  const setCounty = (code) => {
    onDraftChange({ ...draft, county: code || null })
  }

  const updatePerson = (index, partial) => {
    const target = draft.people[index]
    if (!target) return
    onDraftChange(updatePersonInDraft(draft, target.id, mapLegacyPersonPartial(partial)))
  }

  const addPerson = (kind) => {
    if (kind === 'adult') {
      if (adultCount >= maxAdults) return
      onDraftChange(addPersonToDraft(draft, 'adult'))
      return
    }
    if (dependentCount >= maxDependents) return
    onDraftChange(addPersonToDraft(draft, 'dependent'))
  }

  const removePerson = (index) => {
    const target = draft.people[index]
    if (!target) return
    onDraftChange(removePersonFromDraft(draft, target.id))
  }

  const toggleProgram = (key) => {
    const next = new Set(selectedPrograms)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    onScenarioChange({
      selected_programs: programOptions
        .map((program) => program.key)
        .filter((programKey) => next.has(programKey)),
    })
  }

  const adultMembers = people
    .map((person, index) => ({ person, index, meta: rowMeta[index] }))
    .filter(({ person }) => person.kind === 'adult')

  const dependentMembers = people
    .map((person, index) => ({ person, index, meta: rowMeta[index] }))
    .filter(({ person }) => person.kind === 'child')

  const locationStepComplete = Boolean(inputs?.state)
  const adultStepComplete = adultMembers.length > 0
    && adultMembers.every(({ person }) => hasValidAge(person.age))
  const dependentStepComplete = dependentMembers.every(({ person }) => hasValidAge(person.age))
  const currentStepComplete = {
    location: locationStepComplete,
    marital: hasMaritalStatus,
    adults: adultStepComplete,
    dependents: dependentStepComplete,
    review: canCalculate,
  }[currentStepId]
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex >= WIZARD_STEPS.length - 1

  const goToStep = (stepId) => {
    if (WIZARD_STEPS.some((step) => step.id === stepId)) {
      setCurrentStepId(stepId)
    }
  }

  const goBack = () => {
    if (isFirstStep) return
    setCurrentStepId(WIZARD_STEPS[currentStepIndex - 1].id)
  }

  const goNext = () => {
    if (isLastStep) return
    setCurrentStepId(WIZARD_STEPS[currentStepIndex + 1].id)
  }

  const chooseMaritalStatus = (nextMaritalStatus) => {
    const target = nextMaritalStatus === 'MARRIED' ? 'married' : 'single'
    let next = applyMaritalStatusChange(draft, target)
    // Ensure invariant: married → 2 adults, single → at least 1 adult.
    // policyengine-household-wizard@0.1.0's applyMaritalStatusChange only
    // adds a single adult when going 0 → married; patch in a follow-up
    // (https://github.com/PolicyEngine/policyengine-household-wizard/issues).
    if (target === 'married') {
      while (next.people.filter((p) => p.kind === 'adult').length < 2) {
        next = addPersonToDraft(next, 'adult')
      }
    } else if (target === 'single') {
      while (next.people.filter((p) => p.kind === 'adult').length < 1) {
        next = addPersonToDraft(next, 'adult')
      }
    }
    onDraftChange(next)
    goToStep('adults')
  }

  const chooseNoDependents = () => {
    const withoutDeps = {
      ...draft,
      people: draft.people.filter((person) => person.kind !== 'dependent'),
    }
    onDraftChange(withoutDeps)
    goToStep('review')
  }

  const resetWizard = () => {
    onReset()
    goToStep('location')
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
      <WizardProgress
        totalSteps={WIZARD_STEPS.length}
        currentStepIndex={currentStepIndex}
        currentStepLabel={WIZARD_STEPS[currentStepIndex]?.label}
        aria-label="Household setup progress"
      />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!currentStepComplete) return
          if (isLastStep) {
            if (!canCalculate) return
            onCalculate()
            return
          }
          goNext()
        }}
      >
        {currentStepId === 'location' ? (
          <section className="wizard-step">
            <div className="wizard-step-heading">
              <h3>Where does the household live?</h3>
              <p>State is required. County is optional and can refine local assumptions later.</p>
            </div>
            <div className="form-grid form-grid--two">
              <div className="form-group">
                <label htmlFor="state">State</label>
                <select
                  id="state"
                  required
                  value={inputs.state || ''}
                  onChange={(event) => setStateCode(event.target.value)}
                >
                  <option value="" disabled>
                    Select state
                  </option>
                  {metadata.states.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="county">County</label>
                <select
                  id="county"
                  value={inputs.county || ''}
                  onChange={(event) => setCounty(event.target.value)}
                  disabled={!inputs.state}
                >
                  <option value="">
                    {inputs.state ? 'Select county (optional)' : 'Select state first'}
                  </option>
                  {countyOptions.map((county) => (
                    <option key={county.code} value={county.code}>
                      {county.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        ) : null}

        {currentStepId === 'marital' ? (
          <section className="wizard-step">
            <div className="wizard-step-heading">
              <h3>Are you married?</h3>
              <p>We use this to decide whether to include a spouse for tax and benefit rules.</p>
            </div>
            <div className="wizard-option-grid">
              <WizardOptionCard
                selected={maritalStatus === 'UNMARRIED'}
                title="Unmarried"
                description="One tax filer, with head-of-household derived when dependents are present."
                onClick={() => chooseMaritalStatus('UNMARRIED')}
              />
              <WizardOptionCard
                selected={maritalStatus === 'MARRIED'}
                title="Married"
                description="Adds a spouse if needed and models the tax unit as married filing jointly."
                onClick={() => chooseMaritalStatus('MARRIED')}
              />
            </div>
          </section>
        ) : null}

        {currentStepId === 'adults' ? (
          <section className="wizard-step member-section">
            <div className="wizard-step-heading">
              <h3>Who are the adults?</h3>
              <p>Adult 1 is the wage axis on the chart. Other adult earnings stay fixed.</p>
            </div>
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
                          required
                          value={person.age}
                          onChange={(event) => updatePerson(index, { age: event.target.value })}
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
          </section>
        ) : null}

        {currentStepId === 'dependents' ? (
          <section className="wizard-step member-section">
            <div className="wizard-step-heading">
              <h3>Any dependents?</h3>
              <p>Add children or other dependents whose benefits and tax credits should be included.</p>
            </div>
            {dependentMembers.length === 0 ? (
              <div className="wizard-option-grid">
                <WizardOptionCard
                  selected={false}
                  title="No dependents"
                  description="Continue with adults only."
                  onClick={chooseNoDependents}
                />
                <WizardOptionCard
                  selected={false}
                  title="Add a dependent"
                  description="Start with a blank age, then add disability, student, blind, or care needs if relevant."
                  onClick={() => addPerson('child')}
                />
              </div>
            ) : (
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
                            required
                            value={person.age}
                            onChange={(event) => updatePerson(index, { age: event.target.value })}
                          />
                        </label>
                      </div>

                      <PersonFlagGrid
                        person={person}
                        updatePerson={(partial) => updatePerson(index, partial)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : null}

        {currentStepId === 'review' ? (
          <section className="wizard-step">
            <div className="wizard-step-heading">
              <h3>Review and calculate</h3>
              <p>Check the household, adjust optional details if needed, then build the cliff chart.</p>
            </div>

            <div className="wizard-review-grid">
              <button type="button" className="wizard-review-item" onClick={() => goToStep('location')}>
                <span>Location</span>
                <strong>{inputs.state || 'Missing'}{countyLabel ? `, ${countyLabel}` : ''}</strong>
              </button>
              <button type="button" className="wizard-review-item" onClick={() => goToStep('marital')}>
                <span>Marital status</span>
                <strong>{maritalStatus === 'MARRIED' ? 'Married' : maritalStatus === 'UNMARRIED' ? 'Unmarried' : 'Missing'}</strong>
              </button>
              <button type="button" className="wizard-review-item" onClick={() => goToStep('adults')}>
                <span>Adults</span>
                <strong>{adultCount} adult{adultCount === 1 ? '' : 's'}</strong>
              </button>
              <button type="button" className="wizard-review-item" onClick={() => goToStep('dependents')}>
                <span>Dependents</span>
                <strong>{dependentCount} dependent{dependentCount === 1 ? '' : 's'}</strong>
              </button>
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
                        onClick={() => onScenarioChange({ programs_mode: mode.key })}
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
                      onChange={(value) => onScenarioChange({ chart_max_earned_income: value || 100000 })}
                      tooltip="Optional upper bound for the wage chart."
                    />
                    <div className="form-group checkbox-form-group">
                      <label className="member-checkbox-label member-checkbox-label--standalone">
                        <input
                          type="checkbox"
                          checked={Boolean(inputs.has_employer_health_insurance)}
                          onChange={(event) => onScenarioChange({ has_employer_health_insurance: event.target.checked })}
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
                        onChange={(value) => onScenarioChange({ [field.key]: value })}
                      />
                    ))}
                    <CurrencyField
                      id="liquid_assets"
                      label="Checking and savings"
                      value={inputs.liquid_assets}
                      onChange={(value) => onScenarioChange({ liquid_assets: value })}
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
                        onChange={(value) => onScenarioChange({ [field.key]: value })}
                      />
                    ))}
                  </div>
                </section>
              </div>
            </details>
          </section>
        ) : null}

        <div className="form-actions">
          <button
            type="button"
            className="reset-btn"
            onClick={resetWizard}
          >
            Reset
          </button>
          <button
            type="button"
            className="reset-btn"
            onClick={goBack}
            disabled={isFirstStep}
          >
            Back
          </button>
          <button
            type="submit"
            className="calculate-btn"
            disabled={loading || !currentStepComplete}
            title={!currentStepComplete ? 'Complete this step to continue.' : undefined}
          >
            {loading
              ? 'Building chart...'
              : isLastStep
                ? canCalculate ? 'Find cliffs' : 'Complete required fields'
                : 'Continue'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default InputPanel

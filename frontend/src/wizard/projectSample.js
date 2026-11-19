import { hasValidZip } from '../dataLookup'
import { createInitialScenario } from './cliffWatchDraft'
import { EXAMPLE_ZIP_BY_STATE } from './sampleZips'

// Correspond exactly to the person variables in cliff_watch.calculator.HEAD_INCOME_INPUTS.
const nonwageFields = [
  ['selfEmploymentIncome', 'self_employment_income_annual', 'self-employment income'],
  ['socialSecurityIncome', 'social_security_annual', 'Social Security retirement'],
  ['privatePensionIncome', 'pension_income_annual', 'taxable private pension'],
]

export function projectSample(sample, currentDraft, metadata) {
  const { state, maritalStatus, people } = sample.draft
  const keepZip = hasValidZip(currentDraft.zip, state)
  const exampleZip = keepZip ? null : EXAMPLE_ZIP_BY_STATE[state]
  const scenario = createInitialScenario(metadata)
  const nonwageIncome = []
  people.forEach((person, index) => {
    for (const [source, field, label] of nonwageFields) {
      const amount = person[source]
      if (!Number.isFinite(amount) || amount === 0) continue
      // The calculator places these fields on Adult 1 and accepts only positive amounts.
      const included = index === 0 && person.kind === 'adult' && amount > 0
      if (included) scenario[field] = amount
      nonwageIncome.push({ personId: person.id, label, amount, included })
    }
  })
  return {
    draft: {
      state,
      maritalStatus,
      people: people.map(({ id, kind, age, employmentIncome }) => ({ id, kind, age, employmentIncome })),
      year: metadata.year,
      zip: keepZip ? currentDraft.zip : exampleZip,
      county: keepZip ? currentDraft.county : null,
    },
    scenario,
    source: { ...sample, nonwageIncome, exampleZip },
  }
}

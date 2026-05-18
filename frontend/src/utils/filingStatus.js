const MARRIED_FILING_STATUSES = new Set(['JOINT', 'SEPARATE'])

export const newPerson = (kind) => ({
  kind,
  age: '',
  is_pregnant: false,
  is_disabled: false,
  is_blind: false,
  is_full_time_student: false,
  is_incapable_of_self_care: false,
  earned_income: 0,
})

export const maxAdultsForMetadata = (metadata) => (
  Math.max(1, Number(metadata?.defaults?.max_adults) || 6)
)

export function applyMaritalStatusSelection(inputs, maritalStatus, metadata) {
  const people = inputs?.people || []

  if (
    maritalStatus === 'MARRIED'
    && people.filter((person) => person.kind === 'adult').length < 2
    && people.filter((person) => person.kind === 'adult').length < maxAdultsForMetadata(metadata)
  ) {
    const lastAdultIndex = people.reduce((lastIndex, person, index) => (
      person.kind === 'adult' ? index : lastIndex
    ), -1)
    const nextPeople = [...people]
    nextPeople.splice(lastAdultIndex + 1, 0, newPerson('adult'))

    return {
      marital_status: maritalStatus,
      people: nextPeople,
    }
  }

  return { marital_status: maritalStatus }
}

export function applyFilingStatusSelection(inputs, filingStatus, metadata) {
  const people = inputs?.people || []
  const adultCount = people.filter((person) => person.kind === 'adult').length

  if (
    MARRIED_FILING_STATUSES.has(filingStatus)
    && adultCount < 2
    && adultCount < maxAdultsForMetadata(metadata)
  ) {
    const lastAdultIndex = people.reduce((lastIndex, person, index) => (
      person.kind === 'adult' ? index : lastIndex
    ), -1)
    const nextPeople = [...people]
    nextPeople.splice(lastAdultIndex + 1, 0, newPerson('adult'))

    return {
      filing_status: filingStatus,
      people: nextPeople,
    }
  }

  return { filing_status: filingStatus }
}

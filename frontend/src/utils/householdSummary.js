const PERSON_MODIFIERS = [
  { key: 'is_pregnant', singular: 'pregnant', plural: 'pregnant', adultOnly: true },
  { key: 'is_disabled', singular: 'disabled', plural: 'disabled' },
  { key: 'is_blind', singular: 'blind', plural: 'blind' },
  { key: 'is_full_time_student', singular: 'full-time student', plural: 'full-time students' },
  { key: 'is_incapable_of_self_care', singular: 'needs care', plural: 'need care' },
]

const formatCount = (count, singular, plural) => (
  `${count} ${count === 1 ? singular : plural}`
)

function formatModifierCount(count, modifier) {
  return formatCount(count, modifier.singular, modifier.plural)
}

function formatPeopleGroup(people, kind, singular, plural) {
  const group = people.filter((person) => person.kind === kind)
  const modifiers = PERSON_MODIFIERS
    .filter((modifier) => !(modifier.adultOnly && kind !== 'adult'))
    .map((modifier) => {
      const count = group.filter((person) => Boolean(person[modifier.key])).length
      return count > 0 ? formatModifierCount(count, modifier) : null
    })
    .filter(Boolean)

  return [
    formatCount(group.length, singular, plural),
    modifiers.length ? `(${modifiers.join(', ')})` : '',
  ].filter(Boolean).join(' ')
}

export function householdStateName(inputs, metadata) {
  return metadata?.states?.find((state) => state.code === inputs?.state)?.name
    || inputs?.state
    || ''
}

function placeName(stateName, countyName) {
  if (!countyName || countyName === stateName) return stateName
  return stateName ? `${countyName}, ${stateName}` : countyName
}

export function householdSummary(inputs, metadata, countyName = null) {
  const people = inputs?.people || []

  return [
    placeName(householdStateName(inputs, metadata), countyName),
    formatPeopleGroup(people, 'adult', 'adult', 'adults'),
    formatPeopleGroup(people, 'child', 'dependent', 'dependents'),
  ].filter(Boolean).join(' · ')
}

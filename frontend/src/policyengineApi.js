const PE_API_URL = 'https://api.policyengine.org'

const STATE_TANF_VARIABLES = {
  AK: 'ak_atap',
  AL: 'al_tanf',
  AR: 'ar_tea',
  AZ: 'az_tanf',
  CA: 'ca_tanf',
  CO: 'co_tanf',
  CT: 'ct_tfa',
  DC: 'dc_tanf',
  DE: 'de_tanf',
  FL: 'fl_tca',
  GA: 'ga_tanf',
  HI: 'hi_tanf',
  IA: 'ia_fip',
  ID: 'id_tafi',
  IL: 'il_tanf',
  IN: 'in_tanf',
  KS: 'ks_tanf',
  KY: 'ky_ktap',
  LA: 'la_fitap',
  MA: 'ma_tafdc',
  MD: 'md_tca',
  ME: 'me_tanf',
  MI: 'mi_fip',
  MN: 'mn_mfip',
  MO: 'mo_tanf',
  MS: 'ms_tanf',
  MT: 'mt_tanf',
  NC: 'nc_tanf',
  ND: 'nd_tanf',
  NE: 'ne_adc',
  NH: 'nh_fanf',
  NJ: 'nj_wfnj',
  NM: 'nm_works',
  NV: 'nv_tanf',
  NY: 'ny_tanf',
  OH: 'oh_owf',
  OK: 'ok_tanf',
  OR: 'or_tanf',
  PA: 'pa_tanf',
  RI: 'ri_works',
  SC: 'sc_tanf',
  SD: 'sd_tanf',
  TN: 'tn_ff',
  TX: 'tx_tanf',
  UT: 'ut_fep',
  VA: 'va_tanf',
  VT: 'vt_reach_up',
  WA: 'wa_tanf',
  WI: 'wi_works',
  WV: 'wv_works',
  WY: 'wy_power',
}

const STATE_TANF_EARNED_INCOME_VARIABLES = {
  DC: 'dc_tanf_gross_earned_income',
  IL: 'il_tanf_gross_earned_income',
  MT: 'mt_tanf_gross_earned_income_person',
  SC: 'sc_tanf_gross_earned_income',
  TX: 'tx_tanf_gross_earned_income',
}

const VALID_FILING_STATUSES = new Set([
  'SINGLE',
  'HEAD_OF_HOUSEHOLD',
  'JOINT',
  'SEPARATE',
])

const MARRIED_FILING_STATUSES = new Set(['JOINT', 'SEPARATE'])

class PolicyEngineApiError extends Error {
  constructor(message, status, response) {
    super(message)
    this.name = 'PolicyEngineApiError'
    this.status = status
    this.response = response
  }
}

const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100

const monthlyAmount = (value) => roundCurrency((Number(value) || 0) / 12)

const REFUNDABLE_CREDIT_COMPONENTS = [
  { key: 'eitc', variable: 'eitc', entity: 'tax_unit' },
  { key: 'ctc', variable: 'refundable_ctc', entity: 'tax_unit' },
  {
    key: 'refundable_american_opportunity_credit',
    variable: 'refundable_american_opportunity_credit',
    entity: 'tax_unit',
  },
  {
    key: 'recovery_rebate_credit',
    variable: 'recovery_rebate_credit',
    entity: 'tax_unit',
  },
  {
    key: 'refundable_payroll_tax_credit',
    variable: 'refundable_payroll_tax_credit',
    entity: 'tax_unit',
  },
  { key: 'state_eitc', variable: 'state_eitc', entity: 'tax_unit' },
  { key: 'state_ctc', variable: 'state_ctc', entity: 'tax_unit' },
  { key: 'state_cdcc', variable: 'state_cdcc', entity: 'tax_unit' },
  { key: 'state_property_tax_credit', variable: 'state_property_tax_credit', entity: 'tax_unit' },
  { key: 'vt_renter_credit', variable: 'vt_renter_credit', entity: 'tax_unit' },
  {
    key: 'va_refundable_eitc_if_claimed',
    variable: 'va_refundable_eitc_if_claimed',
    entity: 'tax_unit',
  },
  { key: 'va_low_income_tax_credit', variable: 'va_low_income_tax_credit', entity: 'tax_unit' },
  {
    key: 'nm_low_income_comprehensive_tax_rebate',
    variable: 'nm_low_income_comprehensive_tax_rebate',
    entity: 'tax_unit',
  },
]

const asArray = (value, fallbackLength = 0) => {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item) || 0)
  }
  if (value == null) {
    return fallbackLength > 0 ? Array(fallbackLength).fill(0) : []
  }
  return [Number(value) || 0]
}

const asBooleanArray = (value, fallbackLength = 0) => {
  if (Array.isArray(value)) {
    return value.map((item) => Boolean(Number(item)))
  }
  if (value == null) {
    return fallbackLength > 0 ? Array(fallbackLength).fill(false) : []
  }
  return [Boolean(Number(value))]
}

const sumArrays = (arrays, length) => {
  const totals = Array(length).fill(0)
  arrays.forEach((values) => {
    values.forEach((value, index) => {
      totals[index] += Number(value) || 0
    })
  })
  return totals
}

const roundPercent = (value) => Math.round((Number(value) || 0) * 10) / 10

const getYearValue = (entity, variable, year) => entity?.[variable]?.[String(year)]

const getMonthValue = (entity, variable, year) => entity?.[variable]?.[`${year}-01`]

function buildRefundableCreditsFromResponse(taxUnit, peopleResponse, descriptor, year) {
  return Object.fromEntries(
    REFUNDABLE_CREDIT_COMPONENTS.map((component) => {
      const value = component.entity === 'person'
        ? descriptor.people.reduce(
          (sum, person) => sum + (Number(getYearValue(peopleResponse[person.id], component.variable, year)) || 0),
          0,
        )
        : Number(getYearValue(taxUnit, component.variable, year)) || 0

      return [component.key, roundCurrency(value)]
    }),
  )
}

function buildRefundableCreditSeriesFromResponse(taxUnit, peopleResponse, descriptor, year, pointCount) {
  return Object.fromEntries(
    REFUNDABLE_CREDIT_COMPONENTS.map((component) => {
      const values = component.entity === 'person'
        ? sumArrays(
          descriptor.people.map((person) => asArray(
            getYearValue(peopleResponse[person.id], component.variable, year),
            pointCount,
          )),
          pointCount,
        )
        : asArray(getYearValue(taxUnit, component.variable, year), pointCount)

      return [component.key, values.map((value) => roundCurrency(value))]
    }),
  )
}

function deriveFilingStatus(people = []) {
  const adults = people.filter((person) => person?.kind !== 'child').length
  const children = people.filter((person) => person?.kind === 'child').length

  if (adults >= 2) {
    return 'JOINT'
  }
  if (children > 0) {
    return 'HEAD_OF_HOUSEHOLD'
  }
  return 'SINGLE'
}

function effectiveFilingStatus(payload = {}) {
  if (VALID_FILING_STATUSES.has(payload?.filing_status)) {
    return payload.filing_status
  }
  return deriveFilingStatus(payload?.people || [])
}

function resolvePeople(people = [], filingStatus = 'SINGLE') {
  const resolved = []
  let adultIndex = 0
  let childIndex = 0
  const isMarried = MARRIED_FILING_STATUSES.has(filingStatus)

  people.forEach((member) => {
    const kind = member?.kind === 'child' ? 'child' : 'adult'
    if (kind === 'adult') {
      adultIndex += 1
      resolved.push({
        id: `adult_${adultIndex}`,
        role: adultIndex === 1
          ? 'head'
          : adultIndex === 2 && isMarried
            ? 'spouse'
            : 'other_adult',
        kind,
        age: Math.max(0, Number(member?.age) || 0),
        is_pregnant: Boolean(member?.is_pregnant),
      })
      return
    }

    childIndex += 1
    resolved.push({
      id: `child_${childIndex}`,
      role: 'dependent',
      kind,
      age: Math.max(0, Number(member?.age) || 0),
      is_pregnant: Boolean(member?.is_pregnant),
    })
  })

  return resolved
}

function describeHousehold(people) {
  const numAdults = people.filter((person) => person.kind === 'adult').length
  const numChildren = people.filter((person) => person.kind === 'child').length
  const adultAges = people
    .filter((person) => person.kind === 'adult')
    .map((person) => String(person.age))
  const childAges = people
    .filter((person) => person.kind === 'child')
    .map((person) => String(person.age))

  const description = []
  if (adultAges.length) {
    description.push(`Adult ages: ${adultAges.join(', ')}`)
  }
  if (childAges.length) {
    description.push(`Child ages: ${childAges.join(', ')}`)
  }

  return {
    id: 'custom_household',
    label: `${numAdults} ${numAdults === 1 ? 'adult' : 'adults'} + ${numChildren} ${numChildren === 1 ? 'child' : 'children'}`,
    short_label: `${numAdults}A/${numChildren}C`,
    description: description.join('. ') || 'Custom household.',
    summary: 'The first adult is treated as the primary earner. When filing jointly or separately, the second adult is treated as a spouse.',
    people,
    counts: {
      num_adults: numAdults,
      num_children: numChildren,
      household_size: numAdults + numChildren,
    },
  }
}

function validatePayload(payload) {
  const filingStatus = effectiveFilingStatus(payload)
  const people = resolvePeople(payload.people || [], filingStatus)
  if (!people.length) {
    throw new Error('At least one household member is required')
  }
  if (!people.some((person) => person.kind === 'adult')) {
    throw new Error('At least one adult household member is required')
  }
  if (
    MARRIED_FILING_STATUSES.has(filingStatus)
    && people.filter((person) => person.kind === 'adult').length < 2
  ) {
    throw new Error('Married filing statuses require two adult household members')
  }
  people.forEach((person) => {
    if (person.age < 0 || person.age > 120) {
      throw new Error(`Invalid age: ${person.age}`)
    }
  })
  return people
}

function buildPersonData(person, year) {
  return {
    age: { [year]: person.age },
    has_itin: { [year]: true },
    has_esi: { [year]: false },
    offered_aca_disqualifying_esi: { [year]: false },
    is_pregnant: { [year]: Boolean(person.is_pregnant) },
    under_60_days_postpartum: { [year]: false },
    immigration_status_str: { [year]: 'CITIZEN' },
    is_aca_ptc_eligible: { [year]: null },
    is_medicaid_eligible: { [year]: null },
    is_chip_eligible: { [year]: null },
    wic: { [`${year}-01`]: null },
    medicaid: { [year]: null },
    chip: { [year]: null },
  }
}

function buildSituation(payload, options = {}) {
  const {
    includeIncomeOverrides = true,
    withAxes = false,
    maxEarnedIncome = 0,
    step = 500,
  } = options
  const year = String(payload.year)
  const people = validatePayload(payload)
  const descriptor = describeHousehold(people)
  const filingStatus = effectiveFilingStatus(payload)
  const earnedIncome = Number(payload.earned_income) || 0
  const monthlyEarnedIncome = earnedIncome / 12
  const memberIds = descriptor.people.map((person) => person.id)

  const situation = {
    people: {},
    families: { family: { members: [...memberIds] } },
    spm_units: {
      spm_unit: {
        members: [...memberIds],
        snap: { [`${year}-01`]: null },
        free_school_meals: { [year]: null },
      },
    },
    tax_units: {
      tax_unit: {
        members: [...memberIds],
        filing_status: { [year]: filingStatus },
        tax_unit_fpg: { [year]: null },
        premium_tax_credit: { [`${year}-01`]: null },
      },
    },
    households: {
      household: {
        members: [...memberIds],
        state_name: { [year]: payload.state },
        household_market_income: { [year]: null },
        household_tax_before_refundable_credits: { [year]: null },
      },
    },
    marital_units: {},
  }

  REFUNDABLE_CREDIT_COMPONENTS
    .filter((component) => component.entity === 'tax_unit')
    .forEach((component) => {
      situation.tax_units.tax_unit[component.variable] = { [year]: null }
    })

  const tanfVariable = STATE_TANF_VARIABLES[payload.state]
  if (tanfVariable) {
    situation.spm_units.spm_unit[tanfVariable] = { [`${year}-01`]: null }
  }

  descriptor.people.forEach((person, index) => {
    const personData = buildPersonData(person, year)

    REFUNDABLE_CREDIT_COMPONENTS
      .filter((component) => component.entity === 'person')
      .forEach((component) => {
        personData[component.variable] = { [year]: null }
      })

    if (includeIncomeOverrides && index === 0 && earnedIncome > 0) {
      personData.employment_income = { [year]: earnedIncome }
      personData.tanf_gross_earned_income = Object.fromEntries(
        Array.from({ length: 12 }, (_, month) => [
          `${year}-${String(month + 1).padStart(2, '0')}`,
          monthlyEarnedIncome,
        ]),
      )

      const stateSpecificEarnedIncomeVariable =
        STATE_TANF_EARNED_INCOME_VARIABLES[payload.state]
      if (stateSpecificEarnedIncomeVariable) {
        personData[stateSpecificEarnedIncomeVariable] = Object.fromEntries(
          Array.from({ length: 12 }, (_, month) => [
            `${year}-${String(month + 1).padStart(2, '0')}`,
            monthlyEarnedIncome,
          ]),
        )
      }
    } else if (!includeIncomeOverrides && index === 0) {
      personData.employment_income = { [year]: null }
    }

    situation.people[person.id] = personData
  })

  if (includeIncomeOverrides) {
    situation.tax_units.tax_unit.aca_magi = { [year]: earnedIncome }
    situation.tax_units.tax_unit.medicaid_magi = { [year]: earnedIncome }
    if (payload.state === 'CO' && earnedIncome > 0) {
      situation.spm_units.spm_unit.co_tanf_countable_gross_earned_income = {
        [year]: earnedIncome,
      }
    }
  }

  const headAndSpouse = descriptor.people
    .filter((person) => person.role === 'head' || person.role === 'spouse')
    .map((person) => person.id)

  if (headAndSpouse.length === 2 && MARRIED_FILING_STATUSES.has(filingStatus)) {
    situation.marital_units.primary_marital_unit = {
      members: headAndSpouse,
    }
  }

  descriptor.people
    .filter((person) => person.role !== 'head' && person.role !== 'spouse')
    .forEach((person) => {
      situation.marital_units[`${person.id}_marital_unit`] = {
        members: [person.id],
      }
    })

  if (withAxes) {
    const requestedStep = Math.max(1, Number(step) || 500)
    const alignedMaxEarnedIncome = Math.max(
      requestedStep,
      Math.ceil(Math.max(requestedStep, Number(maxEarnedIncome) || requestedStep) / requestedStep) * requestedStep,
    )
    const pointCount = Math.floor(alignedMaxEarnedIncome / requestedStep) + 1
    situation.axes = [[{
      name: 'employment_income',
      period: year,
      min: 0,
      max: alignedMaxEarnedIncome,
      count: pointCount,
    }]]
    return {
      descriptor,
      tanfVariable,
      pointCount,
      alignedMaxEarnedIncome,
      effectiveStep: requestedStep,
      situation,
    }
  }

  return {
    descriptor,
    tanfVariable,
    pointCount: 1,
    alignedMaxEarnedIncome: Number(payload.earned_income) || 0,
    effectiveStep: 0,
    situation,
  }
}

function namespaceSituation(baseSituation, descriptor, prefix) {
  const personIdMap = Object.fromEntries(
    descriptor.people.map((person) => [person.id, `${prefix}_${person.id}`]),
  )

  const renameEntityGroup = (entities = {}) => Object.fromEntries(
    Object.entries(entities).map(([entityId, entity]) => [
      `${prefix}_${entityId}`,
      {
        ...entity,
        members: Array.isArray(entity?.members)
          ? entity.members.map((memberId) => personIdMap[memberId] || memberId)
          : entity?.members,
      },
    ]),
  )

  return {
    ids: {
      householdId: `${prefix}_${Object.keys(baseSituation.households || {})[0]}`,
      taxUnitId: `${prefix}_${Object.keys(baseSituation.tax_units || {})[0]}`,
      spmUnitId: `${prefix}_${Object.keys(baseSituation.spm_units || {})[0]}`,
      personIdMap,
    },
    situation: {
      people: Object.fromEntries(
        Object.entries(baseSituation.people || {}).map(([personId, person]) => [
          personIdMap[personId],
          person,
        ]),
      ),
      families: renameEntityGroup(baseSituation.families),
      spm_units: renameEntityGroup(baseSituation.spm_units),
      tax_units: renameEntityGroup(baseSituation.tax_units),
      households: renameEntityGroup(baseSituation.households),
      marital_units: renameEntityGroup(baseSituation.marital_units),
    },
  }
}

function buildAllStatesSituation(payload, metadata) {
  const states = (metadata?.states || []).map((item) => item.code)
  if (!states.length) {
    throw new Error('No states available for comparison.')
  }

  const combinedSituation = {
    people: {},
    families: {},
    spm_units: {},
    tax_units: {},
    households: {},
    marital_units: {},
  }

  const contexts = states.map((stateCode) => {
    const statePayload = {
      ...payload,
      state: stateCode,
    }
    const built = buildSituation(statePayload, { includeIncomeOverrides: true })
    const prefixed = namespaceSituation(
      built.situation,
      built.descriptor,
      stateCode.toLowerCase(),
    )

    Object.assign(combinedSituation.people, prefixed.situation.people)
    Object.assign(combinedSituation.families, prefixed.situation.families)
    Object.assign(combinedSituation.spm_units, prefixed.situation.spm_units)
    Object.assign(combinedSituation.tax_units, prefixed.situation.tax_units)
    Object.assign(combinedSituation.households, prefixed.situation.households)
    Object.assign(combinedSituation.marital_units, prefixed.situation.marital_units)

    return {
      state: stateCode,
      descriptor: built.descriptor,
      ids: prefixed.ids,
    }
  })

  return {
    situation: combinedSituation,
    contexts,
  }
}

async function fetchWithTimeout(url, options, timeout = 120000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function policyEngineCalculate(household) {
  const response = await fetchWithTimeout(`${PE_API_URL}/us/calculate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ household }),
  })

  if (!response.ok) {
    let body
    try {
      body = await response.json()
    } catch {
      body = await response.text()
    }
    throw new PolicyEngineApiError(
      `PolicyEngine API error: ${response.status}`,
      response.status,
      body,
    )
  }

  const payload = await response.json()
  if (payload?.status && payload.status !== 'ok') {
    throw new PolicyEngineApiError(
      payload.message || 'PolicyEngine API calculation failed.',
      response.status,
      payload,
    )
  }
  return payload
}

function getStateName(metadata, stateCode) {
  return metadata?.states?.find((item) => item.code === stateCode)?.name || stateCode
}

function getProgramDefinitions(metadata) {
  return metadata?.programs || []
}

function getProgramLabelMap(metadata) {
  return Object.fromEntries(
    getProgramDefinitions(metadata).map((program) => [program.key, program.label]),
  )
}

function bestAccessProgram({ acaEligible, medicaidEligible, chipEligible }) {
  if (medicaidEligible) return 'medicaid'
  if (chipEligible) return 'chip'
  if (acaEligible) return 'aca'
  return 'none'
}

function formatProgramBreakdown(programs, metadata) {
  const byKey = Object.fromEntries(
    getProgramDefinitions(metadata).map((program) => [program.key, program]),
  )
  return getProgramDefinitions(metadata)
    .map((program) => {
      const annual = roundCurrency(programs[program.key])
      if (annual <= 0) {
        return null
      }
      return {
        key: program.key,
        label: byKey[program.key]?.label || program.key,
        short_label: byKey[program.key]?.short_label || program.key,
        description: byKey[program.key]?.description || '',
        annual,
        monthly: monthlyAmount(annual),
      }
    })
    .filter(Boolean)
}

function buildHouseholdResultFromResponse(payload, metadata, apiResponse, descriptor) {
  const year = String(payload.year)
  const households = apiResponse?.result?.households?.household || {}
  const taxUnit = apiResponse?.result?.tax_units?.tax_unit || {}
  const spmUnit = apiResponse?.result?.spm_units?.spm_unit || {}
  const peopleResponse = apiResponse?.result?.people || {}
  const tanfVariable = STATE_TANF_VARIABLES[payload.state]

  const marketIncome = roundCurrency(getYearValue(households, 'household_market_income', year))
  const taxes = roundCurrency(getYearValue(households, 'household_tax_before_refundable_credits', year))
  const snap = roundCurrency((Number(getMonthValue(spmUnit, 'snap', year)) || 0) * 12)
  const wic = roundCurrency(
    Object.values(peopleResponse)
      .map((person) => Number(getMonthValue(person, 'wic', year)) || 0)
      .reduce((sum, value) => sum + value, 0) * 12,
  )
  const freeSchoolMeals = roundCurrency(getYearValue(spmUnit, 'free_school_meals', year))
  const medicaid = roundCurrency(
    Object.values(peopleResponse)
      .map((person) => Number(getYearValue(person, 'medicaid', year)) || 0)
      .reduce((sum, value) => sum + value, 0),
  )
  const chip = roundCurrency(
    Object.values(peopleResponse)
      .map((person) => Number(getYearValue(person, 'chip', year)) || 0)
      .reduce((sum, value) => sum + value, 0),
  )
  const acaPtc = roundCurrency((Number(getMonthValue(taxUnit, 'premium_tax_credit', year)) || 0) * 12)
  const tanf = roundCurrency(
    tanfVariable
      ? (Number(getMonthValue(spmUnit, tanfVariable, year)) || 0) * 12
      : 0,
  )
  const taxUnitFpg = roundCurrency(getYearValue(taxUnit, 'tax_unit_fpg', year))
  const refundableCreditPrograms = buildRefundableCreditsFromResponse(
    taxUnit,
    peopleResponse,
    descriptor,
    year,
  )

  const programs = {
    snap,
    tanf,
    wic,
    free_school_meals: freeSchoolMeals,
    medicaid,
    chip,
    aca_ptc: acaPtc,
    ...refundableCreditPrograms,
  }

  const people = descriptor.people.map((person) => {
    const apiPerson = peopleResponse[person.id] || {}
    const acaEligible = Boolean(Number(getYearValue(apiPerson, 'is_aca_ptc_eligible', year)))
    const medicaidEligible = Boolean(Number(getYearValue(apiPerson, 'is_medicaid_eligible', year)))
    const chipEligible = Boolean(Number(getYearValue(apiPerson, 'is_chip_eligible', year)))
    return {
      id: person.id,
      role: person.role,
      age: person.age,
      is_aca_ptc_eligible: acaEligible,
      is_medicaid_eligible: medicaidEligible,
      is_chip_eligible: chipEligible,
      best_access_program: bestAccessProgram({
        acaEligible,
        medicaidEligible,
        chipEligible,
      }),
    }
  })

  const access = {
    aca_people: 0,
    medicaid_people: 0,
    chip_people: 0,
    uncovered_people: 0,
  }

  people.forEach((person) => {
    if (person.best_access_program === 'aca') access.aca_people += 1
    if (person.best_access_program === 'medicaid') access.medicaid_people += 1
    if (person.best_access_program === 'chip') access.chip_people += 1
    if (person.best_access_program === 'none') access.uncovered_people += 1
  })

  const coreSupport = roundCurrency(
    Object.values(programs).reduce((sum, value) => sum + value, 0),
  )
  const netResources = roundCurrency(marketIncome + coreSupport - taxes)

  return {
    input: {
      state: payload.state,
      earned_income: payload.earned_income,
      year: payload.year,
      county: null,
      household_type: null,
      filing_status: effectiveFilingStatus(payload),
      people: descriptor.people.map((person) => ({
        kind: person.kind,
        age: person.age,
        is_pregnant: person.is_pregnant,
      })),
    },
    template: {
      id: descriptor.id,
      label: descriptor.label,
      short_label: descriptor.short_label,
      description: descriptor.description,
      summary: descriptor.summary,
    },
    counts: descriptor.counts,
    totals: {
      market_income: marketIncome,
      taxes,
      core_support: coreSupport,
      net_resources: netResources,
    },
    programs,
    access,
    context: {
      tax_unit_fpg: taxUnitFpg,
      income_pct_fpg: taxUnitFpg ? roundPercent((marketIncome / taxUnitFpg) * 100) : 0,
      resources_pct_fpg: taxUnitFpg ? roundPercent((netResources / taxUnitFpg) * 100) : 0,
    },
    people,
    state_name: getStateName(metadata, payload.state),
    program_breakdown: formatProgramBreakdown(programs, metadata),
    eligible: coreSupport > 0,
    monthly: {
      market_income: monthlyAmount(marketIncome),
      taxes: monthlyAmount(taxes),
      core_support: monthlyAmount(coreSupport),
      net_resources: monthlyAmount(netResources),
    },
  }
}

function buildCliffDrivers(previousPoint, currentPoint, metadata) {
  const labelByKey = getProgramLabelMap(metadata)
  const drivers = Object.keys(labelByKey).flatMap((key) => {
    const changeAnnual = roundCurrency(currentPoint.programs[key] - previousPoint.programs[key])
    if (changeAnnual >= 0) {
      return []
    }
    return [{
      key,
      label: labelByKey[key],
      kind: 'benefit_loss',
      raw_change_annual: changeAnnual,
      raw_change_monthly: monthlyAmount(changeAnnual),
      resource_effect_annual: changeAnnual,
      resource_effect_monthly: monthlyAmount(changeAnnual),
    }]
  })

  const taxChangeAnnual = roundCurrency(currentPoint.totals.taxes - previousPoint.totals.taxes)
  if (taxChangeAnnual > 0) {
    drivers.push({
      key: 'taxes',
      label: 'Higher taxes',
      kind: 'tax_increase',
      raw_change_annual: taxChangeAnnual,
      raw_change_monthly: monthlyAmount(taxChangeAnnual),
      resource_effect_annual: roundCurrency(-taxChangeAnnual),
      resource_effect_monthly: monthlyAmount(-taxChangeAnnual),
    })
  }

  return drivers.sort((left, right) => {
    if (left.resource_effect_annual !== right.resource_effect_annual) {
      return left.resource_effect_annual - right.resource_effect_annual
    }
    return left.label.localeCompare(right.label)
  })
}

function sortStateComparisonStates(states) {
  return [...states]
    .sort((left, right) => {
      if (right.net_resources !== left.net_resources) {
        return right.net_resources - left.net_resources
      }
      if (right.core_support !== left.core_support) {
        return right.core_support - left.core_support
      }
      return left.state.localeCompare(right.state)
    })
    .map((state, index) => ({
      ...state,
      rank: index + 1,
    }))
}

function buildStateComparisonEntryFromResponse(payload, metadata, apiResponse, context) {
  const households = apiResponse?.result?.households || {}
  const taxUnits = apiResponse?.result?.tax_units || {}
  const spmUnits = apiResponse?.result?.spm_units || {}
  const allPeople = apiResponse?.result?.people || {}

  const canonicalPeople = Object.fromEntries(
    context.descriptor.people.map((person) => [
      person.id,
      allPeople[context.ids.personIdMap[person.id]] || {},
    ]),
  )

  const stateResult = buildHouseholdResultFromResponse(
    payload,
    metadata,
    {
      result: {
        households: {
          household: households[context.ids.householdId] || {},
        },
        tax_units: {
          tax_unit: taxUnits[context.ids.taxUnitId] || {},
        },
        spm_units: {
          spm_unit: spmUnits[context.ids.spmUnitId] || {},
        },
        people: canonicalPeople,
      },
    },
    context.descriptor,
  )

  return {
    state: payload.state,
    state_name: stateResult.state_name,
    template_label: stateResult.template.label,
    net_resources: stateResult.totals.net_resources,
    taxes: stateResult.totals.taxes,
    net_resources_monthly: stateResult.monthly.net_resources,
    core_support: stateResult.totals.core_support,
    core_support_monthly: stateResult.monthly.core_support,
    taxes_monthly: stateResult.monthly.taxes,
    income_pct_fpg: stateResult.context.income_pct_fpg,
    resources_pct_fpg: stateResult.context.resources_pct_fpg,
    access: stateResult.access,
  }
}

function buildSeriesDataFromResponse(payload, metadata, apiResponse, descriptor, seriesMeta) {
  const year = String(payload.year)
  const households = apiResponse?.result?.households?.household || {}
  const taxUnit = apiResponse?.result?.tax_units?.tax_unit || {}
  const spmUnit = apiResponse?.result?.spm_units?.spm_unit || {}
  const peopleResponse = apiResponse?.result?.people || {}
  const pointCount = seriesMeta.pointCount
  const tanfVariable = STATE_TANF_VARIABLES[payload.state]
  const firstAdultId = descriptor.people.find((person) => person.kind === 'adult')?.id

  const earnedIncomeValues = asArray(
    getYearValue(peopleResponse[firstAdultId], 'employment_income', year),
    pointCount,
  )
  const marketIncomeValues = asArray(
    getYearValue(households, 'household_market_income', year),
    pointCount,
  )
  const taxValues = asArray(
    getYearValue(households, 'household_tax_before_refundable_credits', year),
    pointCount,
  )
  const snapValues = asArray(
    getMonthValue(spmUnit, 'snap', year),
    pointCount,
  ).map((value) => value * 12)
  const freeSchoolMealValues = asArray(
    getYearValue(spmUnit, 'free_school_meals', year),
    pointCount,
  )
  const premiumTaxCreditValues = asArray(
    getMonthValue(taxUnit, 'premium_tax_credit', year),
    pointCount,
  ).map((value) => value * 12)
  const tanfValues = tanfVariable
    ? asArray(getMonthValue(spmUnit, tanfVariable, year), pointCount).map((value) => value * 12)
    : Array(pointCount).fill(0)
  const medicaidValues = sumArrays(
    descriptor.people.map((person) => asArray(
      getYearValue(peopleResponse[person.id], 'medicaid', year),
      pointCount,
    )),
    pointCount,
  )
  const chipValues = sumArrays(
    descriptor.people.map((person) => asArray(
      getYearValue(peopleResponse[person.id], 'chip', year),
      pointCount,
    )),
    pointCount,
  )
  const wicValues = sumArrays(
    descriptor.people.map((person) => asArray(
      getMonthValue(peopleResponse[person.id], 'wic', year),
      pointCount,
    )),
    pointCount,
  ).map((value) => value * 12)
  const refundableCreditProgramValues = buildRefundableCreditSeriesFromResponse(
    taxUnit,
    peopleResponse,
    descriptor,
    year,
    pointCount,
  )

  const points = earnedIncomeValues.map((earnedIncome, index) => {
    const programs = {
      snap: roundCurrency(snapValues[index]),
      tanf: roundCurrency(tanfValues[index]),
      wic: roundCurrency(wicValues[index]),
      free_school_meals: roundCurrency(freeSchoolMealValues[index]),
      medicaid: roundCurrency(medicaidValues[index]),
      chip: roundCurrency(chipValues[index]),
      aca_ptc: roundCurrency(premiumTaxCreditValues[index]),
      ...Object.fromEntries(
        Object.entries(refundableCreditProgramValues).map(([key, values]) => [
          key,
          roundCurrency(values[index]),
        ]),
      ),
    }
    const marketIncome = roundCurrency(marketIncomeValues[index])
    const taxes = roundCurrency(taxValues[index])
    const coreSupport = roundCurrency(
      Object.values(programs).reduce((sum, value) => sum + value, 0),
    )
    const netResources = roundCurrency(marketIncome + coreSupport - taxes)
    return {
      earned_income: roundCurrency(earnedIncome),
      step_annual: seriesMeta.effectiveStep,
      totals: {
        market_income: marketIncome,
        taxes,
        core_support: coreSupport,
        net_resources: netResources,
      },
      programs,
    }
  })

  const data = points.map((point, index) => {
    const previousPoint = points[index - 1]
    const netChangeAnnual = previousPoint
      ? roundCurrency(point.totals.net_resources - previousPoint.totals.net_resources)
      : 0
    const cliffDrivers = previousPoint
      ? buildCliffDrivers(previousPoint, point, metadata)
      : []
    return {
      earned_income: point.earned_income,
      step_annual: seriesMeta.effectiveStep,
      net_resources: point.totals.net_resources,
      net_change_annual: netChangeAnnual,
      core_support: point.totals.core_support,
      taxes: point.totals.taxes,
      medicaid: point.programs.medicaid,
      chip: point.programs.chip,
      aca_ptc: point.programs.aca_ptc,
      snap: point.programs.snap,
      free_school_meals: point.programs.free_school_meals,
      eitc: point.programs.eitc,
      ctc: point.programs.ctc,
      refundable_american_opportunity_credit: point.programs.refundable_american_opportunity_credit,
      recovery_rebate_credit: point.programs.recovery_rebate_credit,
      refundable_payroll_tax_credit: point.programs.refundable_payroll_tax_credit,
      state_eitc: point.programs.state_eitc,
      state_ctc: point.programs.state_ctc,
      state_cdcc: point.programs.state_cdcc,
      state_property_tax_credit: point.programs.state_property_tax_credit,
      vt_renter_credit: point.programs.vt_renter_credit,
      va_refundable_eitc_if_claimed: point.programs.va_refundable_eitc_if_claimed,
      va_low_income_tax_credit: point.programs.va_low_income_tax_credit,
      nm_low_income_comprehensive_tax_rebate: point.programs.nm_low_income_comprehensive_tax_rebate,
      tanf: point.programs.tanf,
      wic: point.programs.wic,
      has_previous_point: Boolean(previousPoint),
      cliff_drop_annual: previousPoint && netChangeAnnual < 0
        ? roundCurrency(-netChangeAnnual)
        : 0,
      is_cliff: Boolean(previousPoint && netChangeAnnual < 0),
      cliff_drivers: previousPoint && netChangeAnnual < 0 ? cliffDrivers : [],
    }
  })

  return {
    data,
    step_annual: seriesMeta.effectiveStep,
    requested_step_annual: Number(payload.step) || seriesMeta.effectiveStep,
    max_earned_income: seriesMeta.alignedMaxEarnedIncome,
    requested_max_earned_income: Number(payload.max_earned_income) || seriesMeta.alignedMaxEarnedIncome,
    truncated: false,
    truncation_reason: null,
    point_count: data.length,
    max_net_resources: Math.max(...data.map((item) => item.net_resources), 0),
  }
}

export async function calculateHouseholdViaPolicyEngine(payload, metadata) {
  const baseSituation = buildSituation(payload, { includeIncomeOverrides: true })
  const delta = metadata?.defaults?.cliff_delta || 1000
  const bumpedSituation = buildSituation(
    {
      ...payload,
      earned_income: payload.earned_income + delta,
    },
    { includeIncomeOverrides: true },
  )

  const [baseResponse, bumpedResponse] = await Promise.all([
    policyEngineCalculate(baseSituation.situation),
    policyEngineCalculate(bumpedSituation.situation),
  ])

  const result = buildHouseholdResultFromResponse(
    payload,
    metadata,
    baseResponse,
    baseSituation.descriptor,
  )
  const bumpedResult = buildHouseholdResultFromResponse(
    {
      ...payload,
      earned_income: payload.earned_income + delta,
    },
    metadata,
    bumpedResponse,
    bumpedSituation.descriptor,
  )
  const resourceChangeAnnual = roundCurrency(
    bumpedResult.totals.net_resources - result.totals.net_resources,
  )
  const gapAnnual = Math.max(0, roundCurrency(-resourceChangeAnnual))

  result.cliff = {
    delta_annual: delta,
    resource_change_annual: resourceChangeAnnual,
    resource_change_monthly: monthlyAmount(resourceChangeAnnual),
    gap_annual: gapAnnual,
    gap_monthly: monthlyAmount(gapAnnual),
    effective_marginal_rate: delta
      ? roundCurrency((1 - (resourceChangeAnnual / delta)) * 10000) / 10000
      : 0,
    is_on_cliff: gapAnnual > 0,
  }

  return result
}

export async function calculateSeriesViaPolicyEngine(payload, metadata) {
  const seriesMeta = buildSituation(payload, {
    includeIncomeOverrides: false,
    withAxes: true,
    maxEarnedIncome: payload.max_earned_income,
    step: payload.step,
  })
  const response = await policyEngineCalculate(seriesMeta.situation)
  return buildSeriesDataFromResponse(
    payload,
    metadata,
    response,
    seriesMeta.descriptor,
    seriesMeta,
  )
}

export async function calculateAllStatesViaPolicyEngine(payload, metadata) {
  const comparisonMeta = buildAllStatesSituation(payload, metadata)
  const response = await policyEngineCalculate(comparisonMeta.situation)
  const states = comparisonMeta.contexts.map((context) => (
    buildStateComparisonEntryFromResponse(
      {
        ...payload,
        state: context.state,
      },
      metadata,
      response,
      context,
    )
  ))
  const sortedStates = sortStateComparisonStates(states)

  return {
    states: sortedStates,
    max_net_resources: Math.max(
      ...sortedStates.map((item) => Number(item.net_resources || 0)),
      0,
    ),
  }
}

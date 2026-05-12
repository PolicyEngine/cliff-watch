import { applyStateProgramLabels } from './utils/programLabels.js'

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

const DEFAULT_CCDF_MODELED_STATES = new Set([
  'CA', 'CO', 'DE', 'MA', 'ME', 'NE', 'NH', 'PA', 'RI', 'VT',
])

const DEFAULT_PUBLIC_ASSISTANCE_PROGRAM_OPTIONS = [
  { key: 'snap', label: 'Supplemental Nutrition Assistance Program (SNAP)' },
  { key: 'free_school_meals', label: 'Free or reduced price school meals' },
  { key: 'wic', label: 'Women, Infants, and Children Nutrition Program (WIC)' },
  { key: 'tanf', label: 'Temporary Assistance for Needy Families (TANF)' },
  { key: 'child_care_subsidies', label: 'Child Care Subsidy (CCDF)' },
  { key: 'head_start', label: 'Head Start' },
  { key: 'early_head_start', label: 'Early Head Start' },
  { key: 'housing_assistance', label: 'Section 8 Housing Choice Voucher' },
  { key: 'medicaid', label: 'Medicaid for adults' },
  { key: 'chip', label: 'Medicaid for children / CHIP' },
  { key: 'aca_ptc', label: 'Health Insurance Marketplace Subsidy' },
  { key: 'federal_refundable_credits', label: 'Federal refundable tax credits' },
  { key: 'state_refundable_credits', label: 'State refundable tax credits' },
  { key: 'ssi', label: 'Supplemental Security Income (SSI)' },
  { key: 'ssdi', label: 'Social Security Disability Insurance (SSDI)' },
]

const DEFAULT_HOUSEHOLD_COST_DEFINITIONS = [
  {
    key: 'rent',
    label: 'Rent or mortgage',
    short_label: 'Housing',
    description: 'Annual rent or mortgage entered by the household.',
  },
  {
    key: 'utilities',
    label: 'Utilities',
    short_label: 'Utilities',
    description: 'Annual utility costs entered by the household.',
  },
  {
    key: 'childcare',
    label: 'Child care expense',
    short_label: 'Child care',
    description: 'Annual out-of-pocket child care expense entered by the household.',
  },
  {
    key: 'food',
    label: 'Food',
    short_label: 'Food',
    description: 'Annual food costs entered by the household.',
  },
  {
    key: 'transportation',
    label: 'Transportation',
    short_label: 'Transport',
    description: 'Annual transportation costs entered by the household.',
  },
  {
    key: 'health_insurance_premiums',
    label: 'Health insurance premiums',
    short_label: 'Health premiums',
    description: 'Annual out-of-pocket health insurance premiums entered by the household.',
  },
  {
    key: 'technology',
    label: 'Phone and internet',
    short_label: 'Tech',
    description: 'Annual phone and internet costs entered by the household.',
  },
  {
    key: 'debt_payments',
    label: 'Debt payments',
    short_label: 'Debt',
    description: 'Annual debt payments entered by the household.',
  },
  {
    key: 'education_training',
    label: 'Education and training',
    short_label: 'Training',
    description: 'Annual education or training costs entered by the household.',
  },
  {
    key: 'other_expenses',
    label: 'Other expenses',
    short_label: 'Other',
    description: 'Other annual budget costs entered by the household.',
  },
  {
    key: 'chip_premium',
    label: 'CHIP premium',
    short_label: 'CHIP premium',
    description: 'Annual CHIP premium or enrollment fee paid by the household.',
  },
]

const FIXED_HOUSEHOLD_COST_INPUTS = {
  rent: 'rent_annual',
  utilities: 'utility_expense_annual',
  childcare: 'childcare_expenses',
  food: 'food_expense_annual',
  transportation: 'transportation_expense_annual',
  health_insurance_premiums: 'health_insurance_premium_annual',
  technology: 'technology_expense_annual',
  debt_payments: 'debt_payment_annual',
  education_training: 'education_expense_annual',
  other_expenses: 'other_expense_annual',
}

function isCcdfModeledState(state, metadata) {
  const fromMetadata = metadata?.ccdf_modeled_states
  if (Array.isArray(fromMetadata) && fromMetadata.length) {
    return fromMetadata.includes(state)
  }
  return DEFAULT_CCDF_MODELED_STATES.has(state)
}

export class PolicyEngineApiError extends Error {
  constructor(message, status, response) {
    super(message)
    this.name = 'PolicyEngineApiError'
    this.status = status
    this.response = response
  }
}

const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100

const monthlyAmount = (value) => roundCurrency((Number(value) || 0) / 12)

const nonnegative = (value) => Math.max(0, Number(value) || 0)

function normalizeCounty(county, state) {
  if (!county) return null
  const normalized = String(county)
    .trim()
    .toUpperCase()
    .replaceAll(',', '')
    .replaceAll('.', '')
    .replaceAll('-', '_')
    .replace(/\s+/g, '_')

  if (!normalized) return null
  return normalized.endsWith(`_${state}`) ? normalized : `${normalized}_${state}`
}

function getPublicAssistancePrograms(metadata) {
  const options = metadata?.public_assistance_programs
  if (Array.isArray(options) && options.length) {
    return options
  }
  return DEFAULT_PUBLIC_ASSISTANCE_PROGRAM_OPTIONS
}

function selectedPrograms(payload, metadata) {
  const knownKeys = new Set(getPublicAssistancePrograms(metadata).map((program) => program.key))
  return new Set(
    (payload?.selected_programs || []).filter((key) => knownKeys.has(key)),
  )
}

function programIncluded(payload, key, metadata) {
  const mode = payload?.programs_mode || 'all'
  if (mode === 'none') return false
  if (mode === 'custom') return selectedPrograms(payload, metadata).has(key)
  return true
}

function filterProgramValue(payload, key, value, metadata) {
  return programIncluded(payload, key, metadata) ? value : 0
}

function fixedHouseholdCostsFromPayload(payload) {
  return Object.fromEntries(
    Object.entries(FIXED_HOUSEHOLD_COST_INPUTS).map(([key, field]) => [
      key,
      roundCurrency(nonnegative(payload?.[field])),
    ]),
  )
}

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

const REFUNDABLE_CREDIT_KEYS = REFUNDABLE_CREDIT_COMPONENTS.map((component) => component.key)

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

function sumPeopleYear(peopleResponse, descriptor, variable, year) {
  return descriptor.people
    .map((person) => Number(getYearValue(peopleResponse[person.id], variable, year)) || 0)
    .reduce((sum, value) => sum + value, 0)
}

function sumPeopleMonthAnnualized(peopleResponse, descriptor, variable, year) {
  return descriptor.people
    .map((person) => Number(getMonthValue(peopleResponse[person.id], variable, year)) || 0)
    .reduce((sum, value) => sum + value, 0) * 12
}

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
        is_disabled: Boolean(member?.is_disabled),
        is_blind: Boolean(member?.is_blind),
        is_full_time_student: Boolean(member?.is_full_time_student),
        is_incapable_of_self_care: Boolean(member?.is_incapable_of_self_care),
        earned_income: nonnegative(member?.earned_income),
        ssi_amount: nonnegative(member?.ssi_amount),
        ssdi_amount: nonnegative(member?.ssdi_amount),
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
      is_disabled: Boolean(member?.is_disabled),
      is_blind: Boolean(member?.is_blind),
      is_full_time_student: Boolean(member?.is_full_time_student),
      is_incapable_of_self_care: Boolean(member?.is_incapable_of_self_care),
      earned_income: nonnegative(member?.earned_income),
      ssi_amount: nonnegative(member?.ssi_amount),
      ssdi_amount: nonnegative(member?.ssdi_amount),
    })
  })

  return resolved
}

function describeHousehold(people) {
  const numAdults = people.filter((person) => person.kind === 'adult').length
  const numDependents = people.filter((person) => person.kind === 'child').length
  const adultAges = people
    .filter((person) => person.kind === 'adult')
    .map((person) => String(person.age))
  const dependentAges = people
    .filter((person) => person.kind === 'child')
    .map((person) => String(person.age))

  const description = []
  if (adultAges.length) {
    description.push(`Adult ages: ${adultAges.join(', ')}`)
  }
  if (dependentAges.length) {
    description.push(`Dependent ages: ${dependentAges.join(', ')}`)
  }

  return {
    id: 'custom_household',
    label: `${numAdults} ${numAdults === 1 ? 'adult' : 'adults'} + ${numDependents} ${numDependents === 1 ? 'dependent' : 'dependents'}`,
    short_label: `${numAdults}A/${numDependents}D`,
    description: description.join('. ') || 'Custom household.',
    summary: 'The first adult is treated as the primary earner. The second adult joins the tax unit, and any other household members are treated as dependents.',
    people,
    counts: {
      num_adults: numAdults,
      num_children: numDependents,
      household_size: numAdults + numDependents,
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
  const data = {
    age: { [year]: person.age },
    has_itin: { [year]: true },
    has_esi: { [year]: false },
    offered_aca_disqualifying_esi: { [year]: false },
    is_pregnant: { [year]: Boolean(person.is_pregnant) },
    is_disabled: { [year]: Boolean(person.is_disabled) },
    is_blind: { [year]: Boolean(person.is_blind) },
    is_full_time_student: { [year]: Boolean(person.is_full_time_student) },
    is_incapable_of_self_care: { [year]: Boolean(person.is_incapable_of_self_care) },
    under_60_days_postpartum: { [year]: false },
    immigration_status_str: { [year]: 'CITIZEN' },
    is_ccdf_reason_for_care_eligible: { [year]: true },
    takes_up_medicaid_if_eligible: { [year]: true },
    takes_up_chip_if_eligible: { [year]: true },
    takes_up_ssi_if_eligible: { [year]: true },
    takes_up_head_start_if_eligible: { [year]: true },
    takes_up_early_head_start_if_eligible: { [year]: true },
    is_enrolled_in_ccdf: { [year]: true },
    is_enrolled_in_head_start: { [year]: true },
    receives_wic: { [`${year}-01`]: true },
    is_aca_ptc_eligible: { [year]: null },
    is_medicaid_eligible: { [year]: null },
    is_chip_eligible: { [year]: null },
    wic: { [`${year}-01`]: null },
    medicaid: { [year]: null },
    chip: { [year]: null },
    head_start: { [year]: null },
    early_head_start: { [year]: null },
    ssi: { [year]: null },
    social_security_disability: { [year]: null },
  }
  if (person.kind === 'adult') {
    data.ccdf_age_group = { [year]: 'SCHOOL_AGE' }
  }
  return data
}

function buildSituation(payload, options = {}) {
  const {
    includeIncomeOverrides = true,
    withAxes = false,
    maxEarnedIncome = 0,
    minEarnedIncome = 0,
    step = 500,
  } = options
  const year = String(payload.year)
  const people = validatePayload(payload)
  const descriptor = describeHousehold(people)
  const filingStatus = effectiveFilingStatus(payload)
  const earnedIncome = Number(payload.earned_income) || 0
  const memberIds = descriptor.people.map((person) => person.id)

  const childcareExpenses = nonnegative(payload.childcare_expenses)
  const rentAnnual = nonnegative(payload.rent_annual)
  const utilityExpenseAnnual = nonnegative(payload.utility_expense_annual)
  const healthInsurancePremiumAnnual = nonnegative(
    payload.health_insurance_premium_annual,
  )
  const ccdfModeled = isCcdfModeledState(payload.state, options.metadata)
  const spmUnitEntity = {
    members: [...memberIds],
    snap: { [`${year}-01`]: null },
    free_school_meals: { [year]: null },
    housing_assistance: { [year]: null },
    meets_ccdf_activity_test: { [year]: true },
    takes_up_snap_if_eligible: { [year]: programIncluded(payload, 'snap', options.metadata) },
    takes_up_tanf_if_eligible: { [year]: programIncluded(payload, 'tanf', options.metadata) },
    receives_housing_assistance: { [year]: programIncluded(payload, 'housing_assistance', options.metadata) },
  }
  if (ccdfModeled) {
    spmUnitEntity.child_care_subsidies = { [year]: null }
  }
  if (childcareExpenses > 0) {
    spmUnitEntity.childcare_expenses = { [year]: childcareExpenses }
    spmUnitEntity.spm_unit_pre_subsidy_childcare_expenses = { [year]: childcareExpenses }
  }
  if (utilityExpenseAnnual > 0) {
    spmUnitEntity.utility_expense = { [year]: utilityExpenseAnnual }
  }
  if (nonnegative(payload.liquid_assets) > 0) {
    spmUnitEntity.snap_assets = { [year]: nonnegative(payload.liquid_assets) }
  }
  if (programIncluded(payload, 'tanf', options.metadata)) {
    spmUnitEntity.is_tanf_enrolled = Object.fromEntries(
      Array.from({ length: 12 }, (_, month) => [
        `${year}-${String(month + 1).padStart(2, '0')}`,
        true,
      ]),
    )
  }

  const situation = {
    people: {},
    families: { family: { members: [...memberIds] } },
    spm_units: {
      spm_unit: spmUnitEntity,
    },
    tax_units: {
      tax_unit: {
        members: [...memberIds],
        filing_status: { [year]: filingStatus },
        tax_unit_fpg: { [year]: null },
        income_tax_refundable_credits: { [year]: null },
        premium_tax_credit: { [`${year}-01`]: null },
        takes_up_aca_if_eligible: { [year]: programIncluded(payload, 'aca_ptc', options.metadata) },
        takes_up_eitc: { [year]: programIncluded(payload, 'federal_refundable_credits', options.metadata) },
      },
    },
    households: {
      household: {
        members: [...memberIds],
        state_name: { [year]: payload.state },
        county: normalizeCounty(payload.county, payload.state)
          ? { [year]: normalizeCounty(payload.county, payload.state) }
          : undefined,
        household_market_income: { [year]: null },
        household_tax_before_refundable_credits: { [year]: null },
        household_state_tax_before_refundable_credits: { [year]: null },
        household_refundable_state_tax_credits: { [year]: null },
        chip_premium: { [year]: null },
        hud_utility_allowance: utilityExpenseAnnual > 0
          ? { [year]: utilityExpenseAnnual }
          : undefined,
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

  const setEarnedIncome = (personData, amount) => {
    const annualAmount = Number(amount) || 0
    const monthlyAmountValue = annualAmount / 12
    personData.employment_income = { [year]: annualAmount }
    personData.tanf_gross_earned_income = Object.fromEntries(
      Array.from({ length: 12 }, (_, month) => [
        `${year}-${String(month + 1).padStart(2, '0')}`,
        monthlyAmountValue,
      ]),
    )

    const stateSpecificEarnedIncomeVariable =
      STATE_TANF_EARNED_INCOME_VARIABLES[payload.state]
    if (stateSpecificEarnedIncomeVariable) {
      personData[stateSpecificEarnedIncomeVariable] = Object.fromEntries(
        Array.from({ length: 12 }, (_, month) => [
          `${year}-${String(month + 1).padStart(2, '0')}`,
          monthlyAmountValue,
        ]),
      )
    }
  }

  descriptor.people.forEach((person, index) => {
    const personData = buildPersonData(person, year)

    REFUNDABLE_CREDIT_COMPONENTS
      .filter((component) => component.entity === 'person')
      .forEach((component) => {
        personData[component.variable] = { [year]: null }
      })

    personData.takes_up_medicaid_if_eligible = {
      [year]: programIncluded(payload, 'medicaid', options.metadata),
    }
    personData.takes_up_chip_if_eligible = {
      [year]: programIncluded(payload, 'chip', options.metadata),
    }
    personData.takes_up_ssi_if_eligible = {
      [year]: programIncluded(payload, 'ssi', options.metadata),
    }
    personData.takes_up_head_start_if_eligible = {
      [year]: programIncluded(payload, 'head_start', options.metadata),
    }
    personData.takes_up_early_head_start_if_eligible = {
      [year]: programIncluded(payload, 'early_head_start', options.metadata),
    }
    personData.is_enrolled_in_ccdf = {
      [year]: programIncluded(payload, 'child_care_subsidies', options.metadata),
    }
    personData.is_enrolled_in_head_start = {
      [year]: programIncluded(payload, 'head_start', options.metadata),
    }
    personData.receives_wic = Object.fromEntries(
      Array.from({ length: 12 }, (_, month) => [
        `${year}-${String(month + 1).padStart(2, '0')}`,
        programIncluded(payload, 'wic', options.metadata),
      ]),
    )

    if (payload.has_employer_health_insurance) {
      personData.has_esi = { [year]: true }
      personData.offered_aca_disqualifying_esi = { [year]: true }
    }

    if (index === 0 && rentAnnual > 0) {
      personData.pre_subsidy_rent = { [year]: rentAnnual }
    }

    if (index === 0 && healthInsurancePremiumAnnual > 0) {
      personData.health_insurance_premiums = { [year]: healthInsurancePremiumAnnual }
    }

    if (person.ssi_amount > 0 && programIncluded(payload, 'ssi', options.metadata)) {
      personData.ssi = { [year]: person.ssi_amount }
    }

    if (person.ssdi_amount > 0 && programIncluded(payload, 'ssdi', options.metadata)) {
      personData.social_security_disability = { [year]: person.ssdi_amount }
    }

    if (includeIncomeOverrides && index === 0) {
      setEarnedIncome(personData, earnedIncome)
    } else if (!includeIncomeOverrides && index === 0) {
      personData.employment_income = { [year]: null }
    } else if (person.earned_income > 0) {
      setEarnedIncome(personData, person.earned_income)
    }

    if (index === 0) {
      const extraIncomeInputs = {
        self_employment_income: payload.self_employment_income_annual,
        child_support_received: payload.child_support_annual,
        taxable_interest_income: payload.taxable_interest_income_annual,
        dividend_income: payload.dividend_income_annual,
        rental_income: payload.rental_income_annual,
        unemployment_compensation: payload.unemployment_compensation_annual,
        pension_income: payload.pension_income_annual,
        social_security: payload.social_security_annual,
        miscellaneous_income: payload.miscellaneous_income_annual,
      }
      Object.entries(extraIncomeInputs).forEach(([variable, amount]) => {
        const annualAmount = nonnegative(amount)
        if (annualAmount > 0) {
          personData[variable] = { [year]: annualAmount }
        }
      })
    }

    situation.people[person.id] = personData
  })

  if (includeIncomeOverrides) {
    const estimatedMagi = earnedIncome
      + descriptor.people.slice(1).reduce((sum, person) => sum + nonnegative(person.earned_income), 0)
      + nonnegative(payload.self_employment_income_annual)
      + nonnegative(payload.taxable_interest_income_annual)
      + nonnegative(payload.dividend_income_annual)
      + nonnegative(payload.rental_income_annual)
      + nonnegative(payload.unemployment_compensation_annual)
      + nonnegative(payload.pension_income_annual)
      + nonnegative(payload.miscellaneous_income_annual)
    situation.tax_units.tax_unit.aca_magi = { [year]: estimatedMagi }
    situation.tax_units.tax_unit.medicaid_magi = { [year]: estimatedMagi }
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
    const rawMin = Math.max(0, Number(minEarnedIncome) || 0)
    const alignedMinEarnedIncome = rawMin >= alignedMaxEarnedIncome
      ? 0
      : Math.floor(rawMin / requestedStep) * requestedStep
    const windowSpan = alignedMaxEarnedIncome - alignedMinEarnedIncome
    const pointCount = Math.max(2, Math.floor(windowSpan / requestedStep) + 1)
    situation.axes = [[{
      name: 'employment_income',
      period: year,
      min: alignedMinEarnedIncome,
      max: alignedMaxEarnedIncome,
      count: pointCount,
    }]]
    return {
      descriptor,
      tanfVariable,
      pointCount,
      alignedMaxEarnedIncome,
      alignedMinEarnedIncome,
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

function getProgramDefinitions(metadata, stateCode) {
  const definitions = metadata?.programs
  if (Array.isArray(definitions) && definitions.length) {
    return applyStateProgramLabels(definitions, metadata, stateCode)
  }
  return applyStateProgramLabels(DEFAULT_PUBLIC_ASSISTANCE_PROGRAM_OPTIONS.map((program) => ({
    ...program,
    short_label: program.label,
    description: '',
  })), metadata, stateCode)
}

function getHouseholdCostDefinitions(metadata) {
  const definitions = metadata?.household_costs
  if (Array.isArray(definitions) && definitions.length) {
    return definitions
  }
  return DEFAULT_HOUSEHOLD_COST_DEFINITIONS
}

function getProgramLabelMap(metadata, stateCode) {
  return Object.fromEntries(
    getProgramDefinitions(metadata, stateCode).map((program) => [program.key, program.label]),
  )
}

function getHouseholdCostLabelMap(metadata) {
  return Object.fromEntries(
    getHouseholdCostDefinitions(metadata).map((cost) => [cost.key, cost.label]),
  )
}

function getHouseholdCostValue(point, key) {
  return Number(point?.household_costs?.[key] ?? point?.[key]) || 0
}

function bestAccessProgram({ acaEligible, medicaidEligible, chipEligible }) {
  if (medicaidEligible) return 'medicaid'
  if (chipEligible) return 'chip'
  if (acaEligible) return 'aca'
  return 'none'
}

function formatProgramBreakdown(programs, metadata, stateCode) {
  const byKey = Object.fromEntries(
    getProgramDefinitions(metadata, stateCode).map((program) => [program.key, program]),
  )
  return getProgramDefinitions(metadata, stateCode)
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

export function buildHouseholdResultFromResponse(payload, metadata, apiResponse, descriptor) {
  const year = String(payload.year)
  const households = apiResponse?.result?.households?.household || {}
  const taxUnit = apiResponse?.result?.tax_units?.tax_unit || {}
  const spmUnit = apiResponse?.result?.spm_units?.spm_unit || {}
  const peopleResponse = apiResponse?.result?.people || {}
  const tanfVariable = STATE_TANF_VARIABLES[payload.state]

  const marketIncome = roundCurrency(getYearValue(households, 'household_market_income', year))
  const taxes = roundCurrency(getYearValue(households, 'household_tax_before_refundable_credits', year))
  const stateTaxesBeforeRefundableCredits = roundCurrency(
    getYearValue(households, 'household_state_tax_before_refundable_credits', year),
  )
  const federalTaxesBeforeRefundableCredits = roundCurrency(
    Math.max(0, taxes - stateTaxesBeforeRefundableCredits),
  )
  const snap = roundCurrency((Number(getMonthValue(spmUnit, 'snap', year)) || 0) * 12)
  const wic = roundCurrency(sumPeopleMonthAnnualized(peopleResponse, descriptor, 'wic', year))
  const freeSchoolMeals = roundCurrency(getYearValue(spmUnit, 'free_school_meals', year))
  const headStart = roundCurrency(sumPeopleYear(peopleResponse, descriptor, 'head_start', year))
  const earlyHeadStart = roundCurrency(sumPeopleYear(peopleResponse, descriptor, 'early_head_start', year))
  const housingAssistance = roundCurrency(getYearValue(spmUnit, 'housing_assistance', year))
  const ssi = roundCurrency(sumPeopleYear(peopleResponse, descriptor, 'ssi', year))
  const ssdi = roundCurrency(sumPeopleYear(peopleResponse, descriptor, 'social_security_disability', year))
  const medicaid = roundCurrency(sumPeopleYear(peopleResponse, descriptor, 'medicaid', year))
  const chip = roundCurrency(sumPeopleYear(peopleResponse, descriptor, 'chip', year))
  const acaPtc = roundCurrency((Number(getMonthValue(taxUnit, 'premium_tax_credit', year)) || 0) * 12)
  const federalRefundableCredits = roundCurrency(
    getYearValue(taxUnit, 'income_tax_refundable_credits', year),
  )
  const stateRefundableCredits = roundCurrency(
    getYearValue(households, 'household_refundable_state_tax_credits', year),
  )
  const chipPremium = roundCurrency(getYearValue(households, 'chip_premium', year))
  const tanf = roundCurrency(
    tanfVariable
      ? (Number(getMonthValue(spmUnit, tanfVariable, year)) || 0) * 12
      : 0,
  )
  const childCareSubsidies = isCcdfModeledState(payload.state, metadata)
    ? roundCurrency(getYearValue(spmUnit, 'child_care_subsidies', year))
    : 0
  const taxUnitFpg = roundCurrency(getYearValue(taxUnit, 'tax_unit_fpg', year))
  const programs = {
    snap: roundCurrency(filterProgramValue(payload, 'snap', snap, metadata)),
    tanf: roundCurrency(filterProgramValue(payload, 'tanf', tanf, metadata)),
    wic: roundCurrency(filterProgramValue(payload, 'wic', wic, metadata)),
    free_school_meals: roundCurrency(filterProgramValue(
      payload,
      'free_school_meals',
      freeSchoolMeals,
      metadata,
    )),
    head_start: roundCurrency(filterProgramValue(payload, 'head_start', headStart, metadata)),
    early_head_start: roundCurrency(filterProgramValue(
      payload,
      'early_head_start',
      earlyHeadStart,
      metadata,
    )),
    child_care_subsidies: roundCurrency(filterProgramValue(
      payload,
      'child_care_subsidies',
      childCareSubsidies,
      metadata,
    )),
    housing_assistance: roundCurrency(filterProgramValue(
      payload,
      'housing_assistance',
      housingAssistance,
      metadata,
    )),
    ssi: roundCurrency(filterProgramValue(payload, 'ssi', ssi, metadata)),
    ssdi: roundCurrency(filterProgramValue(payload, 'ssdi', ssdi, metadata)),
    medicaid: roundCurrency(filterProgramValue(payload, 'medicaid', medicaid, metadata)),
    chip: roundCurrency(filterProgramValue(payload, 'chip', chip, metadata)),
    aca_ptc: roundCurrency(filterProgramValue(payload, 'aca_ptc', acaPtc, metadata)),
    federal_refundable_credits: roundCurrency(filterProgramValue(
      payload,
      'federal_refundable_credits',
      federalRefundableCredits,
      metadata,
    )),
    state_refundable_credits: roundCurrency(filterProgramValue(
      payload,
      'state_refundable_credits',
      stateRefundableCredits,
      metadata,
    )),
  }
  const householdCosts = {
    ...fixedHouseholdCostsFromPayload(payload),
    chip_premium: chipPremium,
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
  const totalHouseholdCosts = roundCurrency(
    Object.values(householdCosts).reduce((sum, value) => sum + value, 0),
  )
  const netResources = roundCurrency(marketIncome + coreSupport - taxes - totalHouseholdCosts)

  return {
    input: {
      state: payload.state,
      earned_income: payload.earned_income,
      year: payload.year,
      county: payload.county || null,
      household_type: null,
      filing_status: effectiveFilingStatus(payload),
      people: descriptor.people.map((person) => ({
        kind: person.kind,
        age: person.age,
        is_pregnant: person.is_pregnant,
        is_disabled: person.is_disabled,
        is_blind: person.is_blind,
        is_full_time_student: person.is_full_time_student,
        is_incapable_of_self_care: person.is_incapable_of_self_care,
        earned_income: person.earned_income,
        ssi_amount: person.ssi_amount,
        ssdi_amount: person.ssdi_amount,
      })),
      programs_mode: payload.programs_mode || 'all',
      selected_programs: payload.selected_programs || [],
      has_employer_health_insurance: Boolean(payload.has_employer_health_insurance),
      childcare_expenses: nonnegative(payload.childcare_expenses),
      rent_annual: nonnegative(payload.rent_annual),
      utility_expense_annual: nonnegative(payload.utility_expense_annual),
      food_expense_annual: nonnegative(payload.food_expense_annual),
      transportation_expense_annual: nonnegative(payload.transportation_expense_annual),
      health_insurance_premium_annual: nonnegative(payload.health_insurance_premium_annual),
      technology_expense_annual: nonnegative(payload.technology_expense_annual),
      debt_payment_annual: nonnegative(payload.debt_payment_annual),
      education_expense_annual: nonnegative(payload.education_expense_annual),
      other_expense_annual: nonnegative(payload.other_expense_annual),
      self_employment_income_annual: nonnegative(payload.self_employment_income_annual),
      child_support_annual: nonnegative(payload.child_support_annual),
      taxable_interest_income_annual: nonnegative(payload.taxable_interest_income_annual),
      dividend_income_annual: nonnegative(payload.dividend_income_annual),
      rental_income_annual: nonnegative(payload.rental_income_annual),
      unemployment_compensation_annual: nonnegative(payload.unemployment_compensation_annual),
      pension_income_annual: nonnegative(payload.pension_income_annual),
      social_security_annual: nonnegative(payload.social_security_annual),
      miscellaneous_income_annual: nonnegative(payload.miscellaneous_income_annual),
      liquid_assets: nonnegative(payload.liquid_assets),
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
      federal_taxes_before_refundable_credits: federalTaxesBeforeRefundableCredits,
      state_taxes_before_refundable_credits: stateTaxesBeforeRefundableCredits,
      core_support: coreSupport,
      household_costs: totalHouseholdCosts,
      net_resources: netResources,
    },
    programs,
    household_costs: householdCosts,
    access,
    context: {
      tax_unit_fpg: taxUnitFpg,
      income_pct_fpg: taxUnitFpg ? roundPercent((marketIncome / taxUnitFpg) * 100) : 0,
      resources_pct_fpg: taxUnitFpg ? roundPercent((netResources / taxUnitFpg) * 100) : 0,
    },
    people,
    state_name: getStateName(metadata, payload.state),
    program_breakdown: formatProgramBreakdown(programs, metadata, payload.state),
    eligible: coreSupport > 0,
    monthly: {
      market_income: monthlyAmount(marketIncome),
      taxes: monthlyAmount(taxes),
      core_support: monthlyAmount(coreSupport),
      household_costs: monthlyAmount(totalHouseholdCosts),
      net_resources: monthlyAmount(netResources),
    },
  }
}

export function buildCliffDrivers(previousPoint, currentPoint, metadata, stateCode) {
  const labelByKey = getProgramLabelMap(metadata, stateCode)
  const householdCostLabels = getHouseholdCostLabelMap(metadata)
  const drivers = Object.keys(labelByKey).flatMap((key) => {
    const changeAnnual = roundCurrency(
      (Number(currentPoint.programs?.[key]) || 0)
        - (Number(previousPoint.programs?.[key]) || 0),
    )
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

  Object.keys(householdCostLabels).forEach((key) => {
    const changeAnnual = roundCurrency(
      getHouseholdCostValue(currentPoint, key) - getHouseholdCostValue(previousPoint, key),
    )
    if (changeAnnual <= 0) {
      return
    }
    drivers.push({
      key,
      label: householdCostLabels[key],
      kind: 'household_cost_increase',
      raw_change_annual: changeAnnual,
      raw_change_monthly: monthlyAmount(changeAnnual),
      resource_effect_annual: roundCurrency(-changeAnnual),
      resource_effect_monthly: monthlyAmount(-changeAnnual),
    })
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

export function buildSeriesDataFromResponse(payload, metadata, apiResponse, descriptor, seriesMeta) {
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
  const stateTaxValues = asArray(
    getYearValue(households, 'household_state_tax_before_refundable_credits', year),
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
  const headStartValues = sumArrays(
    descriptor.people.map((person) => asArray(
      getYearValue(peopleResponse[person.id], 'head_start', year),
      pointCount,
    )),
    pointCount,
  )
  const earlyHeadStartValues = sumArrays(
    descriptor.people.map((person) => asArray(
      getYearValue(peopleResponse[person.id], 'early_head_start', year),
      pointCount,
    )),
    pointCount,
  )
  const housingAssistanceValues = asArray(
    getYearValue(spmUnit, 'housing_assistance', year),
    pointCount,
  )
  const ssiValues = sumArrays(
    descriptor.people.map((person) => asArray(
      getYearValue(peopleResponse[person.id], 'ssi', year),
      pointCount,
    )),
    pointCount,
  )
  const ssdiValues = sumArrays(
    descriptor.people.map((person) => asArray(
      getYearValue(peopleResponse[person.id], 'social_security_disability', year),
      pointCount,
    )),
    pointCount,
  )
  const premiumTaxCreditValues = asArray(
    getMonthValue(taxUnit, 'premium_tax_credit', year),
    pointCount,
  ).map((value) => value * 12)
  const tanfValues = tanfVariable
    ? asArray(getMonthValue(spmUnit, tanfVariable, year), pointCount).map((value) => value * 12)
    : Array(pointCount).fill(0)
  const childCareSubsidyValues = isCcdfModeledState(payload.state, metadata)
    ? asArray(getYearValue(spmUnit, 'child_care_subsidies', year), pointCount)
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
  const federalRefundableCreditValues = asArray(
    getYearValue(taxUnit, 'income_tax_refundable_credits', year),
    pointCount,
  )
  const stateRefundableCreditValues = asArray(
    getYearValue(households, 'household_refundable_state_tax_credits', year),
    pointCount,
  )
  const chipPremiumValues = asArray(
    getYearValue(households, 'chip_premium', year),
    pointCount,
  )
  const fixedHouseholdCosts = fixedHouseholdCostsFromPayload(payload)

  const points = earnedIncomeValues.map((earnedIncome, index) => {
    const programs = {
      snap: roundCurrency(filterProgramValue(payload, 'snap', snapValues[index], metadata)),
      tanf: roundCurrency(filterProgramValue(payload, 'tanf', tanfValues[index], metadata)),
      wic: roundCurrency(filterProgramValue(payload, 'wic', wicValues[index], metadata)),
      free_school_meals: roundCurrency(filterProgramValue(
        payload,
        'free_school_meals',
        freeSchoolMealValues[index],
        metadata,
      )),
      head_start: roundCurrency(filterProgramValue(
        payload,
        'head_start',
        headStartValues[index],
        metadata,
      )),
      early_head_start: roundCurrency(filterProgramValue(
        payload,
        'early_head_start',
        earlyHeadStartValues[index],
        metadata,
      )),
      child_care_subsidies: roundCurrency(filterProgramValue(
        payload,
        'child_care_subsidies',
        childCareSubsidyValues[index],
        metadata,
      )),
      housing_assistance: roundCurrency(filterProgramValue(
        payload,
        'housing_assistance',
        housingAssistanceValues[index],
        metadata,
      )),
      ssi: roundCurrency(filterProgramValue(payload, 'ssi', ssiValues[index], metadata)),
      ssdi: roundCurrency(filterProgramValue(payload, 'ssdi', ssdiValues[index], metadata)),
      medicaid: roundCurrency(filterProgramValue(payload, 'medicaid', medicaidValues[index], metadata)),
      chip: roundCurrency(filterProgramValue(payload, 'chip', chipValues[index], metadata)),
      aca_ptc: roundCurrency(filterProgramValue(payload, 'aca_ptc', premiumTaxCreditValues[index], metadata)),
      federal_refundable_credits: roundCurrency(filterProgramValue(
        payload,
        'federal_refundable_credits',
        federalRefundableCreditValues[index],
        metadata,
      )),
      state_refundable_credits: roundCurrency(filterProgramValue(
        payload,
        'state_refundable_credits',
        stateRefundableCreditValues[index],
        metadata,
      )),
    }
    const householdCosts = {
      ...fixedHouseholdCosts,
      chip_premium: roundCurrency(chipPremiumValues[index]),
    }
    const marketIncome = roundCurrency(marketIncomeValues[index])
    const taxes = roundCurrency(taxValues[index])
    const stateTaxesBeforeRefundableCredits = roundCurrency(stateTaxValues[index])
    const federalTaxesBeforeRefundableCredits = roundCurrency(
      Math.max(0, taxes - stateTaxesBeforeRefundableCredits),
    )
    const coreSupport = roundCurrency(
      Object.values(programs).reduce((sum, value) => sum + value, 0),
    )
    const totalHouseholdCosts = roundCurrency(
      Object.values(householdCosts).reduce((sum, value) => sum + value, 0),
    )
    const netResources = roundCurrency(marketIncome + coreSupport - taxes - totalHouseholdCosts)
    return {
      earned_income: roundCurrency(earnedIncome),
      step_annual: seriesMeta.effectiveStep,
      totals: {
        market_income: marketIncome,
        taxes,
        federal_taxes_before_refundable_credits: federalTaxesBeforeRefundableCredits,
        state_taxes_before_refundable_credits: stateTaxesBeforeRefundableCredits,
        core_support: coreSupport,
        household_costs: totalHouseholdCosts,
        net_resources: netResources,
      },
      programs,
      household_costs: householdCosts,
    }
  })

  const data = points.map((point, index) => {
    const previousPoint = points[index - 1]
    const netChangeAnnual = previousPoint
      ? roundCurrency(point.totals.net_resources - previousPoint.totals.net_resources)
      : 0
    const cliffDrivers = previousPoint
      ? buildCliffDrivers(previousPoint, point, metadata, payload.state)
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
      head_start: point.programs.head_start,
      early_head_start: point.programs.early_head_start,
      housing_assistance: point.programs.housing_assistance,
      ssi: point.programs.ssi,
      ssdi: point.programs.ssdi,
      federal_refundable_credits: point.programs.federal_refundable_credits,
      state_refundable_credits: point.programs.state_refundable_credits,
      federal_taxes_before_refundable_credits: point.totals.federal_taxes_before_refundable_credits,
      state_taxes_before_refundable_credits: point.totals.state_taxes_before_refundable_credits,
      tanf: point.programs.tanf,
      wic: point.programs.wic,
      child_care_subsidies: point.programs.child_care_subsidies,
      chip_premium: point.household_costs.chip_premium,
      household_costs: point.household_costs,
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
  const baseSituation = buildSituation(payload, { includeIncomeOverrides: true, metadata })
  const delta = metadata?.defaults?.cliff_delta || 1000
  const bumpedSituation = buildSituation(
    {
      ...payload,
      earned_income: payload.earned_income + delta,
    },
    { includeIncomeOverrides: true, metadata },
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
    minEarnedIncome: payload.min_earned_income,
    step: payload.step,
    metadata,
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

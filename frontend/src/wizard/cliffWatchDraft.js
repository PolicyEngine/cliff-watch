/**
 * Bridges Cliff Watch's existing `inputs` shape (filing-status-based, snake-case
 * people array) and the shared `policyengine-household-wizard` US household
 * draft contract. Phase 4 first-consumer integration for
 * https://github.com/PolicyEngine/policyengine-app-v2/issues/1044.
 *
 * The wizard owns the household draft (state, ZIP, county, marital status, people).
 * Cliff Watch keeps a parallel `scenario` object for the cliff-watch-specific
 * fields the wizard's contract doesn't carry (chart range, program take-up
 * toggles, expenses, secondary incomes).
 */
import {
  createBlankDraft,
  getStateFromZip,
  isUSStateCode,
  normalizeLegacyDraft,
  validate,
} from 'policyengine-household-wizard';

const FILING_TO_MARITAL = {
  SINGLE: 'single',
  HEAD_OF_HOUSEHOLD: 'single',
  JOINT: 'married',
  SEPARATE: 'married',
};

function maritalToFiling(maritalStatus, hasDependents) {
  if (maritalStatus === 'married') {
    return 'JOINT';
  }
  if (hasDependents) {
    return 'HEAD_OF_HOUSEHOLD';
  }
  return 'SINGLE';
}

function coerceNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonnegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeZip(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 5);
}

/** Cliff-watch-specific fields the shared draft doesn't carry. */
export const COST_FIELDS = [
  'childcare_expenses',
  'rent_annual',
  'utility_expense_annual',
  'food_expense_annual',
  'transportation_expense_annual',
  'health_insurance_premium_annual',
  'technology_expense_annual',
  'debt_payment_annual',
  'education_expense_annual',
  'other_expense_annual',
];

export const INCOME_AND_ASSET_FIELDS = [
  'self_employment_income_annual',
  'child_support_annual',
  'taxable_interest_income_annual',
  'dividend_income_annual',
  'rental_income_annual',
  'unemployment_compensation_annual',
  'pension_income_annual',
  'social_security_annual',
  'miscellaneous_income_annual',
  'liquid_assets',
];

function getProgramKeys(metadata) {
  const options = metadata?.public_assistance_programs;
  if (Array.isArray(options) && options.length > 0) {
    return options.map((program) => program.key);
  }
  return (metadata?.programs || []).map((program) => program.key);
}

/**
 * Build the parallel "scenario" state — every cliff-watch-specific field that
 * isn't part of the shared household contract.
 */
export function createInitialScenario(metadata) {
  return {
    chart_max_earned_income: Math.max(
      10000,
      Number(metadata?.defaults?.chart_max_earned_income)
        || Number(metadata?.defaults?.series_max_earned_income)
        || 100000,
    ),
    programs_mode: metadata?.defaults?.programs_mode || 'all',
    selected_programs: getProgramKeys(metadata),
    has_employer_health_insurance: false,
    ...Object.fromEntries(COST_FIELDS.map((field) => [field, 0])),
    ...Object.fromEntries(INCOME_AND_ASSET_FIELDS.map((field) => [field, 0])),
  };
}

/**
 * Map Cliff Watch's `inputs` object to the wizard's `USHouseholdDraft`.
 */
export function inputsToDraft(inputs) {
  if (!inputs) {
    return createBlankDraft();
  }
  const zip = normalizeZip(inputs.zip ?? inputs.zip_code);
  const stateFromZip = zip.length === 5 ? getStateFromZip(zip) : null;
  return normalizeLegacyDraft(
    {
      state: stateFromZip || (zip ? null : inputs.state),
      zip,
      county: inputs.county,
      filing_status: inputs.filing_status,
      marital_status: inputs.marital_status,
      people: inputs.people,
      year: inputs.year,
    },
    { year: inputs.year },
  );
}

/**
 * Extract the scenario half of a legacy `inputs` object — everything that
 * isn't part of the shared household contract.
 */
export function inputsToScenario(inputs, metadata) {
  if (!inputs) {
    return createInitialScenario(metadata);
  }
  const defaults = createInitialScenario(metadata);
  return {
    chart_max_earned_income:
      coerceNumber(inputs.chart_max_earned_income) ?? defaults.chart_max_earned_income,
    programs_mode: inputs.programs_mode ?? defaults.programs_mode,
    selected_programs: Array.isArray(inputs.selected_programs)
      ? inputs.selected_programs
      : defaults.selected_programs,
    has_employer_health_insurance: Boolean(inputs.has_employer_health_insurance),
    ...Object.fromEntries(
      COST_FIELDS.map((field) => [field, nonnegative(inputs[field])]),
    ),
    ...Object.fromEntries(
      INCOME_AND_ASSET_FIELDS.map((field) => [field, nonnegative(inputs[field])]),
    ),
  };
}

/**
 * Combine draft + scenario back into the legacy `inputs` shape that
 * `policyengineApi.js` and `dataLookup.js` still expect downstream. This is
 * the conversion shim at the payload boundary; once the rest of the data
 * pipeline migrates to `toV1HouseholdSituation`, this can disappear.
 */
export function combineDraftAndScenarioToInputs(draft, scenario, metadata) {
  const hasDependents = draft.people.some((person) => person.kind === 'dependent');
  let maritalStatus = '';
  if (draft.maritalStatus === 'married') {
    maritalStatus = 'MARRIED';
  } else if (draft.maritalStatus === 'single') {
    maritalStatus = 'UNMARRIED';
  }
  return {
    state: isUSStateCode(draft.state) ? draft.state : '',
    zip: normalizeZip(draft.zip),
    county: draft.county ?? null,
    marital_status: maritalStatus,
    filing_status: maritalToFiling(draft.maritalStatus, hasDependents),
    year: draft.year ?? metadata?.year ?? new Date().getUTCFullYear(),
    people: draft.people.map((person) => ({
      kind: person.kind === 'adult' ? 'adult' : 'child',
      age: person.age ?? '',
      is_pregnant: Boolean(person.isPregnant),
      is_disabled: Boolean(person.isDisabled),
      is_blind: Boolean(person.isBlind),
      is_full_time_student: Boolean(person.isFullTimeStudent),
      is_incapable_of_self_care: Boolean(person.needsCare),
      earned_income: coerceNumber(person.employmentIncome) ?? 0,
      ssi_amount: coerceNumber(person.ssiAmount) ?? 0,
      ssdi_amount: coerceNumber(person.ssdiAmount) ?? 0,
    })),
    ...scenario,
  };
}

/** Returns true when the wizard's required checks pass and at least one adult has a valid age. */
export function isDraftReady(draft) {
  return validate(draft).ok;
}

/** Legacy alias retained for the cliff-watch adapter PR's tests. */
export function draftToInputs(draft, defaults = {}) {
  const hasDependents = draft.people.some((person) => person.kind === 'dependent');
  return {
    ...defaults,
    state: draft.state ?? defaults.state ?? '',
    zip: normalizeZip(draft.zip ?? defaults.zip),
    county: draft.county ?? defaults.county ?? null,
    filing_status: maritalToFiling(draft.maritalStatus, hasDependents),
    year: draft.year,
    people: draft.people.map((person) => ({
      kind: person.kind === 'adult' ? 'adult' : 'child',
      age: person.age ?? '',
      is_pregnant: Boolean(person.isPregnant),
      is_disabled: Boolean(person.isDisabled),
      is_blind: Boolean(person.isBlind),
      is_full_time_student: Boolean(person.isFullTimeStudent),
      is_incapable_of_self_care: Boolean(person.needsCare),
      earned_income: coerceNumber(person.employmentIncome) ?? 0,
      ssi_amount: coerceNumber(person.ssiAmount) ?? 0,
      ssdi_amount: coerceNumber(person.ssdiAmount) ?? 0,
    })),
  };
}

export { FILING_TO_MARITAL };

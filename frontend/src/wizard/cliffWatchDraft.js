/**
 * Bridges Cliff Watch's existing `inputs` shape (filing-status-based, snake-case
 * people array) and the shared `policyengine-household-wizard` US household
 * draft contract. Phase 4 first-consumer integration for
 * https://github.com/PolicyEngine/policyengine-app-v2/issues/1044.
 *
 * Today this module only normalizes / serializes — the visual wizard migration
 * (replacing the flat InputPanel with `WizardOptionCard` and friends) follows
 * in a separate PR.
 */
import {
  createBlankDraft,
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

/**
 * Map Cliff Watch's `inputs` object to a shared `USHouseholdDraft`.
 *
 * - `filing_status` is collapsed to `maritalStatus` (single | married). Head of
 *   household and joint are both retained; the wizard re-derives them from
 *   marital status + dependents at submit time.
 * - The `people` array's snake_case fields and `kind: 'child'` are normalized
 *   to the camelCase / `'dependent'` shape the wizard uses.
 */
export function inputsToDraft(inputs) {
  if (!inputs) {
    return createBlankDraft(inputs?.year);
  }
  return normalizeLegacyDraft(
    {
      state: inputs.state,
      county: inputs.county,
      filing_status: inputs.filing_status,
      people: inputs.people,
      year: inputs.year,
    },
    { year: inputs.year },
  );
}

/**
 * Map a `USHouseholdDraft` back to Cliff Watch's `inputs` shape so existing
 * payload builders keep working while the visual migration lands.
 */
export function draftToInputs(draft, defaults = {}) {
  const hasDependents = draft.people.some((person) => person.kind === 'dependent');
  return {
    ...defaults,
    state: draft.state ?? defaults.state ?? '',
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

/** Returns true when the draft passes the shared wizard's required checks. */
export function isDraftReady(draft) {
  return validate(draft).ok;
}

export { FILING_TO_MARITAL };

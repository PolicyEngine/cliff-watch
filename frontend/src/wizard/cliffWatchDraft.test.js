import assert from 'node:assert/strict';
import test from 'node:test';

import { draftToInputs, inputsToDraft, isDraftReady } from './cliffWatchDraft.js';

const baseInputs = {
  state: 'CA',
  zip: '94612',
  county: null,
  filing_status: 'SINGLE',
  year: 2026,
  people: [
    {
      kind: 'adult',
      age: 30,
      is_disabled: false,
      is_blind: false,
      is_pregnant: false,
      is_full_time_student: false,
      is_incapable_of_self_care: false,
      earned_income: 50000,
      ssi_amount: 0,
      ssdi_amount: 0,
    },
  ],
};

test('inputsToDraft: SINGLE filing status becomes single marital status', () => {
  const draft = inputsToDraft(baseInputs);
  assert.equal(draft.maritalStatus, 'single');
  assert.equal(draft.state, 'CA');
  assert.equal(draft.zip, '94612');
  assert.equal(draft.people.length, 1);
  assert.equal(draft.people[0].kind, 'adult');
  assert.equal(draft.people[0].age, 30);
  assert.equal(draft.people[0].employmentIncome, 50000);
});

test('inputsToDraft: JOINT filing status becomes married marital status', () => {
  const draft = inputsToDraft({
    ...baseInputs,
    filing_status: 'JOINT',
    people: [
      ...baseInputs.people,
      { kind: 'adult', age: 28, earned_income: 20000 },
    ],
  });
  assert.equal(draft.maritalStatus, 'married');
  assert.equal(draft.people.length, 2);
});

test('inputsToDraft: HEAD_OF_HOUSEHOLD becomes single with dependents', () => {
  const draft = inputsToDraft({
    ...baseInputs,
    filing_status: 'HEAD_OF_HOUSEHOLD',
    people: [
      ...baseInputs.people,
      { kind: 'child', age: 6 },
    ],
  });
  assert.equal(draft.maritalStatus, 'single');
  const dependents = draft.people.filter((person) => person.kind === 'dependent');
  assert.equal(dependents.length, 1);
});

test('inputsToDraft: canonical county code passes through unchanged', () => {
  const draft = inputsToDraft({
    ...baseInputs,
    county: 'ALAMEDA_COUNTY_CA',
  });
  assert.equal(draft.county, 'ALAMEDA_COUNTY_CA');
});

test('inputsToDraft: ZIP code can derive state when state is absent', () => {
  const draft = inputsToDraft({
    ...baseInputs,
    state: null,
    zip: '30303',
  });
  assert.equal(draft.state, 'GA');
  assert.equal(draft.zip, '30303');
});

test('inputsToDraft: null input yields a blank draft', () => {
  const draft = inputsToDraft(null);
  assert.equal(draft.state, null);
  assert.deepEqual(draft.people, []);
});

test('draftToInputs: single marital status + dependents becomes HEAD_OF_HOUSEHOLD', () => {
  const draft = inputsToDraft({
    ...baseInputs,
    filing_status: 'SINGLE',
    people: [
      ...baseInputs.people,
      { kind: 'child', age: 8 },
    ],
  });
  const back = draftToInputs(draft);
  assert.equal(back.filing_status, 'HEAD_OF_HOUSEHOLD');
  assert.equal(back.people.length, 2);
  assert.equal(back.people[1].kind, 'child');
});

test('draftToInputs: married couple round-trips', () => {
  const inputs = {
    ...baseInputs,
    filing_status: 'JOINT',
    people: [
      ...baseInputs.people,
      { kind: 'adult', age: 28, earned_income: 25000 },
    ],
  };
  const back = draftToInputs(inputsToDraft(inputs));
  assert.equal(back.filing_status, 'JOINT');
  assert.equal(back.people.length, 2);
  assert.equal(back.people[0].earned_income, 50000);
  assert.equal(back.people[1].earned_income, 25000);
});

test('draftToInputs: single adult round-trips', () => {
  const back = draftToInputs(inputsToDraft(baseInputs));
  assert.equal(back.filing_status, 'SINGLE');
  assert.equal(back.zip, '94612');
  assert.equal(back.people[0].earned_income, 50000);
});

test('draftToInputs: missing person fields coerce to safe defaults', () => {
  const draft = inputsToDraft({
    state: 'NY',
    filing_status: 'SINGLE',
    year: 2026,
    people: [{ kind: 'adult', age: 40 }],
  });
  const back = draftToInputs(draft);
  assert.equal(back.people[0].is_disabled, false);
  assert.equal(back.people[0].earned_income, 0);
  assert.equal(back.people[0].ssi_amount, 0);
  assert.equal(back.people[0].ssdi_amount, 0);
});

test('isDraftReady: complete single-adult draft passes', () => {
  assert.equal(isDraftReady(inputsToDraft(baseInputs)), true);
});

test('isDraftReady: missing state fails', () => {
  const draft = inputsToDraft({ ...baseInputs, state: null, zip: null });
  assert.equal(isDraftReady(draft), false);
});

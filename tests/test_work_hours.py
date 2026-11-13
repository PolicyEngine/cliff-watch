"""CliffWatch's work-hours assumption.

policyengine-us reads missing hours as zero, and zero hours fail its work tests at
every earnings level. The form doesn't ask about hours, so the situation builders
send them.

Invariants, for every household the validator accepts:

- Every person aged 18 or over carries the assumed hours in every situation form,
  and nobody younger carries any.
- A childless adult keeps SNAP as earnings rise, a working parent keeps a child
  care subsidy, and a childless adult keeps Medicaid under the work test that starts
  in 2027: none of these may depend on the engine's default for hours.
"""

from __future__ import annotations

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from cliff_watch.calculator import (
    build_household_situation,
    build_household_variation_situation,
    calculate_income_series,
    household_input_from_dict,
)
from cliff_watch.config import (
    ASSUMED_ADULT_WEEKLY_HOURS,
    MIN_ADULT_AGE,
    WORK_HOURS_INPUTS,
)

YEAR = 2026


@st.composite
def households(draw):
    adults = draw(
        st.lists(st.integers(MIN_ADULT_AGE, 90), min_size=1, max_size=4),
    )
    children = draw(st.lists(st.integers(0, 22), max_size=4))
    return {
        "year": YEAR,
        "earned_income": draw(st.integers(0, 120_000)),
        "state": draw(st.sampled_from(["CA", "NY", "RI", "TX"])),
        "filing_status": "HEAD_OF_HOUSEHOLD",
        "people": [{"kind": "adult", "age": age} for age in adults]
        + [{"kind": "child", "age": age} for age in children],
    }


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(households())
def test_every_adult_and_nobody_else_carries_the_assumed_hours(raw):
    payload = household_input_from_dict(raw)
    for situation in (
        build_household_situation(payload),
        build_household_variation_situation(
            payload, max_earned_income=60_000, count=3
        ),
    ):
        for person in situation["people"].values():
            for variable in WORK_HOURS_INPUTS:
                if person["age"][YEAR] >= MIN_ADULT_AGE:
                    assert person[variable] == {YEAR: ASSUMED_ADULT_WEEKLY_HOURS}
                else:
                    assert variable not in person


def _series(raw, year=YEAR):
    payload = household_input_from_dict({"year": year, "earned_income": 0, **raw})
    return calculate_income_series(payload, max_earned_income=20_000, step=5_000)[
        "data"
    ]


def test_a_childless_adult_keeps_snap_as_earnings_rise():
    rows = _series(
        {
            "state": "TX",
            "filing_status": "SINGLE",
            "people": [{"kind": "adult", "age": 30}],
            "rent_annual": 9_600,
        }
    )
    snap = {row["earned_income"]: row["snap"] for row in rows}
    # Zero hours would fail the SNAP time limit's work test at all of these.
    assert all(snap[earnings] > 0 for earnings in (0, 5_000, 10_000, 15_000))


def test_a_working_parent_keeps_a_child_care_subsidy():
    rows = _series(
        {
            "state": "RI",
            "filing_status": "HEAD_OF_HOUSEHOLD",
            "people": [{"kind": "adult", "age": 30}, {"kind": "child", "age": 3}],
            "childcare_expenses": 8_000,
        }
    )
    # Zero hours would fail Rhode Island's activity test at every one of these.
    assert all(row["child_care_subsidies"] > 0 for row in rows[1:])


def test_a_childless_adult_keeps_medicaid_under_the_2027_work_test():
    rows = _series(
        {
            "state": "CA",
            "filing_status": "SINGLE",
            "people": [{"kind": "adult", "age": 30}],
        },
        year=2027,
    )
    medicaid = {row["earned_income"]: row["medicaid"] for row in rows}
    # Without hours, earnings below the test's income line would lose Medicaid.
    assert all(medicaid[earnings] > 0 for earnings in (0, 5_000, 10_000))

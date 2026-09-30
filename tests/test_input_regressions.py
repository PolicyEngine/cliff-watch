"""Regression tests for inputs that used to reach the wrong policyengine-us variable.

Each case failed before the inputs moved from totals and derived variables to
the components that rules read. Values are for the pinned policyengine-us.
"""

from __future__ import annotations

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from cliff_watch.calculator import (
    build_household_situation,
    calculate_household,
    calculate_income_series,
    household_input_from_dict,
)
from cliff_watch.config import STATE_TANF_VARIABLES

YEAR = 2026


def _simulate(raw):
    from policyengine_us import Simulation

    payload = household_input_from_dict({"year": YEAR, **raw})
    return Simulation(situation=build_household_situation(payload))


def _series(raw, **kwargs):
    payload = household_input_from_dict({"year": YEAR, **raw})
    return calculate_income_series(payload, **kwargs)["data"]


def test_pension_reaches_agi_and_state_pension_exclusion():
    simulation = _simulate(
        {
            "state": "NY",
            "filing_status": "SINGLE",
            "people": [{"kind": "adult", "age": 67}],
            "pension_income_annual": 30_000,
        }
    )
    assert simulation.calculate("adjusted_gross_income", YEAR)[0] == 30_000
    assert simulation.calculate("ny_pension_exclusion", YEAR)[0] == 20_000


def test_social_security_reaches_calworks_unearned_income():
    simulation = _simulate(
        {
            "state": "CA",
            "filing_status": "HEAD_OF_HOUSEHOLD",
            "people": [{"kind": "adult", "age": 60}, {"kind": "child", "age": 5}],
            "social_security_annual": 14_000,
        }
    )
    unearned = simulation.calculate("ca_tanf_other_unearned_income", f"{YEAR}-01")[0]
    assert unearned == pytest.approx(14_000 / 12)


def test_tanf_phases_out_when_a_second_adult_has_wages():
    """A tanf_gross_earned_income input on the second adult froze the head's at 0."""
    data = _series(
        {
            "state": "NY",
            "filing_status": "JOINT",
            "people": [
                {"kind": "adult", "age": 30},
                {"kind": "adult", "age": 29, "earned_income": 3_000},
                {"kind": "child", "age": 3},
            ],
        },
        max_earned_income=40_000,
        step=5_000,
    )
    assert data[0]["tanf"] > 0
    assert data[-1]["tanf"] == 0


def test_self_employment_income_counts_toward_tanf_earned_income():
    simulation = _simulate(
        {
            "state": "NY",
            "earned_income": 6_000,
            "filing_status": "HEAD_OF_HOUSEHOLD",
            "people": [{"kind": "adult", "age": 30}, {"kind": "child", "age": 3}],
            "self_employment_income_annual": 6_000,
        }
    )
    earned = simulation.calculate("tanf_gross_earned_income", f"{YEAR}-01")[0]
    assert earned == pytest.approx(12_000 / 12)


def test_utilities_qualify_snap_for_the_standard_utility_allowance():
    raw = {
        "state": "TX",
        "earned_income": 20_000,
        "filing_status": "HEAD_OF_HOUSEHOLD",
        "people": [
            {"kind": "adult", "age": 30},
            {"kind": "child", "age": 5},
            {"kind": "child", "age": 8},
        ],
        "rent_annual": 12_000,
    }
    without = _simulate(raw)
    with_utilities = _simulate({**raw, "utility_expense_annual": 3_600})
    allowance_type = with_utilities.calculate(
        "snap_utility_allowance_type", f"{YEAR}-01"
    )
    assert allowance_type.decode_to_str()[0] == "SUA"
    assert (
        with_utilities.calculate("snap", f"{YEAR}-01").sum()
        > without.calculate("snap", f"{YEAR}-01").sum()
    )


def test_savings_count_toward_the_ssi_resource_test():
    simulation = _simulate(
        {
            "state": "TX",
            "filing_status": "SINGLE",
            "people": [{"kind": "adult", "age": 70}],
            "liquid_assets": 5_000,
        }
    )
    assert simulation.calculate("ssi_countable_resources", YEAR)[0] == 5_000
    assert simulation.calculate("ssi", YEAR)[0] == 0


def test_savings_count_toward_state_tanf_resource_tests():
    raw = {
        "state": "TX",
        "filing_status": "HEAD_OF_HOUSEHOLD",
        "people": [
            {"kind": "adult", "age": 30},
            {"kind": "child", "age": 5},
            {"kind": "child", "age": 8},
        ],
        "rent_annual": 12_000,
    }
    assert _simulate(raw).calculate("tx_tanf", f"{YEAR}-01")[0] > 0
    with_savings = _simulate({**raw, "liquid_assets": 3_000})
    assert with_savings.calculate("spm_unit_cash_assets", YEAR)[0] == 3_000
    assert with_savings.calculate("tx_tanf", f"{YEAR}-01")[0] == 0


def test_savings_go_to_the_spouse_who_could_claim_ssi():
    situation = build_household_situation(
        household_input_from_dict(
            {
                "state": "TX",
                "year": YEAR,
                "filing_status": "JOINT",
                "people": [{"kind": "adult", "age": 50}, {"kind": "adult", "age": 70}],
                "liquid_assets": 5_000,
            }
        )
    )
    assert "bank_account_assets" not in situation["people"]["adult_1"]
    assert situation["people"]["adult_2"]["bank_account_assets"] == {YEAR: 5_000}


# The single-household endpoint and the earnings series share one builder, so at
# the same earnings they must agree on every displayed number.
DISPLAYED_PROGRAMS = (
    "snap",
    "tanf",
    "wic",
    "free_school_meals",
    "head_start",
    "early_head_start",
    "child_care_subsidies",
    "housing_assistance",
    "ssi",
    "ssdi",
    "medicaid",
    "chip",
    "aca_ptc",
    "federal_refundable_credits",
    "state_refundable_credits",
)


@settings(max_examples=8, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    state=st.sampled_from(sorted(STATE_TANF_VARIABLES)),
    head_age=st.integers(18, 80),
    married=st.booleans(),
    children=st.lists(st.integers(0, 17), max_size=3),
    earnings_step=st.integers(0, 8),
    second_wages=st.sampled_from([0, 4_000]),
    income=st.fixed_dictionaries(
        {
            "self_employment_income_annual": st.sampled_from([0, 5_000]),
            "social_security_annual": st.sampled_from([0, 12_000]),
            "pension_income_annual": st.sampled_from([0, 9_000]),
            "public_pension_income_annual": st.sampled_from([0, 6_000]),
            "dividend_income_annual": st.sampled_from([0, 2_000]),
            "utility_expense_annual": st.sampled_from([0, 3_600]),
            "liquid_assets": st.sampled_from([0, 2_500]),
        }
    ),
)
def test_household_path_matches_the_series_at_the_same_earnings(
    state, head_age, married, children, earnings_step, second_wages, income
):
    earnings = earnings_step * 5_000
    people = [{"kind": "adult", "age": head_age}]
    if married:
        people.append({"kind": "adult", "age": 40, "earned_income": second_wages})
    people += [{"kind": "child", "age": age} for age in children]
    raw = {
        "state": state,
        "year": YEAR,
        "filing_status": "JOINT"
        if married
        else ("HEAD_OF_HOUSEHOLD" if children else "SINGLE"),
        "people": people,
        "rent_annual": 12_000,
        **income,
    }
    point = calculate_household(
        household_input_from_dict({**raw, "earned_income": earnings})
    )
    series = _series(raw, max_earned_income=40_000, step=5_000)
    series_point = next(
        item
        for item in series
        if item["earned_income"] == earnings + (second_wages if married else 0)
    )
    # The paths round to cents at different steps, so allow a few cents.
    for program in DISPLAYED_PROGRAMS:
        assert point["programs"][program] == pytest.approx(
            series_point[program], abs=0.05
        ), program
    assert point["totals"]["taxes"] == pytest.approx(series_point["taxes"], abs=0.05)
    assert point["totals"]["net_resources"] == pytest.approx(
        series_point["net_resources"], abs=0.05
    )

"""Part-year SNAP and the programs policyengine-us grants for the whole year.

policyengine-us tests categorical eligibility for Head Start, Early Head Start and
free school meals over the whole year, so a household that gets SNAP only from
October gets a full year of each. /api/series lists the months with SNAP on each
point (`snap_months`) and marks the programs a point gets for the whole year only
through those months (`part_year_snap_programs`); the chart note reads both.

The Georgia pins hold for policyengine-us 1.755.5. When CliffWatch's engine counts
these programs from the first month of SNAP (PolicyEngine/policyengine-us#10766),
they fail, and the chart note should go.
"""

from __future__ import annotations

import pytest

pytest.importorskip("policyengine_us")

from cliff_watch.calculator import (
    PART_YEAR_SNAP_PROGRAMS,
    _load_simulation,
    build_household_variation_situation,
    calculate_income_series,
    household_input_from_dict,
)

YEAR = 2026
ALL_YEAR = list(range(1, 13))


def _adult(age):
    return {"kind": "adult", "age": age}


def _child(age):
    return {"kind": "child", "age": age}


GEORGIA = {"state": "GA", "zip": "30303", "people": [_adult(30), _child(4)]}


def _payload(raw):
    return household_input_from_dict({"year": YEAR, **raw})


def test_georgia_parent_gets_head_start_without_snap_until_october():
    series = calculate_income_series(
        _payload(GEORGIA),
        min_earned_income=26_500,
        max_earned_income=29_000,
        step=500,
    )["data"]
    by_wages = {round(point["earned_income"]): point for point in series}
    assert set(by_wages) >= {27_000, 27_500, 28_000, 28_500, 29_000}

    # SNAP all year beside Head Start: no mark.
    assert by_wages[27_000]["snap_months"] == ALL_YEAR
    assert by_wages[27_000]["snap"] > 0
    assert by_wages[27_000]["part_year_snap_programs"] == []

    # SNAP from October only. The chart reads January, so it shows no SNAP, while
    # the engine grants Head Start for the whole year.
    for wages in (27_500, 28_000):
        point = by_wages[wages]
        assert point["snap_months"] == [10, 11, 12]
        assert point["snap"] == 0
        assert point["head_start"] == pytest.approx(13_086)
        assert point["part_year_snap_programs"] == ["head_start"]

    # No SNAP in any month, and no Head Start.
    for wages in (28_500, 29_000):
        point = by_wages[wages]
        assert point["snap_months"] == []
        assert point["head_start"] == 0
        assert point["part_year_snap_programs"] == []


# Households from the differential check behind this change, each with the points
# it marks on a series from $0 to $80,000 in $500 steps.
CASES = {
    "Georgia parent of a 4-year-old": (
        GEORGIA,
        {27_500: ["head_start"], 28_000: ["head_start"]},
    ),
    "Nevada couple with a 1-year-old": (
        {
            "state": "NV",
            "marital_status": "MARRIED",
            "people": [_adult(30), _adult(30), _child(1)],
        },
        {42_500: ["early_head_start"], 43_000: ["early_head_start"]},
    ),
    "Texas parent of children 7 and 10": (
        {"state": "TX", "people": [_adult(35), _child(7), _child(10)]},
        {42_500: ["free_school_meals"], 43_000: ["free_school_meals"]},
    ),
    # California serves free school meals to every student, so a month of SNAP
    # adds nothing there.
    "California parent of an 8-year-old": (
        {"state": "CA", "people": [_adult(35), _child(8)]},
        {},
    ),
    # Child support lifts this parent's SNAP limit earlier; past it, the household
    # passes Head Start's own income test at some points.
    "Georgia parent of a 4-year-old with child support": (
        {**GEORGIA, "child_support_annual": 6_000},
        {22_000: ["head_start"]},
    ),
}


@pytest.mark.parametrize("raw, marks", CASES.values(), ids=CASES.keys())
def test_marks_match_the_engine_without_categorical_eligibility(raw, marks):
    """A point marks a program exactly when switching categorical eligibility off
    lowers it, on a point with SNAP in 1 to 11 months and no TANF or SSI."""
    payload = _payload(raw)
    series = calculate_income_series(payload, max_earned_income=80_000, step=500)[
        "data"
    ]
    wages = [point["earned_income"] for point in series]

    situation = build_household_variation_situation(
        payload,
        max_earned_income=int(wages[-1]),
        count=len(wages),
        min_earned_income=int(wages[0]),
    )
    for person in situation["people"].values():
        person["is_head_start_categorically_eligible"] = {YEAR: False}
    for unit in situation["spm_units"].values():
        unit["meets_school_meal_categorical_eligibility"] = {YEAR: False}
    simulation = _load_simulation()(situation=situation)
    assert [
        round(value)
        for value in simulation.calculate(
            "employment_income", YEAR, map_to="household"
        ).tolist()
    ] == [round(value) for value in wages]
    without = {
        program: simulation.calculate(program, YEAR, map_to="household").tolist()
        for program in PART_YEAR_SNAP_PROGRAMS
    }

    observed = {}
    for index, point in enumerate(series):
        part_year = (
            0 < len(point["snap_months"]) < 12
            and point["tanf"] <= 0
            and point["ssi"] <= 0
        )
        expected = [
            program
            for program in PART_YEAR_SNAP_PROGRAMS
            if part_year
            and point[program] > 0
            and without[program][index] < point[program] - 0.01
        ]
        assert point["part_year_snap_programs"] == expected, point["earned_income"]
        if expected:
            observed[round(point["earned_income"])] = expected
    assert observed == marks

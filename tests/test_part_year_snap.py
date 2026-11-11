"""Part-year SNAP and the programs policyengine-us grants for the whole year.

policyengine-us tests categorical eligibility for Head Start, Early Head Start and
free school meals over the whole year, so a household that gets SNAP only from
October gets a full year of each. /api/series lists the months with SNAP on each
point (`snap_months`) and marks the programs a point gets for the whole year only
through those months (`part_year_snap_programs`); the chart note reads both.

The Georgia pins hold for policyengine-us 1.755.5. Drop or rework the chart note
once CliffWatch charts SNAP's annual sum (#45) or runs a policyengine-us release
that counts these programs from the first month of SNAP
(PolicyEngine/policyengine-us#10766). Either change makes these tests fail.
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
    # SNAP counts child support and AGI doesn't. So this parent gets SNAP from
    # October at $21,500 and $22,000 of wages, but at $21,500 the household still
    # passes Head Start's income test, and only $22,000 gets a mark.
    "Georgia parent of a 4-year-old with child support": (
        {**GEORGIA, "child_support_annual": 6_000},
        {22_000: ["head_start"]},
    ),
    # Free school meals count Social Security in full, while Head Start's income
    # test reads AGI. At $22,000 the household gets SNAP from October and its
    # school-meal income exceeds the free limit, but the 4-year-old passes Head
    # Start's income test, and a child eligible for Head Start keeps the free
    # meals without SNAP.
    "Texas disabled parent on SSDI with children 4 and 8": (
        {
            "state": "TX",
            "rent_annual": 18_000,
            "people": [
                {**_adult(35), "is_disabled": True, "ssdi_amount": 18_000},
                _child(4),
                _child(8),
            ],
        },
        {},
    ),
    # SSI makes a household categorically eligible for Head Start but not for
    # school meals, so these meals rest on SNAP alone.
    "Texas parent of an 8-year-old on SSI and a 10-year-old": (
        {
            "state": "TX",
            "people": [_adult(35), {**_child(8), "ssi_amount": 6_000}, _child(10)],
        },
        {35_000: ["free_school_meals"], 35_500: ["free_school_meals"]},
    ),
    # Here SSI goes to the 4-year-old, who keeps Head Start without SNAP and, as
    # a child eligible for Head Start, keeps the household's free meals too.
    "Texas parent of a 4-year-old on SSI and an 8-year-old": (
        {
            "state": "TX",
            "people": [_adult(35), {**_child(4), "ssi_amount": 6_000}, _child(8)],
        },
        {},
    ),
    # At $27,500 and $28,000 this household gets SNAP from October, and its
    # income stays within the free-meal limit, so its meals don't rest on SNAP.
    "Georgia parent of a 7-year-old": (
        {**GEORGIA, "people": [_adult(30), _child(7)]},
        {},
    ),
}


@pytest.mark.parametrize("raw, marks", CASES.values(), ids=CASES.keys())
def test_marks_match_the_engine_without_snap(raw, marks):
    """A point marks a program exactly when the household gets it, gets SNAP in
    1 to 11 months, and loses some of it when the engine reruns the series with
    SNAP turned off."""
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
    for unit in situation["spm_units"].values():
        unit["takes_up_snap_if_eligible"] = {YEAR: False}
    simulation = _load_simulation()(situation=situation)
    assert [
        round(value)
        for value in simulation.calculate(
            "employment_income", YEAR, map_to="household"
        ).tolist()
    ] == [round(value) for value in wages]
    assert not any(simulation.calculate("snap", YEAR, map_to="household").tolist())
    without_snap = {
        program: simulation.calculate(program, YEAR, map_to="household").tolist()
        for program in PART_YEAR_SNAP_PROGRAMS
    }

    observed = {}
    for index, point in enumerate(series):
        expected = [
            program
            for program in PART_YEAR_SNAP_PROGRAMS
            if 0 < len(point["snap_months"]) < 12
            and point[program] > 0
            and without_snap[program][index] < point[program] - 0.01
        ]
        assert point["part_year_snap_programs"] == expected, point["earned_income"]
        if expected:
            observed[round(point["earned_income"])] = expected
    assert observed == marks

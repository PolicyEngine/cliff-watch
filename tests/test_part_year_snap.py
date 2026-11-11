"""Part-year SNAP and the programs policyengine-us grants for the whole year.

policyengine-us tests categorical eligibility for Head Start, Early Head Start and
free school meals over the whole year, so a household that gets SNAP only from
October gets a full year of each. /api/series lists the months with SNAP on each
point (`snap_months`) and marks the programs a point gets for the whole year only
through those months (`part_year_snap_programs`); the chart note reads both.

The Georgia pins hold for policyengine-us 1.755.5. Drop or rework the chart note
once CliffWatch charts SNAP's annual sum (#45) or runs a policyengine-us release
that counts these programs from the first month of SNAP
(PolicyEngine/policyengine-us#10766). Either change makes the Georgia test fail.
"""

from __future__ import annotations

import copy

import pytest

pytest.importorskip("policyengine_us")

from cliff_watch import calculator
from cliff_watch.calculator import (
    PART_YEAR_SNAP_PROGRAMS,
    PUBLIC_ASSISTANCE_PROGRAM_KEYS,
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
    # Any member's SSI makes the household categorically eligible for Head
    # Start, so the 4-year-old keeps Head Start without SNAP and, as a child
    # eligible for Head Start, keeps the household's free meals too.
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


def _count_engine_builds(monkeypatch):
    """The situations of the simulations each series call builds: one for the
    series, and one more when CliffWatch reruns it with SNAP turned off."""
    simulation_class = _load_simulation()
    built = []

    def build(*args, **kwargs):
        built.append(kwargs.get("situation"))
        return simulation_class(*args, **kwargs)

    monkeypatch.setattr(calculator, "_load_simulation", lambda: build)
    return built


def _series_by_wages(raw, min_earned_income, max_earned_income):
    series = calculate_income_series(
        _payload(raw),
        min_earned_income=min_earned_income,
        max_earned_income=max_earned_income,
        step=500,
    )["data"]
    return {round(point["earned_income"]): point for point in series}


def test_a_deselected_program_gets_no_mark_and_no_rerun(monkeypatch):
    """policyengine-us computes free school meals whether or not the user charts
    them, and CliffWatch zeroes them only for display. Left out of the chart,
    they get no mark, and with nothing else at these points that could fall,
    CliffWatch skips the rerun."""
    built = _count_engine_builds(monkeypatch)
    texas = {"state": "TX", "people": [_adult(35), _child(7), _child(10)]}

    charted = _series_by_wages(texas, 41_500, 44_000)
    assert len(built) == 2
    built.clear()
    left_out = _series_by_wages(
        {
            **texas,
            "programs_mode": "custom",
            "selected_programs": sorted(
                PUBLIC_ASSISTANCE_PROGRAM_KEYS - {"free_school_meals"}
            ),
        },
        41_500,
        44_000,
    )
    assert len(built) == 1

    for wages in (42_500, 43_000):
        assert charted[wages]["part_year_snap_programs"] == ["free_school_meals"]
        assert left_out[wages]["snap_months"] == [10, 11, 12]
        assert left_out[wages]["free_school_meals"] == 0
        assert left_out[wages]["part_year_snap_programs"] == []


def test_free_meals_in_a_universal_meal_state_skip_the_rerun(monkeypatch):
    """California serves free meals to every student. At $30,000 this household
    gets SNAP in part of the year and free meals, and no other program, so
    CliffWatch skips the rerun."""
    built = _count_engine_builds(monkeypatch)
    by_wages = _series_by_wages(
        {"state": "CA", "people": [_adult(35), _child(8)]}, 29_000, 31_000
    )
    point = by_wages[30_000]
    assert 0 < len(point["snap_months"]) < 12
    assert point["free_school_meals"] > 0
    assert point["head_start"] == point["early_head_start"] == 0
    assert all(not point["part_year_snap_programs"] for point in by_wages.values())
    assert len(built) == 1


def test_snap_moves_no_free_meals_where_every_student_eats_free():
    """CliffWatch skips the rerun for free meals wherever
    state_has_universal_free_school_meals holds. That rests on policyengine-us
    giving those households the same free meals with or without SNAP, which
    this checks in every state the installed release lists, for a parent of an
    8-year-old from $0 to $80,000 of wages."""
    simulation_class = _load_simulation()
    universal_meals = simulation_class(
        situation=build_household_variation_situation(
            _payload(GEORGIA), max_earned_income=1_000, count=2
        )
    ).tax_benefit_system.parameters.gov.usda.school_meals.state_universal_free_meals
    states = [
        state
        for state, parameter in universal_meals.children.items()
        if parameter(f"{YEAR}-01-01")
    ]
    assert "CA" in states

    def household(simulation, variable):
        return simulation.calculate(variable, YEAR, map_to="household").tolist()

    for state in states:
        situation = build_household_variation_situation(
            _payload({"state": state, "people": [_adult(35), _child(8)]}),
            max_earned_income=80_000,
            count=81,
            min_earned_income=0,
        )
        situation_without_snap = copy.deepcopy(situation)
        for unit in situation_without_snap["spm_units"].values():
            unit["takes_up_snap_if_eligible"] = {YEAR: False}
        with_snap = simulation_class(situation=situation)
        without_snap = simulation_class(situation=situation_without_snap)

        assert all(household(with_snap, "state_has_universal_free_school_meals")), state
        assert any(household(with_snap, "snap")), state
        assert not any(household(without_snap, "snap")), state
        meals = household(with_snap, "free_school_meals")
        assert all(value > 0 for value in meals), state
        assert household(without_snap, "free_school_meals") == pytest.approx(meals), (
            state
        )

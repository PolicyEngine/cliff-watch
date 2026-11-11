"""When CliffWatch reruns a series with SNAP turned off, on a stub engine.

`_part_year_snap_by_point` marks a program at a point where the household gets
it, gets SNAP in 1 to 11 months, and loses some of it in a rerun without SNAP.
The rerun costs most of a second, so CliffWatch skips it for a series with no
point where a program on the chart could fall. These tests feed the function a
stub engine, so they need no policyengine-us release: they pin which points get
a mark, when the rerun runs, and what situation it gets.
tests/test_part_year_snap.py runs the real engine.
"""

from __future__ import annotations

import copy
from types import SimpleNamespace

import pytest

from cliff_watch.calculator import (
    _PART_YEAR_SNAP_VARIABLES,
    PART_YEAR_SNAP_PROGRAMS,
    _part_year_snap_by_point,
)

YEAR = 2026
ALL_YEAR = list(range(1, 13))
OCTOBER_ON = [10, 11, 12]
HEAD_START = 13_086.0
FREE_MEALS = 1_130.96
SITUATION = {
    "people": {"parent": {"age": {YEAR: 30}}, "child": {"age": {YEAR: 8}}},
    "spm_units": {
        "spm_unit": {
            "members": ["parent", "child"],
            "takes_up_snap_if_eligible": {YEAR: True},
        }
    },
}


def _point(snap_months, with_snap, without_snap=None):
    """A series point: the months with SNAP, and each program's annual value
    with SNAP and in the rerun without it (the same unless given)."""
    return {
        "snap_months": snap_months,
        "with_snap": with_snap,
        "without_snap": with_snap if without_snap is None else without_snap,
    }


def _stub_engine(points, *, universal_meals=None, missing=()):
    """A stub Simulation class over `points`, and the list of situations it was
    built from. It turns SNAP off where every SPM unit sets
    takes_up_snap_if_eligible to {YEAR: False}. With universal_meals None, it
    leaves out state_has_universal_free_school_meals, as an older
    policyengine-us release would."""
    known = set(_PART_YEAR_SNAP_VARIABLES) - set(missing)
    if universal_meals is not None:
        known.add("state_has_universal_free_school_meals")
    built = []

    class Simulation:
        tax_benefit_system = SimpleNamespace(variables=dict.fromkeys(known))

        def __init__(self, situation):
            built.append(copy.deepcopy(situation))
            self.snap_off = all(
                unit.get("takes_up_snap_if_eligible") == {YEAR: False}
                for unit in situation["spm_units"].values()
            )

        def calculate(self, variable, period, map_to=None):
            assert map_to == "household"
            if variable == "snap":
                month = int(period.split("-")[1])
                return [
                    0.0 if self.snap_off or month not in point["snap_months"] else 150.0
                    for point in points
                ]
            assert period == YEAR
            if variable == "state_has_universal_free_school_meals":
                return [universal_meals] * len(points)
            key = "without_snap" if self.snap_off else "with_snap"
            return [point[key].get(variable, 0.0) for point in points]

    return Simulation, built


def _run(points, **kwargs):
    """The months and marks for each point, the situations of any reruns, and
    the caller's situation after the call."""
    included = kwargs.pop("included_programs", PART_YEAR_SNAP_PROGRAMS)
    Simulation, built = _stub_engine(points, **kwargs)
    situation = copy.deepcopy(SITUATION)
    months, flags = _part_year_snap_by_point(
        Simulation(situation=situation),
        situation,
        YEAR,
        simulation_class=Simulation,
        point_count=len(points),
        included_programs=included,
    )
    marks = [
        [program for program in PART_YEAR_SNAP_PROGRAMS if flag[program]]
        for flag in flags
    ]
    return months, marks, built[1:], situation


def test_marks_programs_that_fall_with_snap_in_one_to_eleven_months():
    points = [
        # SNAP all year: no mark, whatever the rerun says.
        _point(ALL_YEAR, {"head_start": HEAD_START}, {"head_start": 0.0}),
        # One month of SNAP, and Head Start rests on it.
        _point([12], {"head_start": HEAD_START}, {"head_start": 0.0}),
        # Eleven months, and free meals rest on them.
        _point(list(range(2, 13)), {"free_school_meals": FREE_MEALS}, {}),
        # Head Start stays without SNAP through another route.
        _point(OCTOBER_ON, {"head_start": HEAD_START}),
        # No SNAP in any month.
        _point([], {"head_start": HEAD_START}, {"head_start": 0.0}),
        # Early Head Start falls by 50 cents, which counts.
        _point(
            OCTOBER_ON,
            {"early_head_start": 15_000.0},
            {"early_head_start": 14_999.5},
        ),
        # A fall within a cent doesn't count.
        _point(
            OCTOBER_ON,
            {"free_school_meals": FREE_MEALS},
            {"free_school_meals": FREE_MEALS - 0.005},
        ),
        # Head Start falls while free meals stay: only Head Start gets a mark.
        _point(
            OCTOBER_ON,
            {"head_start": HEAD_START, "free_school_meals": FREE_MEALS},
            {"free_school_meals": FREE_MEALS},
        ),
    ]
    months, marks, reruns, _ = _run(points)
    assert months == [point["snap_months"] for point in points]
    assert marks == [
        [],
        ["head_start"],
        ["free_school_meals"],
        [],
        [],
        ["early_head_start"],
        [],
        ["head_start"],
    ]
    assert len(reruns) == 1


def test_rerun_turns_snap_off_in_a_copy_of_the_situation():
    points = [_point(OCTOBER_ON, {"head_start": HEAD_START}, {"head_start": 0.0})]
    _, marks, reruns, situation = _run(points)
    assert marks == [["head_start"]]
    (rerun,) = reruns
    without_snap = copy.deepcopy(SITUATION)
    without_snap["spm_units"]["spm_unit"]["takes_up_snap_if_eligible"] = {YEAR: False}
    assert rerun == without_snap
    assert situation == SITUATION


@pytest.mark.parametrize(
    "points, kwargs",
    [
        pytest.param(
            [_point(ALL_YEAR, {"head_start": HEAD_START}, {"head_start": 0.0})],
            {},
            id="SNAP all year",
        ),
        pytest.param(
            [_point([], {"head_start": HEAD_START}, {"head_start": 0.0})],
            {},
            id="no SNAP",
        ),
        pytest.param([_point(OCTOBER_ON, {})], {}, id="no program"),
        # In a state that serves free meals to every student, policyengine-us
        # gives the free tier with or without SNAP.
        pytest.param(
            [_point(OCTOBER_ON, {"free_school_meals": FREE_MEALS})],
            {"universal_meals": True},
            id="free meals in a universal-meal state",
        ),
        # The engine computes free meals the user left out of the chart, and
        # the chart drops them, so they can't get a mark.
        pytest.param(
            [_point(OCTOBER_ON, {"free_school_meals": FREE_MEALS}, {})],
            {
                "included_programs": ["head_start", "early_head_start"],
                "universal_meals": False,
            },
            id="free meals left out of the chart",
        ),
    ],
)
def test_skips_the_rerun_where_no_program_could_fall(points, kwargs):
    months, marks, reruns, _ = _run(points, **kwargs)
    assert months == [point["snap_months"] for point in points]
    assert marks == [[] for _ in points]
    assert reruns == []


def test_universal_meals_still_get_the_rerun_for_head_start():
    points = [
        _point(
            OCTOBER_ON,
            {"head_start": HEAD_START, "free_school_meals": FREE_MEALS},
            {"free_school_meals": FREE_MEALS},
        ),
        _point(OCTOBER_ON, {"free_school_meals": FREE_MEALS}),
    ]
    _, marks, reruns, _ = _run(points, universal_meals=True)
    assert marks == [["head_start"], []]
    assert len(reruns) == 1


def test_programs_left_out_of_the_chart_get_no_mark():
    points = [
        _point(
            OCTOBER_ON,
            {"head_start": HEAD_START, "free_school_meals": FREE_MEALS},
            {},
        )
    ]
    _, marks, reruns, _ = _run(
        points,
        included_programs=["head_start", "early_head_start"],
        universal_meals=False,
    )
    assert marks == [["head_start"]]
    assert len(reruns) == 1


def test_without_the_universal_meal_variable_free_meals_get_the_rerun():
    points = [_point(OCTOBER_ON, {"free_school_meals": FREE_MEALS}, {})]
    _, marks, reruns, _ = _run(points, universal_meals=None)
    assert marks == [["free_school_meals"]]
    assert len(reruns) == 1


@pytest.mark.parametrize("variable", _PART_YEAR_SNAP_VARIABLES)
def test_without_a_snap_variable_nothing_gets_a_mark(variable):
    points = [_point(OCTOBER_ON, {"head_start": HEAD_START}, {"head_start": 0.0})]
    months, marks, reruns, _ = _run(points, missing=[variable])
    assert months == [[]]
    assert marks == [[]]
    assert reruns == []

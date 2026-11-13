"""The bridge from CliffWatch's situations to calculate_household.

Invariants, for every household the validator accepts:

- ``household_kwargs`` keeps every input the situation set, and puts each person
  in exactly one marital unit.
- ``HouseholdCalculation`` lays results out the way ``Simulation.calculate`` does,
  and a person variable mapped to a group is the sum over people at each point.
- Every read the calculator makes returns what a direct policyengine-us
  ``Simulation`` of the same situation returns (a differential test).
- The calculation completes: since the port no TANF or child care read can fail
  on its own, because calculate_household computes them all together.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from cliff_watch import calculator
from cliff_watch.calculator import (
    ENGINE_VARIABLES,
    build_household_situation,
    build_household_variation_situation,
    calculate_household,
    calculate_income_series,
    household_input_from_dict,
)
from cliff_watch.config import CCDF_MODELED_STATES, STATE_NAME_BY_CODE
from cliff_watch.engine import (
    SPM_SELECTION,
    HouseholdCalculation,
    household_kwargs,
    run_household,
)
from tests.test_payload_invariants import YEAR, raw_payloads

REPO = Path(__file__).resolve().parents[1]
ENGINE_SETTINGS = settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[
        HealthCheck.too_slow,
        HealthCheck.function_scoped_fixture,
    ],
)


def _situations(payload):
    yield build_household_situation(payload)
    yield build_household_variation_situation(payload, max_earned_income=60000, count=3)


def _periods(year=YEAR, value=True):
    return {f"{year}-{month:02d}": value for month in range(1, 13)}


# ---------------------------------------------------------------------------
# household_kwargs


def _situation(**overrides):
    everyone = ["a", "b", "c"]
    return {
        "people": {
            "a": {"age": {YEAR: 40}, "employment_income": {YEAR: None}},
            "b": {"age": {YEAR: 38}, "receives_wic": _periods()},
            "c": {"age": {YEAR: 5}},
        },
        "families": {"family": {"members": everyone}},
        "spm_units": {
            "spm_unit": {"members": everyone, "is_tanf_enrolled": _periods()}
        },
        "tax_units": {
            "tax_unit": {"members": everyone, "filing_status": {YEAR: "JOINT"}}
        },
        "households": {"household": {"members": everyone, "state_name": {YEAR: "CA"}}},
        "marital_units": {"couple": {"members": ["a", "b"]}},
        **overrides,
    }


def test_kwargs_turn_periods_into_annual_values():
    kwargs = household_kwargs(_situation(), year=YEAR)
    assert kwargs["year"] == YEAR
    # None marks an axis variable and sets nothing; twelve equal months become
    # one value, which policyengine-us spreads back over the months.
    assert kwargs["people"] == [
        {"age": 40},
        {"age": 38, "receives_wic": True},
        {"age": 5},
    ]
    assert kwargs["spm_unit"] == {"is_tanf_enrolled": True}
    assert kwargs["tax_unit"] == {"filing_status": "JOINT"}
    assert kwargs["household"] == {"state_name": "CA"}
    assert kwargs["family"] == {}
    assert "axes" not in kwargs


def test_kwargs_give_people_outside_a_couple_their_own_marital_unit():
    kwargs = household_kwargs(_situation(), year=YEAR)
    assert kwargs["marital_unit"] == [{"members": [0, 1]}, {"members": [2]}]
    kwargs = household_kwargs(_situation(marital_units={}), year=YEAR)
    assert kwargs["marital_unit"] == [
        {"members": [0]},
        {"members": [1]},
        {"members": [2]},
    ]


def test_kwargs_pass_axes_through():
    axes = [
        [{"name": "employment_income", "period": YEAR, "min": 0, "max": 9, "count": 2}]
    ]
    assert household_kwargs(_situation(axes=axes), year=YEAR)["axes"] == axes


@pytest.mark.parametrize(
    "values",
    [
        {f"{YEAR}-01": True},
        {**_periods(), f"{YEAR}-06": False},
        {YEAR + 1: 40},
        {YEAR: 40, YEAR + 1: 41},
        40,
    ],
)
def test_kwargs_refuse_values_that_vary_within_the_year(values):
    situation = _situation()
    situation["people"]["a"]["age"] = values
    with pytest.raises(ValueError, match="age"):
        household_kwargs(situation, year=YEAR)


@pytest.mark.parametrize(
    "groups",
    [
        {},
        {"one": {"members": ["a"]}, "two": {"members": ["b", "c"]}},
        {"one": {"members": ["a", "b"]}},
        {"one": {"members": ["b", "a", "c"]}},
    ],
)
def test_kwargs_refuse_anything_but_one_group_of_everyone(groups):
    with pytest.raises(ValueError, match="tax_units"):
        household_kwargs(_situation(tax_units=groups), year=YEAR)


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(raw=raw_payloads())
def test_kwargs_keep_every_input_and_each_person_in_one_marital_unit(raw):
    payload = household_input_from_dict(raw)
    for situation in _situations(payload):
        kwargs = household_kwargs(situation, year=YEAR)

        members = [i for unit in kwargs["marital_unit"] for i in unit["members"]]
        assert sorted(members) == list(range(len(situation["people"])))

        records = [
            *zip(situation["people"].values(), kwargs["people"]),
            *(
                (next(iter(situation[plural].values())), kwargs[entity])
                for plural, entity in (
                    ("families", "family"),
                    ("spm_units", "spm_unit"),
                    ("tax_units", "tax_unit"),
                    ("households", "household"),
                )
            ),
        ]
        for original, translated in records:
            names = {name for name in original if name != "members"}
            for name in names:
                sent = list(original[name].values())
                if sent == [None]:
                    assert name not in translated
                else:
                    assert translated[name] == sent[0]
                    assert set(sent) == {sent[0]}
            assert set(translated) <= names


# ---------------------------------------------------------------------------
# HouseholdCalculation, on a made-up result


def _fake_calculation(people_points, group_points):
    single = len(people_points[0]) == 1
    person = [{"x": row[0] if single else row} for row in people_points]
    group = {"y": group_points[0] if single else group_points}
    return HouseholdCalculation(
        {"person": person, "spm_unit": group},
        year=YEAR,
        variables={
            "x": SimpleNamespace(entity="person"),
            "y": SimpleNamespace(entity="spm_unit"),
            "m": SimpleNamespace(entity="marital_unit"),
        },
    )


amounts = st.floats(min_value=0, max_value=1e6, allow_nan=False)


@settings(max_examples=200)
@given(
    shape=st.tuples(st.integers(1, 7), st.integers(1, 12)).flatmap(
        lambda shape: st.tuples(
            st.lists(
                st.lists(amounts, min_size=shape[1], max_size=shape[1]),
                min_size=shape[0],
                max_size=shape[0],
            ),
            st.lists(amounts, min_size=shape[1], max_size=shape[1]),
        )
    )
)
def test_reads_follow_the_layout_of_simulation_calculate(shape):
    people_points, group_points = shape
    calculation = _fake_calculation(people_points, group_points)
    people = len(people_points)
    points = len(people_points[0])

    flat = calculation.calculate("x", period=YEAR)
    assert len(flat) == people * points
    for person in range(people):
        for point in range(points):
            assert flat[point * people + person] == people_points[person][point]

    assert calculation.calculate("x", YEAR, map_to="person") == flat
    assert calculation.calculate("x", YEAR, map_to="household") == [
        sum(row[point] for row in people_points) for point in range(points)
    ]
    for target in (None, "family", "spm_unit", "tax_unit", "household"):
        assert calculation.calculate("y", YEAR, map_to=target) == group_points


def test_reads_refuse_what_the_result_cannot_answer():
    calculation = _fake_calculation([[1.0], [2.0]], [3.0])
    with pytest.raises(ValueError, match="covers"):
        calculation.calculate("x", f"{YEAR}-01")
    with pytest.raises(ValueError, match="covers"):
        calculation.calculate("x", YEAR + 1)
    with pytest.raises(ValueError, match="map a spm_unit variable to a person"):
        calculation.calculate("y", YEAR, map_to="person")
    with pytest.raises(ValueError, match="can't map to"):
        calculation.calculate("x", YEAR, map_to="marital_unit")
    with pytest.raises(ValueError, match="can't read a marital_unit"):
        calculation.calculate("m", YEAR)


# ---------------------------------------------------------------------------
# Against a direct Simulation of the same situation


class _ComparedCalculation:
    """Checks each read against a direct Simulation as the calculator makes it."""

    def __init__(self, calculation, situation, reads):
        from policyengine.tax_benefit_models.us.spm import resolve_spm_selection
        from policyengine_us import Simulation

        self._calculation = calculation
        self._simulation = Simulation(
            situation=situation,
            spm=resolve_spm_selection(SPM_SELECTION),
        )
        self._reads = reads
        self.variables = calculation.variables

    def calculate(self, variable, period=None, map_to=None):
        ours = self._calculation.calculate(variable, period=period, map_to=map_to)
        kwargs = {} if map_to is None else {"map_to": map_to}
        direct = self._simulation.calculate(variable, period=period, **kwargs).tolist()
        assert len(ours) == len(direct), (variable, map_to)
        for mine, theirs in zip(ours, direct):
            # The engine holds floats in single precision, and a person variable
            # mapped to a group sums them there; the bridge sums the same values
            # in double precision.
            tolerance = 0.01 + 16 * 2**-24 * abs(theirs)
            assert abs(mine - theirs) <= tolerance, (variable, map_to, mine, theirs)
        self._reads.add((variable, map_to))
        return ours


@pytest.fixture
def compared_reads(monkeypatch):
    reads: set[tuple[str, str | None]] = set()

    def compared_run(situation, *, year, variables):
        calculation = run_household(situation, year=year, variables=variables)
        return _ComparedCalculation(calculation, situation, reads)

    monkeypatch.setattr(calculator, "run_household", compared_run)
    return reads


COMPARED_HOUSEHOLDS = [
    {"state": "CA", "people": [{"kind": "adult", "age": 30}]},
    {
        "state": "NY",
        "people": [{"kind": "adult", "age": 45}, {"kind": "child", "age": 3}],
        "childcare_expenses": 9_000,
        "rent_annual": 14_000,
        "utility_expense_annual": 2_400,
    },
    {
        "state": "PA",
        "filing_status": "JOINT",
        "people": [
            {"kind": "adult", "age": 40, "earned_income": 0},
            {"kind": "adult", "age": 38, "earned_income": 21_000},
            {"kind": "child", "age": 10},
            {"kind": "child", "age": 5},
        ],
        "childcare_expenses": 6_000,
        "liquid_assets": 3_000,
    },
    {
        "state": "TX",
        "filing_status": "JOINT",
        "people": [
            {"kind": "adult", "age": 70, "ssi_amount": 2_400},
            {"kind": "adult", "age": 67, "is_blind": True},
        ],
        "social_security_annual": 15_000,
        "liquid_assets": 1_500,
    },
    {
        "state": "OH",
        "filing_status": "SINGLE",
        "people": [
            {"kind": "adult", "age": 50, "ssdi_amount": 12_000, "is_disabled": True},
            {"kind": "adult", "age": 22, "earned_income": 9_000},
        ],
    },
]


@pytest.mark.parametrize("raw", COMPARED_HOUSEHOLDS, ids=lambda raw: raw["state"])
def test_every_read_matches_a_direct_simulation(raw, compared_reads):
    payload = household_input_from_dict(
        {"year": YEAR, "earned_income": 18_000, "programs_mode": "all", **raw}
    )

    calculate_household(payload)
    calculate_income_series(payload, max_earned_income=30_000, step=15_000)

    # The series path reads some variables at other targets too, and both paths
    # read everything the calculator requests.
    assert {variable for variable, _ in compared_reads} >= set(ENGINE_VARIABLES)
    assert ("medicaid", None) in compared_reads
    assert ("medicaid", "household") in compared_reads


@ENGINE_SETTINGS
@given(raw=raw_payloads())
def test_reads_match_a_direct_simulation_for_any_household(raw, compared_reads):
    payload = household_input_from_dict(raw)
    calculate_household(payload)
    calculate_income_series(payload, max_earned_income=30_000, step=15_000)


def test_snap_and_wic_are_calendar_year_sums():
    """The annual read covers the October COLA, unlike January times twelve."""
    from policyengine_us import Simulation

    payload = household_input_from_dict(
        {
            "state": "CA",
            "year": YEAR,
            "earned_income": 12_000,
            "people": [
                {"kind": "adult", "age": 28, "is_pregnant": True},
                {"kind": "child", "age": 1},
            ],
        }
    )
    situation = build_household_situation(payload)
    simulation = Simulation(situation=situation)
    calculation = run_household(situation, year=YEAR, variables=ENGINE_VARIABLES)
    for variable in ("snap", "wic"):
        months = sum(
            simulation.calculate(variable, f"{YEAR}-{month:02d}", map_to="household")[0]
            for month in range(1, 13)
        )
        assert months > 0, variable
        assert calculation.calculate(variable, YEAR, map_to="household")[0] == (
            pytest.approx(months, abs=0.05)
        )


# ---------------------------------------------------------------------------
# Every state


def _state_household(state):
    return household_input_from_dict(
        {
            "state": state,
            "year": YEAR,
            "earned_income": 15_000,
            "programs_mode": "all",
            "people": [
                {"kind": "adult", "age": 33},
                {"kind": "child", "age": 2},
                {"kind": "child", "age": 8},
            ],
            "childcare_expenses": 8_000,
            "rent_annual": 12_000,
            "utility_expense_annual": 1_800,
        }
    )


@pytest.mark.parametrize("state", sorted(STATE_NAME_BY_CODE))
def test_every_state_computes_on_both_paths(state):
    # TANF and child care reads sat behind try/except on direct Simulations.
    # calculate_household computes them with everything else, so a formula that
    # raised would take down the whole response.
    payload = _state_household(state)
    household = calculate_household(payload)
    series = calculate_income_series(payload, max_earned_income=20_000, step=10_000)
    assert series["point_count"] >= 2
    assert household["programs"]["tanf"] >= 0
    if state not in CCDF_MODELED_STATES:
        assert household["programs"]["child_care_subsidies"] == 0


def test_child_care_computes_for_adults_without_children():
    # An age-group formula used to raise for adults in the modeled states.
    for state in sorted(CCDF_MODELED_STATES):
        payload = household_input_from_dict(
            {
                "state": state,
                "year": YEAR,
                "earned_income": 15_000,
                "programs_mode": "all",
                "people": [{"kind": "adult", "age": 33}],
            }
        )
        assert calculate_household(payload)["programs"]["child_care_subsidies"] == 0


def test_a_household_needs_someone_aged_18_or_older():
    # calculate_household's default outputs measure SPM poverty, which raises
    # for a unit with no adult. The validator says so first.
    people = [{"kind": "adult", "age": 17}, {"kind": "child", "age": 2}]
    payload = household_input_from_dict(
        {"state": "CA", "year": YEAR, "earned_income": 1_000, "people": people}
    )
    with pytest.raises(ValueError, match="18 or older"):
        calculate_household(payload)

    people = [{"kind": "adult", "age": 17}, {"kind": "adult", "age": 18}]
    payload = household_input_from_dict(
        {"state": "CA", "year": YEAR, "earned_income": 1_000, "people": people}
    )
    assert calculate_household(payload)["programs"]["snap"] >= 0


# ---------------------------------------------------------------------------
# Loading


def test_metadata_loads_without_the_engine():
    # /api/metadata has a ten second budget, and importing policyengine alone
    # takes longer than that on a cold instance.
    code = (
        "import sys; import api.metadata; "
        "loaded = {'policyengine', 'policyengine_us', 'policyengine_core'} & set(sys.modules); "
        "assert not loaded, loaded"
    )
    subprocess.run([sys.executable, "-c", code], cwd=REPO, check=True)


def test_metadata_reports_each_engine_package():
    from api._shared import engine_versions

    assert set(engine_versions()) == {
        "policyengine",
        "policyengine-us",
        "policyengine-core",
        "spm-calculator",
    }

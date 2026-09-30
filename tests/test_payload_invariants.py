"""Invariants of the situation builders over arbitrary households.

PolicyEngine US computes some variables as the sum of components (``adds``,
``subtracts``). An input on such a total replaces the sum, so components sent
alongside it drop out, and every rule that reads a component sees zero:
sending ``pension_income`` left ``taxable_pension_income`` and AGI at 0, and
sending ``social_security`` left ``social_security_retirement`` at 0. These
properties check the builders against the installed policyengine-us graph,
check the frontend's snapshot of that graph, run the builder through the engine,
and compare the Python builder with the JS one in
``frontend/src/policyengineApi.js``.
"""

from __future__ import annotations

import importlib.metadata
import json
import shutil
import subprocess
from functools import cache
from pathlib import Path

import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

from cliff_watch.calculator import (
    HEAD_INCOME_INPUTS,
    HouseholdInput,
    build_household_situation,
    build_household_variation_situation,
    household_input_from_dict,
)
from cliff_watch.config import PUBLIC_ASSISTANCE_PROGRAM_OPTIONS, STATE_NAME_BY_CODE
from cliff_watch.variable_graph import (
    GROUP_ENTITIES,
    REVIEWED_TOTAL_INPUTS,
    build_variable_graph,
    components_of,
    graph_node,
    situation_inputs,
    situation_variables,
)

REPO = Path(__file__).resolve().parents[1]
SNAPSHOT = (
    REPO / "frontend" / "src" / "__fixtures__" / "policyengine-us-variable-graph.json"
)
YEAR = 2026
PROGRAM_KEYS = [item["key"] for item in PUBLIC_ASSISTANCE_PROGRAM_OPTIONS]
COST_FIELDS = (
    "childcare_expenses",
    "rent_annual",
    "utility_expense_annual",
    "food_expense_annual",
    "transportation_expense_annual",
    "health_insurance_premium_annual",
    "technology_expense_annual",
    "debt_payment_annual",
    "education_expense_annual",
    "other_expense_annual",
)
PROPERTY_SETTINGS = settings(
    max_examples=150,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)


@pytest.fixture(scope="module")
def system():
    from policyengine_us import CountryTaxBenefitSystem

    return CountryTaxBenefitSystem()


@cache
def _node(system, name):
    return graph_node(system, name)


def _graph_for(system, names):
    return build_variable_graph(system, names)


# Per-person amounts must be non-negative (the calculator rejects negatives);
# household-level amounts are clamped, so they may be negative.
person_amount = st.one_of(st.just(0), st.integers(1, 500_000))
household_amount = st.one_of(
    st.just(0), st.integers(-50_000, -1), st.integers(1, 2_000_000)
)


def _person(kind):
    return st.fixed_dictionaries(
        {
            "kind": st.just(kind),
            "age": st.integers(18, 120) if kind == "adult" else st.integers(0, 17),
            "is_pregnant": st.booleans(),
            "is_disabled": st.booleans(),
            "is_blind": st.booleans(),
            "is_full_time_student": st.booleans(),
            "is_incapable_of_self_care": st.booleans(),
            "earned_income": person_amount,
            "ssi_amount": person_amount,
            "ssdi_amount": person_amount,
        }
    )


@st.composite
def raw_payloads(draw, income_fields=tuple(HEAD_INCOME_INPUTS)):
    filing_status = draw(
        st.sampled_from(["SINGLE", "HEAD_OF_HOUSEHOLD", "JOINT", "SEPARATE"])
    )
    married = filing_status in {"JOINT", "SEPARATE"}
    adults = draw(st.lists(_person("adult"), min_size=2 if married else 1, max_size=4))
    children = draw(st.lists(_person("child"), max_size=4))
    return {
        "state": draw(st.sampled_from(sorted(STATE_NAME_BY_CODE))),
        "year": YEAR,
        "earned_income": draw(st.integers(0, 300_000)),
        "filing_status": filing_status,
        "people": adults + children,
        "programs_mode": draw(st.sampled_from(["all", "none", "custom"])),
        "selected_programs": draw(st.lists(st.sampled_from(PROGRAM_KEYS), unique=True)),
        "has_employer_health_insurance": draw(st.booleans()),
        "liquid_assets": draw(household_amount),
        **{field: draw(household_amount) for field in COST_FIELDS},
        **{field: draw(household_amount) for field in income_fields},
    }


def _situations(payload: HouseholdInput):
    yield "household", build_household_situation(payload)
    yield (
        "series",
        build_household_variation_situation(payload, max_earned_income=60000, count=3),
    )


@PROPERTY_SETTINGS
@given(raw=raw_payloads())
def test_emits_only_policyengine_variables_on_their_entities(system, raw):
    payload = household_input_from_dict(raw)
    for _, situation in _situations(payload):
        for group, variable in situation_variables(situation):
            node = _node(system, variable)
            if group != "axes":
                assert node["entity"] == GROUP_ENTITIES[group], (group, variable)


@PROPERTY_SETTINGS
@given(raw=raw_payloads())
def test_never_sets_a_total_except_reviewed_ones(system, raw):
    payload = household_input_from_dict(raw)
    for path, situation in _situations(payload):
        for group, instance, variable in situation_inputs(situation):
            node = _node(system, variable)
            if node["adds"] or node["subtracts"]:
                assert variable in REVIEWED_TOTAL_INPUTS, (
                    f"{path}: {group}.{instance}.{variable} is a total input"
                )


@PROPERTY_SETTINGS
@given(raw=raw_payloads())
def test_never_sets_a_total_with_one_of_its_components(system, raw):
    payload = household_input_from_dict(raw)
    for path, situation in _situations(payload):
        inputs = situation_inputs(situation)
        graph = _graph_for(system, sorted({variable for _, _, variable in inputs}))
        for group, instance, variable in inputs:
            components = components_of(graph, variable)
            clashes = [
                other
                for g, i, other in inputs
                if g == group and i == instance and other in components
            ]
            assert clashes == [], (
                f"{path}: {group}.{instance}.{variable} with {clashes}"
            )


def test_head_income_fields_map_to_distinct_person_components(system):
    targets = list(HEAD_INCOME_INPUTS.values())
    assert len(set(targets)) == len(targets)
    for variable in targets:
        node = _node(system, variable)
        assert node["entity"] == "person", variable
        if node["adds"] or node["subtracts"]:
            assert variable in REVIEWED_TOTAL_INPUTS, f"{variable} is a total"


@PROPERTY_SETTINGS
@given(raw=raw_payloads())
def test_each_entered_head_income_amount_lands_once_on_its_component(raw):
    payload = household_input_from_dict(raw)
    for path, situation in _situations(payload):
        people = list(situation["people"].items())
        _, head = people[0]
        entered = sent = 0.0
        for field, variable in HEAD_INCOME_INPUTS.items():
            amount = max(0.0, float(raw[field]))
            entered += amount
            if amount > 0:
                assert head[variable] == {YEAR: amount}, (path, field)
                sent += head[variable][YEAR]
            else:
                assert variable not in head, (path, field)
            for person_id, record in people[1:]:
                assert variable not in record, (path, person_id, variable)
        assert sent == entered


# ---------------------------------------------------------------------------
# The frontend's snapshot of the variable graph must match the installed engine.


def test_variable_graph_snapshot_matches_installed_policyengine_us(system):
    snapshot = json.loads(SNAPSHOT.read_text())
    installed = importlib.metadata.version("policyengine-us")
    hint = "run `uv run python scripts/generate_variable_graph.py`"
    assert snapshot["policyengine_us_version"] == installed, hint
    regenerated = build_variable_graph(system, snapshot["variables"])
    assert regenerated == snapshot["variables"], hint


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(raw=raw_payloads())
def test_variable_graph_snapshot_covers_python_builder(raw):
    snapshot = json.loads(SNAPSHOT.read_text())["variables"]
    payload = household_input_from_dict(raw)
    for _, situation in _situations(payload):
        for _, variable in situation_variables(situation):
            assert variable in snapshot, (
                f"{variable}: run `uv run python scripts/generate_variable_graph.py`"
            )


# ---------------------------------------------------------------------------
# Run built situations through the installed engine.

# Head income fields that enter federal gross income in full.
FULLY_TAXABLE_FIELDS = tuple(
    field
    for field in HEAD_INCOME_INPUTS
    if field not in {"child_support_annual", "social_security_annual"}
)


@settings(max_examples=12, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    raw=raw_payloads(),
    ssdi=st.one_of(st.just(0), st.integers(1, 30_000)),
)
def test_entered_income_reaches_the_engine_components(raw, ssdi):
    from policyengine_us import Simulation

    raw = {**raw, "programs_mode": "all"}
    raw["people"] = [{**raw["people"][0], "ssdi_amount": ssdi}, *raw["people"][1:]]
    payload = household_input_from_dict(raw)
    simulation = Simulation(situation=build_household_situation(payload))

    def head(variable):
        return float(simulation.calculate(variable, YEAR)[0])

    # policyengine-us can make the first adult of an unmarried multi-adult
    # household another adult's tax dependent, whose gross income it leaves
    # out; that role assignment is outside this invariant.
    assume(head("is_tax_unit_head") or head("is_tax_unit_spouse"))

    entered = {field: max(0.0, float(raw[field])) for field in HEAD_INCOME_INPUTS}
    private = entered["pension_income_annual"]
    public = entered["public_pension_income_annual"]
    assert head("taxable_private_pension_income") == pytest.approx(private)
    assert head("taxable_public_pension_income") == pytest.approx(public)
    assert head("taxable_pension_income") == pytest.approx(private + public)
    assert head("pension_income") == pytest.approx(private + public)
    dividends = entered["dividend_income_annual"]
    assert head("qualified_dividend_income") == pytest.approx(dividends)
    assert head("dividend_income") == pytest.approx(dividends)
    retirement = entered["social_security_annual"]
    assert head("social_security_retirement") == pytest.approx(retirement)
    assert head("social_security_disability") == pytest.approx(ssdi)
    assert head("social_security") == pytest.approx(retirement + ssdi)

    # Every entered taxable dollar reaches federal gross income exactly once;
    # at most 85% of Social Security benefits are taxable. Alaska adds its
    # Permanent Fund Dividend, which the household doesn't enter.
    fully_taxable = (
        payload.earned_income
        + sum(entered[field] for field in FULLY_TAXABLE_FIELDS)
        + head("ak_permanent_fund_dividend")
    )
    taxable_social_security = head("irs_gross_income") - fully_taxable
    assert taxable_social_security >= -0.01
    assert taxable_social_security <= 0.85 * (retirement + ssdi) + 0.01


# ---------------------------------------------------------------------------
# Differential: the JS builder must send the same inputs as the Python one.

NODE = shutil.which("node")
JS_BUILDER = REPO / "frontend" / "src" / "policyengineApi.js"
JS_RUNNER = f"""
import {{ buildSituation }} from {json.dumps(JS_BUILDER.as_uri())}
const cases = JSON.parse(await new Promise((resolve) => {{
  let data = ''
  process.stdin.on('data', (chunk) => {{ data += chunk }})
  process.stdin.on('end', () => resolve(data))
}}))
const metadata = {{ public_assistance_programs: {json.dumps([{"key": key} for key in PROGRAM_KEYS])} }}
process.stdout.write(JSON.stringify(cases.map(({{ payload, series }}) => buildSituation(
  payload,
  series
    ? {{ includeIncomeOverrides: false, withAxes: true, maxEarnedIncome: 60000, step: 30000, metadata }}
    : {{ includeIncomeOverrides: true, metadata }},
).situation)))
"""


def _normalized_inputs(situation):
    def normalize(value):
        if isinstance(value, bool) or value is None or isinstance(value, str):
            return value
        return round(float(value), 6)

    return {
        (group, instance, variable): {
            str(period): normalize(value)
            for period, value in situation[group][instance][variable].items()
        }
        for group, instance, variable in situation_inputs(situation)
    }


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(raw=raw_payloads())
def test_js_builder_sends_the_same_inputs(raw):
    payload = household_input_from_dict(raw)
    cases = [{"payload": raw, "series": False}, {"payload": raw, "series": True}]
    output = subprocess.run(
        [NODE, "--input-type=module", "-e", JS_RUNNER],
        input=json.dumps(cases),
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    js_household, js_series = json.loads(output)
    python_household = build_household_situation(payload)
    python_series = build_household_variation_situation(
        payload, max_earned_income=60000, count=3
    )
    assert _normalized_inputs(js_household) == _normalized_inputs(python_household)
    assert _normalized_inputs(js_series) == _normalized_inputs(python_series)

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
from hypothesis import HealthCheck, assume, example, given, settings
from hypothesis import strategies as st

from cliff_watch.calculator import (
    HEAD_INCOME_INPUTS,
    HouseholdInput,
    _normalize_county,
    build_household_situation,
    build_household_variation_situation,
    household_input_from_dict,
    resolved_county,
)
from cliff_watch.config import PUBLIC_ASSISTANCE_PROGRAM_OPTIONS, STATE_NAME_BY_CODE
from cliff_watch.zip_county import RATING_AREA_OVERRIDES, _table, rating_area_override
from cliff_watch.variable_graph import (
    GROUP_ENTITIES,
    KNOWN_COMPUTED_INPUTS,
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


def _places():
    """Each state's ZIPs, its counties, and the names that normalize to them."""
    table = _table()
    zips: dict[str, list[str]] = {}
    for zip_code, rows in sorted(table.zips.items()):
        for state in sorted({table.codes[index][-2:] for index, _ in rows}):
            zips.setdefault(state, []).append(zip_code)
    counties: dict[str, list[str]] = {}
    for code in table.codes:
        counties.setdefault(code[-2:], []).append(code)
    names = {
        state: [
            table.names_by_code[code]
            for code in codes
            if _normalize_county(table.names_by_code[code], state) == code
        ]
        for state, codes in counties.items()
    }
    return sorted(table.zips), zips, counties, names


ALL_ZIPS, ZIPS_BY_STATE, COUNTIES_BY_STATE, COUNTY_NAMES_BY_STATE = _places()


def _location(state):
    """No place, a ZIP in the state or anywhere, a county by code or by name, or both.

    Counties whose rating area the engine misses come up as often as any other.
    """
    counties = [
        st.sampled_from(COUNTIES_BY_STATE[state]),
        st.sampled_from(COUNTY_NAMES_BY_STATE[state]),
    ]
    overrides = sorted(c for c in RATING_AREA_OVERRIDES if c.endswith(f"_{state}"))
    if overrides:
        counties.append(st.sampled_from(overrides))
    county = st.one_of(*counties)
    zip_code = st.one_of(
        st.sampled_from(ZIPS_BY_STATE[state]), st.sampled_from(ALL_ZIPS)
    )
    return st.one_of(
        st.just({}),
        st.fixed_dictionaries({"zip": zip_code}),
        st.fixed_dictionaries({"county": county}),
        st.fixed_dictionaries({"zip": zip_code, "county": county}),
    )


@st.composite
def raw_payloads(draw, income_fields=tuple(HEAD_INCOME_INPUTS)):
    filing_status = draw(
        st.sampled_from(["SINGLE", "HEAD_OF_HOUSEHOLD", "JOINT", "SEPARATE"])
    )
    married = filing_status in {"JOINT", "SEPARATE"}
    adults = draw(st.lists(_person("adult"), min_size=2 if married else 1, max_size=4))
    children = draw(st.lists(_person("child"), max_size=4))
    state = draw(st.sampled_from(sorted(STATE_NAME_BY_CODE)))
    return {
        "state": state,
        **draw(_location(state)),
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
def test_never_sets_a_computed_variable_unless_listed(system, raw):
    payload = household_input_from_dict(raw)
    for path, situation in _situations(payload):
        for group, instance, variable in situation_inputs(situation):
            if system.variables[variable].formulas:
                assert variable in KNOWN_COMPUTED_INPUTS, (
                    f"{path}: {group}.{instance}.{variable} has a formula"
                )


def test_known_computed_inputs_still_have_formulas(system):
    # A listed variable that lost its formula no longer needs a reason here.
    stale = [
        name
        for name in KNOWN_COMPUTED_INPUTS
        if name not in system.variables or not system.variables[name].formulas
    ]
    assert stale == []


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


@PROPERTY_SETTINGS
@given(raw=raw_payloads())
def test_location_inputs_follow_the_county_rule(raw):
    """The county is the entered one or else the ZIP's; the ZIP goes as entered; a
    rating area goes only for a county the engine's join misses; and no household
    takes up housing assistance, whatever the place."""
    payload = household_input_from_dict(raw)
    county = resolved_county(payload)
    rating_area = rating_area_override(county)
    for path, situation in _situations(payload):
        for record in situation["households"].values():
            assert record.get("county") == ({YEAR: county} if county else None), path
            assert record.get("zip_code") == (
                {YEAR: payload.zip} if payload.zip else None
            ), path
            assert record.get("slcsp_rating_area") == (
                None if rating_area is None else {YEAR: rating_area}
            ), path
        for record in situation["spm_units"].values():
            assert record["takes_up_housing_assistance_if_eligible"] == {
                YEAR: False
            }, path


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

# The household that failed the gross-income check before it allowed for
# float32 rounding: $523,288 of other income and $1 of SSDI in Alaska.
SEPTEMBER_FLOAT32_HOUSEHOLD = {
    "state": "AK",
    "year": YEAR,
    "earned_income": 0,
    "filing_status": "SINGLE",
    "people": [
        {
            "kind": "adult",
            "age": 18,
            "is_pregnant": False,
            "is_disabled": False,
            "is_blind": False,
            "is_full_time_student": False,
            "is_incapable_of_self_care": False,
            "earned_income": 0,
            "ssi_amount": 0,
            "ssdi_amount": 0,
        }
    ],
    "programs_mode": "all",
    "selected_programs": [],
    "has_employer_health_insurance": False,
    "liquid_assets": 0,
    **{field: 0 for field in COST_FIELDS},
    **{field: 0 for field in HEAD_INCOME_INPUTS},
    "miscellaneous_income_annual": 523_288,
}


@settings(max_examples=12, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@example(raw=SEPTEMBER_FLOAT32_HOUSEHOLD, ssdi=1)
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

    # Every entered taxable dollar reaches federal gross income exactly once,
    # next to the engine's taxable share of Social Security. Alaska adds its
    # Permanent Fund Dividend, which the household doesn't enter.
    fully_taxable = (
        payload.earned_income
        + sum(entered[field] for field in FULLY_TAXABLE_FIELDS)
        + head("ak_permanent_fund_dividend")
    )
    gross_income = head("irs_gross_income")
    taxable_social_security = head("taxable_social_security")
    # policyengine-us adds the gross income sources one at a time in float32,
    # and each addition can round by half a float32 step of the running total,
    # at most 2**-24 of it. From $524,288 a step is $0.0625, so taxable benefits
    # of $0.85 can come back as $0.875.
    sources = simulation.tax_benefit_system.parameters(
        f"{YEAR}-01-01"
    ).gov.irs.gross_income.sources
    assert "taxable_social_security" in sources
    tolerance = 0.01 + len(sources) * 2**-24 * gross_income
    assert abs(gross_income - fully_taxable - taxable_social_security) <= tolerance
    # At most 85% of Social Security benefits are taxable.
    assert 0 <= taxable_social_security <= 0.85 * (retirement + ssdi) + tolerance


# ---------------------------------------------------------------------------
# Differential: the JS builder must send the same inputs as the Python one.
#
# The drawn payloads carry filing_status, a lowercase programs_mode and the
# metadata program list. The builders still differ outside that: Python
# ignores marital_status, which the UI sends instead of filing_status; JS
# doesn't lowercase programs_mode; and JS's fallback program list, used when
# metadata is missing, leaves out ssdi.
#
# Python also resolves a county from the ZIP, sends the ZIP, and sends a rating
# area for the counties in RATING_AREA_OVERRIDES. The JS builder, which no
# production page calls, does none of these and carries no ZIP table, so the
# comparison leaves out the ZIP and those counties and keeps any other county.


def _shared_location(raw):
    shared = {key: value for key, value in raw.items() if key != "zip"}
    county = resolved_county(household_input_from_dict(shared))
    if rating_area_override(county) is not None:
        shared.pop("county")
    return shared

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
    raw = _shared_location(raw)
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

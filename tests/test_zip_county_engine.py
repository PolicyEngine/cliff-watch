"""The ZIP's county through policyengine-us.

The household is the single parent in Cambridge, Massachusetts, whose chart showed
Barnstable County's benchmark premiums before the API read the ZIP.
"""

from __future__ import annotations

import pytest

pytest.importorskip("policyengine_us")

from api._shared import _series_cached, compute_series
from cliff_watch.calculator import (
    _load_simulation,
    build_household_situation,
    calculate_household,
    calculate_income_series,
    household_input_from_dict,
)
from cliff_watch.zip_county import (
    COUNTIES_WITHOUT_BENCHMARK,
    COUNTIES_WITHOUT_RATING_AREA_ROW,
    RATING_AREA_OVERRIDES,
    _table,
    rating_area_override,
)

YEAR = 2026
MAX_EARNINGS = 60_000
STEP = 2_500


def _payload(**overrides):
    return household_input_from_dict(
        {
            "state": "MA",
            "earned_income": 0,
            "year": YEAR,
            "marital_status": "UNMARRIED",
            "people": [
                {"kind": "adult", "age": 33},
                {"kind": "child", "age": 6},
                {"kind": "child", "age": 10},
            ],
            **overrides,
        }
    )


def _series(payload):
    return calculate_income_series(payload, max_earned_income=MAX_EARNINGS, step=STEP)


def _engine_values(payload, *variables):
    simulation = _load_simulation()(situation=build_household_situation(payload))
    return {
        variable: simulation.calculate(variable, YEAR).tolist()[0]
        for variable in variables
    }


@pytest.fixture(scope="module")
def zip_only_series():
    return _series(_payload(zip="02139"))


def test_middlesex_zip_gives_the_same_series_as_the_explicit_county(
    zip_only_series,
) -> None:
    explicit = _series(_payload(zip="02139", county="MIDDLESEX_COUNTY_MA"))

    assert zip_only_series["data"] == explicit["data"]


def test_a_single_calculation_reports_the_county_and_zip_it_used() -> None:
    from_zip = calculate_household(_payload(earned_income=30_000, zip="02139"))
    named = calculate_household(
        _payload(earned_income=30_000, zip="02139", county="MIDDLESEX_COUNTY_MA")
    )
    no_zip = calculate_household(_payload(earned_income=30_000))

    assert from_zip == named
    assert from_zip["input"]["county"] == "MIDDLESEX_COUNTY_MA"
    assert from_zip["input"]["zip"] == "02139"
    assert no_zip["input"]["county"] is None
    assert no_zip["input"]["zip"] is None


def test_the_series_differs_from_the_state_default_county(zip_only_series) -> None:
    """The negative control: this household's chart does depend on its county."""
    no_county = _series(_payload())

    assert zip_only_series["data"] != no_county["data"]
    assert any(
        with_zip["aca_ptc"] != without["aca_ptc"]
        for with_zip, without in zip(
            zip_only_series["data"], no_county["data"], strict=True
        )
    )


def test_naming_the_default_county_reproduces_the_old_series() -> None:
    """A ZIP changes this series only through the county it resolves to."""
    old_behaviour = _series(_payload())
    named = _series(_payload(zip="02139", county="BARNSTABLE_COUNTY_MA"))

    assert named["data"] == old_behaviour["data"]


def test_engine_reads_the_zips_county_and_rating_area() -> None:
    no_county = _engine_values(_payload(), "county_str", "slcsp_rating_area")
    from_zip = _engine_values(_payload(zip="02139"), "county_str", "slcsp_rating_area")

    assert no_county["county_str"] == "BARNSTABLE_COUNTY_MA"
    assert from_zip["county_str"] == "MIDDLESEX_COUNTY_MA"
    assert no_county["slcsp_rating_area"] == 7
    assert from_zip["slcsp_rating_area"] == 3


@pytest.mark.parametrize(
    ("zip_code", "rating_area"),
    [("90802", 15), ("91001", 15), ("93534", 15), ("90001", 16), ("90210", 16)],
)
def test_los_angeles_county_rating_area_reads_the_zip(zip_code, rating_area) -> None:
    values = _engine_values(
        _payload(state="CA", zip=zip_code), "county_str", "slcsp_rating_area"
    )
    assert values["county_str"] == "LOS_ANGELES_COUNTY_CA"
    assert values["slcsp_rating_area"] == rating_area


def test_api_series_reports_the_location_it_used() -> None:
    response = compute_series(
        _payload(zip="02467"), max_earned_income=20_000, step=5_000
    )
    location = response["location"]

    assert location["zip"] == "02467"
    assert location["county"] == "MIDDLESEX_COUNTY_MA"
    assert location["county_name"] == "Middlesex County"
    assert location["source"] == "zip"
    assert [county["code"] for county in location["counties"]] == [
        "MIDDLESEX_COUNTY_MA",
        "NORFOLK_COUNTY_MA",
        "SUFFOLK_COUNTY_MA",
    ]


def test_api_series_cache_keeps_zips_apart(zip_only_series) -> None:
    """Payloads that differ only in the ZIP must not share a cached series.

    Cambridge (Middlesex) and Hyannis (Barnstable) give this household different
    series, so a cache key without the ZIP would hand the second call the first's.
    """
    _series_cached.cache_clear()
    cambridge = compute_series(
        _payload(zip="02139"), max_earned_income=MAX_EARNINGS, step=STEP
    )
    hyannis = compute_series(
        _payload(zip="02601"), max_earned_income=MAX_EARNINGS, step=STEP
    )

    assert cambridge["location"]["county"] == "MIDDLESEX_COUNTY_MA"
    assert hyannis["location"]["county"] == "BARNSTABLE_COUNTY_MA"
    assert cambridge["data"] == zip_only_series["data"]
    assert hyannis["data"] == _series(_payload(zip="02601"))["data"]
    assert cambridge["data"] != hyannis["data"]


# Housing assistance: CliffWatch has no input for whether a household holds a
# voucher (#30), and its rent field also takes mortgage payments, so no household
# takes one up. The engine still computes the subsidy, which is the control.


@pytest.mark.parametrize(
    ("state", "zip_code", "county"),
    [
        ("CA", "90802", None),
        ("TX", "75201", None),
        ("TX", "77002", None),
        ("KS", "67202", None),
        ("CA", None, "LOS_ANGELES_COUNTY_CA"),
    ],
)
def test_no_household_takes_up_the_voucher_the_engine_computes(
    state, zip_code, county
) -> None:
    values = _engine_values(
        _payload(
            state=state,
            zip=zip_code,
            county=county,
            earned_income=30_000,
            rent_annual=24_000,
        ),
        "hud_hap",
        "housing_assistance",
    )
    assert values["hud_hap"] > 0
    assert values["housing_assistance"] == 0


# ACA rating areas: policyengine-us joins the county's code to this file by exact
# name and gives rating area 1 to a county the join misses.


@pytest.fixture(scope="module")
def rating_area_file():
    from policyengine_us.parameters.gov.hhs.medicaid.geography import (
        aca_rating_areas,
    )

    return {
        county: int(area)
        for county, area in zip(
            aca_rating_areas["county"], aca_rating_areas["rating_area"], strict=True
        )
    }


def test_every_county_has_a_rating_area_row_or_an_override(rating_area_file) -> None:
    missed = {code for code in _table().codes if code not in rating_area_file}
    assert missed == set(RATING_AREA_OVERRIDES) | COUNTIES_WITHOUT_RATING_AREA_ROW


def test_each_override_holds_its_rows_rating_area(rating_area_file) -> None:
    for code, (row, area) in RATING_AREA_OVERRIDES.items():
        assert code not in rating_area_file, code
        assert rating_area_file[row] == area, code


def _twin(code, rating_area_file):
    """A county in the same state whose exact name the file holds, in the same area."""
    area = RATING_AREA_OVERRIDES[code][1]
    state = code.rsplit("_", 1)[1]
    return next(
        (
            other
            for other in _table().codes
            if other.endswith(f"_{state}") and rating_area_file.get(other) == area
        ),
        None,
    )


def _rating_areas_and_benchmarks(counties, rating_areas=None):
    """Rating area and January age-0 benchmark for one household per county.

    Once any household in a simulation sets an input, policyengine-core gives the
    others its default (0 for a rating area) rather than the formula's value, so
    this sets the rating area on every household or on none. CliffWatch's own
    simulations hold one household each.
    """
    groups = ("tax_units", "families", "spm_units", "marital_units")
    situation = {"people": {}, "households": {}, **{group: {} for group in groups}}
    for index, code in enumerate(counties):
        person = f"person_{index}"
        situation["people"][person] = {"age": {YEAR: 40}}
        household = {
            "members": [person],
            "state_name": {YEAR: code.rsplit("_", 1)[1]},
            "county": {YEAR: code},
        }
        if rating_areas is not None:
            household["slcsp_rating_area"] = {YEAR: rating_areas[index]}
        situation["households"][f"household_{index}"] = household
        for group in groups:
            situation[group][f"{group}_{index}"] = {"members": [person]}

    simulation = _load_simulation()(situation=situation)
    return dict(
        zip(
            counties,
            zip(
                simulation.calculate("slcsp_rating_area", YEAR).tolist(),
                simulation.calculate("slcsp_age_0", f"{YEAR}-01").tolist(),
                strict=True,
            ),
            strict=True,
        )
    )


def test_an_override_county_gets_the_benchmark_of_its_rating_area(
    rating_area_file,
) -> None:
    """Each override county against a twin whose name the join matches.

    Doña Ana County is the only county in New Mexico's rating area 3, so it has no
    twin; it checks against the rating area 1 the join gives it without the input.
    """
    counties = sorted(RATING_AREA_OVERRIDES)
    twins = {code: _twin(code, rating_area_file) for code in counties}
    assert [code for code, twin in twins.items() if twin is None] == [
        "DOÑA_ANA_COUNTY_NM"
    ]
    sent = _rating_areas_and_benchmarks(
        counties, [rating_area_override(code) for code in counties]
    )
    joined = _rating_areas_and_benchmarks(
        sorted({twin for twin in twins.values() if twin}) + ["DOÑA_ANA_COUNTY_NM"]
    )

    for code in counties:
        area, cost = sent[code]
        assert area == RATING_AREA_OVERRIDES[code][1], code
        assert cost > 0, code
        if twins[code]:
            assert joined[twins[code]] == (area, cost), code
    # Without the input the join misses Doña Ana and prices it as rating area 1.
    assert joined["DOÑA_ANA_COUNTY_NM"][0] == 1
    assert joined["DOÑA_ANA_COUNTY_NM"][1] != sent["DOÑA_ANA_COUNTY_NM"][1]


def test_an_override_reaches_every_point_of_the_series(monkeypatch) -> None:
    """Baylor County by ZIP prices tax credits like Archer County, its rating area 24
    twin, at every earnings level, and unlike the rating area 1 it got before."""
    baylor = _series(_payload(state="TX", zip="76380"))["data"]
    archer = _series(_payload(state="TX", county="ARCHER_COUNTY_TX"))["data"]
    monkeypatch.setattr("cliff_watch.calculator.rating_area_override", lambda _: None)
    before = _series(_payload(state="TX", zip="76380"))["data"]

    credits = [point["aca_ptc"] for point in baylor]
    assert any(credit > 0 for credit in credits)
    assert credits == [point["aca_ptc"] for point in archer]
    assert credits != [point["aca_ptc"] for point in before]


def test_the_first_reviews_baylor_household_reads_rating_area_24() -> None:
    values = _engine_values(
        _payload(state="TX", zip="76380", earned_income=30_000),
        "county_str",
        "slcsp_rating_area",
    )
    assert values == {"county_str": "BAYLOR_COUNTY_TX", "slcsp_rating_area": 24}


def test_the_counties_without_a_benchmark_match_the_engine() -> None:
    """Fails when an engine update adds their rating areas, so the page note goes too.

    A single adult at $60,000 reads a benchmark in every other county, so a zero here
    means the engine holds no premium for the county.
    """
    codes = _table().codes
    groups = ("tax_units", "families", "spm_units", "marital_units")
    situation = {"people": {}, "households": {}, **{group: {} for group in groups}}
    for index, code in enumerate(codes):
        person = f"person_{index}"
        situation["people"][person] = {
            "age": {YEAR: 40},
            "employment_income": {YEAR: 60_000},
        }
        situation["households"][f"household_{index}"] = {
            "members": [person],
            "state_name": {YEAR: code.rsplit("_", 1)[1]},
            "county": {YEAR: code},
        }
        for group in groups:
            situation[group][f"{group}_{index}"] = {"members": [person]}

    simulation = _load_simulation()(situation=situation)
    benchmark = simulation.calculate("slcsp", YEAR, map_to="household")

    assert len(benchmark) == len(codes)
    assert {
        code for code, premium in zip(codes, benchmark, strict=True) if premium == 0
    } == COUNTIES_WITHOUT_BENCHMARK


@pytest.mark.parametrize(
    ("zip_code", "state"), [("29135", "SC"), ("29824", "SC"), ("32456", "FL")]
)
def test_a_county_without_a_benchmark_shows_no_premium_tax_credit(
    zip_code, state
) -> None:
    """What the page's note says, with the state default county as the control."""
    response = compute_series(
        _payload(state=state, zip=zip_code), max_earned_income=60_000, step=10_000
    )
    state_default = compute_series(
        _payload(state=state), max_earned_income=60_000, step=10_000
    )

    assert response["location"]["has_benchmark_premium"] is False
    assert all(point["aca_ptc"] == 0 for point in response["data"])
    assert any(point["aca_ptc"] > 0 for point in state_default["data"])

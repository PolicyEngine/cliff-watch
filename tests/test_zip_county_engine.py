"""The ZIP's county through policyengine-us.

The household is the single parent in Cambridge, Massachusetts, whose chart showed
Barnstable County's benchmark premiums before the API read the ZIP.
"""

from __future__ import annotations

import pytest

pytest.importorskip("policyengine_us")

from api._shared import compute_series
from cliff_watch.calculator import (
    _load_simulation,
    build_household_situation,
    calculate_household,
    calculate_income_series,
    household_input_from_dict,
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


def test_api_series_cache_keeps_zips_apart() -> None:
    cambridge = compute_series(
        _payload(zip="02139"), max_earned_income=20_000, step=5_000
    )
    boston = compute_series(_payload(zip="02163"), max_earned_income=20_000, step=5_000)

    assert cambridge["location"]["county"] == "MIDDLESEX_COUNTY_MA"
    assert boston["location"]["county"] == "SUFFOLK_COUNTY_MA"

"""The ZIP-to-county table and the rule that reads it, with no engine run.

`tests/test_zip_county_engine.py` runs the same rule through policyengine-us.
"""

from __future__ import annotations

import gzip
import importlib.util
import json
import random
import re
import sys
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from cliff_watch.calculator import (
    _normalize_county,
    build_household_situation,
    household_input_from_dict,
    household_location,
    resolved_county,
)
from cliff_watch.zip_county import (
    COUNTIES_WITHOUT_BENCHMARK,
    COUNTIES_WITHOUT_RATING_AREA_ROW,
    DATA_PATH,
    RATING_AREA_OVERRIDES,
    _table,
    counties_for_zip,
    county_for_zip,
    describe_location,
    normalize_zip,
    rating_area_override,
)

ROOT = Path(__file__).resolve().parents[1]

# These tests run on busy machines, where a timing limit measures the machine.
PROPERTY = settings(deadline=None, suppress_health_check=[HealthCheck.too_slow])

STATES = frozenset(
    [
        "AL",
        "AK",
        "AZ",
        "AR",
        "CA",
        "CO",
        "CT",
        "DE",
        "DC",
        "FL",
        "GA",
        "HI",
        "ID",
        "IL",
        "IN",
        "IA",
        "KS",
        "KY",
        "LA",
        "ME",
        "MD",
        "MA",
        "MI",
        "MN",
        "MS",
        "MO",
        "MT",
        "NE",
        "NV",
        "NH",
        "NJ",
        "NM",
        "NY",
        "NC",
        "ND",
        "OH",
        "OK",
        "OR",
        "PA",
        "RI",
        "SC",
        "SD",
        "TN",
        "TX",
        "UT",
        "VT",
        "VA",
        "WA",
        "WV",
        "WI",
        "WY",
    ]
)


def _state_of(code: str) -> str:
    return code.rsplit("_", 1)[1]


def _payload(**overrides):
    return household_input_from_dict(
        {
            "state": "MA",
            "earned_income": 30_000,
            "year": 2026,
            "marital_status": "UNMARRIED",
            "people": [
                {"kind": "adult", "age": 33},
                {"kind": "child", "age": 6},
                {"kind": "child", "age": 10},
            ],
            **overrides,
        }
    )


@lru_cache(maxsize=1)
def _load_builder():
    name = "build_zip_county"
    spec = importlib.util.spec_from_file_location(
        name, ROOT / "scripts" / "build_zip_county.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# A fixed sample keeps Hypothesis's database stable across table rebuilds.
_ALL_ZIPS = sorted(_table().zips)
_ZIP_SAMPLE = random.Random(20261105).sample(_ALL_ZIPS, 2_000)
_COUNTY_CODES = st.sampled_from(_table().codes)


def _zips_by_state() -> dict[str, list[str]]:
    """Every (ZIP, state) pair the table holds, grouped by state. A ZIP that
    crosses a state line appears under each of its states."""
    table = _table()
    by_state: dict[str, list[str]] = {}
    for zip_code in _ALL_ZIPS:
        for state in sorted(
            {_state_of(table.codes[i]) for i, _ in table.zips[zip_code]}
        ):
            by_state.setdefault(state, []).append(zip_code)
    return by_state


def _override_county_zips(zips_by_state: dict[str, list[str]]) -> dict[str, str]:
    """Per override county, the first ZIP that resolves to it."""
    override: dict[str, str] = {}
    for state, zips in sorted(zips_by_state.items()):
        for zip_code in zips:
            county = county_for_zip(zip_code, state)
            if county in RATING_AREA_OVERRIDES:
                override.setdefault(county, zip_code)
    return override


_ZIPS_BY_STATE = _zips_by_state()
_OVERRIDE_COUNTY_ZIPS = _override_county_zips(_ZIPS_BY_STATE)
_ZIP_LIKE_TEXT = st.one_of(
    st.none(),
    st.text(max_size=12),
    st.sampled_from(_ZIP_SAMPLE),
    st.integers(min_value=0, max_value=99_999_999).map(str),
    st.from_regex(r"\A[0-9]{5}-[0-9]{4}\Z"),
)


# The table, for every row.


def test_every_zip_is_five_ascii_digits() -> None:
    pattern = re.compile(r"[0-9]{5}")
    assert all(pattern.fullmatch(zip_code) for zip_code in _table().zips)


def test_every_county_belongs_to_a_state_the_form_accepts() -> None:
    assert {_state_of(code) for code in _table().codes} == STATES


def test_every_county_serves_some_zip() -> None:
    used = {index for rows in _table().zips.values() for index, _ in rows}
    assert used == set(range(len(_table().codes)))


def test_every_county_code_is_an_engine_county() -> None:
    pytest.importorskip("policyengine_us")
    from policyengine_us.variables.household.demographic.geographic.county.county_enum import (
        County,
    )

    members = set(County._member_names_)
    assert [code for code in _table().codes if code not in members] == []


def test_every_county_code_survives_the_explicit_county_path() -> None:
    """A picked county must reach the engine as the code the table gave it."""
    for code in _table().codes:
        assert _normalize_county(code, _state_of(code)) == code


def test_each_zip_lists_counties_in_resolution_order() -> None:
    table = _table()
    for zip_code, rows in table.zips.items():
        assert rows, zip_code
        counted = [residents is not None for _, residents in rows]
        # Either the Census counted every county in the row or none of them.
        assert all(counted) or not any(counted), zip_code
        if all(counted):
            keys = [(-residents, table.codes[index]) for index, residents in rows]
            assert keys == sorted(keys), zip_code
            assert all(residents > 0 for _, residents in rows), zip_code
        codes = [table.codes[index] for index, _ in rows]
        assert len(codes) == len(set(codes)), zip_code


def test_resident_shares_sum_to_one_across_state_lines() -> None:
    table = _table()
    for zip_code, rows in table.zips.items():
        states = {_state_of(table.codes[index]) for index, _ in rows}
        options = [
            option for state in states for option in counties_for_zip(zip_code, state)
        ]
        assert len(options) == len(rows), zip_code
        if rows[0][1] is None:
            assert all(option.resident_share is None for option in options), zip_code
        else:
            total = sum(option.resident_share for option in options)
            assert total == pytest.approx(1.0), zip_code


def test_county_for_zip_returns_the_first_row_in_each_state() -> None:
    table = _table()
    for zip_code, rows in table.zips.items():
        first_by_state: dict[str, str] = {}
        for index, _ in rows:
            code = table.codes[index]
            first_by_state.setdefault(_state_of(code), code)
        for state, code in first_by_state.items():
            assert county_for_zip(zip_code, state) == code, zip_code


def test_table_records_its_sources_and_builder() -> None:
    with gzip.open(DATA_PATH, "rt", encoding="utf-8") as file:
        meta = json.load(file)["meta"]
    assert meta["built_by"] == "scripts/build_zip_county.py"
    assert meta["sources"]["geonames"]["license"] == "CC BY 4.0"
    assert set(meta["sources"]) == {
        "relationship_file",
        "residents",
        "geonames",
        "uds_crosswalk",
    }


# Pinned places, checked by hand against the Census files.


@pytest.mark.parametrize(
    ("zip_code", "state", "expected"),
    [
        ("02139", "MA", [("MIDDLESEX_COUNTY_MA", 39_525)]),
        ("02138", "MA", [("MIDDLESEX_COUNTY_MA", 37_982)]),
        (
            "02467",
            "MA",
            [
                ("MIDDLESEX_COUNTY_MA", 9_116),
                ("NORFOLK_COUNTY_MA", 9_024),
                ("SUFFOLK_COUNTY_MA", 4_486),
            ],
        ),
        ("02163", "MA", [("SUFFOLK_COUNTY_MA", 1_391)]),
        ("10463", "NY", [("BRONX_COUNTY_NY", 62_707), ("NEW_YORK_COUNTY_NY", 8_594)]),
        ("42223", "KY", [("CHRISTIAN_COUNTY_KY", 12_828)]),
        ("42223", "TN", [("MONTGOMERY_COUNTY_TN", 7_307)]),
        ("96742", "HI", [("KALAWAO_COUNTY_HI", 82)]),
    ],
)
def test_pinned_resident_counts(zip_code, state, expected) -> None:
    options = counties_for_zip(zip_code, state)
    assert [(option.code, option.residents) for option in options] == expected


@pytest.mark.parametrize(
    ("zip_code", "state", "expected"),
    [
        ("10001", "NY", "NEW_YORK_COUNTY_NY"),
        ("90210", "CA", "LOS_ANGELES_COUNTY_CA"),
        ("90001", "CA", "LOS_ANGELES_COUNTY_CA"),
        ("60601", "IL", "COOK_COUNTY_IL"),
        ("30303", "GA", "FULTON_COUNTY_GA"),
        ("77002", "TX", "HARRIS_COUNTY_TX"),
        ("20001", "DC", "DISTRICT_OF_COLUMBIA_DC"),
        ("22314", "VA", "ALEXANDRIA_CITY_VA"),
        ("70112", "LA", "ORLEANS_PARISH_LA"),
        ("99501", "AK", "ANCHORAGE_MUNICIPALITY_AK"),
        ("21201", "MD", "BALTIMORE_CITY_MD"),
        ("63101", "MO", "ST_LOUIS_CITY_MO"),
        ("88001", "NM", "DOÑA_ANA_COUNTY_NM"),
        ("06010", "CT", "HARTFORD_COUNTY_CT"),
        ("89439", "NV", "WASHOE_COUNTY_NV"),
        ("89439", "CA", "SIERRA_COUNTY_CA"),
        # A ZIP with no ZCTA of its own: a county, and no resident count to show.
        ("02238", "MA", "MIDDLESEX_COUNTY_MA"),
    ],
)
def test_pinned_counties(zip_code, state, expected) -> None:
    assert county_for_zip(zip_code, state) == expected


def test_zip_with_no_zcta_records_no_residents() -> None:
    [option] = counties_for_zip("02238", "MA")
    assert option.residents is None
    assert option.resident_share is None


def test_puerto_rico_zip_is_outside_the_table() -> None:
    assert describe_location("00601", "MA") == {
        "zip": "00601",
        "county": None,
        "county_name": None,
        "source": "none",
        "has_benchmark_premium": True,
        "counties": [],
    }


@pytest.mark.parametrize(
    ("zip_code", "state", "county"),
    [
        ("29135", "SC", "CALHOUN_COUNTY_SC"),
        ("29824", "SC", "EDGEFIELD_COUNTY_SC"),
        ("32456", "FL", "GULF_COUNTY_FL"),
    ],
)
def test_location_flags_a_county_with_no_benchmark_premium(
    zip_code, state, county
) -> None:
    location = describe_location(zip_code, state)
    assert location["county"] == county
    assert location["has_benchmark_premium"] is False


def test_the_benchmark_flag_follows_the_county_a_link_names() -> None:
    edgefield = describe_location("29201", "SC", "EDGEFIELD_COUNTY_SC")
    richland = describe_location("29824", "SC", "RICHLAND_COUNTY_SC")
    assert edgefield["has_benchmark_premium"] is False
    assert richland["has_benchmark_premium"] is True


def test_no_state_default_county_lacks_a_benchmark_premium() -> None:
    """A location with no county reads true, because the engine then uses the default."""
    assert COUNTIES_WITHOUT_BENCHMARK <= set(_table().codes)
    for state in {_state_of(code) for code in COUNTIES_WITHOUT_BENCHMARK}:
        counties = [code for code in _table().codes if _state_of(code) == state]
        assert min(counties) not in COUNTIES_WITHOUT_BENCHMARK


# The rating areas the engine's name join misses. `tests/test_zip_county_engine.py`
# checks each entry against the engine's own file.


def test_rating_area_overrides_name_table_counties_and_their_own_state() -> None:
    codes = set(_table().codes)
    assert set(RATING_AREA_OVERRIDES) <= codes
    assert COUNTIES_WITHOUT_RATING_AREA_ROW <= codes
    assert not set(RATING_AREA_OVERRIDES) & COUNTIES_WITHOUT_RATING_AREA_ROW
    for code, (row, area) in RATING_AREA_OVERRIDES.items():
        # The file's spelling differs from the code but names the same state.
        assert row != code
        assert _state_of(row) == _state_of(code), code
        assert isinstance(area, int) and area >= 1, code
        assert rating_area_override(code) == area


@pytest.mark.parametrize(
    "county", [None, "", "MIDDLESEX_COUNTY_MA", "OGLALA_LAKOTA_COUNTY_SD", "X_MA"]
)
def test_other_counties_get_no_rating_area_override(county) -> None:
    assert rating_area_override(county) is None


@pytest.mark.parametrize("county", sorted(RATING_AREA_OVERRIDES))
def test_an_override_county_sends_its_rating_area_by_name_or_by_zip(county) -> None:
    state = _state_of(county)
    zip_code = _OVERRIDE_COUNTY_ZIPS[county]
    area = RATING_AREA_OVERRIDES[county][1]
    named = build_household_situation(_payload(state=state, county=county))
    from_zip = build_household_situation(_payload(state=state, zip=zip_code))

    assert named["households"]["household"]["slcsp_rating_area"] == {2026: area}
    assert from_zip["households"]["household"]["county"] == {2026: county}
    assert from_zip["households"]["household"]["slcsp_rating_area"] == {2026: area}


# The rule, through the calculator's input type.


def test_zip_alone_resolves_to_its_county() -> None:
    payload = _payload(zip="02139")
    assert resolved_county(payload) == "MIDDLESEX_COUNTY_MA"
    location = household_location(payload)
    assert location["source"] == "zip"
    assert location["county"] == "MIDDLESEX_COUNTY_MA"
    assert location["county_name"] == "Middlesex County"

    household = build_household_situation(payload)["households"]["household"]
    assert household["county"][2026] == "MIDDLESEX_COUNTY_MA"
    assert household["zip_code"][2026] == "02139"


def test_explicit_county_overrides_the_zip() -> None:
    payload = _payload(zip="02139", county="SUFFOLK_COUNTY_MA")
    assert resolved_county(payload) == "SUFFOLK_COUNTY_MA"
    location = household_location(payload)
    assert location["source"] == "explicit"
    assert location["county"] == "SUFFOLK_COUNTY_MA"
    assert [county["code"] for county in location["counties"]] == [
        "MIDDLESEX_COUNTY_MA"
    ]

    household = build_household_situation(payload)["households"]["household"]
    assert household["county"][2026] == "SUFFOLK_COUNTY_MA"
    assert household["zip_code"][2026] == "02139"


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_blank_county_falls_through_to_the_zip(blank) -> None:
    payload = _payload(zip="02139", county=blank)
    assert resolved_county(payload) == "MIDDLESEX_COUNTY_MA"
    assert household_location(payload)["source"] == "zip"


def test_cross_state_zip_resolves_by_the_household_state() -> None:
    kentucky = _payload(state="KY", zip="42223")
    tennessee = _payload(state="TN", zip="42223")
    assert resolved_county(kentucky) == "CHRISTIAN_COUNTY_KY"
    assert resolved_county(tennessee) == "MONTGOMERY_COUNTY_TN"
    assert household_location(kentucky)["counties"][0][
        "resident_share"
    ] == pytest.approx(12_828 / (12_828 + 7_307))


def test_zip_outside_the_state_leaves_the_engine_its_default() -> None:
    payload = _payload(state="CA", zip="02139")
    assert resolved_county(payload) is None
    assert household_location(payload)["source"] == "none"
    assert "county" not in build_household_situation(payload)["households"]["household"]


def test_no_zip_and_no_county_stay_as_they_were() -> None:
    payload = _payload()
    assert payload.zip is None
    household = build_household_situation(payload)["households"]["household"]
    assert "county" not in household
    assert "zip_code" not in household
    assert household_location(payload) == {
        "zip": None,
        "county": None,
        "county_name": None,
        "source": "none",
        "has_benchmark_premium": True,
        "counties": [],
    }


@pytest.mark.parametrize(
    "written", ["02139", " 02139 ", "02139-1234", "021391234", "ZIP 02139"]
)
def test_payload_normalizes_zip_like_the_form(written) -> None:
    assert _payload(zip=written).zip == "02139"


@pytest.mark.parametrize("written", ["", "2139", "abcde", None, "０２１３９"])
def test_payload_drops_a_zip_with_too_few_ascii_digits(written) -> None:
    assert _payload(zip=written).zip is None


# Properties for every input.


@PROPERTY
@given(_ZIP_LIKE_TEXT)
def test_normalize_zip_gives_five_ascii_digits_or_none_and_is_idempotent(value) -> None:
    normalized = normalize_zip(value)
    assert normalized is None or re.fullmatch(r"[0-9]{5}", normalized)
    assert normalize_zip(normalized) == normalized


@PROPERTY
@given(_ZIP_LIKE_TEXT, st.sampled_from(sorted(STATES)))
def test_lookup_never_raises_and_stays_in_the_state(value, state) -> None:
    county = county_for_zip(value, state)
    assert county is None or _state_of(county) == state
    location = describe_location(value, state)
    assert location["county"] == county
    assert location["source"] == ("zip" if county else "none")
    assert location["has_benchmark_premium"] == (
        county not in COUNTIES_WITHOUT_BENCHMARK
    )
    assert all(_state_of(option["code"]) == state for option in location["counties"])
    # The page reads this block as JSON.
    assert json.loads(json.dumps(location)) == location


@PROPERTY
@given(_ZIP_LIKE_TEXT, _COUNTY_CODES)
def test_explicit_county_always_wins(value, county) -> None:
    state = _state_of(county)
    payload = _payload(state=state, zip=value, county=county)
    assert resolved_county(payload) == county
    location = household_location(payload)
    assert location["county"] == county
    assert location["source"] == "explicit"
    assert location["county_name"]


@pytest.mark.parametrize("state", sorted(STATES))
def test_zip_alone_builds_the_same_situation_as_its_county_named(state) -> None:
    """Every ZIP the table holds for the state, so across the states every
    (ZIP, state) pair."""
    for zip_code in _ZIPS_BY_STATE[state]:
        county = county_for_zip(zip_code, state)
        assert county is not None and _state_of(county) == state, zip_code
        zip_only = build_household_situation(_payload(state=state, zip=zip_code))
        explicit = build_household_situation(
            _payload(state=state, zip=zip_code, county=county)
        )
        assert zip_only == explicit, zip_code
        assert zip_only["households"]["household"]["county"] == {2026: county}


def test_the_per_state_loops_cover_every_zip_and_state() -> None:
    """The loops above walk `_ZIPS_BY_STATE`, so it must list each (ZIP, state)
    pair the table holds exactly once, including the pairs of ZIPs that cross a
    state line."""
    table = _table()
    pairs = {
        (zip_code, _state_of(table.codes[index]))
        for zip_code, rows in table.zips.items()
        for index, _ in rows
    }
    listed = [
        (zip_code, state) for state, zips in _ZIPS_BY_STATE.items() for zip_code in zips
    ]
    assert len(listed) == len(set(listed))
    assert set(listed) == pairs
    assert set(_ZIPS_BY_STATE) == {state for _, state in pairs} == STATES
    assert len(pairs) > len(table.zips)  # some ZIPs cross a state line


@PROPERTY
@given(_ZIP_LIKE_TEXT, _COUNTY_CODES)
def test_only_an_override_county_gets_a_rating_area_input(value, county) -> None:
    household = build_household_situation(
        _payload(state=_state_of(county), zip=value, county=county)
    )["households"]["household"]
    if county in RATING_AREA_OVERRIDES:
        assert household["slcsp_rating_area"] == {
            2026: RATING_AREA_OVERRIDES[county][1]
        }
    else:
        assert "slcsp_rating_area" not in household


@PROPERTY
@given(_ZIP_LIKE_TEXT, st.sampled_from(sorted(STATES)))
def test_no_household_takes_up_housing_assistance(value, state) -> None:
    """CliffWatch has no voucher input (#30), so no ZIP or county turns one on."""
    situation = build_household_situation(_payload(state=state, zip=value))
    for record in situation["spm_units"].values():
        assert record["takes_up_housing_assistance_if_eligible"] == {2026: False}


@pytest.mark.parametrize("state", sorted(STATES))
def test_counties_for_a_zip_lead_with_the_county_it_resolves_to(state) -> None:
    for zip_code in _ZIPS_BY_STATE[state]:
        options = counties_for_zip(zip_code, state)
        assert options[0].code == county_for_zip(zip_code, state), zip_code
        for option in options:
            assert _state_of(option.code) == state, zip_code
            assert option.name, zip_code
            if option.resident_share is not None:
                assert 0 < option.resident_share <= 1, zip_code


@PROPERTY
@given(_ZIP_LIKE_TEXT)
def test_payload_survives_the_cache_key_serialization(value) -> None:
    payload = _payload(zip=value)
    round_tripped = json.loads(json.dumps(asdict(payload), sort_keys=True))
    assert household_input_from_dict(round_tripped).zip == payload.zip


# The builder's rule, on toy inputs.

ENGINE = {
    "25017": ("MIDDLESEX_COUNTY_MA", "Middlesex County"),
    "25021": ("NORFOLK_COUNTY_MA", "Norfolk County"),
    "25025": ("SUFFOLK_COUNTY_MA", "Suffolk County"),
    "09003": ("HARTFORD_COUNTY_CT", "Hartford County"),
    "21047": ("CHRISTIAN_COUNTY_KY", "Christian County"),
    "47125": ("MONTGOMERY_COUNTY_TN", "Montgomery County"),
}


def _build(land=None, population=None, geonames=None, crosswalk=None):
    return _load_builder().build_table(
        land or {},
        population or {},
        geonames or {},
        crosswalk or {},
        ENGINE,
    )


def test_builder_ranks_counties_by_residents() -> None:
    zips, counts = _build(
        land={"02467": {"25017": 1, "25021": 2, "25025": 3}},
        population={"02467": {"25017": 9, "25021": 8, "25025": 7}},
    )
    assert zips["02467"] == [
        ("MIDDLESEX_COUNTY_MA", 9),
        ("NORFOLK_COUNTY_MA", 8),
        ("SUFFOLK_COUNTY_MA", 7),
    ]
    assert counts["zcta_with_residents"] == 1


def test_builder_breaks_a_resident_tie_by_code() -> None:
    zips, _ = _build(
        land={"02467": {"25025": 1, "25017": 2}},
        population={"02467": {"25025": 5, "25017": 5}},
    )
    assert [code for code, _ in zips["02467"]] == [
        "MIDDLESEX_COUNTY_MA",
        "SUFFOLK_COUNTY_MA",
    ]


def test_builder_leaves_out_a_county_with_land_and_no_residents() -> None:
    zips, _ = _build(
        land={"02467": {"25017": 1, "25021": 99}},
        population={"02467": {"25017": 5, "25021": 0}},
    )
    assert zips["02467"] == [("MIDDLESEX_COUNTY_MA", 5)]


def test_builder_ranks_a_zcta_with_no_residents_by_land_and_records_no_count() -> None:
    zips, counts = _build(land={"02238": {"25017": 1, "25021": 5}})
    assert zips["02238"] == [("NORFOLK_COUNTY_MA", None), ("MIDDLESEX_COUNTY_MA", None)]
    assert counts["zcta_without_residents"] == 1


def test_builder_gives_a_zip_with_no_zcta_its_geonames_county() -> None:
    zips, counts = _build(
        land={"02139": {"25017": 1}},
        population={"02139": {"25017": 5}},
        geonames={"02238": ("MA", "25021"), "02139": ("MA", "25025")},
    )
    assert zips["02238"] == [("NORFOLK_COUNTY_MA", None)]
    # A ZIP with its own ZCTA keeps the Census answer over GeoNames.
    assert zips["02139"] == [("MIDDLESEX_COUNTY_MA", 5)]
    assert counts["zip_without_zcta_from_geonames"] == 1


def test_builder_falls_back_to_the_crosswalk_zctas_county_in_the_same_state() -> None:
    zips, counts = _build(
        land={"42223": {"21047": 1, "47125": 1}, "06010": {"09003": 1}},
        population={"42223": {"21047": 9, "47125": 7}, "06010": {"09003": 5}},
        # GeoNames gives a planning region the engine lacks, so the row moves on.
        geonames={"06011": ("CT", "09110")},
        crosswalk={
            "06011": ("CT", "06010"),
            "42221": ("TN", "42223"),
            "99999": ("MA", "42223"),
        },
    )
    assert zips["06011"] == [("HARTFORD_COUNTY_CT", None)]
    # In its own state, though the ZCTA's largest county lies across the line.
    assert zips["42221"] == [("MONTGOMERY_COUNTY_TN", None)]
    # No county of that ZCTA in that state, so no row at all.
    assert "99999" not in zips
    assert counts["zip_without_zcta_from_crosswalk"] == 2


def test_builder_skips_a_zcta_outside_the_engine_counties() -> None:
    zips, counts = _build(land={"00601": {"72001": 1}})
    assert zips == {}
    assert counts["zcta_outside_engine_counties"] == 1


_FIPS = sorted(ENGINE)
_LAND_AND_POPULATION = st.dictionaries(
    st.sampled_from(["02138", "02139", "02140", "02141"]),
    st.dictionaries(
        st.sampled_from(_FIPS),
        st.tuples(
            st.integers(min_value=0, max_value=1_000),
            st.integers(min_value=0, max_value=1_000),
        ),
        min_size=1,
    ),
    max_size=4,
)


@PROPERTY
@given(_LAND_AND_POPULATION)
def test_builder_invariants_for_any_inputs(cells) -> None:
    land = {z: {f: a for f, (a, _) in row.items()} for z, row in cells.items()}
    population = {z: {f: p for f, (_, p) in row.items()} for z, row in cells.items()}

    zips, counts = _build(land=land, population=population)
    fips_by_code = {code: fips for fips, (code, _) in ENGINE.items()}

    def in_order(rows, measure_by_fips):
        """Most first by each county's measure, ties broken by county code."""
        keys = [(-measure_by_fips[fips_by_code[code]], code) for code, _ in rows]
        return keys == sorted(keys) and len(set(keys)) == len(keys)

    assert set(zips) == set(land)
    for zcta, rows in zips.items():
        residents = population[zcta]
        if sum(residents.values()) > 0:
            top = max(residents.values())
            # The first county holds the most residents, and only counties with
            # residents appear.
            assert rows[0][1] == top
            assert all(count and count > 0 for _, count in rows)
            assert len(rows) == sum(1 for value in residents.values() if value > 0)
            assert sum(count for _, count in rows) == sum(residents.values())
            assert in_order(rows, residents)
        else:
            # With no residents, every county with land appears, most land first.
            assert all(count is None for _, count in rows)
            assert len(rows) == len(land[zcta])
            assert {fips_by_code[code] for code, _ in rows} == set(land[zcta])
            assert in_order(rows, land[zcta])
    assert (counts["zcta_with_residents"] + counts["zcta_without_residents"]) == len(
        zips
    )

    # The order of the input files changes nothing.
    rng = random.Random(0)

    def shuffled(mapping):
        items = list(mapping.items())
        rng.shuffle(items)
        return {
            key: dict(rng.sample(list(value.items()), len(value)))
            for key, value in items
        }

    assert _build(land=shuffled(land), population=shuffled(population))[0] == zips


def test_builder_writes_the_same_bytes_for_the_same_table(tmp_path) -> None:
    builder = _load_builder()
    zips = {
        "02467": [("MIDDLESEX_COUNTY_MA", 9), ("NORFOLK_COUNTY_MA", 8)],
        "02238": [("MIDDLESEX_COUNTY_MA", None)],
    }
    first = builder.write_table(tmp_path / "a.json.gz", zips, ENGINE, {"note": "toy"})
    second = builder.write_table(
        tmp_path / "b.json.gz",
        dict(reversed(list(zips.items()))),
        ENGINE,
        {"note": "toy"},
    )
    assert first == second

    with gzip.open(tmp_path / "a.json.gz", "rt", encoding="utf-8") as file:
        document = json.load(file)
    codes = [code for code, _ in document["counties"]]
    assert document["zips"]["02467"] == [
        [codes.index("MIDDLESEX_COUNTY_MA"), 9],
        [codes.index("NORFOLK_COUNTY_MA"), 8],
    ]

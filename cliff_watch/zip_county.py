"""Map a household's ZIP code to its county.

The form asks for a ZIP and no county, and policyengine-us gives a household with
no county its state's first county. This module closes that gap. It reads
`data/zip_county.json.gz`, which `scripts/build_zip_county.py` builds from Census
and GeoNames data, and resolves a county by this rule:

1. An explicit county, such as a share link's `county=`, always wins.
2. Otherwise the household gets the ZIP's first county in the household's state.
   A ZIP with several counties lists the one with the most 2020 Census residents
   first, ties going to the lower county code.
3. A ZIP with no county in that state resolves to nothing, and the engine then
   uses the state's first county. `describe_location` reports this as "none", so
   the page can say so.

It also lists two engine gaps by county: the counties whose benchmark premium the
engine lacks, and the counties whose ACA rating area its name join misses.

This module imports no engine code, so a request pays only for reading the table.
"""

from __future__ import annotations

import gzip
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA_PATH = Path(__file__).resolve().parent / "data" / "zip_county.json.gz"

# policyengine-us's `gov.aca.state_rating_area_cost` has no row for these counties'
# rating areas (South Carolina 9 and 19, Florida 22), so a household there reads a
# $0 benchmark premium and no premium tax credit. The page says so. A test compares
# this set with the engine, so an engine update that adds the rows fails until the
# set shrinks.
COUNTIES_WITHOUT_BENCHMARK = frozenset(
    {"CALHOUN_COUNTY_SC", "EDGEFIELD_COUNTY_SC", "GULF_COUNTY_FL"}
)

# policyengine-us finds a county's ACA rating area by joining the county's name to
# `gov/hhs/medicaid/geography/aca_rating_areas.csv`, and gives rating area 1 to any
# county the join misses. That file names these counties differently from the
# engine's `County` codes, so the calculator sends each one's rating area as an
# input. Each entry gives the file's row and the rating area that row holds. Most
# rows drop a word or a letter (`BAYLOR_TX`, `DONA_ANA_NM`). Chugach and Copper
# River read the row of Valdez-Cordova, the census area the Census Bureau split
# into them in 2019, and Kusilvak reads Wade Hampton's, its name until 2015. The
# file has no row for Oglala Lakota County, South Dakota, under that name or under
# Shannon County, its name until 2015, so it keeps the engine's rating area 1.
# Tests compare this map with the engine, so an engine update that renames a row
# fails until the entry goes.
RATING_AREA_OVERRIDES = {
    "ADAMS_COUNTY_MS": ("ADAMS_MS", 6),
    "BAYLOR_COUNTY_TX": ("BAYLOR_TX", 24),
    "BEN_HILL_COUNTY_GA": ("BEN_HILL_GA", 15),
    "BRYAN_COUNTY_GA": ("BRYAN_GA", 14),
    "CHOCTAW_COUNTY_MS": ("CHOCTAW_MS", 6),
    "CHUGACH_CENSUS_AREA_AK": ("VALDEZCORDOVA_AK", 1),
    "CHURCHILL_COUNTY_NV": ("CHURCHILL_NV", 4),
    "CLARK_COUNTY_KY": ("CLARK_KY", 5),
    "COPPER_RIVER_CENSUS_AREA_AK": ("VALDEZCORDOVA_AK", 1),
    "CUMBERLAND_COUNTY_KY": ("CUMBERLAND_KY", 4),
    "DAWSON_COUNTY_GA": ("DAWSON_GA", 10),
    "DEUEL_COUNTY_NE": ("DEUEL_NE", 4),
    "DOÑA_ANA_COUNTY_NM": ("DONA_ANA_NM", 3),
    "HAINES_BOROUGH_AK": ("HAINES_AK", 3),
    "HARDEMAN_COUNTY_TX": ("HARDEMAN_TX", 24),
    "HEMPHILL_COUNTY_TX": ("HEMPHILL_TX", 2),
    "JIM_HOGG_COUNTY_TX": ("JIM_HOGG_TX", 12),
    "JOHNSON_COUNTY_GA": ("JOHNSON_GA", 11),
    "KIMBLE_COUNTY_TX": ("KIMBLE_TX", 17),
    "KUSILVAK_CENSUS_AREA_AK": ("WADE_HAMPTON_AK", 2),
    "LASALLE_PARISH_LA": ("LA_SALLE_LA", 6),
    "LOGAN_COUNTY_NE": ("LOGAN_NE", 4),
    "LOS_ALAMOS_COUNTY_NM": ("LOS_ALAMOS_NM", 5),
    "MITCHELL_COUNTY_NC": ("MITCHELL_NC", 1),
    "NESHOBA_COUNTY_MS": ("NESHOBA_MS", 6),
    "PASQUOTANK_COUNTY_NC": ("PASQUOTANK_NC", 12),
    "PETERSBURG_BOROUGH_AK": ("PETERSBURG_AK", 3),
    "PRINCE_OF_WALES_HYDER_CENSUS_AREA_AK": ("PRINCE_OF_WALESHYDER_AK", 3),
    "REAGAN_COUNTY_TX": ("REAGAN_TX", 17),
    "TOOMBS_COUNTY_GA": ("TOOMBS_GA", 11),
    "WALTHALL_COUNTY_MS": ("WALTHALL_MS", 6),
}
COUNTIES_WITHOUT_RATING_AREA_ROW = frozenset({"OGLALA_LAKOTA_COUNTY_SD"})


def rating_area_override(county: str | None) -> int | None:
    """The ACA rating area to send for a county the engine's join misses, if any."""
    entry = RATING_AREA_OVERRIDES.get(county) if county else None
    return entry[1] if entry else None

_NON_DIGITS = re.compile(r"[^0-9]")


@dataclass(frozen=True)
class CountyOption:
    code: str
    name: str
    residents: int | None
    resident_share: float | None


@dataclass(frozen=True)
class _Table:
    names_by_code: dict[str, str]
    codes: tuple[str, ...]
    zips: dict[str, list[list[int | None]]]


@lru_cache(maxsize=1)
def _table() -> _Table:
    with gzip.open(DATA_PATH, "rt", encoding="utf-8") as file:
        document = json.load(file)
    counties = document["counties"]
    return _Table(
        names_by_code={code: name for code, name in counties},
        codes=tuple(code for code, _ in counties),
        zips=document["zips"],
    )


def normalize_zip(value: Any) -> str | None:
    """Return the first five digits, as the form does, or None if there are fewer."""
    digits = _NON_DIGITS.sub("", "" if value is None else str(value))[:5]
    return digits if len(digits) == 5 else None


def counties_for_zip(zip_code: Any, state: str | None) -> tuple[CountyOption, ...]:
    """The ZIP's counties in `state`, in resolution order.

    `resident_share` is the county's share of everyone in the ZIP, across state
    lines. It is None where the table records no residents.
    """
    normalized = normalize_zip(zip_code)
    if normalized is None or not state:
        return ()
    table = _table()
    rows = table.zips.get(normalized)
    if not rows:
        return ()
    total_residents = sum(residents or 0 for _, residents in rows)
    suffix = f"_{state}"
    options = []
    for index, residents in rows:
        code = table.codes[index]
        if code.endswith(suffix):
            options.append(
                CountyOption(
                    code=code,
                    name=table.names_by_code[code],
                    residents=residents,
                    resident_share=(
                        residents / total_residents
                        if residents is not None and total_residents
                        else None
                    ),
                )
            )
    return tuple(options)


def county_for_zip(zip_code: Any, state: str | None) -> str | None:
    """The county code a household in this ZIP and state resolves to, if any."""
    options = counties_for_zip(zip_code, state)
    return options[0].code if options else None


def describe_location(
    zip_code: Any,
    state: str | None,
    explicit_county: str | None = None,
) -> dict[str, Any]:
    """Say which county a calculation uses and why, for the page to show."""
    options = counties_for_zip(zip_code, state)
    if explicit_county:
        county, source = explicit_county, "explicit"
    elif options:
        county, source = options[0].code, "zip"
    else:
        county, source = None, "none"
    return {
        "zip": normalize_zip(zip_code),
        "county": county,
        "county_name": _table().names_by_code.get(county) if county else None,
        "source": source,
        "has_benchmark_premium": county not in COUNTIES_WITHOUT_BENCHMARK,
        "counties": [
            {
                "code": option.code,
                "name": option.name,
                "residents": option.residents,
                "resident_share": option.resident_share,
            }
            for option in options
        ],
    }

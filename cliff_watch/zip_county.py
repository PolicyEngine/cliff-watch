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

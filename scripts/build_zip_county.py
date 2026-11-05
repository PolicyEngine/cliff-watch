"""Build cliff_watch/data/zip_county.json.gz, which maps a ZIP to its counties.

Sources, all public:

- Census 2020 ZCTA-to-county relationship file: which counties each ZIP Code
  Tabulation Area (ZCTA) touches, and how much land it has in each.
- Census 2020 Demographic and Housing Characteristics (DHC), table P1, summary
  level 881: residents of each ZCTA-county part.
- GeoNames US postal codes (CC BY 4.0): the county of each ZIP that has no ZCTA
  of its own, such as a post-office-box or single-organization ZIP.
- The UDS Mapper ZIP-to-ZCTA crosswalk, as policyengine-us-data stored it: the
  ZCTA of a ZIP that GeoNames can't place in a county the engine knows. GeoNames
  gives Connecticut's planning regions, and the engine still has its 8 counties.
  This build reads only that file's ZIP, ZCTA and state columns. Its county column
  holds a random county for a ZCTA that spans several.
- policyengine-us's county_fips_2020.csv.gz and County enum: the code the engine
  reads for each county FIPS.

The rule the table encodes, which `cliff_watch.zip_county` applies:

- Each ZIP lists its counties in resolution order.
- A ZIP with its own ZCTA lists counties by 2020 residents, most first, with ties
  broken by county code.
- A ZCTA with no residents lists counties by land area and records no population.
- A ZIP with no ZCTA lists the single county GeoNames gives it, or else the first
  county of its crosswalk ZCTA in its own state, and records no population.

Run it from the repository root:

    CENSUS_API_KEY=... uv run python scripts/build_zip_county.py --cache-dir /tmp/zc

The cache directory keeps each download, so a rerun repeats no request and gives
a byte-identical file.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RELATIONSHIP_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/"
    "tab20_zcta520_county20_natl.txt"
)
DHC_URL = "https://api.census.gov/data/2020/dec/dhc"
GEONAMES_URL = "https://download.geonames.org/export/zip/US.zip"
UDS_CROSSWALK_URL = (
    "https://raw.githubusercontent.com/PolicyEngine/policyengine-us-data/"
    "76c61544d7e7db37bed768784a8cd2411e48d6c2/"
    "policyengine_us_data/geography/zip_codes.csv.gz"
)

OUTPUT_PATH = (
    Path(__file__).resolve().parents[1] / "cliff_watch" / "data" / "zip_county.json.gz"
)

# The 50 states and DC, the places the form accepts.
STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "DC": "11", "FL": "12", "GA": "13", "HI": "15",
    "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
    "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
    "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
    "WV": "54", "WI": "55", "WY": "56",
}  # fmt: skip
STATE_BY_FIPS = {fips: state for state, fips in STATE_FIPS.items()}

ZCTAS_PER_REQUEST = 200
USER_AGENT = "cliff-watch-build-zip-county"


def _download(url: str, attempts: int = 6) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == attempts - 1:
                raise
            print(f"retrying after {exc}", file=sys.stderr)
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def _cached(cache_dir: Path, name: str, url: str) -> bytes:
    path = cache_dir / name
    if path.exists():
        return path.read_bytes()
    body = _download(url)
    path.write_bytes(body)
    return body


def read_relationship_file(body: bytes) -> dict[str, dict[str, int]]:
    """Land area in square meters by ZCTA and county FIPS."""
    land_by_zcta: dict[str, dict[str, int]] = defaultdict(dict)
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig")), delimiter="|")
    for row in reader:
        zcta = row["GEOID_ZCTA5_20"]
        county_fips = row["GEOID_COUNTY_20"]
        if not zcta or not county_fips:
            continue
        land_by_zcta[zcta][county_fips] = int(row["AREALAND_PART"] or 0)
    return dict(land_by_zcta)


def read_population(
    land_by_zcta: dict[str, dict[str, int]],
    cache_dir: Path,
    api_key: str | None,
) -> tuple[dict[str, dict[str, int]], list[str]]:
    """2020 residents by ZCTA and county FIPS, from DHC summary level 881."""
    zctas_by_state: dict[str, set[str]] = defaultdict(set)
    for zcta, counties in land_by_zcta.items():
        for county_fips in counties:
            if county_fips[:2] in STATE_BY_FIPS:
                zctas_by_state[county_fips[:2]].add(zcta)

    jobs: list[tuple[str, int, list[str]]] = []
    for state_fips, zctas in sorted(zctas_by_state.items()):
        ordered = sorted(zctas)
        for start in range(0, len(ordered), ZCTAS_PER_REQUEST):
            batch = ordered[start : start + ZCTAS_PER_REQUEST]
            jobs.append((state_fips, start, batch))

    def fetch(job: tuple[str, int, list[str]]) -> tuple[str, list[list[str]]]:
        state_fips, start, batch = job
        name = f"dhc-{state_fips}-{start:05d}-{len(batch)}.json"
        path = cache_dir / name
        if path.exists():
            return name, json.loads(path.read_text())
        query = {
            "get": "P1_001N",
            "for": "county (or part):*",
            "in": (
                f"state:{state_fips} "
                f"zip code tabulation area (or part):{','.join(batch)}"
            ),
        }
        if api_key:
            query["key"] = api_key
        url = f"{DHC_URL}?{urllib.parse.urlencode(query)}"
        body = _download(url)
        rows = json.loads(body)
        path.write_text(json.dumps(rows))
        return name, rows

    population: dict[str, dict[str, int]] = defaultdict(dict)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = sorted(pool.map(fetch, jobs), key=lambda result: result[0])

    for _, rows in results:
        header = rows[0]
        count_index = header.index("P1_001N")
        state_index = header.index("state")
        zcta_index = header.index("zip code tabulation area (or part)")
        county_index = header.index("county (or part)")
        for row in rows[1:]:
            county_fips = row[state_index] + row[county_index]
            population[row[zcta_index]][county_fips] = int(row[count_index])
    return dict(population), [name for name, _ in results]


def read_geonames(body: bytes) -> dict[str, tuple[str, str]]:
    """State and county FIPS by ZIP, for rows that name a county."""
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        text = archive.read("US.txt").decode("utf-8")
    counties = {}
    for line in text.splitlines():
        fields = line.split("\t")
        zip_code, state, county_suffix = fields[1], fields[4], fields[6]
        if state in STATE_FIPS and county_suffix.isdigit():
            counties[zip_code] = (
                state,
                STATE_FIPS[state] + county_suffix.zfill(3),
            )
    return counties


def read_uds_crosswalk(body: bytes) -> dict[str, tuple[str, str]]:
    """State and ZCTA by ZIP. The file's county column is random, so this skips it."""
    text = gzip.decompress(body).decode("utf-8")
    crosswalk = {}
    for row in csv.DictReader(io.StringIO(text)):
        if row["state"] in STATE_FIPS:
            crosswalk[row["zip_code"].zfill(5)] = (
                row["state"],
                row["zcta"].zfill(5),
            )
    return crosswalk


def read_engine_counties() -> tuple[dict[str, tuple[str, str]], str]:
    """Engine county code and display name by county FIPS, and the engine version."""
    from importlib.metadata import version

    from policyengine_us.tools.geography.county_helpers import (
        load_county_fips_dataset,
        map_county_string_to_enum,
    )
    from policyengine_us.variables.household.demographic.geographic.county.county_enum import (
        County,
    )

    dataset = load_county_fips_dataset()
    dataset = dataset[dataset["state"].isin(STATE_FIPS)].reset_index(drop=True)
    enum_indices = map_county_string_to_enum(dataset["county_name"], dataset["state"])
    names = County._member_names_
    counties = {}
    for fips, name, index in zip(
        dataset["county_fips"], dataset["county_name"], enum_indices
    ):
        code = names[int(index)]
        if code == "UNKNOWN":
            raise ValueError(f"The County enum has no member for {fips} {name}")
        counties[fips] = (code, name)
    return counties, version("policyengine-us")


def build_table(
    land_by_zcta: dict[str, dict[str, int]],
    population: dict[str, dict[str, int]],
    geonames: dict[str, tuple[str, str]],
    uds_crosswalk: dict[str, tuple[str, str]],
    engine_counties: dict[str, tuple[str, str]],
) -> tuple[dict[str, list[tuple[str, int | None]]], dict[str, int]]:
    """Each ZIP's counties in resolution order, with the build's own counts."""
    zips: dict[str, list[tuple[str, int | None]]] = {}
    counts = {
        "zcta_with_residents": 0,
        "zcta_without_residents": 0,
        "zip_without_zcta_from_geonames": 0,
        "zip_without_zcta_from_crosswalk": 0,
        "zcta_outside_engine_counties": 0,
    }

    for zcta, land in sorted(land_by_zcta.items()):
        known = {
            fips: area for fips, area in land.items() if fips in engine_counties
        }
        if not known:
            # Territories' ZCTAs: the form accepts no ZIP in these places.
            counts["zcta_outside_engine_counties"] += 1
            continue
        residents = {
            fips: population.get(zcta, {}).get(fips, 0) for fips in known
        }
        if sum(residents.values()) > 0:
            ranked = sorted(
                (
                    (engine_counties[fips][0], count)
                    for fips, count in residents.items()
                    if count > 0
                ),
                key=lambda item: (-item[1], item[0]),
            )
            zips[zcta] = [(code, count) for code, count in ranked]
            counts["zcta_with_residents"] += 1
        else:
            ranked_land = sorted(
                ((engine_counties[fips][0], area) for fips, area in known.items()),
                key=lambda item: (-item[1], item[0]),
            )
            zips[zcta] = [(code, None) for code, _ in ranked_land]
            counts["zcta_without_residents"] += 1

    zcta_rows = dict(zips)
    for zip_code, (_, county_fips) in sorted(geonames.items()):
        if zip_code in land_by_zcta or county_fips not in engine_counties:
            continue
        zips[zip_code] = [(engine_counties[county_fips][0], None)]
        counts["zip_without_zcta_from_geonames"] += 1

    for zip_code, (state, zcta) in sorted(uds_crosswalk.items()):
        if zip_code in zips or zip_code in land_by_zcta:
            continue
        in_state = [
            code
            for code, _ in zcta_rows.get(zcta, [])
            if code.endswith(f"_{state}")
        ]
        if in_state:
            zips[zip_code] = [(in_state[0], None)]
            counts["zip_without_zcta_from_crosswalk"] += 1

    return zips, counts


def _sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def write_table(
    path: Path,
    zips: dict[str, list[tuple[str, int | None]]],
    engine_counties: dict[str, tuple[str, str]],
    meta: dict,
) -> bytes:
    counties = sorted(engine_counties.values())
    index_by_code = {code: index for index, (code, _) in enumerate(counties)}
    document = {
        "meta": meta,
        "counties": [[code, name] for code, name in counties],
        "zips": {
            zip_code: [[index_by_code[code], count] for code, count in rows]
            for zip_code, rows in sorted(zips.items())
        },
    }
    raw = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    buffer = io.BytesIO()
    with gzip.GzipFile(
        filename="", mode="wb", compresslevel=9, fileobj=buffer, mtime=0
    ) as archive:
        archive.write(raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buffer.getvalue())
    return buffer.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    relationship = _cached(args.cache_dir, "relationship.txt", RELATIONSHIP_URL)
    geonames_body = _cached(args.cache_dir, "geonames-US.zip", GEONAMES_URL)
    crosswalk_body = _cached(args.cache_dir, "uds-zip-codes.csv.gz", UDS_CROSSWALK_URL)
    land_by_zcta = read_relationship_file(relationship)
    population, _ = read_population(
        land_by_zcta,
        args.cache_dir,
        os.environ.get("CENSUS_API_KEY"),
    )
    geonames = read_geonames(geonames_body)
    engine_counties, engine_version = read_engine_counties()
    zips, counts = build_table(
        land_by_zcta,
        population,
        geonames,
        read_uds_crosswalk(crosswalk_body),
        engine_counties,
    )

    meta = {
        "built_by": "scripts/build_zip_county.py",
        "engine": f"policyengine-us {engine_version}",
        "sources": {
            "relationship_file": {
                "url": RELATIONSHIP_URL,
                "sha256": _sha256(relationship),
            },
            "residents": {
                "url": DHC_URL,
                "table": "P1_001N",
                "summary_level": 881,
            },
            "geonames": {
                "url": GEONAMES_URL,
                "sha256": _sha256(geonames_body),
                "license": "CC BY 4.0",
            },
            "uds_crosswalk": {
                "url": UDS_CROSSWALK_URL,
                "sha256": _sha256(crosswalk_body),
            },
        },
        "counts": counts,
    }
    written = write_table(args.output, zips, engine_counties, meta)
    print(json.dumps({"zips": len(zips), "bytes": len(written), **counts}, indent=2))


if __name__ == "__main__":
    main()

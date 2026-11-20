from __future__ import annotations

import base64
import csv
import hashlib
import json
import os
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from importlib.metadata import distribution, version
from pathlib import Path
from typing import Any, Callable

from cliff_watch.calculator import (
    DEFAULT_SERIES_MAX_EARNINGS,
    DEFAULT_SERIES_STEP,
    HouseholdInput,
    calculate_household,
    calculate_household_types,
)
from cliff_watch.series_request import (
    _serialize_payload,
    _series_cached as _series_cached,
    compute_series as compute_series,
    compute_series_request as compute_series_request,
    parse_household_payload,
)
from cliff_watch.config import (
    CCDF_MODELED_STATES,
    DEFAULT_CLIFF_DELTA,
    DEFAULT_FILING_STATUS,
    DEFAULT_SERIES_EARNINGS_BUFFER,
    DEFAULT_YEAR,
    DEFAULT_SERIES_MIN_EARNINGS_WINDOW,
    FILING_STATUS_OPTIONS,
    HOUSEHOLD_COST_DEFINITIONS,
    HOUSEHOLD_TYPES,
    MAX_ADULTS,
    MAX_DEPENDENTS,
    PROGRAM_DEFINITIONS,
    PUBLIC_ASSISTANCE_PROGRAM_OPTIONS,
    STATE_INFO,
    STATE_PROGRAM_OVERRIDES,
)


def engine_versions() -> dict[str, str]:
    """Installed engine packages, so a deployment can be checked from outside."""
    return {
        package: version(package)
        for package in ("policyengine-us", "policyengine-core", "spm-calculator")
    }


def _engine_record(name: str) -> list[tuple[str, str]] | None:
    package = distribution(name)
    origin = json.loads(package.read_text("direct_url.json") or "{}")
    if "dir_info" in origin:
        return None
    prefix = name.replace("-", "_") + "/"
    rows = csv.reader((package.read_text("RECORD") or "").splitlines())
    files = sorted(
        (path, checksum)
        for path, checksum, _ in rows
        if path.startswith(prefix) and checksum.startswith("sha256=")
    )
    # A Vercel deployment has an immutable filesystem. On a developer's
    # machine a file can be edited in place without rebuilding the wheel.
    if os.environ.get("VERCEL") != "1":
        for path, checksum in files:
            try:
                actual = hashlib.sha256(package.locate_file(path).read_bytes()).digest()
            except OSError:
                return None
            if base64.urlsafe_b64encode(actual).rstrip(b"=").decode() != checksum[7:]:
                return None
    return files or None


@lru_cache(maxsize=1)
def series_revision() -> str | None:
    """Bind saved sample charts to the code, engine and geography that made them."""
    root = Path(__file__).resolve().parents[1]
    versions = engine_versions()
    digest = hashlib.sha256(json.dumps(versions, sort_keys=True).encode())
    for name in sorted(versions):
        records = _engine_record(name)
        if not records:
            return None
        digest.update(json.dumps(records, separators=(",", ":")).encode())
    for source in (
        "cliff_watch/series_request.py",
        "cliff_watch/calculator.py",
        "cliff_watch/config.py",
        "cliff_watch/zip_county.py",
        "cliff_watch/data/zip_county.json.gz",
    ):
        digest.update(hashlib.sha256((root / source).read_bytes()).digest())
    return digest.hexdigest()


def metadata_response() -> dict[str, Any]:
    return {
        "year": DEFAULT_YEAR,
        "engine": engine_versions(),
        # An explicit source checkout can contain unpublished formulas while
        # the installed package still reports the version used for the bundle.
        "series_revision": (
            None if os.environ.get("POLICYENGINE_US_REPO") else series_revision()
        ),
        "states": STATE_INFO,
        "household_types": HOUSEHOLD_TYPES,
        "programs": PROGRAM_DEFINITIONS,
        "state_program_overrides": STATE_PROGRAM_OVERRIDES,
        "household_costs": HOUSEHOLD_COST_DEFINITIONS,
        "public_assistance_programs": PUBLIC_ASSISTANCE_PROGRAM_OPTIONS,
        "ccdf_modeled_states": sorted(CCDF_MODELED_STATES),
        "filing_statuses": FILING_STATUS_OPTIONS,
        "defaults": {
            "state": "GA",
            "filing_status": "SINGLE",
            "people": [
                {"kind": "adult", "age": 33},
            ],
            "chart_max_earned_income": DEFAULT_SERIES_MAX_EARNINGS,
            "series_max_earned_income": DEFAULT_SERIES_MAX_EARNINGS,
            "series_step": DEFAULT_SERIES_STEP,
            "series_earnings_buffer": DEFAULT_SERIES_EARNINGS_BUFFER,
            "series_min_earnings_window": DEFAULT_SERIES_MIN_EARNINGS_WINDOW,
            "cliff_delta": DEFAULT_CLIFF_DELTA,
            "max_adults": MAX_ADULTS,
            "max_dependents": MAX_DEPENDENTS,
            "programs_mode": "all",
        },
    }


@lru_cache(maxsize=128)
def _household_cached(serialized_payload: str) -> dict[str, Any]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_household(payload)


@lru_cache(maxsize=128)
def _household_types_cached(serialized_payload: str) -> list[dict[str, Any]]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_household_types(payload)


def compute_household(payload: HouseholdInput) -> dict[str, Any]:
    return _household_cached(_serialize_payload(payload))


def compute_household_types(payload: HouseholdInput) -> dict[str, Any]:
    items = _household_types_cached(_serialize_payload(payload))
    sorted_items = sorted(
        items,
        key=lambda item: (-item["net_resources_annual"], item["label"]),
    )
    for index, item in enumerate(sorted_items, start=1):
        item["rank"] = index
    return {
        "households": sorted_items,
        "max_net_resources": max(
            (item["net_resources_annual"] for item in sorted_items),
            default=0,
        ),
    }


def read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    content_length = int(handler.headers.get("content-length", "0"))
    if content_length <= 0:
        raise ValueError("Request body is required")

    body = handler.rfile.read(content_length)
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("Request body must be valid JSON") from exc


def send_json(
    handler: BaseHTTPRequestHandler,
    payload: dict[str, Any],
    status_code: int = 200,
    cache_control: str = "s-maxage=60, stale-while-revalidate=600",
) -> None:
    encoded = json.dumps(payload).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(encoded)))
    handler.send_header("Cache-Control", cache_control)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(encoded)


def send_error_json(
    handler: BaseHTTPRequestHandler,
    status_code: int,
    message: str,
) -> None:
    send_json(
        handler,
        {"error": message},
        status_code=status_code,
        cache_control="no-store",
    )


def handle_options(handler: BaseHTTPRequestHandler) -> None:
    handler.send_response(204)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()


def handle_post(
    handler: BaseHTTPRequestHandler,
    builder: Callable[[dict[str, Any]], dict[str, Any]],
) -> None:
    try:
        payload = read_json_body(handler)
        response = builder(payload)
    except Exception as exc:
        send_error_json(handler, 500, f"Calculation failed: {exc}")
        return

    send_json(handler, response, cache_control="no-store")

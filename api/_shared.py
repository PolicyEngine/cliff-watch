from __future__ import annotations

import json
from dataclasses import asdict
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from typing import Any, Callable

from cliff_watch.calculator import (
    DEFAULT_SERIES_MAX_EARNINGS,
    DEFAULT_SERIES_STEP,
    HouseholdInput,
    calculate_household,
    calculate_household_types,
    calculate_income_series,
    household_input_from_dict,
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
    PROGRAM_DEFINITIONS,
    STATE_INFO,
)


def _serialize_payload(payload: HouseholdInput) -> str:
    return json.dumps(asdict(payload), sort_keys=True)


def parse_household_payload(raw_payload: dict[str, Any]) -> HouseholdInput:
    return household_input_from_dict(raw_payload)


def metadata_response() -> dict[str, Any]:
    return {
        "year": DEFAULT_YEAR,
        "states": STATE_INFO,
        "household_types": HOUSEHOLD_TYPES,
        "programs": PROGRAM_DEFINITIONS,
        "household_costs": HOUSEHOLD_COST_DEFINITIONS,
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
        },
    }


@lru_cache(maxsize=128)
def _household_cached(serialized_payload: str) -> dict[str, Any]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_household(payload)


@lru_cache(maxsize=128)
def _series_cached(
    serialized_payload: str,
    max_earned_income: int,
    step: int,
    min_earned_income: int,
) -> dict[str, Any]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_income_series(
        payload,
        max_earned_income=max_earned_income,
        step=step,
        min_earned_income=min_earned_income,
    )


@lru_cache(maxsize=128)
def _household_types_cached(serialized_payload: str) -> list[dict[str, Any]]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_household_types(payload)


def compute_household(payload: HouseholdInput) -> dict[str, Any]:
    return _household_cached(_serialize_payload(payload))


def compute_series(
    payload: HouseholdInput,
    *,
    max_earned_income: int = DEFAULT_SERIES_MAX_EARNINGS,
    step: int = DEFAULT_SERIES_STEP,
    min_earned_income: int = 0,
) -> dict[str, Any]:
    series = _series_cached(
        _serialize_payload(payload),
        max_earned_income,
        step,
        min_earned_income,
    )
    data = series["data"]
    return {
        "data": data,
        "step_annual": series["step_annual"],
        "requested_step_annual": series["requested_step_annual"],
        "max_earned_income": series["max_earned_income"],
        "requested_max_earned_income": series["requested_max_earned_income"],
        "truncated": series["truncated"],
        "truncation_reason": series["truncation_reason"],
        "point_count": series["point_count"],
        "max_net_resources": max(
            (item["net_resources"] for item in data),
            default=0,
        ),
    }


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

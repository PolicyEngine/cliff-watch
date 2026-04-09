from __future__ import annotations

import json
from dataclasses import asdict
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from typing import Any, Callable

from scripts.calculator import (
    DEFAULT_SERIES_MAX_EARNINGS,
    DEFAULT_SERIES_STEP,
    HouseholdInput,
    calculate_all_states,
    calculate_household,
    calculate_household_types,
    calculate_income_series,
    household_input_from_dict,
)
from scripts.config import (
    DEFAULT_CLIFF_DELTA,
    DEFAULT_YEAR,
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
        "defaults": {
            "state": "GA",
            "earned_income_yearly": 30000,
            "people": [
                {"kind": "adult", "age": 33},
                {"kind": "child", "age": 6},
                {"kind": "child", "age": 10},
            ],
            "series_max_earned_income": DEFAULT_SERIES_MAX_EARNINGS,
            "series_step": DEFAULT_SERIES_STEP,
            "cliff_delta": DEFAULT_CLIFF_DELTA,
        },
    }


def _state_sort_key(item: dict[str, Any]) -> tuple[float, float, str]:
    return (
        -item["net_resources_monthly"],
        -item["core_support_monthly"],
        item["state"],
    )


@lru_cache(maxsize=128)
def _household_cached(serialized_payload: str) -> dict[str, Any]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_household(payload)


@lru_cache(maxsize=128)
def _states_cached(serialized_payload: str) -> list[dict[str, Any]]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_all_states(payload)


@lru_cache(maxsize=128)
def _series_cached(
    serialized_payload: str,
    max_earned_income: int,
    step: int,
) -> list[dict[str, Any]]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_income_series(
        payload,
        max_earned_income=max_earned_income,
        step=step,
    )


@lru_cache(maxsize=128)
def _household_types_cached(serialized_payload: str) -> list[dict[str, Any]]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_household_types(payload)


def compute_household(payload: HouseholdInput) -> dict[str, Any]:
    return _household_cached(_serialize_payload(payload))


def compute_states(payload: HouseholdInput) -> dict[str, Any]:
    states = _states_cached(_serialize_payload(payload))
    sorted_states = sorted(states, key=_state_sort_key)
    max_resources = max(
        (item["net_resources_monthly"] for item in sorted_states),
        default=0,
    )
    for index, item in enumerate(sorted_states, start=1):
        item["rank"] = index
    return {
        "states": sorted_states,
        "max_net_resources_monthly": max_resources,
    }


def compute_series(
    payload: HouseholdInput,
    *,
    max_earned_income: int = DEFAULT_SERIES_MAX_EARNINGS,
    step: int = DEFAULT_SERIES_STEP,
) -> dict[str, Any]:
    data = _series_cached(_serialize_payload(payload), max_earned_income, step)
    return {
        "data": data,
        "step_annual": step,
        "step_monthly": round(step / 12, 2),
        "max_net_resources_monthly": max(
            (item["net_resources_monthly"] for item in data),
            default=0,
        ),
    }


def compute_household_types(payload: HouseholdInput) -> dict[str, Any]:
    items = _household_types_cached(_serialize_payload(payload))
    sorted_items = sorted(
        items,
        key=lambda item: (-item["net_resources_monthly"], item["label"]),
    )
    for index, item in enumerate(sorted_items, start=1):
        item["rank"] = index
    return {
        "households": sorted_items,
        "max_net_resources_monthly": max(
            (item["net_resources_monthly"] for item in sorted_items),
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

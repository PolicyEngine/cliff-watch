"""Translate the shared HTTP and offline request into a model earnings series."""

from __future__ import annotations

import json
from dataclasses import asdict
from functools import lru_cache
from typing import Any

from cliff_watch.calculator import (
    DEFAULT_SERIES_MAX_EARNINGS,
    DEFAULT_SERIES_STEP,
    HouseholdInput,
    calculate_income_series,
    household_input_from_dict,
    household_location,
)


def _serialize_payload(payload: HouseholdInput) -> str:
    return json.dumps(asdict(payload), sort_keys=True)


def parse_household_payload(raw_payload: dict[str, Any]) -> HouseholdInput:
    return household_input_from_dict(raw_payload)


@lru_cache(maxsize=128)
def _series_cached(
    serialized_payload: str,
    max_earned_income: int,
    step: int,
    min_earned_income: int | None,
) -> dict[str, Any]:
    payload = parse_household_payload(json.loads(serialized_payload))
    return calculate_income_series(
        payload,
        max_earned_income=max_earned_income,
        step=step,
        min_earned_income=min_earned_income,
    )


def compute_series(
    payload: HouseholdInput,
    *,
    max_earned_income: int = DEFAULT_SERIES_MAX_EARNINGS,
    step: int = DEFAULT_SERIES_STEP,
    min_earned_income: int | None = None,
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
        "location": household_location(payload),
    }


def compute_series_request(raw: dict[str, Any]) -> dict[str, Any]:
    lower = raw.get("min_earned_income")
    return compute_series(
        parse_household_payload(raw),
        max_earned_income=int(raw.get("max_earned_income", DEFAULT_SERIES_MAX_EARNINGS)),
        step=int(raw.get("step", DEFAULT_SERIES_STEP)),
        min_earned_income=int(lower) if lower is not None else None,
    )

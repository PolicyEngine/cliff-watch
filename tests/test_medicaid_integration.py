"""Smoke tests for Medicaid values flowing through Cliff Watch."""

from __future__ import annotations

import pytest

from cliff_watch import (
    calculate_household,
    calculate_income_series,
    household_input_from_dict,
)

pytest.importorskip("policyengine_us")


def test_single_adult_medicaid_surfaces_in_series() -> None:
    payload = household_input_from_dict(
        {
            "state": "DE",
            "earned_income": 0,
            "year": 2026,
            "filing_status": "SINGLE",
            "people": [{"kind": "adult", "age": 33}],
            "programs_mode": "all",
        }
    )

    result = calculate_income_series(
        payload,
        max_earned_income=30_000,
        step=500,
    )

    assert result["data"][0]["medicaid"] > 0
    assert max(point["medicaid"] for point in result["data"]) > 0


def test_medicaid_is_zero_when_program_is_not_selected() -> None:
    payload = household_input_from_dict(
        {
            "state": "DE",
            "earned_income": 0,
            "year": 2026,
            "filing_status": "SINGLE",
            "people": [{"kind": "adult", "age": 33}],
            "programs_mode": "custom",
            "selected_programs": ["chip"],
        }
    )

    result = calculate_household(payload)

    assert result["programs"]["medicaid"] == 0

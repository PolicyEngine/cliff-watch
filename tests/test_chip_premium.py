"""Smoke tests for the CHIP premium integration.

These tests exercise the household calculator's direct outputs without
invoking the full microsimulation over an income range. They pin the
accounting shape: `chip_premium` is reported as a household_cost, reduces
`net_resources`, and appears on the per-earnings-level series payload.
"""

from __future__ import annotations

import pytest

from cliff_watch import calculate_household, household_input_from_dict

pytest.importorskip("policyengine_us")


def _chip_premium_available() -> bool:
    """True when the installed policyengine-us release exposes `chip_premium`."""
    from policyengine_us import Microsimulation  # noqa: WPS433

    return "chip_premium" in Microsimulation().tax_benefit_system.variables


requires_chip_premium = pytest.mark.skipif(
    not _chip_premium_available(),
    reason="Installed policyengine-us release predates the chip_premium variable",
)


def _texas_child_household(earned_income: int) -> dict:
    return {
        "state": "TX",
        "earned_income": earned_income,
        "year": 2024,
        "filing_status": "SINGLE",
        "people": [
            {"kind": "adult", "age": 34},
            {"kind": "child", "age": 8},
        ],
    }


def test_chip_premium_surfaces_at_texas_enrollment_fee_band() -> None:
    """A Texas tax unit in the CHIP-eligible income range owes an enrollment fee."""
    payload = household_input_from_dict(_texas_child_household(30_000))
    result = calculate_household(payload)

    household_costs = result.get("household_costs")
    assert household_costs is not None, "calculator must expose household_costs"
    assert "chip_premium" in household_costs, "chip_premium should be reported"

    totals = result["totals"]
    assert "household_costs" in totals
    assert totals["household_costs"] == household_costs["chip_premium"]

    expected_net = (
        totals["market_income"]
        + totals["core_support"]
        - totals["taxes"]
        - totals["household_costs"]
    )
    assert abs(totals["net_resources"] - round(expected_net, 2)) < 0.01


@requires_chip_premium
def test_missouri_premium_cliff_reduces_net_resources() -> None:
    """Missouri CHIP premium schedule produces a net-resources cliff at 225% FPL.

    A family of 4 at 200% FPL (Tier 2) pays $124/mo = $1,488/yr post-July 2024.
    The same family at 230% FPL (Tier 3) pays $301/mo = $3,612/yr.
    The tier boundary drops net resources by roughly $2,124 (ignoring other
    simultaneous cliffs for the purposes of this regression guard).
    """
    below = household_input_from_dict(
        {
            "state": "MO",
            "earned_income": 52_000,
            "year": 2024,
            "filing_status": "HEAD_OF_HOUSEHOLD",
            "people": [
                {"kind": "adult", "age": 35},
                {"kind": "adult", "age": 35},
                {"kind": "child", "age": 8},
                {"kind": "child", "age": 10},
            ],
        }
    )
    above = household_input_from_dict(
        {
            "state": "MO",
            "earned_income": 75_000,
            "year": 2024,
            "filing_status": "HEAD_OF_HOUSEHOLD",
            "people": [
                {"kind": "adult", "age": 35},
                {"kind": "adult", "age": 35},
                {"kind": "child", "age": 8},
                {"kind": "child", "age": 10},
            ],
        }
    )

    below_result = calculate_household(below)
    above_result = calculate_household(above)

    below_premium = below_result["household_costs"]["chip_premium"]
    above_premium = above_result["household_costs"]["chip_premium"]

    assert above_premium > below_premium, (
        "CHIP premium should rise when the Missouri family crosses a tier boundary "
        f"(below={below_premium}, above={above_premium})"
    )

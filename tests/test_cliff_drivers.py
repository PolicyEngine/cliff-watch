from cliff_watch.calculator import _build_cliff_drivers


def test_build_cliff_drivers_includes_household_cost_increases() -> None:
    previous = {
        "programs": {
            "snap": 0.0,
            "tanf": 0.0,
            "wic": 0.0,
            "free_school_meals": 0.0,
            "child_care_subsidies": 0.0,
            "medicaid": 0.0,
            "chip": 0.0,
            "aca_ptc": 0.0,
            "federal_refundable_credits": 0.0,
            "state_refundable_credits": 0.0,
        },
        "household_costs": {
            "chip_premium": 0.0,
        },
        "totals": {
            "taxes": 0.0,
        },
    }
    current = {
        "programs": {
            "snap": 0.0,
            "tanf": 0.0,
            "wic": 0.0,
            "free_school_meals": 0.0,
            "child_care_subsidies": 0.0,
            "medicaid": 0.0,
            "chip": 0.0,
            "aca_ptc": 0.0,
            "federal_refundable_credits": 0.0,
            "state_refundable_credits": 0.0,
        },
        "household_costs": {
            "chip_premium": 900.0,
        },
        "totals": {
            "taxes": 0.0,
        },
    }

    assert _build_cliff_drivers(previous, current) == [
        {
            "key": "chip_premium",
            "label": "CHIP premium",
            "kind": "household_cost_increase",
            "raw_change_annual": 900.0,
            "raw_change_monthly": 75.0,
            "resource_effect_annual": -900.0,
            "resource_effect_monthly": -75.0,
        }
    ]

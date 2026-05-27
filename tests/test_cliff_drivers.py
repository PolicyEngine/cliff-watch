from cliff_watch.calculator import _build_cliff_drivers, _format_program_breakdown


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


def test_build_cliff_drivers_uses_state_specific_program_labels() -> None:
    previous = {
        "programs": {"tanf": 1_200.0},
        "household_costs": {},
        "totals": {"taxes": 0.0},
    }
    current = {
        "programs": {"tanf": 0.0},
        "household_costs": {},
        "totals": {"taxes": 0.0},
    }

    assert (
        _build_cliff_drivers(previous, current, "MN")[0]["label"]
        == "Minnesota MFIP"
    )


def test_build_cliff_drivers_identifies_person_losing_medicaid() -> None:
    previous = {
        "programs": {"medicaid": 6_332.0},
        "household_costs": {},
        "totals": {"taxes": 0.0},
        "person_programs": {
            "medicaid": {
                "adult_1": {"label": "Adult 1 Medicaid", "value": 6_332.0},
                "child_1": {"label": "Child 1 Medicaid", "value": 0.0},
            }
        },
    }
    current = {
        "programs": {"medicaid": 0.0},
        "household_costs": {},
        "totals": {"taxes": 0.0},
        "person_programs": {
            "medicaid": {
                "adult_1": {"label": "Adult 1 Medicaid", "value": 0.0},
                "child_1": {"label": "Child 1 Medicaid", "value": 0.0},
            }
        },
    }

    assert _build_cliff_drivers(previous, current, "MN") == [
        {
            "key": "medicaid:adult_1",
            "label": "Adult 1 Medicaid",
            "kind": "benefit_loss",
            "program_key": "medicaid",
            "person_id": "adult_1",
            "raw_change_annual": -6_332.0,
            "raw_change_monthly": -527.67,
            "resource_effect_annual": -6_332.0,
            "resource_effect_monthly": -527.67,
        }
    ]


def test_format_program_breakdown_uses_state_specific_program_labels() -> None:
    result = _format_program_breakdown({"tanf": 500.0}, "CA")

    assert result[0]["label"] == "California CalWORKs Cash Benefit"

from __future__ import annotations

from cliff_watch.calculator import (
    build_household_situation,
    calculate_household_types,
    household_input_from_dict,
)


def _parity_payload() -> dict:
    return {
        "state": "GA",
        "county": "Fulton",
        "earned_income": 30_000,
        "year": 2026,
        "filing_status": "JOINT",
        "people": [
            {
                "kind": "adult",
                "age": 34,
                "is_pregnant": True,
                "is_disabled": True,
                "is_blind": True,
                "is_full_time_student": True,
                "ssi_amount": 1_200,
                "ssdi_amount": 2_400,
            },
            {
                "kind": "adult",
                "age": 36,
                "earned_income": 12_000,
            },
            {
                "kind": "child",
                "age": 4,
                "is_incapable_of_self_care": True,
            },
        ],
        "childcare_expenses": 6_000,
        "rent_annual": 18_000,
        "utility_expense_annual": 2_400,
        "food_expense_annual": 7_200,
        "transportation_expense_annual": 4_800,
        "health_insurance_premium_annual": 1_800,
        "technology_expense_annual": 1_200,
        "debt_payment_annual": 900,
        "education_expense_annual": 600,
        "other_expense_annual": 300,
        "self_employment_income_annual": 3_000,
        "child_support_annual": 2_000,
        "taxable_interest_income_annual": 100,
        "dividend_income_annual": 200,
        "rental_income_annual": 300,
        "unemployment_compensation_annual": 400,
        "pension_income_annual": 500,
        "social_security_annual": 600,
        "miscellaneous_income_annual": 700,
        "liquid_assets": 1_500,
        "has_employer_health_insurance": True,
        "programs_mode": "custom",
        "selected_programs": ["snap", "housing_assistance", "ssi", "ssdi"],
    }


def test_atlanta_fed_parity_inputs_reach_policyengine_situation() -> None:
    payload = household_input_from_dict(_parity_payload())
    situation = build_household_situation(payload)

    adult_1 = situation["people"]["adult_1"]
    adult_2 = situation["people"]["adult_2"]
    child_1 = situation["people"]["child_1"]
    spm_unit = situation["spm_units"]["spm_unit"]
    tax_unit = situation["tax_units"]["tax_unit"]
    household = situation["households"]["household"]

    assert household["county"][2026] == "FULTON_GA"
    assert household["hud_utility_allowance"][2026] == 2_400

    assert adult_1["is_pregnant"][2026] is True
    assert adult_1["is_disabled"][2026] is True
    assert adult_1["is_blind"][2026] is True
    assert adult_1["is_full_time_student"][2026] is True
    assert adult_1["pre_subsidy_rent"][2026] == 18_000
    assert adult_1["health_insurance_premiums"][2026] == 1_800
    assert adult_1["ssi"][2026] == 1_200
    assert adult_1["social_security_disability"][2026] == 2_400
    assert adult_1["takes_up_medicaid_if_eligible"][2026] is False
    assert adult_1["takes_up_ssi_if_eligible"][2026] is True

    assert adult_2["employment_income"][2026] == 12_000
    assert child_1["is_incapable_of_self_care"][2026] is True

    assert spm_unit["takes_up_snap_if_eligible"][2026] is True
    assert spm_unit["takes_up_tanf_if_eligible"][2026] is False
    assert spm_unit["receives_housing_assistance"][2026] is True
    assert spm_unit["childcare_expenses"][2026] == 6_000
    assert spm_unit["utility_expense"][2026] == 2_400
    assert spm_unit["snap_assets"][2026] == 1_500

    assert tax_unit["takes_up_aca_if_eligible"][2026] is False
    assert tax_unit["aca_magi"][2026] == 47_200


def test_household_type_comparison_preserves_advanced_inputs(monkeypatch) -> None:
    payload = household_input_from_dict(_parity_payload())
    captured = []

    def fake_simulate_core(scenario):
        captured.append(scenario)
        return {
            "template": {
                "label": "Example",
                "short_label": "Ex",
                "description": "Example household.",
            },
            "totals": {
                "net_resources": 1_200,
                "core_support": 600,
                "taxes": 100,
            },
            "counts": {
                "num_adults": 1,
                "num_children": 0,
                "household_size": 1,
            },
        }

    monkeypatch.setattr(
        "cliff_watch.calculator._simulate_core",
        fake_simulate_core,
    )

    calculate_household_types(payload)

    assert captured
    assert all(scenario.people == () for scenario in captured)
    assert all(scenario.selected_programs == payload.selected_programs for scenario in captured)
    assert all(scenario.rent_annual == 18_000 for scenario in captured)
    assert all(scenario.programs_mode == "custom" for scenario in captured)

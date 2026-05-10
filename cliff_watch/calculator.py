from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from cliff_watch.config import (
    CCDF_MODELED_STATES,
    DEFAULT_CLIFF_DELTA,
    DEFAULT_FILING_STATUS,
    DEFAULT_SERIES_EARNINGS_BUFFER,
    DEFAULT_SERIES_MAX_EARNINGS,
    DEFAULT_SERIES_MIN_EARNINGS_WINDOW,
    DEFAULT_SERIES_STEP_INCREMENT,
    DEFAULT_SERIES_STEP,
    DEFAULT_SERIES_TARGET_POINTS,
    DEFAULT_YEAR,
    FILING_STATUS_OPTIONS,
    HOUSEHOLD_COST_DEFINITIONS,
    MARRIED_FILING_STATUSES,
    HOUSEHOLD_TYPE_BY_ID,
    MAX_ADULTS,
    MAX_DEPENDENTS,
    PROGRAM_DEFINITIONS,
    PUBLIC_ASSISTANCE_PROGRAM_OPTIONS,
    STATE_INFO,
    STATE_NAME_BY_CODE,
    STATE_TANF_VARIABLES,
)


class CalculatorDependencyError(RuntimeError):
    pass


@dataclass(frozen=True)
class HouseholdMemberInput:
    age: int
    kind: str
    is_pregnant: bool = False
    is_disabled: bool = False
    is_blind: bool = False
    is_full_time_student: bool = False
    is_incapable_of_self_care: bool = False
    earned_income: float = 0.0
    ssi_amount: float = 0.0
    ssdi_amount: float = 0.0


@dataclass(frozen=True)
class HouseholdInput:
    state: str
    earned_income: float
    year: int = DEFAULT_YEAR
    county: str | None = None
    people: tuple[HouseholdMemberInput, ...] = ()
    household_type: str | None = None
    filing_status: str | None = None
    childcare_expenses: float = 0.0
    rent_annual: float = 0.0
    utility_expense_annual: float = 0.0
    food_expense_annual: float = 0.0
    transportation_expense_annual: float = 0.0
    health_insurance_premium_annual: float = 0.0
    technology_expense_annual: float = 0.0
    debt_payment_annual: float = 0.0
    education_expense_annual: float = 0.0
    other_expense_annual: float = 0.0
    self_employment_income_annual: float = 0.0
    child_support_annual: float = 0.0
    taxable_interest_income_annual: float = 0.0
    dividend_income_annual: float = 0.0
    rental_income_annual: float = 0.0
    unemployment_compensation_annual: float = 0.0
    pension_income_annual: float = 0.0
    social_security_annual: float = 0.0
    miscellaneous_income_annual: float = 0.0
    liquid_assets: float = 0.0
    has_employer_health_insurance: bool = False
    programs_mode: str = "all"
    selected_programs: tuple[str, ...] = ()


PROGRAM_LABEL_BY_KEY = {item["key"]: item["label"] for item in PROGRAM_DEFINITIONS}
HOUSEHOLD_COST_LABEL_BY_KEY = {
    item["key"]: item["label"] for item in HOUSEHOLD_COST_DEFINITIONS
}
PUBLIC_ASSISTANCE_PROGRAM_KEYS = {
    item["key"] for item in PUBLIC_ASSISTANCE_PROGRAM_OPTIONS
}
FILING_STATUS_CODES = {item["code"] for item in FILING_STATUS_OPTIONS}
REFUNDABLE_CREDIT_COMPONENTS = (
    {"key": "eitc", "variable": "eitc", "map_to": "tax_unit"},
    {
        "key": "ctc",
        "variable": "refundable_ctc",
        "map_to": "tax_unit",
    },
    {
        "key": "refundable_american_opportunity_credit",
        "variable": "refundable_american_opportunity_credit",
        "map_to": "tax_unit",
    },
    {
        "key": "recovery_rebate_credit",
        "variable": "recovery_rebate_credit",
        "map_to": "tax_unit",
    },
    {
        "key": "refundable_payroll_tax_credit",
        "variable": "refundable_payroll_tax_credit",
        "map_to": "tax_unit",
    },
    {
        "key": "state_eitc",
        "variable": "state_eitc",
        "map_to": "tax_unit",
    },
    {
        "key": "state_ctc",
        "variable": "state_ctc",
        "map_to": "tax_unit",
    },
    {
        "key": "state_cdcc",
        "variable": "state_cdcc",
        "map_to": "tax_unit",
    },
    {
        "key": "state_property_tax_credit",
        "variable": "state_property_tax_credit",
        "map_to": "tax_unit",
    },
    {
        "key": "vt_renter_credit",
        "variable": "vt_renter_credit",
        "map_to": "tax_unit",
    },
    {
        "key": "va_refundable_eitc_if_claimed",
        "variable": "va_refundable_eitc_if_claimed",
        "map_to": "tax_unit",
    },
    {
        "key": "va_low_income_tax_credit",
        "variable": "va_low_income_tax_credit",
        "map_to": "tax_unit",
    },
    {
        "key": "nm_low_income_comprehensive_tax_rebate",
        "variable": "nm_low_income_comprehensive_tax_rebate",
        "map_to": "tax_unit",
    },
)


def _candidate_policyengine_repo() -> Path | None:
    repo = os.getenv("POLICYENGINE_US_REPO")
    if repo:
        return Path(repo).expanduser()
    return None


def _load_simulation():
    repo = _candidate_policyengine_repo()
    if repo and str(repo) not in sys.path:
        sys.path.insert(0, str(repo))

    try:
        from policyengine_us import Simulation
    except ModuleNotFoundError as exc:
        raise CalculatorDependencyError(
            "PolicyEngine dependencies are not installed. "
            "Run `uv pip install -r requirements.txt` or set "
            "`POLICYENGINE_US_REPO` to a local checkout."
        ) from exc

    return Simulation


def _as_scalar(value: Any) -> float:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list):
        if not value:
            return 0.0
        return float(value[0])
    return float(value)


def _as_bool_list(value: Any) -> list[bool]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list):
        return [bool(item) for item in value]
    return [bool(value)]


def _as_float_list(value: Any) -> list[float]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list):
        if value and isinstance(value[0], list):
            value = value[0]
        return [float(item) for item in value]
    return [float(value)]


def _nonnegative(value: Any) -> float:
    return max(0.0, float(value or 0.0))


def _selected_programs(payload: HouseholdInput) -> set[str]:
    return {
        key
        for key in payload.selected_programs
        if key in PUBLIC_ASSISTANCE_PROGRAM_KEYS
    }


def _program_included(payload: HouseholdInput, key: str) -> bool:
    mode = (payload.programs_mode or "all").lower()
    if mode == "none":
        return False
    if mode == "custom":
        return key in _selected_programs(payload)
    return True


def _filtered_program_value(
    payload: HouseholdInput,
    key: str,
    value: float,
) -> float:
    return value if _program_included(payload, key) else 0.0


def _normalize_county(county: str | None, state: str) -> str | None:
    if county is None:
        return None

    normalized = (
        county.strip()
        .upper()
        .replace(",", "")
        .replace(".", "")
        .replace("-", "_")
        .replace(" ", "_")
    )
    if normalized.endswith(f"_{state}"):
        return normalized
    return f"{normalized}_{state}"


def _compat_people_from_template(
    household_type: str,
) -> tuple[HouseholdMemberInput, ...]:
    template = HOUSEHOLD_TYPE_BY_ID[household_type]
    return tuple(
        HouseholdMemberInput(
            age=int(person["age"]),
            kind="child" if person["role"] == "dependent" else "adult",
            is_pregnant=bool(person.get("is_pregnant", False)),
            is_disabled=bool(person.get("is_disabled", False)),
            is_blind=bool(person.get("is_blind", False)),
            is_full_time_student=bool(person.get("is_full_time_student", False)),
            is_incapable_of_self_care=bool(
                person.get("is_incapable_of_self_care", False)
            ),
        )
        for person in template["people"]
    )


def _input_people(payload: HouseholdInput) -> tuple[HouseholdMemberInput, ...]:
    if payload.people:
        return payload.people
    if payload.household_type:
        return _compat_people_from_template(payload.household_type)
    return ()


def _resolved_people(payload: HouseholdInput) -> list[dict[str, Any]]:
    people = []
    adult_index = 0
    child_index = 0
    filing_status = _effective_filing_status(payload)
    is_married = filing_status in MARRIED_FILING_STATUSES

    for member in _input_people(payload):
        if member.kind == "adult":
            adult_index += 1
            person_id = f"adult_{adult_index}"
            if adult_index == 1:
                role = "head"
            elif adult_index == 2 and is_married:
                role = "spouse"
            else:
                role = "other_adult"
        else:
            child_index += 1
            person_id = f"child_{child_index}"
            role = "dependent"

        people.append(
            {
                "id": person_id,
                "role": role,
                "kind": member.kind,
                "age": int(member.age),
                "is_pregnant": bool(member.is_pregnant),
                "is_disabled": bool(member.is_disabled),
                "is_blind": bool(member.is_blind),
                "is_full_time_student": bool(member.is_full_time_student),
                "is_incapable_of_self_care": bool(
                    member.is_incapable_of_self_care
                ),
                "earned_income": _nonnegative(member.earned_income),
                "ssi_amount": _nonnegative(member.ssi_amount),
                "ssdi_amount": _nonnegative(member.ssdi_amount),
            }
        )

    return people


def _format_count(count: int, singular: str, plural: str) -> str:
    return f"{count} {singular if count == 1 else plural}"


def _household_descriptor(payload: HouseholdInput) -> dict[str, Any]:
    if payload.household_type and not payload.people:
        template = HOUSEHOLD_TYPE_BY_ID[payload.household_type]
        return {
            "id": template["id"],
            "label": template["label"],
            "short_label": template["short_label"],
            "description": template["description"],
            "summary": template["summary"],
            "people": _resolved_people(payload),
        }

    people = _resolved_people(payload)
    num_adults = sum(1 for person in people if person["kind"] == "adult")
    num_dependents = sum(1 for person in people if person["kind"] == "child")
    adult_ages = [str(person["age"]) for person in people if person["kind"] == "adult"]
    dependent_ages = [
        str(person["age"]) for person in people if person["kind"] == "child"
    ]

    description_parts = []
    if adult_ages:
        description_parts.append(f"Adult ages: {', '.join(adult_ages)}")
    if dependent_ages:
        description_parts.append(f"Dependent ages: {', '.join(dependent_ages)}")

    return {
        "id": "custom_household",
        "label": f"{_format_count(num_adults, 'adult', 'adults')} + {_format_count(num_dependents, 'dependent', 'dependents')}",
        "short_label": f"{num_adults}A/{num_dependents}D",
        "description": ". ".join(description_parts)
        if description_parts
        else "Custom household.",
        "summary": "The first adult is treated as the primary earner. The second adult joins the tax unit, and any other household members are treated as dependents.",
        "people": people,
    }


def _derive_filing_status(
    people: tuple[HouseholdMemberInput, ...],
) -> str:
    adults = sum(1 for person in people if person.kind == "adult")
    children = sum(1 for person in people if person.kind == "child")
    if adults >= 2:
        return "JOINT"
    if children > 0:
        return DEFAULT_FILING_STATUS
    return "SINGLE"


def _effective_filing_status(payload: HouseholdInput) -> str:
    if payload.filing_status in FILING_STATUS_CODES:
        return str(payload.filing_status)
    return _derive_filing_status(_input_people(payload))


def _validate_input(payload: HouseholdInput) -> None:
    if payload.state not in STATE_NAME_BY_CODE:
        raise ValueError(f"Unsupported state code: {payload.state}")
    if payload.household_type and payload.household_type not in HOUSEHOLD_TYPE_BY_ID:
        raise ValueError(f"Unsupported household_type: {payload.household_type}")
    if payload.earned_income < 0:
        raise ValueError("earned_income must be non-negative")
    people = _input_people(payload)
    filing_status = _effective_filing_status(payload)
    if not people:
        raise ValueError("At least one household member is required")
    if not any(person.kind == "adult" for person in people):
        raise ValueError("At least one adult household member is required")
    if sum(1 for person in people if person.kind == "adult") > MAX_ADULTS:
        raise ValueError(f"At most {MAX_ADULTS} adult household members are supported")
    if sum(1 for person in people if person.kind == "child") > MAX_DEPENDENTS:
        raise ValueError(
            f"At most {MAX_DEPENDENTS} dependent household members are supported"
        )
    if filing_status not in FILING_STATUS_CODES:
        raise ValueError(f"Unsupported filing_status: {filing_status}")
    if (
        filing_status in MARRIED_FILING_STATUSES
        and sum(1 for person in people if person.kind == "adult") < 2
    ):
        raise ValueError("Married filing statuses require two adult household members")
    for person in people:
        if person.kind not in {"adult", "child"}:
            raise ValueError(f"Unsupported household member kind: {person.kind}")
        if person.age < 0 or person.age > 120:
            raise ValueError(f"Invalid age: {person.age}")
        for field_name in ("earned_income", "ssi_amount", "ssdi_amount"):
            if getattr(person, field_name) < 0:
                raise ValueError(f"{field_name} must be non-negative")


def _base_person_data(
    person: dict[str, Any],
    *,
    year: int,
) -> dict[str, Any]:
    data = {
        "age": {year: person["age"]},
        "has_itin": {year: True},
        "has_esi": {year: False},
        "offered_aca_disqualifying_esi": {year: False},
        "is_pregnant": {year: bool(person.get("is_pregnant", False))},
        "is_disabled": {year: bool(person.get("is_disabled", False))},
        "is_blind": {year: bool(person.get("is_blind", False))},
        "is_full_time_student": {
            year: bool(person.get("is_full_time_student", False))
        },
        "is_incapable_of_self_care": {
            year: bool(person.get("is_incapable_of_self_care", False))
        },
        "under_60_days_postpartum": {year: False},
        "immigration_status_str": {year: "CITIZEN"},
        "is_ccdf_reason_for_care_eligible": {year: True},
    }
    # Adults fail the CCDF age-group formula (defined only for children <13),
    # which crashes any simulation that touches CCDF. Pin them to a valid
    # enum value so the subsidy computes to 0 instead of erroring.
    if person["kind"] == "adult":
        data["ccdf_age_group"] = {year: "SCHOOL_AGE"}
    return data


def _base_household_groups(
    members: list[dict[str, Any]],
    *,
    payload: HouseholdInput,
    include_income_overrides: bool,
) -> dict[str, Any]:
    year = payload.year
    earned_income = float(payload.earned_income)
    rent_annual = _nonnegative(payload.rent_annual)
    utility_expense_annual = _nonnegative(payload.utility_expense_annual)
    health_insurance_premium_annual = _nonnegative(
        payload.health_insurance_premium_annual
    )
    people: dict[str, dict[str, Any]] = {}
    member_ids = [person["id"] for person in members]

    def set_earned_income(person_data: dict[str, Any], amount: float) -> None:
        person_data["employment_income"] = {year: amount}
        monthly_earned = amount / 12
        person_data["tanf_gross_earned_income"] = {
            f"{year}-{month:02d}": monthly_earned for month in range(1, 13)
        }

        state_specific_earned_income = {
            "DC": "dc_tanf_gross_earned_income",
            "IL": "il_tanf_gross_earned_income",
            "MT": "mt_tanf_gross_earned_income_person",
            "SC": "sc_tanf_gross_earned_income",
            "TX": "tx_tanf_gross_earned_income",
        }
        variable = state_specific_earned_income.get(payload.state)
        if variable:
            person_data[variable] = {
                f"{year}-{month:02d}": monthly_earned for month in range(1, 13)
            }

    for index, person in enumerate(members):
        person_data = _base_person_data(person, year=year)

        if index == 0 and rent_annual > 0:
            person_data["pre_subsidy_rent"] = {year: rent_annual}

        if payload.has_employer_health_insurance:
            person_data["has_esi"] = {year: True}
            person_data["offered_aca_disqualifying_esi"] = {year: True}

        if index == 0 and health_insurance_premium_annual > 0:
            person_data["health_insurance_premiums"] = {
                year: health_insurance_premium_annual
            }

        person_data["takes_up_medicaid_if_eligible"] = {
            year: _program_included(payload, "medicaid")
        }
        person_data["takes_up_chip_if_eligible"] = {
            year: _program_included(payload, "chip")
        }
        person_data["takes_up_ssi_if_eligible"] = {
            year: _program_included(payload, "ssi")
        }
        person_data["takes_up_head_start_if_eligible"] = {
            year: _program_included(payload, "head_start")
        }
        person_data["takes_up_early_head_start_if_eligible"] = {
            year: _program_included(payload, "early_head_start")
        }
        person_data["is_enrolled_in_ccdf"] = {
            year: _program_included(payload, "child_care_subsidies")
        }
        person_data["is_enrolled_in_head_start"] = {
            year: _program_included(payload, "head_start")
        }
        person_data["receives_wic"] = {
            f"{year}-{month:02d}": _program_included(payload, "wic")
            for month in range(1, 13)
        }

        if person["ssi_amount"] > 0 and _program_included(payload, "ssi"):
            person_data["ssi"] = {year: person["ssi_amount"]}
        if person["ssdi_amount"] > 0 and _program_included(payload, "ssdi"):
            person_data["social_security_disability"] = {
                year: person["ssdi_amount"]
            }

        fixed_earned_income = person["earned_income"] if index != 0 else 0.0
        if include_income_overrides and index == 0:
            set_earned_income(person_data, earned_income)
        elif not include_income_overrides and index == 0:
            person_data["employment_income"] = {year: None}
        elif fixed_earned_income > 0:
            set_earned_income(person_data, fixed_earned_income)

        if index == 0:
            extra_income_inputs = {
                "self_employment_income": payload.self_employment_income_annual,
                "child_support_received": payload.child_support_annual,
                "taxable_interest_income": payload.taxable_interest_income_annual,
                "dividend_income": payload.dividend_income_annual,
                "rental_income": payload.rental_income_annual,
                "unemployment_compensation": payload.unemployment_compensation_annual,
                "pension_income": payload.pension_income_annual,
                "social_security": payload.social_security_annual,
                "miscellaneous_income": payload.miscellaneous_income_annual,
            }
            for variable, amount in extra_income_inputs.items():
                annual_amount = _nonnegative(amount)
                if annual_amount > 0:
                    person_data[variable] = {year: annual_amount}

        people[person["id"]] = person_data

    household = {
        "members": member_ids,
        "state_name": {year: payload.state},
    }

    county = _normalize_county(payload.county, payload.state)
    if county:
        household["county"] = {year: county}

    tax_unit = {
        "members": member_ids,
        "filing_status": {year: _effective_filing_status(payload)},
        "takes_up_aca_if_eligible": {
            year: _program_included(payload, "aca_ptc")
        },
        "takes_up_eitc": {
            year: _program_included(payload, "federal_refundable_credits")
        },
    }
    if include_income_overrides:
        estimated_magi = (
            earned_income
            + sum(person["earned_income"] for person in members[1:])
            + _nonnegative(payload.self_employment_income_annual)
            + _nonnegative(payload.taxable_interest_income_annual)
            + _nonnegative(payload.dividend_income_annual)
            + _nonnegative(payload.rental_income_annual)
            + _nonnegative(payload.unemployment_compensation_annual)
            + _nonnegative(payload.pension_income_annual)
            + _nonnegative(payload.miscellaneous_income_annual)
        )
        tax_unit["aca_magi"] = {year: estimated_magi}
        tax_unit["medicaid_magi"] = {year: estimated_magi}

    childcare_expenses = _nonnegative(payload.childcare_expenses)
    spm_unit: dict[str, Any] = {
        "members": member_ids,
        "meets_ccdf_activity_test": {year: True},
        "takes_up_snap_if_eligible": {
            year: _program_included(payload, "snap")
        },
        "takes_up_tanf_if_eligible": {
            year: _program_included(payload, "tanf")
        },
        "receives_housing_assistance": {
            year: _program_included(payload, "housing_assistance")
        },
    }
    if childcare_expenses > 0:
        spm_unit["childcare_expenses"] = {year: childcare_expenses}
        spm_unit["spm_unit_pre_subsidy_childcare_expenses"] = {
            year: childcare_expenses
        }
    if utility_expense_annual > 0:
        spm_unit["utility_expense"] = {year: utility_expense_annual}
        household["hud_utility_allowance"] = {year: utility_expense_annual}
    if payload.liquid_assets > 0:
        spm_unit["snap_assets"] = {year: _nonnegative(payload.liquid_assets)}

    if _program_included(payload, "tanf"):
        spm_unit["is_tanf_enrolled"] = {
            f"{year}-{month:02d}": True for month in range(1, 13)
        }

    situation: dict[str, Any] = {
        "people": people,
        "families": {"family": {"members": member_ids}},
        "spm_units": {"spm_unit": spm_unit},
        "tax_units": {"tax_unit": tax_unit},
        "households": {"household": household},
        "marital_units": {},
    }

    if include_income_overrides and payload.state == "CO" and earned_income > 0:
        situation["spm_units"]["spm_unit"]["co_tanf_countable_gross_earned_income"] = {
            year: earned_income
        }

    head_and_spouse = [
        person["id"] for person in members if person["role"] in {"head", "spouse"}
    ]
    if (
        len(head_and_spouse) == 2
        and _effective_filing_status(payload) in MARRIED_FILING_STATUSES
    ):
        situation["marital_units"]["primary_marital_unit"] = {
            "members": head_and_spouse
        }

    for person in members:
        if person["role"] not in {"head", "spouse"}:
            situation["marital_units"][f"{person['id']}_marital_unit"] = {
                "members": [person["id"]]
            }

    return situation


def build_household_situation(payload: HouseholdInput) -> dict[str, Any]:
    _validate_input(payload)

    descriptor = _household_descriptor(payload)
    return _base_household_groups(
        descriptor["people"],
        payload=payload,
        include_income_overrides=True,
    )


def build_household_variation_situation(
    payload: HouseholdInput,
    *,
    max_earned_income: int,
    count: int,
    min_earned_income: int = 0,
) -> dict[str, Any]:
    _validate_input(payload)
    descriptor = _household_descriptor(payload)
    situation = _base_household_groups(
        descriptor["people"],
        payload=payload,
        include_income_overrides=False,
    )
    situation["axes"] = [
        [
            {
                "name": "employment_income",
                "period": payload.year,
                "min": max(0, int(min_earned_income)),
                "max": max_earned_income,
                "count": count,
            }
        ]
    ]
    return situation


def _variable_exists(simulation: Any, variable: str) -> bool:
    return variable in getattr(simulation.tax_benefit_system, "variables", {})


def _calculate_variable(
    simulation: Any,
    variable: str,
    year: int,
    *,
    map_to: str | None = None,
    monthly: bool = False,
    annualize: bool = False,
    default: float = 0.0,
) -> float:
    if not _variable_exists(simulation, variable):
        return default
    period = f"{year}-01" if monthly else year
    kwargs: dict[str, Any] = {"period": period}
    if map_to is not None:
        kwargs["map_to"] = map_to
    value = _as_scalar(simulation.calculate(variable, **kwargs))
    if monthly and annualize:
        return value * 12
    return value


def _calculate_variable_array(
    simulation: Any,
    variable: str,
    year: int,
    *,
    map_to: str | None = None,
    monthly: bool = False,
    annualize: bool = False,
) -> list[float]:
    if not _variable_exists(simulation, variable):
        return []
    period = f"{year}-01" if monthly else year
    kwargs: dict[str, Any] = {"period": period}
    if map_to is not None:
        kwargs["map_to"] = map_to
    values = _as_float_list(simulation.calculate(variable, **kwargs))
    if monthly and annualize:
        return [value * 12 for value in values]
    return values


def _normalize_series_values(
    values: list[float],
    point_count: int,
    *,
    default: float = 0.0,
) -> list[float]:
    if not values:
        return [default] * point_count
    if len(values) == point_count:
        return values
    if len(values) == 1:
        return values * point_count
    raise ValueError(f"Expected {point_count} series values but received {len(values)}")


def _calculate_tanf_amount(simulation: Any, payload: HouseholdInput) -> float:
    variable = STATE_TANF_VARIABLES.get(payload.state)
    if not variable:
        return 0.0
    try:
        return _calculate_variable(simulation, variable, payload.year)
    except Exception:
        return 0.0


def _calculate_tanf_amount_array(
    simulation: Any,
    payload: HouseholdInput,
) -> list[float]:
    variable = STATE_TANF_VARIABLES.get(payload.state)
    if not variable:
        return []
    try:
        return _calculate_variable_array(simulation, variable, payload.year)
    except Exception:
        return []


def _template_counts(payload: HouseholdInput) -> dict[str, int]:
    people = _resolved_people(payload)
    num_adults = sum(1 for person in people if person["kind"] == "adult")
    num_children = sum(1 for person in people if person["kind"] == "child")
    return {
        "num_adults": num_adults,
        "num_children": num_children,
        "household_size": num_adults + num_children,
    }


def _best_access_program(
    *,
    aca_eligible: bool,
    medicaid_eligible: bool,
    chip_eligible: bool,
) -> str:
    if medicaid_eligible:
        return "medicaid"
    if chip_eligible:
        return "chip"
    if aca_eligible:
        return "aca"
    return "none"


def _calculate_refundable_credit_programs(
    simulation: Any,
    year: int,
) -> dict[str, float]:
    values = {}
    for component in REFUNDABLE_CREDIT_COMPONENTS:
        try:
            value = _calculate_variable(
                simulation,
                component["variable"],
                year,
                map_to=component["map_to"],
            )
        except Exception:
            value = 0.0
        values[component["key"]] = round(value, 2)
    return values


def _calculate_refundable_credit_program_arrays(
    simulation: Any,
    year: int,
    point_count: int,
) -> dict[str, list[float]]:
    values: dict[str, list[float]] = {}
    for component in REFUNDABLE_CREDIT_COMPONENTS:
        try:
            series = _calculate_variable_array(
                simulation,
                component["variable"],
                year,
                map_to=component["map_to"],
            )
        except Exception:
            series = []
        values[component["key"]] = _normalize_series_values(series, point_count)
    return values


def _simulate_core(payload: HouseholdInput) -> dict[str, Any]:
    Simulation = _load_simulation()
    situation = build_household_situation(payload)
    simulation = Simulation(situation=situation)
    year = payload.year
    descriptor = _household_descriptor(payload)
    members = descriptor["people"]

    market_income = _calculate_variable(
        simulation,
        "household_market_income",
        year,
        map_to="household",
    )
    taxes = _calculate_variable(
        simulation,
        "household_tax_before_refundable_credits",
        year,
        map_to="household",
    )
    state_taxes_before_refundable_credits = _calculate_variable(
        simulation,
        "household_state_tax_before_refundable_credits",
        year,
        map_to="household",
    )
    federal_taxes_before_refundable_credits = max(
        0.0,
        taxes - state_taxes_before_refundable_credits,
    )
    snap = _calculate_variable(
        simulation,
        "snap",
        year,
        map_to="household",
        monthly=True,
        annualize=True,
    )
    wic = _calculate_variable(
        simulation,
        "wic",
        year,
        map_to="household",
        monthly=True,
        annualize=True,
    )
    free_school_meals = _calculate_variable(
        simulation,
        "free_school_meals",
        year,
        map_to="household",
    )
    head_start = _calculate_variable(
        simulation,
        "head_start",
        year,
        map_to="household",
    )
    early_head_start = _calculate_variable(
        simulation,
        "early_head_start",
        year,
        map_to="household",
    )
    housing_assistance = _calculate_variable(
        simulation,
        "housing_assistance",
        year,
        map_to="spm_unit",
    )
    ssi = _calculate_variable(
        simulation,
        "ssi",
        year,
        map_to="household",
    )
    ssdi = _calculate_variable(
        simulation,
        "social_security_disability",
        year,
        map_to="household",
    )
    medicaid_value = _calculate_variable(
        simulation,
        "medicaid",
        year,
        map_to="household",
    )
    chip_value = _calculate_variable(
        simulation,
        "chip",
        year,
        map_to="household",
    )
    chip_premium = _calculate_variable(
        simulation,
        "chip_premium",
        year,
        map_to="household",
    )
    aca_ptc = _calculate_variable(
        simulation,
        "premium_tax_credit",
        year,
        map_to="household",
    )
    federal_refundable_credits = _calculate_variable(
        simulation,
        "income_tax_refundable_credits",
        year,
        map_to="tax_unit",
    )
    state_refundable_credits = _calculate_variable(
        simulation,
        "household_refundable_state_tax_credits",
        year,
        map_to="household",
    )
    tanf = _calculate_tanf_amount(simulation, payload)
    if payload.state in CCDF_MODELED_STATES:
        try:
            child_care_subsidies = _calculate_variable(
                simulation,
                "child_care_subsidies",
                year,
                map_to="spm_unit",
            )
        except Exception:
            child_care_subsidies = 0.0
    else:
        child_care_subsidies = 0.0
    tax_unit_fpg = _calculate_variable(
        simulation,
        "tax_unit_fpg",
        year,
        map_to="tax_unit",
    )
    aca_eligible = _as_bool_list(
        simulation.calculate("is_aca_ptc_eligible", period=year)
    )
    medicaid_eligible = _as_bool_list(
        simulation.calculate("is_medicaid_eligible", period=year)
    )
    chip_eligible = _as_bool_list(simulation.calculate("is_chip_eligible", period=year))

    people = []
    for person, aca, medicaid, chip in zip(
        members,
        aca_eligible,
        medicaid_eligible,
        chip_eligible,
    ):
        people.append(
            {
                "id": person["id"],
                "role": person["role"],
                "age": person["age"],
                "is_aca_ptc_eligible": aca,
                "is_medicaid_eligible": medicaid,
                "is_chip_eligible": chip,
                "best_access_program": _best_access_program(
                    aca_eligible=aca,
                    medicaid_eligible=medicaid,
                    chip_eligible=chip,
                ),
            }
        )

    access = {
        "aca_people": 0,
        "medicaid_people": 0,
        "chip_people": 0,
        "uncovered_people": 0,
    }
    for person in people:
        key = {
            "aca": "aca_people",
            "medicaid": "medicaid_people",
            "chip": "chip_people",
            "none": "uncovered_people",
        }[person["best_access_program"]]
        access[key] += 1

    programs = {
        "snap": _filtered_program_value(payload, "snap", snap),
        "tanf": _filtered_program_value(payload, "tanf", tanf),
        "wic": _filtered_program_value(payload, "wic", wic),
        "free_school_meals": _filtered_program_value(
            payload, "free_school_meals", free_school_meals
        ),
        "head_start": _filtered_program_value(payload, "head_start", head_start),
        "early_head_start": _filtered_program_value(
            payload, "early_head_start", early_head_start
        ),
        "child_care_subsidies": _filtered_program_value(
            payload, "child_care_subsidies", child_care_subsidies
        ),
        "housing_assistance": _filtered_program_value(
            payload, "housing_assistance", housing_assistance
        ),
        "ssi": _filtered_program_value(payload, "ssi", ssi),
        "ssdi": _filtered_program_value(payload, "ssdi", ssdi),
        "medicaid": _filtered_program_value(payload, "medicaid", medicaid_value),
        "chip": _filtered_program_value(payload, "chip", chip_value),
        "aca_ptc": _filtered_program_value(payload, "aca_ptc", aca_ptc),
        "federal_refundable_credits": _filtered_program_value(
            payload, "federal_refundable_credits", federal_refundable_credits
        ),
        "state_refundable_credits": _filtered_program_value(
            payload, "state_refundable_credits", state_refundable_credits
        ),
    }
    household_costs = {
        "rent": _nonnegative(payload.rent_annual),
        "utilities": _nonnegative(payload.utility_expense_annual),
        "childcare": _nonnegative(payload.childcare_expenses),
        "food": _nonnegative(payload.food_expense_annual),
        "transportation": _nonnegative(payload.transportation_expense_annual),
        "health_insurance_premiums": _nonnegative(
            payload.health_insurance_premium_annual
        ),
        "technology": _nonnegative(payload.technology_expense_annual),
        "debt_payments": _nonnegative(payload.debt_payment_annual),
        "education_training": _nonnegative(payload.education_expense_annual),
        "other_expenses": _nonnegative(payload.other_expense_annual),
        "chip_premium": chip_premium,
    }
    core_support = sum(programs.values())
    total_household_costs = sum(household_costs.values())
    net_resources = market_income + core_support - taxes - total_household_costs

    return {
        "input": {
            "state": payload.state,
            "earned_income": payload.earned_income,
            "year": payload.year,
            "county": payload.county,
            "household_type": payload.household_type,
            "filing_status": _effective_filing_status(payload),
            "people": [
                {
                    "kind": person["kind"],
                    "age": person["age"],
                    "is_pregnant": person["is_pregnant"],
                    "is_disabled": person["is_disabled"],
                    "is_blind": person["is_blind"],
                    "is_full_time_student": person["is_full_time_student"],
                    "is_incapable_of_self_care": person[
                        "is_incapable_of_self_care"
                    ],
                    "earned_income": person["earned_income"],
                    "ssi_amount": person["ssi_amount"],
                    "ssdi_amount": person["ssdi_amount"],
                }
                for person in members
            ],
            "childcare_expenses": payload.childcare_expenses,
            "rent_annual": payload.rent_annual,
            "utility_expense_annual": payload.utility_expense_annual,
            "food_expense_annual": payload.food_expense_annual,
            "transportation_expense_annual": payload.transportation_expense_annual,
            "health_insurance_premium_annual": (
                payload.health_insurance_premium_annual
            ),
            "technology_expense_annual": payload.technology_expense_annual,
            "debt_payment_annual": payload.debt_payment_annual,
            "education_expense_annual": payload.education_expense_annual,
            "other_expense_annual": payload.other_expense_annual,
            "self_employment_income_annual": payload.self_employment_income_annual,
            "child_support_annual": payload.child_support_annual,
            "taxable_interest_income_annual": (
                payload.taxable_interest_income_annual
            ),
            "dividend_income_annual": payload.dividend_income_annual,
            "rental_income_annual": payload.rental_income_annual,
            "unemployment_compensation_annual": (
                payload.unemployment_compensation_annual
            ),
            "pension_income_annual": payload.pension_income_annual,
            "social_security_annual": payload.social_security_annual,
            "miscellaneous_income_annual": payload.miscellaneous_income_annual,
            "liquid_assets": payload.liquid_assets,
            "has_employer_health_insurance": payload.has_employer_health_insurance,
            "programs_mode": payload.programs_mode,
            "selected_programs": list(payload.selected_programs),
        },
        "template": {
            "id": descriptor["id"],
            "label": descriptor["label"],
            "short_label": descriptor["short_label"],
            "description": descriptor["description"],
            "summary": descriptor["summary"],
        },
        "counts": _template_counts(payload),
        "totals": {
            "market_income": round(market_income, 2),
            "taxes": round(taxes, 2),
            "federal_taxes_before_refundable_credits": round(
                federal_taxes_before_refundable_credits,
                2,
            ),
            "state_taxes_before_refundable_credits": round(
                state_taxes_before_refundable_credits,
                2,
            ),
            "core_support": round(core_support, 2),
            "household_costs": round(total_household_costs, 2),
            "net_resources": round(net_resources, 2),
        },
        "programs": {key: round(value, 2) for key, value in programs.items()},
        "household_costs": {
            key: round(value, 2) for key, value in household_costs.items()
        },
        "access": access,
        "context": {
            "tax_unit_fpg": round(tax_unit_fpg, 2),
            "income_pct_fpg": round((market_income / tax_unit_fpg) * 100, 1)
            if tax_unit_fpg
            else 0.0,
            "resources_pct_fpg": round((net_resources / tax_unit_fpg) * 100, 1)
            if tax_unit_fpg
            else 0.0,
        },
        "people": people,
    }


def _attach_cliff_metrics(
    payload: HouseholdInput,
    base_result: dict[str, Any],
    *,
    delta: int = DEFAULT_CLIFF_DELTA,
) -> dict[str, Any]:
    bumped_payload = replace(payload, earned_income=payload.earned_income + delta)
    bumped_result = _simulate_core(bumped_payload)
    change = (
        bumped_result["totals"]["net_resources"]
        - base_result["totals"]["net_resources"]
    )
    cliff_gap = max(0.0, -change)
    effective_marginal_rate = round(1 - (change / delta), 4) if delta else 0.0

    base_result["cliff"] = {
        "delta_annual": delta,
        "resource_change_annual": round(change, 2),
        "resource_change_monthly": round(change / 12, 2),
        "gap_annual": round(cliff_gap, 2),
        "gap_monthly": round(cliff_gap / 12, 2),
        "effective_marginal_rate": effective_marginal_rate,
        "is_on_cliff": cliff_gap > 0,
    }
    return base_result


def _format_program_breakdown(programs: dict[str, float]) -> list[dict[str, Any]]:
    labels = {item["key"]: item for item in PROGRAM_DEFINITIONS}
    ordered = []
    for key in [item["key"] for item in PROGRAM_DEFINITIONS]:
        annual = round(programs.get(key, 0.0), 2)
        if annual <= 0:
            continue
        ordered.append(
            {
                "key": key,
                "label": labels[key]["label"],
                "short_label": labels[key]["short_label"],
                "description": labels[key]["description"],
                "annual": annual,
                "monthly": round(annual / 12, 2),
            }
        )
    return ordered


def _monthly_amount(amount: float) -> float:
    return round(amount / 12, 2)


def _round_up_to_increment(value: int, increment: int) -> int:
    if increment <= 0:
        return max(1, value)
    return max(increment, math.ceil(value / increment) * increment)


def _resolve_series_max_earned_income(
    payload: HouseholdInput,
    requested_max_earned_income: int,
) -> int:
    floor = max(
        DEFAULT_SERIES_MIN_EARNINGS_WINDOW,
        int(payload.earned_income) + DEFAULT_SERIES_EARNINGS_BUFFER,
    )
    ceiling = max(floor, requested_max_earned_income)
    return max(floor, min(requested_max_earned_income, ceiling))


def _resolve_series_step(
    max_earned_income: int,
    requested_step: int,
) -> int:
    step = max(1, requested_step)
    point_count = (max_earned_income // step) + 1
    if point_count <= DEFAULT_SERIES_TARGET_POINTS:
        return step

    minimum_step = math.ceil(
        max_earned_income / max(1, DEFAULT_SERIES_TARGET_POINTS - 1)
    )
    return _round_up_to_increment(
        max(step, minimum_step),
        DEFAULT_SERIES_STEP_INCREMENT,
    )


def _build_cliff_drivers(
    previous_result: dict[str, Any],
    result: dict[str, Any],
) -> list[dict[str, Any]]:
    drivers = []

    for key, label in PROGRAM_LABEL_BY_KEY.items():
        annual_change = round(
            result["programs"].get(key, 0.0)
            - previous_result["programs"].get(key, 0.0),
            2,
        )
        if annual_change < 0:
            drivers.append(
                {
                    "key": key,
                    "label": label,
                    "kind": "benefit_loss",
                    "raw_change_annual": annual_change,
                    "raw_change_monthly": _monthly_amount(annual_change),
                    "resource_effect_annual": annual_change,
                    "resource_effect_monthly": _monthly_amount(annual_change),
                }
            )

    for key, label in HOUSEHOLD_COST_LABEL_BY_KEY.items():
        annual_change = round(
            result["household_costs"].get(key, 0.0)
            - previous_result["household_costs"].get(key, 0.0),
            2,
        )
        if annual_change > 0:
            drivers.append(
                {
                    "key": key,
                    "label": label,
                    "kind": "household_cost_increase",
                    "raw_change_annual": annual_change,
                    "raw_change_monthly": _monthly_amount(annual_change),
                    "resource_effect_annual": round(-annual_change, 2),
                    "resource_effect_monthly": _monthly_amount(-annual_change),
                }
            )

    tax_change = round(
        result["totals"]["taxes"] - previous_result["totals"]["taxes"],
        2,
    )
    if tax_change > 0:
        drivers.append(
            {
                "key": "taxes",
                "label": "Higher taxes",
                "kind": "tax_increase",
                "raw_change_annual": tax_change,
                "raw_change_monthly": _monthly_amount(tax_change),
                "resource_effect_annual": round(-tax_change, 2),
                "resource_effect_monthly": _monthly_amount(-tax_change),
            }
        )

    return sorted(
        drivers,
        key=lambda item: (item["resource_effect_annual"], item["label"]),
    )


def calculate_household(
    payload: HouseholdInput,
    *,
    delta: int = DEFAULT_CLIFF_DELTA,
) -> dict[str, Any]:
    result = _simulate_core(payload)
    result = _attach_cliff_metrics(payload, result, delta=delta)
    result["state_name"] = STATE_NAME_BY_CODE[payload.state]
    result["program_breakdown"] = _format_program_breakdown(result["programs"])
    result["eligible"] = result["totals"]["core_support"] > 0
    result["monthly"] = {
        key: round(value / 12, 2) for key, value in result["totals"].items()
    }
    return result


def calculate_income_series(
    payload: HouseholdInput,
    *,
    max_earned_income: int = DEFAULT_SERIES_MAX_EARNINGS,
    step: int = DEFAULT_SERIES_STEP,
    min_earned_income: int = 0,
) -> dict[str, Any]:
    effective_max_earned_income = _resolve_series_max_earned_income(
        payload,
        max_earned_income,
    )
    effective_step = _resolve_series_step(effective_max_earned_income, step)
    aligned_max_earned_income = _round_up_to_increment(
        effective_max_earned_income,
        effective_step,
    )
    aligned_min_earned_income = max(0, int(min_earned_income))
    if aligned_min_earned_income >= aligned_max_earned_income:
        aligned_min_earned_income = 0
    effective_window = aligned_max_earned_income - aligned_min_earned_income
    point_count = max(2, (effective_window // effective_step) + 1)
    Simulation = _load_simulation()
    simulation = Simulation(
        situation=build_household_variation_situation(
            payload,
            max_earned_income=aligned_max_earned_income,
            count=point_count,
            min_earned_income=aligned_min_earned_income,
        )
    )

    earned_incomes = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "employment_income",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    market_income_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "household_market_income",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    tax_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "household_tax_before_refundable_credits",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    state_tax_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "household_state_tax_before_refundable_credits",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    federal_refundable_credit_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "income_tax_refundable_credits",
            payload.year,
            map_to="tax_unit",
        ),
        point_count,
    )
    state_refundable_credit_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "household_refundable_state_tax_credits",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    snap_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "snap",
            payload.year,
            map_to="household",
            monthly=True,
            annualize=True,
        ),
        point_count,
    )
    wic_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "wic",
            payload.year,
            map_to="household",
            monthly=True,
            annualize=True,
        ),
        point_count,
    )
    free_school_meal_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "free_school_meals",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    head_start_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "head_start",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    early_head_start_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "early_head_start",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    housing_assistance_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "housing_assistance",
            payload.year,
            map_to="spm_unit",
        ),
        point_count,
    )
    ssi_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "ssi",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    ssdi_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "social_security_disability",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    medicaid_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "medicaid",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    chip_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "chip",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    chip_premium_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "chip_premium",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    aca_ptc_values = _normalize_series_values(
        _calculate_variable_array(
            simulation,
            "premium_tax_credit",
            payload.year,
            map_to="household",
        ),
        point_count,
    )
    tanf_values = _normalize_series_values(
        _calculate_tanf_amount_array(simulation, payload),
        point_count,
    )
    if payload.state in CCDF_MODELED_STATES:
        try:
            child_care_subsidy_series = _calculate_variable_array(
                simulation,
                "child_care_subsidies",
                payload.year,
                map_to="spm_unit",
            )
        except Exception:
            child_care_subsidy_series = []
    else:
        child_care_subsidy_series = []
    child_care_subsidy_values = _normalize_series_values(
        child_care_subsidy_series,
        point_count,
    )

    series = []
    previous_result = None
    step_monthly = _monthly_amount(effective_step)
    truncated = False
    truncation_reason = None
    fixed_household_costs = {
        "rent": _nonnegative(payload.rent_annual),
        "utilities": _nonnegative(payload.utility_expense_annual),
        "childcare": _nonnegative(payload.childcare_expenses),
        "food": _nonnegative(payload.food_expense_annual),
        "transportation": _nonnegative(payload.transportation_expense_annual),
        "health_insurance_premiums": _nonnegative(
            payload.health_insurance_premium_annual
        ),
        "technology": _nonnegative(payload.technology_expense_annual),
        "debt_payments": _nonnegative(payload.debt_payment_annual),
        "education_training": _nonnegative(payload.education_expense_annual),
        "other_expenses": _nonnegative(payload.other_expense_annual),
    }

    for index, earned_income in enumerate(earned_incomes):
        programs = {
            "snap": round(
                _filtered_program_value(payload, "snap", snap_values[index]), 2
            ),
            "tanf": round(
                _filtered_program_value(payload, "tanf", tanf_values[index]), 2
            ),
            "wic": round(
                _filtered_program_value(payload, "wic", wic_values[index]), 2
            ),
            "free_school_meals": round(
                _filtered_program_value(
                    payload, "free_school_meals", free_school_meal_values[index]
                ),
                2,
            ),
            "head_start": round(
                _filtered_program_value(
                    payload, "head_start", head_start_values[index]
                ),
                2,
            ),
            "early_head_start": round(
                _filtered_program_value(
                    payload, "early_head_start", early_head_start_values[index]
                ),
                2,
            ),
            "child_care_subsidies": round(
                _filtered_program_value(
                    payload,
                    "child_care_subsidies",
                    child_care_subsidy_values[index],
                ),
                2,
            ),
            "housing_assistance": round(
                _filtered_program_value(
                    payload,
                    "housing_assistance",
                    housing_assistance_values[index],
                ),
                2,
            ),
            "ssi": round(
                _filtered_program_value(payload, "ssi", ssi_values[index]), 2
            ),
            "ssdi": round(
                _filtered_program_value(payload, "ssdi", ssdi_values[index]), 2
            ),
            "medicaid": round(
                _filtered_program_value(payload, "medicaid", medicaid_values[index]),
                2,
            ),
            "chip": round(
                _filtered_program_value(payload, "chip", chip_values[index]), 2
            ),
            "aca_ptc": round(
                _filtered_program_value(payload, "aca_ptc", aca_ptc_values[index]),
                2,
            ),
            "federal_refundable_credits": round(
                _filtered_program_value(
                    payload,
                    "federal_refundable_credits",
                    federal_refundable_credit_values[index],
                ),
                2,
            ),
            "state_refundable_credits": round(
                _filtered_program_value(
                    payload,
                    "state_refundable_credits",
                    state_refundable_credit_values[index],
                ),
                2,
            ),
        }
        household_costs = {
            **fixed_household_costs,
            "chip_premium": round(chip_premium_values[index], 2),
        }
        market_income = round(market_income_values[index], 2)
        taxes = round(tax_values[index], 2)
        state_taxes_before_refundable_credits = round(
            state_tax_values[index],
            2,
        )
        federal_taxes_before_refundable_credits = round(
            max(0.0, taxes - state_taxes_before_refundable_credits),
            2,
        )
        core_support = round(sum(programs.values()), 2)
        total_household_costs = round(sum(household_costs.values()), 2)
        result = {
            "programs": programs,
            "household_costs": household_costs,
            "totals": {
                "market_income": market_income,
                "taxes": taxes,
                "federal_taxes_before_refundable_credits": federal_taxes_before_refundable_credits,
                "state_taxes_before_refundable_credits": state_taxes_before_refundable_credits,
                "core_support": core_support,
                "household_costs": total_household_costs,
                "net_resources": round(
                    market_income + core_support - taxes - total_household_costs,
                    2,
                ),
            },
        }
        net_resources = result["totals"]["net_resources"]
        has_previous_point = previous_result is not None
        previous_net_resources = (
            previous_result["totals"]["net_resources"]
            if previous_result is not None
            else net_resources
        )
        net_change = net_resources - previous_net_resources
        cliff_drop = max(0.0, previous_net_resources - net_resources)
        cliff_drivers = (
            _build_cliff_drivers(previous_result, result)
            if previous_result is not None and cliff_drop > 0
            else []
        )
        series.append(
            {
                "earned_income": round(earned_income, 2),
                "step_annual": effective_step,
                "net_resources": net_resources,
                "net_change_annual": round(net_change, 2)
                if has_previous_point
                else 0.0,
                "core_support": core_support,
                "taxes": taxes,
                "medicaid": programs["medicaid"],
                "chip": programs["chip"],
                "chip_premium": household_costs["chip_premium"],
                "aca_ptc": programs["aca_ptc"],
                "snap": programs["snap"],
                "free_school_meals": programs["free_school_meals"],
                "head_start": programs["head_start"],
                "early_head_start": programs["early_head_start"],
                "housing_assistance": programs["housing_assistance"],
                "ssi": programs["ssi"],
                "ssdi": programs["ssdi"],
                "federal_refundable_credits": programs["federal_refundable_credits"],
                "state_refundable_credits": programs["state_refundable_credits"],
                "federal_taxes_before_refundable_credits": federal_taxes_before_refundable_credits,
                "state_taxes_before_refundable_credits": state_taxes_before_refundable_credits,
                "tanf": programs["tanf"],
                "wic": programs["wic"],
                "child_care_subsidies": programs["child_care_subsidies"],
                "household_costs": household_costs,
                "has_previous_point": has_previous_point,
                "cliff_drop_annual": round(cliff_drop, 2),
                "is_cliff": cliff_drop > 0,
                "cliff_drivers": cliff_drivers,
            }
        )
        previous_result = result

    return {
        "data": series,
        "requested_step_annual": step,
        "step_annual": effective_step,
        "requested_max_earned_income": max_earned_income,
        "max_earned_income": series[-1]["earned_income"] if series else 0,
        "truncated": truncated,
        "truncation_reason": truncation_reason,
        "point_count": len(series),
    }


def calculate_household_types(payload: HouseholdInput) -> list[dict[str, Any]]:
    results = []
    for household_type in HOUSEHOLD_TYPE_BY_ID:
        scenario = replace(
            payload,
            household_type=household_type,
            people=(),
            filing_status=None,
        )
        result = _simulate_core(scenario)
        results.append(
            {
                "household_type": household_type,
                "label": result["template"]["label"],
                "short_label": result["template"]["short_label"],
                "description": result["template"]["description"],
                "net_resources_annual": round(
                    result["totals"]["net_resources"],
                    2,
                ),
                "net_resources_monthly": round(
                    result["totals"]["net_resources"] / 12,
                    2,
                ),
                "core_support_annual": round(
                    result["totals"]["core_support"],
                    2,
                ),
                "core_support_monthly": round(
                    result["totals"]["core_support"] / 12,
                    2,
                ),
                "taxes_annual": round(result["totals"]["taxes"], 2),
                "taxes_monthly": round(result["totals"]["taxes"] / 12, 2),
                "counts": result["counts"],
            }
        )
    return results


def household_input_from_dict(data: dict[str, Any]) -> HouseholdInput:
    def numeric(field: str) -> float:
        return float(data.get(field, 0) or 0)

    people = tuple(
        HouseholdMemberInput(
            age=int(person["age"]),
            kind=str(
                person.get("kind")
                or (
                    "child"
                    if person.get("role") == "dependent"
                    else "adult"
                    if person.get("role")
                    else "adult"
                    if int(person["age"]) >= 18
                    else "child"
                )
            ),
            is_pregnant=bool(person.get("is_pregnant", False)),
            is_disabled=bool(person.get("is_disabled", False)),
            is_blind=bool(person.get("is_blind", False)),
            is_full_time_student=bool(person.get("is_full_time_student", False)),
            is_incapable_of_self_care=bool(
                person.get("is_incapable_of_self_care", False)
            ),
            earned_income=float(person.get("earned_income", 0) or 0),
            ssi_amount=float(person.get("ssi_amount", 0) or 0),
            ssdi_amount=float(person.get("ssdi_amount", 0) or 0),
        )
        for person in data.get("people", [])
    )
    selected_programs = tuple(
        str(key)
        for key in data.get("selected_programs", [])
        if str(key) in PUBLIC_ASSISTANCE_PROGRAM_KEYS
    )
    return HouseholdInput(
        state=data["state"],
        earned_income=numeric("earned_income"),
        year=int(data.get("year", DEFAULT_YEAR)),
        county=data.get("county"),
        people=people,
        household_type=data.get("household_type"),
        filing_status=data.get("filing_status"),
        childcare_expenses=numeric("childcare_expenses"),
        rent_annual=numeric("rent_annual"),
        utility_expense_annual=numeric("utility_expense_annual"),
        food_expense_annual=numeric("food_expense_annual"),
        transportation_expense_annual=numeric("transportation_expense_annual"),
        health_insurance_premium_annual=numeric(
            "health_insurance_premium_annual"
        ),
        technology_expense_annual=numeric("technology_expense_annual"),
        debt_payment_annual=numeric("debt_payment_annual"),
        education_expense_annual=numeric("education_expense_annual"),
        other_expense_annual=numeric("other_expense_annual"),
        self_employment_income_annual=numeric("self_employment_income_annual"),
        child_support_annual=numeric("child_support_annual"),
        taxable_interest_income_annual=numeric(
            "taxable_interest_income_annual"
        ),
        dividend_income_annual=numeric("dividend_income_annual"),
        rental_income_annual=numeric("rental_income_annual"),
        unemployment_compensation_annual=numeric(
            "unemployment_compensation_annual"
        ),
        pension_income_annual=numeric("pension_income_annual"),
        social_security_annual=numeric("social_security_annual"),
        miscellaneous_income_annual=numeric("miscellaneous_income_annual"),
        liquid_assets=numeric("liquid_assets"),
        has_employer_health_insurance=bool(
            data.get("has_employer_health_insurance", False)
        ),
        programs_mode=str(data.get("programs_mode", "all") or "all"),
        selected_programs=selected_programs,
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "input",
        nargs="?",
        default="examples/sample_household.json",
        help="Path to input JSON. Use '-' to read from stdin.",
    )
    parser.add_argument(
        "--mode",
        choices=["household", "series", "households"],
        default="household",
    )
    parser.add_argument(
        "--max-earned-income", type=int, default=DEFAULT_SERIES_MAX_EARNINGS
    )
    parser.add_argument("--step", type=int, default=DEFAULT_SERIES_STEP)
    parser.add_argument("--delta", type=int, default=DEFAULT_CLIFF_DELTA)
    return parser.parse_args()


def _load_input(path: str) -> HouseholdInput:
    if path == "-":
        raw = json.load(sys.stdin)
    else:
        with open(path) as file:
            raw = json.load(file)
    return household_input_from_dict(raw)


def main() -> None:
    args = _parse_args()
    payload = _load_input(args.input)

    if args.mode == "household":
        output = calculate_household(payload, delta=args.delta)
    elif args.mode == "series":
        output = calculate_income_series(
            payload,
            max_earned_income=args.max_earned_income,
            step=args.step,
        )
    else:
        output = calculate_household_types(payload)

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()

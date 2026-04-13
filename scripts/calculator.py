from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from scripts.config import (
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
        MARRIED_FILING_STATUSES,
        HOUSEHOLD_TYPE_BY_ID,
        PROGRAM_DEFINITIONS,
        STATE_INFO,
        STATE_NAME_BY_CODE,
        STATE_TANF_VARIABLES,
    )
except ModuleNotFoundError:
    from config import (
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
        MARRIED_FILING_STATUSES,
        HOUSEHOLD_TYPE_BY_ID,
        PROGRAM_DEFINITIONS,
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


@dataclass(frozen=True)
class HouseholdInput:
    state: str
    earned_income: float
    year: int = DEFAULT_YEAR
    county: str | None = None
    people: tuple[HouseholdMemberInput, ...] = ()
    household_type: str | None = None
    filing_status: str | None = None


PROGRAM_LABEL_BY_KEY = {
    item["key"]: item["label"] for item in PROGRAM_DEFINITIONS
}
FILING_STATUS_CODES = {
    item["code"] for item in FILING_STATUS_OPTIONS
}
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

    sibling = Path(__file__).resolve().parents[1].parent / "policyengine-us"
    if sibling.exists():
        return sibling
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
    num_dependants = sum(1 for person in people if person["kind"] == "child")
    adult_ages = [str(person["age"]) for person in people if person["kind"] == "adult"]
    dependant_ages = [str(person["age"]) for person in people if person["kind"] == "child"]

    description_parts = []
    if adult_ages:
        description_parts.append(f"Adult ages: {', '.join(adult_ages)}")
    if dependant_ages:
        description_parts.append(f"Dependant ages: {', '.join(dependant_ages)}")

    return {
        "id": "custom_household",
        "label": f"{_format_count(num_adults, 'adult', 'adults')} + {_format_count(num_dependants, 'dependant', 'dependants')}",
        "short_label": f"{num_adults}A/{num_dependants}D",
        "description": ". ".join(description_parts) if description_parts else "Custom household.",
        "summary": "The first adult is treated as the primary earner. The second adult joins the tax unit, and any other household members are treated as dependants.",
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
    if filing_status not in FILING_STATUS_CODES:
        raise ValueError(f"Unsupported filing_status: {filing_status}")
    if (
        filing_status in MARRIED_FILING_STATUSES
        and sum(1 for person in people if person.kind == "adult") < 2
    ):
        raise ValueError(
            "Married filing statuses require two adult household members"
        )
    for person in people:
        if person.kind not in {"adult", "child"}:
            raise ValueError(f"Unsupported household member kind: {person.kind}")
        if person.age < 0 or person.age > 120:
            raise ValueError(f"Invalid age: {person.age}")


def _base_person_data(
    person: dict[str, Any],
    *,
    year: int,
) -> dict[str, Any]:
    return {
        "age": {year: person["age"]},
        "has_itin": {year: True},
        "has_esi": {year: False},
        "offered_aca_disqualifying_esi": {year: False},
        "is_pregnant": {year: bool(person.get("is_pregnant", False))},
        "under_60_days_postpartum": {year: False},
        "immigration_status_str": {year: "CITIZEN"},
    }


def _base_household_groups(
    members: list[dict[str, Any]],
    *,
    payload: HouseholdInput,
    include_income_overrides: bool,
) -> dict[str, Any]:
    year = payload.year
    earned_income = float(payload.earned_income)
    monthly_earned = earned_income / 12
    people: dict[str, dict[str, Any]] = {}
    member_ids = [person["id"] for person in members]

    for index, person in enumerate(members):
        person_data = _base_person_data(person, year=year)

        if include_income_overrides and index == 0 and earned_income > 0:
            person_data["employment_income"] = {year: earned_income}
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
                    f"{year}-{month:02d}": monthly_earned
                    for month in range(1, 13)
                }
        elif not include_income_overrides and index == 0:
            person_data["employment_income"] = {year: None}

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
    }
    if include_income_overrides:
        tax_unit["aca_magi"] = {year: earned_income}
        tax_unit["medicaid_magi"] = {year: earned_income}

    situation: dict[str, Any] = {
        "people": people,
        "families": {"family": {"members": member_ids}},
        "spm_units": {"spm_unit": {"members": member_ids}},
        "tax_units": {"tax_unit": tax_unit},
        "households": {"household": household},
        "marital_units": {},
    }

    if include_income_overrides and payload.state == "CO" and earned_income > 0:
        situation["spm_units"]["spm_unit"][
            "co_tanf_countable_gross_earned_income"
        ] = {year: earned_income}

    head_and_spouse = [
        person["id"]
        for person in members
        if person["role"] in {"head", "spouse"}
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
                "min": 0,
                "max": max_earned_income,
                "count": count,
            }
        ]
    ]
    return situation


def _calculate_variable(
    simulation: Any,
    variable: str,
    year: int,
    *,
    map_to: str | None = None,
    monthly: bool = False,
    annualize: bool = False,
) -> float:
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
    raise ValueError(
        f"Expected {point_count} series values but received {len(values)}"
    )


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
    num_adults = sum(
        1 for person in people if person["kind"] == "adult"
    )
    num_children = sum(
        1 for person in people if person["kind"] == "child"
    )
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
    aca_ptc = _calculate_variable(
        simulation,
        "premium_tax_credit",
        year,
        map_to="household",
    )
    tanf = _calculate_tanf_amount(simulation, payload)
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
    chip_eligible = _as_bool_list(
        simulation.calculate("is_chip_eligible", period=year)
    )

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
        "snap": snap,
        "tanf": tanf,
        "wic": wic,
        "free_school_meals": free_school_meals,
        "medicaid": medicaid_value,
        "chip": chip_value,
        "aca_ptc": aca_ptc,
        **_calculate_refundable_credit_programs(simulation, year),
    }
    core_support = sum(programs.values())
    net_resources = market_income + core_support - taxes

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
                }
                for person in members
            ],
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
            "core_support": round(core_support, 2),
            "net_resources": round(net_resources, 2),
        },
        "programs": {key: round(value, 2) for key, value in programs.items()},
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
    bumped_payload = HouseholdInput(
        state=payload.state,
        earned_income=payload.earned_income + delta,
        year=payload.year,
        county=payload.county,
        people=payload.people,
        household_type=payload.household_type,
        filing_status=payload.filing_status,
    )
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
            result["programs"][key] - previous_result["programs"][key],
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
                    "resource_effect_monthly": _monthly_amount(
                        annual_change
                    ),
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
        key: round(value / 12, 2)
        for key, value in result["totals"].items()
    }
    return result


def calculate_all_states(payload: HouseholdInput) -> list[dict[str, Any]]:
    results = []
    for state in [item["code"] for item in STATE_INFO]:
        scenario = HouseholdInput(
            state=state,
            earned_income=payload.earned_income,
            year=payload.year,
            people=payload.people,
            household_type=payload.household_type,
            filing_status=payload.filing_status,
        )
        result = _simulate_core(scenario)
        results.append(
            {
                "state": state,
                "state_name": STATE_NAME_BY_CODE[state],
                "template_label": result["template"]["label"],
                "net_resources": result["totals"]["net_resources"],
                "taxes": result["totals"]["taxes"],
                "net_resources_monthly": round(
                    result["totals"]["net_resources"] / 12,
                    2,
                ),
                "core_support": result["totals"]["core_support"],
                "core_support_monthly": round(
                    result["totals"]["core_support"] / 12,
                    2,
                ),
                "taxes_monthly": round(result["totals"]["taxes"] / 12, 2),
                "income_pct_fpg": result["context"]["income_pct_fpg"],
                "resources_pct_fpg": result["context"]["resources_pct_fpg"],
                "access": result["access"],
            }
        )
    return results


def calculate_income_series(
    payload: HouseholdInput,
    *,
    max_earned_income: int = DEFAULT_SERIES_MAX_EARNINGS,
    step: int = DEFAULT_SERIES_STEP,
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
    point_count = (aligned_max_earned_income // effective_step) + 1
    Simulation = _load_simulation()
    simulation = Simulation(
        situation=build_household_variation_situation(
            payload,
            max_earned_income=aligned_max_earned_income,
            count=point_count,
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
    refundable_credit_program_values = _calculate_refundable_credit_program_arrays(
        simulation,
        payload.year,
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

    series = []
    previous_result = None
    step_monthly = _monthly_amount(effective_step)
    truncated = False
    truncation_reason = None

    for index, earned_income in enumerate(earned_incomes):
        programs = {
            "snap": round(snap_values[index], 2),
            "tanf": round(tanf_values[index], 2),
            "wic": round(wic_values[index], 2),
            "free_school_meals": round(free_school_meal_values[index], 2),
            "medicaid": round(medicaid_values[index], 2),
            "chip": round(chip_values[index], 2),
            "aca_ptc": round(aca_ptc_values[index], 2),
            **{
                key: round(values[index], 2)
                for key, values in refundable_credit_program_values.items()
            },
        }
        market_income = round(market_income_values[index], 2)
        taxes = round(tax_values[index], 2)
        core_support = round(sum(programs.values()), 2)
        result = {
            "programs": programs,
            "totals": {
                "market_income": market_income,
                "taxes": taxes,
                "core_support": core_support,
                "net_resources": round(
                    market_income + core_support - taxes,
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
                "aca_ptc": programs["aca_ptc"],
                "snap": programs["snap"],
                "free_school_meals": programs["free_school_meals"],
                "eitc": programs["eitc"],
                "ctc": programs["ctc"],
                "refundable_american_opportunity_credit": programs["refundable_american_opportunity_credit"],
                "recovery_rebate_credit": programs["recovery_rebate_credit"],
                "refundable_payroll_tax_credit": programs["refundable_payroll_tax_credit"],
                "state_eitc": programs["state_eitc"],
                "state_ctc": programs["state_ctc"],
                "state_cdcc": programs["state_cdcc"],
                "state_property_tax_credit": programs["state_property_tax_credit"],
                "vt_renter_credit": programs["vt_renter_credit"],
                "va_refundable_eitc_if_claimed": programs["va_refundable_eitc_if_claimed"],
                "va_low_income_tax_credit": programs["va_low_income_tax_credit"],
                "nm_low_income_comprehensive_tax_rebate": programs["nm_low_income_comprehensive_tax_rebate"],
                "tanf": programs["tanf"],
                "wic": programs["wic"],
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
        scenario = HouseholdInput(
            state=payload.state,
            earned_income=payload.earned_income,
            year=payload.year,
            county=payload.county,
            household_type=household_type,
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
                    else "adult" if int(person["age"]) >= 18 else "child"
                )
            ),
            is_pregnant=bool(person.get("is_pregnant", False)),
        )
        for person in data.get("people", [])
    )
    return HouseholdInput(
        state=data["state"],
        earned_income=float(data.get("earned_income", 0)),
        year=int(data.get("year", DEFAULT_YEAR)),
        county=data.get("county"),
        people=people,
        household_type=data.get("household_type"),
        filing_status=data.get("filing_status"),
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "input",
        nargs="?",
        default="scripts/sample_household.json",
        help="Path to input JSON. Use '-' to read from stdin.",
    )
    parser.add_argument(
        "--mode",
        choices=["household", "states", "series", "households"],
        default="household",
    )
    parser.add_argument("--max-earned-income", type=int, default=DEFAULT_SERIES_MAX_EARNINGS)
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
    elif args.mode == "states":
        output = calculate_all_states(payload)
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

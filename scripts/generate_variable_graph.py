"""Write the PolicyEngine US variable-graph snapshot the payload tests read.

Collects every variable either situation builder can emit (the Python one in
``cliff_watch/calculator.py`` and the JS one in ``frontend/src/policyengineApi.js``,
via ``node frontend/scripts/emittedVariables.mjs``), then records each one's
entity and transitive ``adds``/``subtracts`` components from the installed
policyengine-us. Run after changing either builder's variables or the pinned
policyengine-us version:

    uv run python scripts/generate_variable_graph.py
"""

from __future__ import annotations

import importlib.metadata
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from cliff_watch.calculator import (
    HEAD_INCOME_INPUTS,
    build_household_situation,
    build_household_variation_situation,
    household_input_from_dict,
)
from cliff_watch.config import (
    PUBLIC_ASSISTANCE_PROGRAM_OPTIONS,
    STATE_NAME_BY_CODE,
)
from cliff_watch.variable_graph import (
    build_variable_graph,
    situation_variables,
)

SNAPSHOT = (
    REPO / "frontend" / "src" / "__fixtures__" / "policyengine-us-variable-graph.json"
)
COST_FIELDS = (
    "childcare_expenses",
    "rent_annual",
    "utility_expense_annual",
    "food_expense_annual",
    "transportation_expense_annual",
    "health_insurance_premium_annual",
    "technology_expense_annual",
    "debt_payment_annual",
    "education_expense_annual",
    "other_expense_annual",
)


def _person(kind: str, age: int) -> dict:
    return {
        "kind": kind,
        "age": age,
        "is_pregnant": kind == "adult",
        "is_disabled": True,
        "is_blind": True,
        "is_full_time_student": True,
        "is_incapable_of_self_care": True,
        "earned_income": 1000,
        "ssi_amount": 100,
        "ssdi_amount": 200,
    }


def python_emitted_variables() -> set[tuple[str, str]]:
    """``(group, variable)`` pairs the Python builder emits over a full grid."""
    names: set[tuple[str, str]] = set()
    for state in STATE_NAME_BY_CODE:
        for filing_status in ("JOINT", "HEAD_OF_HOUSEHOLD"):
            payload = household_input_from_dict(
                {
                    "state": state,
                    "county": "Some County",
                    "earned_income": 20000,
                    "filing_status": filing_status,
                    "people": [
                        _person("adult", 40),
                        _person("adult", 38),
                        _person("adult", 70),
                        _person("child", 4),
                    ],
                    "programs_mode": "custom",
                    "selected_programs": [
                        item["key"] for item in PUBLIC_ASSISTANCE_PROGRAM_OPTIONS
                    ],
                    "has_employer_health_insurance": True,
                    "liquid_assets": 1000,
                    **{field: 1000 for field in COST_FIELDS},
                    **{field: 1000 for field in HEAD_INCOME_INPUTS},
                }
            )
            names.update(situation_variables(build_household_situation(payload)))
            names.update(
                situation_variables(
                    build_household_variation_situation(
                        payload, max_earned_income=50000, count=3
                    )
                )
            )
    return names


def js_emitted_variables() -> set[tuple[str, str]]:
    """``(group, variable)`` pairs the JS builder emits over its own grid."""
    output = subprocess.run(
        ["node", str(REPO / "frontend" / "scripts" / "emittedVariables.mjs")],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return {
        (group, name) for group, names in json.loads(output).items() for name in names
    }


def main() -> None:
    from policyengine_us import CountryTaxBenefitSystem

    emitted = python_emitted_variables() | js_emitted_variables()
    graph = build_variable_graph(
        CountryTaxBenefitSystem(), sorted({name for _, name in emitted})
    )
    version = importlib.metadata.version("policyengine-us")
    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(
        json.dumps(
            {
                "source": "scripts/generate_variable_graph.py",
                "policyengine_us_version": version,
                "variables": graph,
            },
            indent=2,
        )
        + "\n"
    )
    print(
        f"Wrote {len(graph)} variables from policyengine-us {version} to "
        f"{SNAPSHOT.relative_to(REPO)}"
    )


if __name__ == "__main__":
    main()

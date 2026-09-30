"""Differential check of the Python situation builder against the live API.

Posts situations from ``build_household_situation`` to api.policyengine.org and
checks that every entered income amount reaches the component rules read, and
that each entered taxable dollar reaches federal gross income once. Skipped
unless ``POLICYENGINE_LIVE_API=1``, because it needs the network:

    POLICYENGINE_LIVE_API=1 uv run pytest tests/test_live_policyengine_api.py
"""

from __future__ import annotations

import copy
import json
import os
import urllib.request

import pytest

from cliff_watch.calculator import build_household_situation, household_input_from_dict

pytestmark = pytest.mark.skipif(
    os.environ.get("POLICYENGINE_LIVE_API") != "1",
    reason="set POLICYENGINE_LIVE_API=1 to call api.policyengine.org",
)

CALCULATE_URL = "https://api.policyengine.org/us/calculate"
YEAR = 2026
PERSON_OUTPUTS = (
    "taxable_private_pension_income",
    "taxable_public_pension_income",
    "taxable_pension_income",
    "pension_income",
    "qualified_dividend_income",
    "dividend_income",
    "social_security_retirement",
    "social_security_disability",
    "social_security",
    "irs_gross_income",
)
CASES = {
    "NY retiree, private pension and Social Security": {
        "state": "NY",
        "filing_status": "SINGLE",
        "people": [{"kind": "adult", "age": 67}],
        "pension_income_annual": 30000,
        "social_security_annual": 18000,
    },
    "NY retiree, government pension": {
        "state": "NY",
        "filing_status": "SINGLE",
        "people": [{"kind": "adult", "age": 67}],
        "public_pension_income_annual": 30000,
    },
    "CA retiree, dividends and Social Security": {
        "state": "CA",
        "filing_status": "SINGLE",
        "people": [{"kind": "adult", "age": 67}],
        "dividend_income_annual": 20000,
        "social_security_annual": 15000,
    },
    "TX Social Security retirement plus SSDI": {
        "state": "TX",
        "filing_status": "SINGLE",
        "people": [{"kind": "adult", "age": 60, "ssdi_amount": 6000}],
        "social_security_annual": 12000,
    },
    "GA couple, earnings, pensions and interest": {
        "state": "GA",
        "filing_status": "JOINT",
        "earned_income": 15000,
        "people": [{"kind": "adult", "age": 64}, {"kind": "adult", "age": 62}],
        "pension_income_annual": 9000,
        "public_pension_income_annual": 4000,
        "taxable_interest_income_annual": 500,
        "unemployment_compensation_annual": 2000,
    },
}


def _calculate(situation):
    request = urllib.request.Request(
        CALCULATE_URL,
        data=json.dumps({"household": situation}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)["result"]


@pytest.mark.parametrize("raw", CASES.values(), ids=CASES.keys())
def test_entered_income_reaches_components_on_the_live_api(raw):
    payload = household_input_from_dict({"year": YEAR, **raw})
    situation = copy.deepcopy(build_household_situation(payload))
    head_id = next(iter(situation["people"]))
    for variable in PERSON_OUTPUTS:
        situation["people"][head_id].setdefault(variable, {YEAR: None})

    result = _calculate(situation)["people"][head_id]
    head = {variable: result[variable][str(YEAR)] for variable in PERSON_OUTPUTS}

    private = raw.get("pension_income_annual", 0)
    public = raw.get("public_pension_income_annual", 0)
    dividends = raw.get("dividend_income_annual", 0)
    retirement = raw.get("social_security_annual", 0)
    ssdi = raw["people"][0].get("ssdi_amount", 0)
    assert head["taxable_private_pension_income"] == pytest.approx(private)
    assert head["taxable_public_pension_income"] == pytest.approx(public)
    assert head["taxable_pension_income"] == pytest.approx(private + public)
    assert head["pension_income"] == pytest.approx(private + public)
    assert head["qualified_dividend_income"] == pytest.approx(dividends)
    assert head["dividend_income"] == pytest.approx(dividends)
    assert head["social_security_retirement"] == pytest.approx(retirement)
    assert head["social_security_disability"] == pytest.approx(ssdi)
    assert head["social_security"] == pytest.approx(retirement + ssdi)

    fully_taxable = (
        raw.get("earned_income", 0)
        + private
        + public
        + dividends
        + raw.get("taxable_interest_income_annual", 0)
        + raw.get("unemployment_compensation_annual", 0)
    )
    taxable_social_security = head["irs_gross_income"] - fully_taxable
    assert -0.01 <= taxable_social_security <= 0.85 * (retirement + ssdi) + 0.01

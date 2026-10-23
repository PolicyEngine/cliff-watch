"""Concurrent calculations in one process must not fail or differ (#38).

Vercel's Fluid compute runs several /api/series invocations in one Python
process at the same time. policyengine-core 3.27.0 through 3.29.2 forbade
randomness in formulas by patching ``numpy.random`` process-wide while any
formula ran. A concurrent request that was building its Simulation, which
calls ``np.random.seed(0)``, then raised NonDeterministicFormulaError naming
the other request's formula. policyengine-core 3.30.0 replaced that guard with
a static check when variables are built (policyengine-core#519).
"""

from __future__ import annotations

import importlib.util
import threading

import pytest

from cliff_watch import calculate_income_series, household_input_from_dict

pytest.importorskip("policyengine_us")

# Different states and household shapes, so concurrent requests run different
# formulas, as share links opened together do.
HOUSEHOLDS = [
    {
        "state": "PA",
        "marital_status": "MARRIED",
        "people": [
            {"kind": "adult", "age": 40},
            {"kind": "adult", "age": 38},
            {"kind": "child", "age": 10},
            {"kind": "child", "age": 5},
        ],
        "rent_annual": 10_800,
    },
    {
        "state": "OH",
        "people": [{"kind": "adult", "age": 66}],
        "social_security_annual": 15_600,
        "rent_annual": 8_400,
    },
    {
        "state": "TX",
        "people": [
            {"kind": "adult", "age": 28},
            {"kind": "child", "age": 6},
            {"kind": "child", "age": 3},
        ],
        "childcare_expenses": 7_200,
        "rent_annual": 12_000,
    },
    {
        "state": "NE",
        "people": [
            {"kind": "adult", "age": 30},
            {"kind": "child", "age": 4},
            {"kind": "child", "age": 1},
        ],
        "childcare_expenses": 12_000,
        "rent_annual": 10_200,
    },
    {
        "state": "WV",
        "marital_status": "MARRIED",
        "people": [
            {"kind": "adult", "age": 60},
            {"kind": "adult", "age": 58},
        ],
    },
    {
        "state": "MD",
        "people": [
            {"kind": "adult", "age": 35},
            {"kind": "child", "age": 2, "is_disabled": True},
        ],
        "childcare_expenses": 6_000,
    },
]
ROUNDS = 3
MAX_EARNED_INCOME = 25_000
STEP = 2_500


def _series(raw: dict) -> list[dict]:
    payload = household_input_from_dict({"year": 2026, "programs_mode": "all", **raw})
    return calculate_income_series(
        payload, max_earned_income=MAX_EARNED_INCOME, step=STEP
    )["data"]


def test_engine_has_no_runtime_randomness_guard() -> None:
    assert (
        importlib.util.find_spec("policyengine_core.simulations.randomness_guard")
        is None
    )


def test_concurrent_series_calculations_succeed_and_match_serial() -> None:
    serial = [_series(raw) for raw in HOUSEHOLDS]
    errors: list[str] = []
    mismatches: list[str] = []
    lock = threading.Lock()

    def run(index: int, barrier: threading.Barrier) -> None:
        raw = HOUSEHOLDS[index]
        # Start together so formulas and Simulation setup overlap.
        barrier.wait()
        try:
            data = _series(raw)
        except Exception as exc:  # noqa: BLE001 - every failure is the finding
            with lock:
                errors.append(f"{raw['state']}: {type(exc).__name__}: {exc}")
            return
        if data != serial[index]:
            with lock:
                mismatches.append(raw["state"])

    for _ in range(ROUNDS):
        barrier = threading.Barrier(len(HOUSEHOLDS))
        threads = [
            threading.Thread(target=run, args=(index, barrier))
            for index in range(len(HOUSEHOLDS))
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

    assert not errors, "\n".join(errors)
    assert not mismatches, f"concurrent output differs from serial: {mismatches}"

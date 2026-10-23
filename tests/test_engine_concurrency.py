"""Concurrent calculations in one process must not fail (#38).

Vercel's Fluid compute runs several /api/series invocations in one Python
process at the same time. policyengine-core 3.27 through 3.31 forbade
randomness in formulas by patching ``numpy.random`` process-wide while any
formula ran. A concurrent request that was building its Simulation, which
calls ``np.random.seed(0)``, then raised NonDeterministicFormulaError naming
the other request's formula. policyengine-core 3.32.0 replaced that guard with
a static check when variables are built.
"""

from __future__ import annotations

import threading
from importlib.metadata import version

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


def _version_tuple(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split(".")[:3])


def test_engine_has_no_runtime_randomness_guard() -> None:
    assert _version_tuple(version("policyengine-core")) >= (3, 32, 0)


def test_concurrent_series_calculations_succeed() -> None:
    errors: list[str] = []
    errors_lock = threading.Lock()

    def run(raw: dict, barrier: threading.Barrier, max_earned_income: int) -> None:
        payload = household_input_from_dict(
            {"year": 2026, "programs_mode": "all", **raw}
        )
        # Start together so formulas and Simulation setup overlap.
        barrier.wait()
        try:
            calculate_income_series(
                payload,
                max_earned_income=max_earned_income,
                step=2_500,
            )
        except Exception as exc:  # noqa: BLE001 - every failure is the finding
            with errors_lock:
                errors.append(f"{raw['state']}: {type(exc).__name__}: {exc}")

    for round_index in range(ROUNDS):
        barrier = threading.Barrier(len(HOUSEHOLDS))
        threads = [
            threading.Thread(
                target=run,
                args=(raw, barrier, 20_000 + 2_500 * round_index),
            )
            for raw in HOUSEHOLDS
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

    assert not errors, "\n".join(errors)

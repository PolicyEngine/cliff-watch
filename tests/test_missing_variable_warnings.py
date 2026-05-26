from __future__ import annotations

import warnings
from types import SimpleNamespace

from cliff_watch import calculator


def _simulation_without_variables():
    return SimpleNamespace(
        tax_benefit_system=SimpleNamespace(variables={}),
        calculate=lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("missing variables should not be calculated")
        ),
    )


def test__given_missing_scalar_variable_seen_once__then_warning_emitted_once():
    # Given
    calculator._MISSING_VARIABLE_WARNINGS_EMITTED.clear()
    simulation = _simulation_without_variables()

    # When
    with warnings.catch_warnings(record=True) as first_warnings:
        warnings.simplefilter("always")
        first = calculator._calculate_variable(
            simulation,
            "renamed_benefit",
            2026,
            default=42,
        )

    with warnings.catch_warnings(record=True) as second_warnings:
        warnings.simplefilter("always")
        second = calculator._calculate_variable(
            simulation,
            "renamed_benefit",
            2026,
            default=99,
        )

    with warnings.catch_warnings(record=True) as third_warnings:
        warnings.simplefilter("always")
        third = calculator._calculate_variable(
            simulation,
            "another_missing_benefit",
            2026,
            default=13,
        )

    # Then
    assert first == 42
    assert second == 99
    assert third == 13
    assert len(first_warnings) == 1
    assert "Variable 'renamed_benefit' not in installed policyengine-us release" in str(
        first_warnings[0].message
    )
    assert second_warnings == []
    assert len(third_warnings) == 1
    assert "Variable 'another_missing_benefit' not in installed policyengine-us release" in str(
        third_warnings[0].message
    )


def test__given_missing_array_variable__then_warning_uses_same_once_registry():
    # Given
    calculator._MISSING_VARIABLE_WARNINGS_EMITTED.clear()
    simulation = _simulation_without_variables()

    # When
    with warnings.catch_warnings(record=True) as first_warnings:
        warnings.simplefilter("always")
        first = calculator._calculate_variable_array(
            simulation,
            "renamed_series_benefit",
            2026,
        )

    with warnings.catch_warnings(record=True) as second_warnings:
        warnings.simplefilter("always")
        second = calculator._calculate_variable_array(
            simulation,
            "renamed_series_benefit",
            2026,
        )

    # Then
    assert first == []
    assert second == []
    assert len(first_warnings) == 1
    assert second_warnings == []

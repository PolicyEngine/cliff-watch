"""CliffWatch's bridge to ``calculate_household`` in policyengine.py.

The calculator describes a household as a policyengine-us situation, because
that shape carries the group memberships and the earnings axis, and the payload
invariants check it directly. It then reads results one variable at a time.
This module connects both sides to ``pe.us.calculate_household``:

- ``household_kwargs`` turns a situation into the function's keyword arguments.
- ``run_household`` calls it for a list of variables.
- ``HouseholdCalculation`` answers the calculator's reads from the result.

``tests/test_engine.py`` checks each read against a direct policyengine-us
``Simulation`` of the same situation.
"""

from __future__ import annotations

import warnings
from collections.abc import Iterable, Mapping
from typing import Any

# The default outputs of calculate_household include SPM poverty, which needs a
# geography. CliffWatch reports neither, so the national threshold serves.
SPM_SELECTION = {"geography_kind": "national"}

# Entities that hold every person in one group in every CliffWatch situation,
# so a value on any of them is also the value on the others.
_SINGLE_GROUP_ENTITIES = {
    "families": "family",
    "spm_units": "spm_unit",
    "tax_units": "tax_unit",
    "households": "household",
}

_MEMBERS = "members"


class CalculatorDependencyError(RuntimeError):
    pass


def _annual_value(name: str, values: Any, *, year: int) -> Any:
    """One variable's value for the year, from a situation's period mapping.

    calculate_household takes one value per variable for the whole year, so a
    variable set month by month needs the same value in all twelve months.
    Anything else would change the household without saying so, and raises.
    """
    if not isinstance(values, Mapping):
        raise ValueError(f"{name} must map periods to values; got {values!r}.")
    if set(values) == {year}:
        return values[year]
    months = {f"{year}-{month:02d}" for month in range(1, 13)}
    if set(values) == months and len(set(values.values())) == 1:
        return next(iter(values.values()))
    raise ValueError(
        f"{name} must have one value for {year}, or the same value in each "
        f"of its twelve months; got {values!r}."
    )


def _annual_inputs(spec: Mapping[str, Any], *, year: int) -> dict[str, Any]:
    inputs = {}
    for name, values in spec.items():
        if name == _MEMBERS:
            continue
        value = _annual_value(name, values, year=year)
        # A situation marks an axis variable with None, which sets nothing.
        if value is not None:
            inputs[name] = value
    return inputs


def _marital_units(
    units: Mapping[str, Mapping[str, Any]],
    *,
    person_ids: list[str],
    year: int,
) -> list[dict[str, Any]]:
    """Each marital unit as indexes into people, with everyone in exactly one.

    A situation leaves people out of ``marital_units`` when they belong to no
    couple, and policyengine-core then gives each of them a unit of their own.
    The list form of calculate_household says so explicitly.
    """
    index_of = {person_id: index for index, person_id in enumerate(person_ids)}
    groups = [
        {
            _MEMBERS: [index_of[member] for member in unit[_MEMBERS]],
            **_annual_inputs(unit, year=year),
        }
        for unit in units.values()
    ]
    allocated = {index for group in groups for index in group[_MEMBERS]}
    groups.extend(
        {_MEMBERS: [index]}
        for index in range(len(person_ids))
        if index not in allocated
    )
    return groups


def _single_group(
    plural: str,
    groups: Mapping[str, Mapping[str, Any]],
    *,
    person_ids: list[str],
    year: int,
) -> dict[str, Any]:
    if len(groups) != 1:
        raise ValueError(f"{plural} must hold one group; got {len(groups)}.")
    group = next(iter(groups.values()))
    if list(group[_MEMBERS]) != person_ids:
        raise ValueError(
            f"{plural} must hold everyone in order; got {group[_MEMBERS]!r}."
        )
    return _annual_inputs(group, year=year)


def household_kwargs(situation: Mapping[str, Any], *, year: int) -> dict[str, Any]:
    """Keyword arguments for calculate_household that describe a situation."""
    person_ids = list(situation["people"])
    kwargs: dict[str, Any] = {
        "people": [
            _annual_inputs(person, year=year) for person in situation["people"].values()
        ],
        "marital_unit": _marital_units(
            situation.get("marital_units", {}),
            person_ids=person_ids,
            year=year,
        ),
        "year": year,
    }
    for plural, entity in _SINGLE_GROUP_ENTITIES.items():
        kwargs[entity] = _single_group(
            plural,
            situation[plural],
            person_ids=person_ids,
            year=year,
        )
    if "axes" in situation:
        kwargs["axes"] = situation["axes"]
    return kwargs


def _points(value: Any) -> list[float]:
    """A result value as one number per axis point (one point without axes)."""
    return list(value) if isinstance(value, list) else [value]


class HouseholdCalculation:
    """Reads a ``calculate_household`` result the way the calculator reads a run.

    ``calculate`` follows the layout of ``Simulation.calculate``. A person
    variable comes back person by person within each axis point; mapped to a
    group, it comes back as the sum over people at each point. A group variable
    comes back point by point, and because each of those groups holds everyone,
    the value carries over unchanged to any other such group.
    """

    def __init__(self, result: Any, *, year: int, variables: Mapping[str, Any]):
        self._result = result
        self._year = year
        self.variables = variables

    def calculate(
        self,
        variable: str,
        period: int | None = None,
        map_to: str | None = None,
    ) -> list[float]:
        if period is not None and period != self._year:
            raise ValueError(
                f"{variable}: this calculation covers {self._year}, not {period}."
            )
        if map_to not in {None, "person", *_SINGLE_GROUP_ENTITIES.values()}:
            raise ValueError(f"{variable}: can't map to {map_to!r}.")
        entity = self.variables[variable].entity
        if entity == "person":
            people = [_points(person[variable]) for person in self._result["person"]]
            if map_to in {None, "person"}:
                return [value for point in zip(*people) for value in point]
            return [sum(point) for point in zip(*people)]
        if entity not in _SINGLE_GROUP_ENTITIES.values():
            raise ValueError(f"{variable}: can't read a {entity} variable.")
        if map_to == "person":
            raise ValueError(f"{variable}: can't map a {entity} variable to a person.")
        return _points(self._result[entity][variable])


def _load_policyengine() -> tuple[Any, Any]:
    try:
        # policyengine's model module warns at import about bundle metadata
        # that this app doesn't use; it stays in the logs of the first request
        # on each instance otherwise.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=UserWarning)
            import policyengine as pe
            from policyengine.tax_benefit_models.us.model import us_latest
    except ModuleNotFoundError as exc:
        raise CalculatorDependencyError(
            "PolicyEngine dependencies are not installed. Run `uv sync --extra dev`."
        ) from exc
    return pe, us_latest


def run_household(
    situation: Mapping[str, Any],
    *,
    year: int,
    variables: Iterable[str],
) -> HouseholdCalculation:
    """Calculate a situation with calculate_household.

    ``variables`` lists what the caller will read. A name the installed
    policyengine-us doesn't define stays out of the request, so the calculator's
    missing-variable warning still handles it.
    """
    pe, model = _load_policyengine()
    known = model.variables_by_name
    result = pe.us.calculate_household(
        **household_kwargs(situation, year=year),
        extra_variables=[name for name in variables if name in known],
        spm=SPM_SELECTION,
    )
    return HouseholdCalculation(result, year=year, variables=known)

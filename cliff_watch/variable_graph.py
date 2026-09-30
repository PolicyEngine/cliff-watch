"""PolicyEngine US variable graph around the variables cliff-watch sends.

PolicyEngine US computes some variables as the sum of components (``adds`` and
``subtracts``). An input on such a total replaces the sum: components sent with
it drop out of the total, and every rule that reads a component sees zero. The
payload invariant tests use this graph to check that the situation builders in
``cliff_watch/calculator.py`` and ``frontend/src/policyengineApi.js`` avoid both
failure modes. ``scripts/generate_variable_graph.py`` writes it to
``frontend/src/__fixtures__/policyengine-us-variable-graph.json`` for the
frontend tests.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

# Situation entity group -> PolicyEngine US entity key.
GROUP_ENTITIES = {
    "people": "person",
    "families": "family",
    "marital_units": "marital_unit",
    "tax_units": "tax_unit",
    "spm_units": "spm_unit",
    "households": "household",
}

# Totals the builders set directly on purpose, and why each is safe. Adding a
# mapping to any other total fails the invariant tests until it is reviewed
# here. Keep in sync with REVIEWED_TOTAL_INPUTS in
# frontend/src/policyengineApi.invariants.test.js.
REVIEWED_TOTAL_INPUTS = {
    "employment_income": (
        "policyengine-us's Simulation moves this input onto "
        "employment_income_before_lsr, which rules read."
    ),
    "self_employment_income": (
        "policyengine-us's Simulation moves this input onto "
        "self_employment_income_before_lsr, which rules read."
    ),
}


def _component_names(tax_benefit_system: Any, components: Any) -> list[str]:
    if not components:
        return []
    if isinstance(components, str):
        parameter = tax_benefit_system.parameters.get_child(components)
        names: set[str] = set()
        for entry in parameter.values_list:
            names.update(str(name) for name in entry.value)
        return sorted(names)
    return sorted(str(name) for name in components)


def graph_node(tax_benefit_system: Any, name: str) -> dict[str, Any]:
    """Entity and resolved ``adds``/``subtracts`` components of one variable."""
    variable = tax_benefit_system.variables.get(name)
    if variable is None:
        raise KeyError(f"{name} is not a variable in the installed policyengine-us")
    node: dict[str, Any] = {"entity": variable.entity.key}
    for key in ("adds", "subtracts"):
        names = _component_names(tax_benefit_system, getattr(variable, key))
        # `adds` lists may also name parameters, which enter as constants.
        node[key] = [item for item in names if item in tax_benefit_system.variables]
        parameters = [
            item for item in names if item not in tax_benefit_system.variables
        ]
        if parameters:
            node[f"{key}_parameters"] = parameters
    return node


def build_variable_graph(
    tax_benefit_system: Any, roots: Iterable[str]
) -> dict[str, dict[str, Any]]:
    """Graph nodes for ``roots`` and every transitive component beneath them."""
    nodes: dict[str, dict[str, Any]] = {}
    queue = list(roots)
    while queue:
        name = queue.pop()
        if name in nodes:
            continue
        node = graph_node(tax_benefit_system, name)
        nodes[name] = node
        queue.extend(node["adds"] + node["subtracts"])
    return {name: nodes[name] for name in sorted(nodes)}


def components_of(graph: dict[str, dict[str, Any]], name: str) -> set[str]:
    """Transitive components of ``name`` (empty for a leaf)."""
    found: set[str] = set()
    stack = [name]
    while stack:
        node = graph[stack.pop()]
        for child in node["adds"] + node["subtracts"]:
            if child not in found:
                found.add(child)
                stack.append(child)
    return found


def is_total(graph: dict[str, dict[str, Any]], name: str) -> bool:
    node = graph[name]
    return bool(node["adds"] or node["subtracts"])


def situation_inputs(situation: dict[str, Any]) -> list[tuple[str, str, str]]:
    """``(group, instance, variable)`` for every variable given a value.

    Variables whose periods are all ``None`` are output requests, not inputs.
    """
    inputs = []
    for group, instances in situation.items():
        if group not in GROUP_ENTITIES:
            continue
        for instance, record in instances.items():
            for variable, values in record.items():
                if variable == "members" or values is None:
                    continue
                if isinstance(values, dict) and all(
                    value is None for value in values.values()
                ):
                    continue
                inputs.append((group, instance, variable))
    return inputs


def situation_variables(situation: dict[str, Any]) -> list[tuple[str, str]]:
    """``(group, variable)`` for every variable named in the situation."""
    names = set()
    for group, instances in situation.items():
        if group not in GROUP_ENTITIES:
            continue
        for record in instances.values():
            for variable, values in record.items():
                if variable != "members" and values is not None:
                    names.add((group, variable))
    for axis in (item for axes in situation.get("axes", []) for item in axes):
        names.add(("axes", axis["name"]))
    return sorted(names)

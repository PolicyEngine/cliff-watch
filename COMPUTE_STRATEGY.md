# Compute Strategy

This project starts from the `tanf-calculator` repo shape, but it cannot use the same static-grid approach.

The TANF calculator works because its state space is relatively small:

- state
- county group for a few states
- adults
- children
- earned income
- unearned income

Cliff watch is broader. Even a modest cross-state bundle quickly compounds:

- multiple benefit programs with different income tests and phaseouts
- healthcare programs with person-level eligibility
- tax credits that interact with filing structure
- individually entered household members with different ages and roles
- state-by-state variation across taxes and benefits

Precomputing every household composition, state, and income point for every supported program would either explode the dataset or force the product into a very narrow set of assumptions.

## v1 Recommendation

Use a hybrid runtime model:

1. Keep the repo shape familiar: `frontend/`, `scripts/`, `docs/`, and lightweight deployment config.
2. Serve a static React frontend, but compute household results on demand through API handlers.
3. Cache repeated household, state-comparison, and income-series requests in memory by input signature.
4. Precompute only lightweight metadata: states and the modeled benefit bundle.

## v1 Modeled Bundle

The first pass focuses on formulaic programs that are useful for cliff analysis and broadly supported in PolicyEngine:

- SNAP
- TANF or state equivalent
- WIC
- Free school meals
- Aggregate refundable tax credits
- Aggregate healthcare value

This intentionally avoids pretending scarce or highly administrative programs are guaranteed entitlements in every scenario.

## Output Metric

The app centers on a practical comparison metric:

`net resources = market income + modeled support - taxes before refundable credits`

That gives us a single number to compare:

- across earnings levels in one state
- across states for one household definition

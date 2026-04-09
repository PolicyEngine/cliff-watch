# Benefit Cliff Calculator

This repo is a dynamic benefit cliff calculator for comparing modeled household resources across earnings levels and across states using individually entered household members and ages. It keeps the lightweight repo shape of [`tanf-calculator`](https://github.com/PolicyEngine/tanf-calculator), but swaps the static precompute grid for an on-demand PolicyEngine-backed API.

## What This Repo Does

- compares a selected household across all 50 states and DC
- traces a single household through an earnings curve to surface cliffs
- shows a first-pass modeled bundle of:
  - SNAP
  - TANF or state equivalent
  - WIC
  - free school meals
  - refundable tax credits
  - healthcare value

The v1 metric is:

`net resources = market income + modeled support - taxes before refundable credits`

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite 5, Recharts, react-simple-maps |
| Runtime calculations | Python, [PolicyEngine US](https://github.com/PolicyEngine/policyengine-us) |
| Local API | built-in `http.server` wrapper around shared compute helpers |
| Deploy target | static frontend + serverless-style `api/` handlers |

The important product constraint is that we do **not** precompute every state, income point, and program combination. Instead:

1. the frontend stays static
2. household, state, and series requests are computed on demand
3. repeated requests are cached in memory by input signature
4. only metadata is effectively static

More detail is in [COMPUTE_STRATEGY.md](COMPUTE_STRATEGY.md).

## Repo Layout

- `frontend/`: React app
- `scripts/`: PolicyEngine calculator, local dev API server, and sample payload
- `api/`: serverless-style request handlers that share the same compute layer
- `docs/`: static build output from Vite

## Getting Started

### 1. Python setup

Install the calculator dependency:

```bash
uv pip install -r requirements.txt
```

If you already have a local `policyengine-us` checkout, you can point this repo at it:

```bash
export POLICYENGINE_US_REPO=../policyengine-us
```

### 2. Frontend setup

```bash
cd frontend
npm install
```

### 3. Run locally

Start the local API:

```bash
python3 scripts/dev_api_server.py
```

In a second terminal:

```bash
cd frontend
npm run dev
```

The app will run at `http://localhost:3000/`, with `/api/*` proxied to the local Python server.

## Quick CLI Smoke Test

You can also run the calculator without the frontend:

```bash
python3 scripts/calculator.py scripts/sample_household.json --mode household
python3 scripts/calculator.py scripts/sample_household.json --mode states
python3 scripts/calculator.py scripts/sample_household.json --mode series
```

## Current Scope Notes

- Household inputs are person-based in v1, with each family member entered individually by type and age.
- Earnings are assigned to the first adult and held constant over the year.
- A second adult is treated as a spouse, and later adults are modeled as additional household members in the same household unit.
- County-specific refinements are not exposed in the UI yet.
- The modeled bundle is intentionally narrower than every possible administrative program.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

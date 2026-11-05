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

## Chart views

The cliff chart draws one accounting identity — `net income = earnings + supports − taxes − household costs` — from four angles, controlled by two toggles:

| | Total | By program |
| --- | --- | --- |
| **Net income** | net income line with cliff markers and dead-zone shading | stacked program areas summing to the net income line |
| **Marginal tax rate** | step line of the rate between sampled earnings points | stacked per-program contributions (`−Δprogram / Δearnings`) summing to the total rate |

Because differencing is linear, the marginal tax rate decomposes exactly: each program's phase-out (or phase-in, shown below zero) stacks to the combined rate. The rate axis caps at 100% — cliffs push far past it, and the tooltip reports exact rates. The registry that drives all four views lives in `frontend/src/utils/chartModel.js`.

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
- `cliff_watch/`: installable Python package with the calculator, config, and a local dev API server
- `api/`: serverless-style request handlers that share the same compute layer
- `examples/`: sample payloads for the CLI
- `tests/`: pytest suite
- `docs/`: static build output from Vite

## Getting Started

### 1. Python setup

Install the locked environment Vercel deploys (pulls PolicyEngine-US automatically):

```bash
uv sync --extra dev
```

`pyproject.toml` pins the engine (`policyengine-us`, `policyengine-core`, `spm-calculator`) exactly, with the reason for each pin, and `uv.lock` locks the rest. `GET /api/metadata` reports the deployed versions under `engine`. Bump a pin on purpose: engine releases change displayed numbers, so compare `/api/series` output before and after.

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
cliff-watch-dev-server
```

In a second terminal:

```bash
cd frontend
npm run dev
```

The app will run at `http://localhost:3000/`, with `/api/*` proxied to the local Python server.

## Modal Fallback API

If the public PolicyEngine API has not yet picked up a required
`policyengine-us` fix, deploy the same CliffWatch compute layer to Modal and
point the frontend at it.

First verify the Modal CLI is using the PolicyEngine workspace:

```bash
modal token new --profile policyengine  # only needed the first time
modal profile activate policyengine
modal profile list
```

Then deploy the backend:

```bash
modal deploy modal_app.py --env main
```

The production URL should look like:

```text
https://policyengine--cliff-watch-fastapi-app.modal.run
```

Set the frontend environment variable to that origin and redeploy the frontend:

```bash
vercel env add NEXT_PUBLIC_CLIFF_WATCH_API_ORIGIN production
vercel --prod --force --yes --scope policy-engine
```

With that variable set, browser requests go to the Modal backend's
`/api/metadata`, `/api/calculate`, `/api/series`, and `/api/households` routes.

## County from ZIP

The form asks for a ZIP and no county. The API resolves the county, so the form, share links, direct API calls and the Modal fallback all follow one rule:

1. An explicit `county`, such as a share link's `county=MIDDLESEX_COUNTY_MA`, always wins.
2. Otherwise the household gets the ZIP's first county in its state. A ZIP that spans counties lists the county with the most 2020 Census residents first, and a tie goes to the lower county code.
3. A ZIP code tabulation area (ZCTA) with no residents ranks its counties by land area.
4. A ZIP with no ZCTA of its own, such as a post-office-box ZIP, uses GeoNames' county, or else the first county in its state of the ZCTA the crosswalk gives it.
5. A ZIP with no county in the household's state resolves to nothing. policyengine-us then uses the state's first county alphabetically, and the results page says so.

A series response carries a `location` block saying which county the calculation used and why (`source` is `explicit`, `zip` or `none`). When a ZIP spans counties, the results page shows each county's share of the ZIP's residents and lets the user pick another. The choice goes in the share link, and editing the ZIP clears it. The API also sends the ZIP to policyengine-us, because Los Angeles County's rating area and the small-area rent variables read it.

`scripts/build_zip_county.py` builds `cliff_watch/data/zip_county.json.gz`. It reads the [Census 2020 ZCTA-county relationship file](https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.html), [2020 DHC table P1](https://api.census.gov/data/2020/dec/dhc) at summary level 881, [GeoNames US postal codes](https://www.geonames.org/) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the table keeps each ZIP's county and drops the rest) and the UDS Mapper ZIP-to-ZCTA crosswalk as `policyengine-us-data` stored it. The script's docstring lists the sources, and the table's `meta` block records each downloaded file's hash.

Rebuild the table when `policyengine-us` renames a county; `tests/test_zip_county.py` fails if a code stops being an engine county.

```bash
CENSUS_API_KEY=... uv run python scripts/build_zip_county.py --cache-dir /tmp/zip-county
```

## Quick CLI Smoke Test

You can also run the calculator without the frontend:

```bash
python3 -m cliff_watch.calculator examples/sample_household.json --mode household
python3 -m cliff_watch.calculator examples/sample_household.json --mode states
python3 -m cliff_watch.calculator examples/sample_household.json --mode series
```

## Current Scope Notes

- Household inputs are person-based in v1, with each family member entered individually by type and age.
- Earnings are assigned to the first adult and held constant over the year.
- A second adult is treated as a spouse, and later adults are modeled as additional household members in the same household unit.
- The form has no county field. The API resolves the county from the ZIP, as [County from ZIP](#county-from-zip) describes.
- The modeled bundle is intentionally narrower than every possible administrative program.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

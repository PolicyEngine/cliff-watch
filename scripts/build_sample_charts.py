"""Build sample earnings curves and their exact model runs around cliffs.

From the repo root, install frontend dependencies with bun and run
`uv run python -m scripts.build_sample_charts`. Each state is written
atomically after its primary curves and again after its refinement windows.
Re-running reuses completed work at the current simulator revision. Use
--refine-only with existing primary bundles or --check to verify coverage.
"""

import argparse
import base64
import gzip
import json
import math
import os
import subprocess
from pathlib import Path
from tempfile import NamedTemporaryFile

from api._shared import (
    _series_cached,
    compute_series_request,
    metadata_response,
    parse_household_payload,
)
from cliff_watch.calculator import _series_axis

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def compact_json(obj):
    return json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def encode_chart(series):
    # Compress each chart separately for selective decoding in the browser.
    raw = gzip.compress(compact_json(series).encode(), compresslevel=9, mtime=0)
    return base64.b64encode(raw).decode("ascii")


def decode_chart(encoded):
    return json.loads(gzip.decompress(base64.b64decode(encoded, validate=True)))


def write_bundle(path, bundle):
    with NamedTemporaryFile(
        "w", dir=path.parent, prefix=f".{path.stem}-", suffix=".tmp", delete=False
    ) as tmp:
        try:
            tmp.write(compact_json(bundle) + "\n")
            tmp.close()
            os.chmod(tmp.name, 0o644)
            os.replace(tmp.name, path)
        finally:
            Path(tmp.name).unlink(missing_ok=True)


def browser_requests(data, *options):
    result = subprocess.run(
        ["bun", "scripts/sampleChartRequests.mjs", *options],
        input=compact_json(data),
        stdout=subprocess.PIPE,
        text=True,
        cwd=FRONTEND,
        check=True,
    )
    return json.loads(result.stdout)


def run_series(payload):
    try:
        series = compute_series_request(payload)
        if (
            not series["data"]
            or series["point_count"] != len(series["data"])
            or series["truncated"]
        ):
            raise ValueError("Simulator returned an incomplete series")
        return series
    finally:
        _series_cached.cache_clear()


def complete_window(points, payload, fixed_wages):
    if not isinstance(points, list):
        return False
    lower, upper, count = _series_axis(
        parse_household_payload(payload),
        payload["min_earned_income"],
        payload["max_earned_income"],
        payload["step"],
    )
    if len(points) != count:
        return False
    for index, point in enumerate(points):
        expected = fixed_wages + lower + index * (upper - lower) / (count - 1)
        # Model output uses float32 and the API reports wages rounded to cents.
        if not isinstance(point, dict) or not (
            isinstance(point.get("net_resources"), (int, float))
            and math.isfinite(point["net_resources"])
            and isinstance(point.get("earned_income"), (int, float))
            and math.isclose(
                point["earned_income"], expected, rel_tol=2**-23, abs_tol=0.02
            )
        ):
            return False
    return True


def refine_bundle(metadata, state, bundle, *, check=False):
    """Fill or verify exact browser-selected windows, preserving primary results."""
    charts = bundle["charts"]
    plans = browser_requests(
        {"metadata": metadata, "state": state, "charts": charts}, "--windows"
    )[state]
    if charts.keys() != plans.keys():
        raise ValueError(f"{state}: primary payloads differ from the sample catalog")
    modified = False
    count = 0
    for digest, plan in plans.items():
        primary = decode_chart(charts[digest])
        saved = primary.get("sample_refinements")
        count += len(plan)
        existing = saved if isinstance(saved, dict) else {}
        fixed_wages = primary["data"][0]["earned_income"]
        ready = {
            key
            for key, window in plan.items()
            if window["valid"]
            and complete_window(existing.get(key), window["payload"], fixed_wages)
        }
        if isinstance(saved, dict) and ready == saved.keys() == plan.keys():
            continue
        if check:
            raise ValueError(f"{state}/{digest}: incomplete or outdated cliff windows")
        primary["sample_refinements"] = {
            key: existing[key]
            if key in ready
            else run_series(window["payload"])["data"]
            for key, window in plan.items()
        }
        charts[digest] = encode_chart(primary)
        modified = True
    return count, modified


def generate(output: Path, check=False, refine_only=False):
    metadata = metadata_response()
    revision = metadata.get("series_revision")
    if not revision:
        raise ValueError("Sample charts require the pinned simulator with a revision")
    by_state = browser_requests(metadata)
    if check:
        expected = {f"{state}.json" for state in by_state}
        if {path.name for path in output.glob("*.json")} != expected:
            raise ValueError("State bundle inventory differs from the sample catalog")
    else:
        output.mkdir(parents=True, exist_ok=True)
    for state, requests in sorted(by_state.items()):
        path = output / f"{state}.json"
        bundle = json.loads(path.read_bytes()) if path.exists() else {}
        if (
            bundle.get("revision") != revision
            or requests.keys() != bundle.get("charts", {}).keys()
        ):
            if check or refine_only:
                raise ValueError(
                    f"{state}: outdated revision or missing primary payload"
                )
            charts = {
                digest: encode_chart(run_series(payload))
                for digest, payload in sorted(requests.items())
            }
            bundle = {"revision": revision, "charts": charts}
            write_bundle(path, bundle)
        count, modified = refine_bundle(metadata, state, bundle, check=check)
        if modified:
            write_bundle(path, bundle)
        print(f"{state}: {len(requests)} charts, {count} cliff windows", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=FRONTEND / "public/sample-charts"
    )
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--refine-only", action="store_true")
    args = parser.parse_args()
    generate(args.output, args.check, args.refine_only)

"""Build the primary chart for every default sample, one warm simulation at a time.

Install frontend dependencies with bun and run from the repo root with
`uv run python -m scripts.build_sample_charts`. Each state file is published
atomically. Re-running skips complete states at the current simulator revision.
Pass --check to verify coverage against the installed wizard and simulator.
"""

import argparse
import base64
import gzip
import json
import os
import subprocess
from pathlib import Path
from tempfile import NamedTemporaryFile

from api._shared import (
    _series_cached,
    compute_series_request,
    metadata_response,
)

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def compact_json(obj):
    return json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def generate(output: Path, check: bool = False):
    metadata = metadata_response()
    revision = metadata["series_revision"]
    result = subprocess.run(
        ["bun", "scripts/sampleChartRequests.mjs"],
        input=compact_json(metadata),
        stdout=subprocess.PIPE,
        text=True,
        cwd=FRONTEND,
        check=True,
    )
    by_state = json.loads(result.stdout)
    if check:
        expected = {f"{state}.json" for state in by_state}
        if {path.name for path in output.glob("*.json")} != expected:
            raise ValueError("State bundle inventory differs from the sample catalog")
    else:
        output.mkdir(parents=True, exist_ok=True)
    for state, requests in sorted(by_state.items()):
        path = output / f"{state}.json"
        if path.exists():
            existing = json.loads(path.read_text())
            if (
                existing.get("revision") == revision
                and requests.keys() == existing.get("charts", {}).keys()
            ):
                print(f"{state}: {len(requests)} current charts", flush=True)
                continue
        if check:
            raise ValueError(f"{state}: outdated revision or missing sample payload")

        charts = {}
        for digest, payload in sorted(requests.items()):
            series = compute_series_request(payload)
            if not series["data"] or series["point_count"] != len(series["data"]):
                raise ValueError(f"Incomplete series for {state}/{digest}")
            # Gzip wraps each chart separately so the browser inflates only the
            # requested curve. mtime=0 keeps repeated builds deterministic.
            body = gzip.compress(
                compact_json(series).encode(), compresslevel=9, mtime=0
            )
            charts[digest] = base64.b64encode(body).decode("ascii")
            _series_cached.cache_clear()

        with NamedTemporaryFile(
            "w", dir=output, prefix=f".{state}-", suffix=".tmp", delete=False
        ) as tmp:
            try:
                tmp.write(compact_json({"revision": revision, "charts": charts}) + "\n")
                tmp.close()
                os.replace(tmp.name, path)
            finally:
                Path(tmp.name).unlink(missing_ok=True)
        print(f"{state}: wrote {len(charts)} charts", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=FRONTEND / "public/sample-charts"
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generate(args.output, args.check)

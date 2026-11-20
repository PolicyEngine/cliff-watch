"""The static sample results cover all modeled states at the current revision."""

import base64
import gzip
import json
from pathlib import Path

import pytest

from api._shared import metadata_response
from cliff_watch.zip_county import describe_location


def test_shipped_sample_charts_use_current_model_and_complete_default_grid(monkeypatch):
    monkeypatch.delenv("POLICYENGINE_US_REPO", raising=False)
    root = Path(__file__).resolve().parents[1] / "frontend/public/sample-charts"
    metadata = metadata_response()
    states = {entry["code"] for entry in metadata["states"]}
    assert {path.stem for path in root.glob("*.json")} == states
    maximum = metadata["defaults"]["chart_max_earned_income"]
    step = metadata["defaults"]["series_step"]
    axis = list(range(0, maximum + 1, step))
    has_other_earners = False

    for state in sorted(states):
        bundle = json.loads((root / f"{state}.json").read_bytes())
        assert bundle["revision"] == metadata["series_revision"], (
            "Regenerate sample charts with uv run python -m scripts.build_sample_charts"
        )
        assert bundle["charts"]
        for digest, encoded in bundle["charts"].items():
            assert len(bytes.fromhex(digest)) == 32
            chart = json.loads(
                gzip.decompress(base64.b64decode(encoded, validate=True))
            )
            earnings = [point["earned_income"] for point in chart["data"]]
            assert chart["point_count"] == len(earnings) == len(axis)
            assert chart["requested_step_annual"] == step
            assert chart["step_annual"] == max(p["step_annual"] for p in chart["data"])
            assert chart["requested_max_earned_income"] == maximum
            assert chart["max_earned_income"] == earnings[-1]
            assert not chart["truncated"]
            # The grid varies one adult's earnings. Other earners shift the
            # household's horizontal axis by their fixed wages.
            assert earnings[0] >= 0
            has_other_earners |= earnings[0] > 0
            for wage, increment in zip(earnings, axis):
                assert wage == pytest.approx(earnings[0] + increment, rel=0, abs=0.02)
            location = chart["location"]
            assert location["source"] == "zip"
            assert location == describe_location(location["zip"], state)
    assert has_other_earners

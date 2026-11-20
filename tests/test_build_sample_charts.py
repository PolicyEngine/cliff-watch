import json
import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from cliff_watch.config import DEFAULT_SERIES_TARGET_POINTS
from scripts import build_sample_charts as charts


def bounded_payload(lower, upper, step):
    return {
        "state": "GA",
        "people": [{"kind": "adult", "age": 40}],
        "year": 2026,
        "min_earned_income": lower,
        "max_earned_income": upper,
        "step": step,
    }


@settings(max_examples=45)
@given(
    lower=st.integers(0, 90000),
    width=st.integers(1, 10000),
    step=st.integers(1, 500),
    fixed=st.integers(0, 500000),
)
def test_window_grid_has_every_requested_earnings_point(lower, width, step, fixed):
    payload = bounded_payload(lower, lower + width, step)
    count = min(DEFAULT_SERIES_TARGET_POINTS, 1 + math.ceil(width / step))
    points = [
        {
            "earned_income": round(fixed + lower + width * i / (count - 1), 2),
            "net_resources": 0,
        }
        for i in range(count)
    ]
    assert charts.complete_window(points, payload, fixed)
    assert not charts.complete_window(points[:-1], payload, fixed)
    assert not charts.complete_window(points, payload, fixed + 1)
    points[0]["net_resources"] = math.nan
    assert not charts.complete_window(points, payload, fixed)


def test_offline_windows_resume_without_changing_primary_results(monkeypatch):
    # A stubbed model isolates exact request routing and interrupted-build recovery.
    payload = bounded_payload(0, 200, 100)
    key = "0:200:100"
    primary = {"data": [{"earned_income": 1000, "net_resources": 1000}]}
    original = charts.encode_chart(primary)
    bundle = {"revision": "test", "charts": {"profile": original}}
    points = [{"earned_income": 1000 + i, "net_resources": i} for i in (0, 100, 200)]
    calls = []

    def requests(data, mode):
        assert mode == "--windows"
        cached = charts.decode_chart(data["charts"]["profile"]).get(
            "sample_refinements", {}
        )
        return {"GA": {"profile": {key: {"payload": payload, "valid": key in cached}}}}

    def calculate(request):
        calls.append(request)
        return {"data": points}

    monkeypatch.setattr(charts, "browser_requests", requests)
    monkeypatch.setattr(charts, "run_series", calculate)
    with pytest.raises(ValueError, match="incomplete"):
        charts.refine_bundle({}, "GA", bundle, check=True)
    assert bundle["charts"]["profile"] == original
    assert charts.refine_bundle({}, "GA", bundle) == (1, True)
    assert calls == [payload]
    complete = bundle["charts"]["profile"]
    assert charts.decode_chart(complete) == {
        **primary,
        "sample_refinements": {key: points},
    }
    assert charts.refine_bundle({}, "GA", bundle, check=True) == (1, False)
    assert charts.refine_bundle({}, "GA", bundle) == (1, False)
    assert bundle["charts"]["profile"] == complete
    assert calls == [payload]

    partial = charts.decode_chart(complete)
    partial["sample_refinements"][key].pop(1)
    bundle["charts"]["profile"] = charts.encode_chart(partial)
    with pytest.raises(ValueError, match="incomplete"):
        charts.refine_bundle({}, "GA", bundle, check=True)
    assert charts.refine_bundle({}, "GA", bundle) == (1, True)
    assert bundle["charts"]["profile"] == complete
    assert calls == [payload, payload]


def test_catalog_changes_reuse_only_exact_requests_at_the_same_revision(
    monkeypatch, tmp_path
):
    requests = {"same": {"age": 40}, "new": {"age": 41}}
    metadata = {"series_revision": "v1"}
    path = tmp_path / "GA.json"
    saved = charts.encode_chart({"data": [], "sample_refinements": {"saved": []}})
    charts.write_bundle(
        path, {"revision": "v1", "charts": {"same": saved, "gone": saved}}
    )
    calls = []

    def calculate(payload):
        calls.append(payload)
        return {"data": [payload]}

    monkeypatch.setattr(charts, "metadata_response", lambda: metadata)
    monkeypatch.setattr(charts, "browser_requests", lambda data: {"GA": requests})
    monkeypatch.setattr(charts, "refine_bundle", lambda *args, **kwargs: (0, False))
    monkeypatch.setattr(charts, "run_series", calculate)
    charts.generate(tmp_path)
    result = json.loads(path.read_bytes())
    assert calls == [requests["new"]]
    assert result["charts"].keys() == requests.keys()
    assert result["charts"]["same"] == saved

    metadata["series_revision"] = "v2"
    calls.clear()
    charts.generate(tmp_path)
    assert calls == [requests["new"], requests["same"]]
    result = json.loads(path.read_bytes())
    assert result["revision"] == "v2"
    assert result["charts"]["same"] != saved

"""The command-line entry point in cliff_watch.calculator."""

from __future__ import annotations

import io
import json
import sys

from cliff_watch import calculator
from cliff_watch.calculator import household_input_from_dict

PAYLOAD = {
    "state": "CA",
    "earned_income": 20_000,
    "people": [{"kind": "adult", "age": 30}],
}


def test_reads_a_payload_from_stdin(monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(PAYLOAD)))

    assert calculator._load_input("-") == household_input_from_dict(PAYLOAD)


def test_reads_a_payload_from_a_file(tmp_path):
    path = tmp_path / "household.json"
    path.write_text(json.dumps(PAYLOAD))

    assert calculator._load_input(str(path)) == household_input_from_dict(PAYLOAD)

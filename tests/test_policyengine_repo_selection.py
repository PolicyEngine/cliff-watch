from cliff_watch.calculator import _candidate_policyengine_repo


def test_chart_identity_checks_the_installed_model(tmp_path, monkeypatch):
    import base64
    import hashlib
    from importlib.metadata import PathDistribution

    from api import _shared

    metadata = tmp_path / "demo-1.0.dist-info"
    metadata.mkdir()
    source = tmp_path / "demo" / "formula.py"
    source.parent.mkdir()
    source.write_bytes(b"original formula")
    monkeypatch.setattr(_shared, "distribution", lambda name: PathDistribution(metadata))
    monkeypatch.delenv("VERCEL", raising=False)

    def record():
        digest = base64.urlsafe_b64encode(hashlib.sha256(source.read_bytes()).digest())
        (metadata / "RECORD").write_text(
            f"demo/formula.py,sha256={digest.rstrip(b'=').decode()},{source.stat().st_size}\n"
        )

    assert _shared._engine_record("demo") is None
    record()
    official = _shared._engine_record("demo")
    assert official
    source.write_bytes(b"patched formula")
    assert _shared._engine_record("demo") is None
    record()
    assert _shared._engine_record("demo") != official
    (metadata / "direct_url.json").write_text('{"dir_info":{"editable":true}}')
    assert _shared._engine_record("demo") is None


def test_custom_engine_checkout_disables_saved_sample_charts(monkeypatch):
    from api._shared import metadata_response

    monkeypatch.setenv("POLICYENGINE_US_REPO", "/my/engine")
    assert metadata_response()["series_revision"] is None


def test_candidate_policyengine_repo_requires_explicit_env_var(
    monkeypatch,
) -> None:
    monkeypatch.delenv("POLICYENGINE_US_REPO", raising=False)

    assert _candidate_policyengine_repo() is None

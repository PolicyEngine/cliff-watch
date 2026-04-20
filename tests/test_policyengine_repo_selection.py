from cliff_watch.calculator import _candidate_policyengine_repo


def test_candidate_policyengine_repo_requires_explicit_env_var(
    monkeypatch,
) -> None:
    monkeypatch.delenv("POLICYENGINE_US_REPO", raising=False)

    assert _candidate_policyengine_repo() is None

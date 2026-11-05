"""Keep the function inside Vercel's bundle, and keep any cold-start install safe.

Vercel's Python runtime ships a function's dependencies in its zip while the function
totals 225 MiB or less, and no install runs. Past that, it installs the public
packages into /tmp when an instance starts, before any of this app's code runs. An
install that stops partway leaves its files behind, so the retry needs room for a
whole install on top of them. When it lacks that room, every request on the instance
fails with "No space left on device" until the platform replaces the instance. The
README's "Cold-start install" section explains the limits, and the PR that added this
file holds the measurements.

Invariants, for the locked dependency set:

- The function fits the bundle, so no install runs at cold start.
- The trimmed packages stay out of the function.
- Packages with a URL source would stay in the zip if an install came back.
- A complete install, if one came back, fits on top of the leftovers of a stopped one.
- This walk over uv.lock agrees with uv on what the function contains.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tomllib
from importlib import metadata
from pathlib import Path

import pytest
from packaging.markers import Marker
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

REPO = Path(__file__).resolve().parents[1]
MIB = 1024 * 1024

# LAMBDA_SIZE_THRESHOLD_BYTES in the Python builder: past this, cold starts install.
BUNDLE_LIMIT_MIB = 225.0
# What the builder counts besides these packages' files and the repo's tracked files,
# chiefly the built frontend. One comparison on 5 November 2026 set this: 188.74 MiB in
# the builder's debug log, for 186.2 MiB of packages and 0.94 MiB of tracked files as
# this module sizes them.
BUILDER_EXTRA_MIB = 1.6
# The builder counted a file under this package twice on a preview on 5 November 2026:
# 31.5 MiB of padding raised its count by 62.98 MiB.
COUNTED_TWICE = "cliff_watch"
# predefinedExcludes in the builder's sweep of the repo. A large committed file outside
# these counts toward the bundle.
SWEEP_SKIPS_DIRECTORIES = {
    ".mypy_cache",
    ".next",
    ".nuxt",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "node_modules",
    "public",
    "venv",
}
SWEEP_SKIPS_FILES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock"}

# Below these, the size walk has lost files: RECORD files missing, or paths that no
# longer resolve. If a real trim gets there, lower them.
SMALLEST_BELIEVABLE_FUNCTION_MIB = 150.0
SMALLEST_BELIEVABLE_INSTALL_MIB = 130.0

# Measured on preview deployments on 5 November 2026 with statvfs, whose figures
# count 4 KiB blocks on an ext4 /tmp. The builder budgets apparent bytes, which
# understate this: many small files each round up to a whole block.
TMP_USABLE_MIB = 513.4
TMP_BLOCK_BYTES = 4096
# How far an install's peak exceeds its final size: 4.6 MiB and 9.0 MiB measured on
# similar trimmed sets, so this errs on the safe side.
INSTALL_PEAK_OVERHEAD_MIB = 9.0

TRIMMED = {
    "blosc2",
    "hf-xet",
    "jedi",
    "msgpack",
    "ndindex",
    "parso",
    "plotly",
    "tables",
}
IN_THE_ZIP = {"policyengine-us"}

LINUX = {
    "implementation_name": "cpython",
    "implementation_version": "3.12.0",
    "os_name": "posix",
    "platform_machine": "x86_64",
    "platform_python_implementation": "CPython",
    "platform_release": "",
    "platform_system": "Linux",
    "platform_version": "",
    "python_full_version": "3.12.0",
    "python_version": "3.12",
    "sys_platform": "linux",
}


def _lock_rows() -> list[dict]:
    return tomllib.loads((REPO / "uv.lock").read_text())["package"]


def _runtime_rows() -> dict[str, dict]:
    """Every package the deployed function needs, by name, for Linux on 3.12."""
    rows = _lock_rows()
    by_name: dict[str, list[dict]] = {}
    for row in rows:
        by_name.setdefault(row["name"], []).append(row)

    def select(edge: dict) -> dict:
        candidates = by_name[edge["name"]]
        if len(candidates) == 1:
            return candidates[0]
        for candidate in candidates:
            if candidate["version"] == edge.get("version"):
                return candidate
        raise AssertionError(f"no lock row matches {edge}")

    found: dict[str, dict] = {}
    seen: set[tuple[str, str | None]] = set()
    pending: list[tuple[dict, str | None]] = [(by_name["cliff-watch"][0], None)]
    while pending:
        row, extra = pending.pop()
        if (row["name"], extra) in seen:
            continue
        seen.add((row["name"], extra))
        found[row["name"]] = row
        edges = (
            row.get("dependencies", [])
            if extra is None
            else row.get("optional-dependencies", {}).get(extra, [])
        )
        for edge in edges:
            marker = edge.get("marker")
            if marker and not Marker(marker).evaluate(LINUX):
                continue
            target = select(edge)
            pending.append((target, None))
            for wanted in edge.get("extra", []):
                pending.append((target, wanted))
    return found


def _public_names(rows: dict[str, dict]) -> set[str]:
    return {name for name, row in rows.items() if "registry" in row["source"]}


def test_trimmed_packages_stay_out_of_the_function():
    assert not TRIMMED & set(_runtime_rows())


def test_url_sourced_packages_stay_in_the_zip():
    rows = _runtime_rows()
    for name in IN_THE_ZIP:
        assert "registry" not in rows[name]["source"], name


@pytest.mark.skipif(shutil.which("uv") is None, reason="uv is not installed")
def test_the_lock_walk_agrees_with_uv():
    exported = subprocess.run(
        [
            "uv",
            "export",
            "--frozen",
            "--no-dev",
            "--no-hashes",
            "--no-header",
            "--no-annotate",
            "--no-emit-project",
        ],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    from_uv = set()
    for line in exported.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        requirement = Requirement(line.strip())
        if requirement.marker is None or requirement.marker.evaluate(LINUX):
            from_uv.add(canonicalize_name(requirement.name))
    assert {canonicalize_name(name) for name in _runtime_rows()} - {
        "cliff-watch"
    } == from_uv


def _blocks(size: int) -> int:
    return (size + TMP_BLOCK_BYTES - 1) // TMP_BLOCK_BYTES * TMP_BLOCK_BYTES


def _installed_files(names: set[str], path: list[str] | None = None):
    """Each file these packages install, bytecode aside: (package root, path, size)."""
    for name in names:
        distribution = next(
            iter(metadata.distributions(name=name, path=path or sys.path))
        )
        root = str(distribution.locate_file(""))
        for file in distribution.files or []:
            if file.suffix == ".pyc":
                continue
            full = os.path.normpath(str(distribution.locate_file(file)))
            try:
                yield root, full, os.lstat(full).st_size
            except FileNotFoundError:
                continue


def install_bytes(names: set[str], path: list[str] | None = None) -> int:
    """What these packages occupy once installed: file blocks plus directory blocks."""
    total = 0
    directories: set[str] = set()
    for root, full, size in _installed_files(names, path):
        total += _blocks(size)
        parent = os.path.dirname(full)
        while parent.startswith(root) and parent != root.rstrip(os.sep):
            directories.add(parent)
            parent = os.path.dirname(parent)
    return total + len(directories) * TMP_BLOCK_BYTES


def bundle_bytes(names: set[str], path: list[str] | None = None) -> int:
    """What the builder counts for these packages: their files' apparent sizes."""
    return sum(size for _, _, size in _installed_files(names, path))


def repo_bytes() -> int:
    """What the builder sweeps from the repo: tracked files outside its exclude list."""
    tracked = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    total = 0
    for path in filter(None, tracked.split("\0")):
        parts = path.split("/")
        if (
            SWEEP_SKIPS_DIRECTORIES.isdisjoint(parts[:-1])
            and parts[-1] not in SWEEP_SKIPS_FILES
        ):
            copies = 2 if parts[0] == COUNTED_TWICE else 1
            total += copies * (REPO / path).lstat().st_size
    return total


def function_mib() -> float:
    """What the builder counts for the function, by this module's sizing."""
    packages = bundle_bytes(set(_runtime_rows()) - {"cliff-watch"})
    return (packages + repo_bytes()) / MIB + BUILDER_EXTRA_MIB


def _report(line: str) -> None:
    """Show a measured figure in the CI job's summary, since passing tests print nothing."""
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as handle:
            handle.write(f"{line}\n\n")


# Mac wheels differ from the Linux wheels Vercel installs, so these numbers only mean
# anything on Linux; CI runs them on the same manylinux wheels.
@pytest.mark.skipif(sys.platform != "linux", reason="needs the Linux wheels")
def test_the_function_fits_the_bundle_so_no_install_runs():
    total_mib = function_mib()
    _report(
        f"Function: about {total_mib:.1f} MiB of the {BUNDLE_LIMIT_MIB} MiB bundle."
    )
    assert total_mib > SMALLEST_BELIEVABLE_FUNCTION_MIB, (
        f"the size walk found only {total_mib:.1f} MiB, so it has probably lost files"
    )
    assert total_mib <= BUNDLE_LIMIT_MIB, (
        f"the function totals about {total_mib:.1f} MiB, past the {BUNDLE_LIMIT_MIB} MiB "
        "Vercel bundles, so cold starts would install dependencies into /tmp again; trim "
        'a package, or accept the install and update "Cold-start install" in the README'
    )


@pytest.mark.skipif(sys.platform != "linux", reason="needs the Linux wheels")
def test_a_complete_install_fits_on_top_of_a_stopped_one():
    final_mib = install_bytes(_public_names(_runtime_rows())) / MIB
    peak_mib = final_mib + INSTALL_PEAK_OVERHEAD_MIB
    _report(
        f"Install, if one came back: about {final_mib:.1f} MiB in blocks, peak "
        f"{peak_mib:.1f} MiB, with {TMP_USABLE_MIB} MiB usable in /tmp."
    )
    assert final_mib > SMALLEST_BELIEVABLE_INSTALL_MIB, (
        f"the size walk found only {final_mib:.1f} MiB, so it has probably lost files"
    )
    assert 2 * peak_mib <= TMP_USABLE_MIB, (
        f"the install occupies {final_mib:.1f} MiB and peaks at {peak_mib:.1f} MiB, "
        f"so a retry on a stopped install's leftovers needs {2 * peak_mib:.1f} MiB of "
        f"{TMP_USABLE_MIB} MiB; trim a package or give one a URL source"
    )

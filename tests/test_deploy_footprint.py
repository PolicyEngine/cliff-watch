"""The cold-start install has to fit in /tmp twice.

Vercel's Python runtime installs a large function's public packages into /tmp when
an instance starts, before any of this app's code runs. An install that stops
partway leaves its files behind, so the retry needs room for a whole install on
top of them. When it lacks that room, every request on the instance fails with "No
space left on device" until the platform replaces the instance. The README's
"Cold-start install" section explains the limits, and cliff-watch#45 holds the
measurements.

Invariants, for the locked dependency set:

- The trimmed packages stay out of the runtime install.
- Packages with a URL source stay in the function's zip rather than the install.
- A complete install fits on top of the leftovers of a stopped one.
- This walk over uv.lock agrees with uv on what the install contains.
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

# Measured on preview deployments on 5 November 2026 with statvfs, whose figures
# count 4 KiB blocks on an ext4 /tmp. The builder budgets apparent bytes, which
# understate this: many small files each round up to a whole block.
TMP_USABLE_MIB = 513.4
TMP_BLOCK_BYTES = 4096
# How far an install's peak exceeds its final size: 4.6 MiB measured on this package
# set and 9.0 on a larger trimmed set, so this errs on the safe side.
INSTALL_PEAK_OVERHEAD_MIB = 9.0

TRIMMED = {"blosc2", "hf-xet", "jedi", "msgpack", "ndindex", "parso", "plotly", "tables"}
IN_THE_ZIP = {"policyengine", "policyengine-us"}

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


def test_trimmed_packages_stay_out_of_the_runtime_install():
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
    assert {canonicalize_name(name) for name in _runtime_rows()} - {"cliff-watch"} == from_uv


def _blocks(size: int) -> int:
    return (size + TMP_BLOCK_BYTES - 1) // TMP_BLOCK_BYTES * TMP_BLOCK_BYTES


def install_bytes(names: set[str], path: list[str] | None = None) -> int:
    """What these packages occupy once installed: file blocks plus directory blocks."""
    total = 0
    directories: set[str] = set()
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
                total += _blocks(os.lstat(full).st_size)
            except FileNotFoundError:
                continue
            parent = os.path.dirname(full)
            while parent.startswith(root) and parent != root.rstrip(os.sep):
                directories.add(parent)
                parent = os.path.dirname(parent)
    return total + len(directories) * TMP_BLOCK_BYTES


# Mac wheels differ from the Linux wheels Vercel installs, so the number only means
# anything on Linux; CI runs this on the same manylinux wheels.
@pytest.mark.skipif(sys.platform != "linux", reason="needs the Linux wheels")
def test_a_complete_install_fits_on_top_of_a_stopped_one():
    final_mib = install_bytes(_public_names(_runtime_rows())) / MIB
    peak_mib = final_mib + INSTALL_PEAK_OVERHEAD_MIB
    assert 2 * peak_mib <= TMP_USABLE_MIB, (
        f"the install occupies {final_mib:.1f} MiB and peaks at {peak_mib:.1f} MiB, "
        f"so a retry on a stopped install's leftovers needs {2 * peak_mib:.1f} MiB of "
        f"{TMP_USABLE_MIB} MiB; trim a package or give one a URL source"
    )

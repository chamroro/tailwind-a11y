"""Everything needed to say what produced a result. Written once, as the first record of a run file.

A number without this is a claim nobody can check: Bedrock has no seed, so "the same number again" is
not something this harness can promise. What it can promise is that the stored raw outputs can be
re-scored deterministically, and that a re-run can be compared on distributions, which needs the
model, tool versions, prompts and task files to be on record.
"""
from __future__ import annotations

import hashlib
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any

from . import arms as arms_mod
from . import tasks as tasks_mod
from .scoring import REPO_ROOT, run_shim

SCHEMA_VERSION = 1


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def _sha256(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def _node_version() -> str | None:
    try:
        return subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=20).stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


def collect(*, agent_description: dict[str, Any], arms: list[str], split: str, k: int, seed: int,
            limits: dict[str, Any], pricing: dict[str, float] | None) -> dict[str, Any]:
    # Scoring a trivial snippet records the engine version the scorer actually used.
    probe = run_shim("export const x = <p />;")
    status = _git("status", "--porcelain")
    return {
        "kind": "meta",
        "schema_version": SCHEMA_VERSION,
        "agent": agent_description,
        "split": split,
        "arms": arms,
        "k": k,
        "seed": seed,
        "limits": limits,
        "pricing_usd_per_mtok": pricing,
        "engine_version": probe.engine_version,
        "scoring": "analyzeSource called directly (not through the MCP server); default Tailwind palette and spacing, no project config",
        "arm_digests": {a: arms_mod.ARM_SPECS[arms_mod.Arm(a)].digest() for a in arms},
        "task_file_sha256": tasks_mod.file_hash(split),
        "harness_git_sha": _git("rev-parse", "HEAD"),
        "harness_dirty": bool(status) if status is not None else None,
        "package_lock_sha256": _sha256(REPO_ROOT / "package-lock.json"),
        "node": _node_version(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
    }

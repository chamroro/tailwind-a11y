"""Scores a piece of code with the engine, and classifies the outcome.

The engine is run by node/inspect.mjs rather than through the MCP server: the
server cuts its response at 200 violations (so counts here would be capped) and
adds a protocol layer that has nothing to do with what is being measured. It is
the same analyzeSource the server wraps.

What is reported is deliberately NOT one number. For each code sample:
  * `violations`           what the engine found (a lower bound on what is wrong);
  * `skipped`              what it said it could not read (so the true count may be higher);
  * `bypass`               measures taken from the syntax tree, independent of the engine, because
                           the engine is silent about several ways of avoiding it.
The engine cannot report how many elements it actually examined, so a rate per
examined element is not available and no such figure is produced.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .models import RunStatus, Task

REPO_ROOT = Path(__file__).resolve().parents[2]
SHIM = REPO_ROOT / "evals" / "node" / "inspect.mjs"


class ScorerError(RuntimeError):
    """The scoring step itself failed. Never to be read as 'no violations'."""


@dataclass
class EngineResult:
    parsed: bool
    violations: list[dict[str, Any]] = field(default_factory=list)
    skips: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None

    @property
    def violation_count(self) -> int:
        return len(self.violations)

    @property
    def unique_types(self) -> int:
        return len({v["key"] for v in self.violations})

    @property
    def skipped_count(self) -> int:
        return len(self.skips)

    def by_type(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for v in self.violations:
            out[v["type"]] = out.get(v["type"], 0) + 1
        return out


@dataclass
class ShimResult:
    engine_version: str
    aa: EngineResult
    strict: EngineResult
    bypass: dict[str, Any]


def run_shim(code: str, file: str = "snippet.tsx", node: str = "node", timeout: float = 60.0) -> ShimResult:
    """Runs the engine and the syntax-tree measures. Raises ScorerError on any failure of the step itself."""
    try:
        proc = subprocess.run(
            [node, str(SHIM)],
            input=json.dumps({"code": code, "file": file}),
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(REPO_ROOT),
        )
    except (OSError, subprocess.TimeoutExpired) as err:
        raise ScorerError(f"could not run the scoring shim: {err}") from err
    if proc.returncode != 0:
        raise ScorerError(f"scoring shim exited {proc.returncode}: {proc.stderr.strip()[-400:]}")
    try:
        raw = json.loads(proc.stdout)
    except json.JSONDecodeError as err:
        raise ScorerError(f"scoring shim produced invalid output: {err}") from err

    def engine(d: dict[str, Any]) -> EngineResult:
        return EngineResult(
            parsed=bool(d["parsed"]),
            violations=d.get("violations", []),
            skips=d.get("skips", []),
            error=d.get("error"),
        )

    return ShimResult(engine_version=raw["engine_version"], aa=engine(raw["aa"]), strict=engine(raw["strict"]), bypass=raw["bypass"])


@dataclass
class Scored:
    status: RunStatus
    shim: ShimResult | None = None
    missing: list[str] = field(default_factory=list)
    detail: str | None = None


def classify(task: Task, shim: ShimResult) -> Scored:
    """Decides whether the code can be scored at all, and if not, why.

    The order matters and every branch returns a status that is not 'scored': an
    empty violation list is only meaningful when the code parsed, contains JSX,
    and does what the task asked.
    """
    if shim.aa.error or shim.strict.error:
        return Scored(RunStatus.SCORER_ERROR, shim, detail=shim.aa.error or shim.strict.error)
    if not shim.bypass.get("parsed") or not shim.aa.parsed:
        return Scored(RunStatus.PARSED_FALSE, shim, detail=shim.bypass.get("error"))
    if shim.bypass.get("elements", 0) == 0:
        return Scored(RunStatus.NO_JSX, shim)

    tag_counts: dict[str, int] = shim.bypass.get("tag_counts", {})
    missing = [f"{r.label} x{r.min}" for r in task.requires if sum(tag_counts.get(t, 0) for t in r.tags) < r.min]
    if missing:
        return Scored(RunStatus.UNSCORABLE, shim, missing=missing)
    return Scored(RunStatus.SCORED, shim)


def score(task: Task, code: str, **kwargs: Any) -> Scored:
    try:
        shim = run_shim(code, **kwargs)
    except ScorerError as err:
        return Scored(RunStatus.SCORER_ERROR, None, detail=str(err))
    return classify(task, shim)

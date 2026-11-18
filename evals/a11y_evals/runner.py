"""Runs arms x tasks x repetitions, one JSON line per run.

Properties that the results depend on, each pinned by a test:
  * a record is written with one os.write on an O_APPEND file, then fsynced, so a crash cannot leave
    a half record in the middle; a torn last line (a crash during the write itself) is ignored on read;
  * the file is append-only and the LAST record for a run id wins, so resuming never double-counts;
  * only a run that produced no output at all (transport failure) is retried, and only that, so a bad
    answer is never re-rolled until it is a good one;
  * a run stopped by the budget is written down as budget_abort, not dropped: the experiment's
    denominators must show what was planned, not only what happened to finish;
  * one run failing for any reason does not stop the others, and the reason is recorded.
"""
from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

from .agents.base import Agent
from .budget import Budget, BudgetExceeded
from .extract import extract_code
from .models import AgentResult, Arm, RunStatus, Task, Usage
from .scoring import Scored, score


def run_id(task_id: str, arm: str, rep: int) -> str:
    return f"{task_id}|{arm}|{rep}"


# --------------------------------------------------------------------------- the file

class RunFile:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def append(self, record: dict[str, Any]) -> None:
        # ensure_ascii keeps a lone surrogate in a model's output from making the write itself fail.
        line = (json.dumps(record, sort_keys=True) + "\n").encode("ascii")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._drop_torn_tail()
        fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            view = memoryview(line)
            while view:  # one record is one append; a short write is finished, not left as a fragment
                view = view[os.write(fd, view):]
            os.fsync(fd)
        finally:
            os.close(fd)

    def _drop_torn_tail(self) -> None:
        """A crash during a write leaves a last line without its newline. Appending after it would glue the next record
        onto the fragment and lose both, so the fragment (never a complete record) is cut off first."""
        if not self.path.is_file() or self.path.stat().st_size == 0:
            return
        with open(self.path, "rb+") as fh:
            data = fh.read()
            if data.endswith(b"\n"):
                return
            fh.truncate(data.rfind(b"\n") + 1)

    def read(self) -> list[dict[str, Any]]:
        """All complete records in order. A torn final line is skipped; a corrupt line anywhere else is an error."""
        if not self.path.is_file():
            return []
        lines = self.path.read_text(encoding="utf-8").split("\n")
        out: list[dict[str, Any]] = []
        last = max((i for i, l in enumerate(lines) if l.strip()), default=-1)
        for i, line in enumerate(lines):
            if not line.strip():
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as err:
                if i == last:
                    continue  # the write in progress when the process died
                raise ValueError(f"{self.path}: corrupt record on line {i + 1}: {err}") from err
        return out

    def meta(self) -> dict[str, Any] | None:
        return next((r for r in self.read() if r.get("kind") == "meta"), None)

    def runs(self) -> dict[str, dict[str, Any]]:
        """The current record per run id: the last one written wins."""
        latest: dict[str, dict[str, Any]] = {}
        for r in self.read():
            if r.get("kind") == "run":
                latest[r["run_id"]] = r
        return latest


# --------------------------------------------------------------------------- one run

def _behaviour(arm: Arm, result: AgentResult, submitted_code: str | None) -> dict[str, Any] | None:
    """How the tool was used, for the arms that have it. Recorded for every such run, including those that never called it."""
    if arm not in (Arm.C, Arm.C_FORCED):
        return None
    calls = [c for c in result.tool_calls if c.code is not None or c.violations_reported is not None]
    checked = [c.code for c in calls if c.code is not None]
    first = calls[0] if calls else None
    return {
        "n_check_calls": len(calls),
        "called": bool(calls),
        "first_check_violations": first.violations_reported if first else None,
        "changed_code_after_first_check": (
            None if not checked or submitted_code is None else _norm(checked[0]) != _norm(submitted_code)
        ),
        # Whether what it asked the tool about is what it handed in. A different answer means the tool's verdict is about other code.
        "last_checked_is_submitted": None if not checked or submitted_code is None else _norm(checked[-1]) == _norm(submitted_code),
    }


def _norm(code: str) -> str:
    return "\n".join(line.rstrip() for line in code.strip().splitlines())


def _summarise_score(scored: Scored) -> dict[str, Any] | None:
    s = scored.shim
    if s is None:
        return None
    return {
        "aa": {"violations": s.aa.violations, "skips": s.aa.skips, "parsed": s.aa.parsed},
        "strict": {"violations": s.strict.violations, "skips": s.strict.skips, "parsed": s.strict.parsed},
        "bypass": s.bypass,
    }


def execute(task: Task, arm: Arm, rep: int, agent: Agent, budget: Budget, *, max_transport_retries: int,
            sleep: Callable[[float], None] = time.sleep, scorer: Callable[..., Scored] = score) -> dict[str, Any]:
    """Runs one (task, arm, rep) and returns its record. Never raises for a failure of the run itself."""
    rec: dict[str, Any] = {
        "kind": "run", "run_id": run_id(task.id, arm.value, rep), "task_id": task.id, "arm": arm.value,
        "rep": rep, "split": task.split, "stratum": task.stratum,
        "status": None, "attempts": 0, "raw_output": None, "code": None, "usage": None, "cost_usd": None,
        "stop_reason": None, "transcript": None, "exposed": None, "behaviour": None, "score": None, "detail": None,
        "missing": None,
    }

    result: AgentResult | None = None
    spent = Usage()      # everything this run used, failed attempts included
    cost = 0.0

    def book(u: Usage) -> None:
        nonlocal cost
        spent.add(u)
        cost += budget.record(u)
        rec["usage"] = {"input_tokens": spent.input_tokens, "output_tokens": spent.output_tokens, "turns": spent.turns}
        rec["cost_usd"] = cost

    try:
        for attempt in range(max_transport_retries + 1):
            rec["attempts"] = attempt + 1
            result = agent.run(task, arm, budget)
            book(result.usage)
            if result.error is not None and result.error.kind == "transport":
                stop = budget.spend_stop_reason()
                if attempt < max_transport_retries and stop is None:
                    sleep(min(2.0 ** attempt, 30.0))
                    continue
                if stop is not None:
                    rec["detail"] = f"not retried: {stop}"
            break
    except BudgetExceeded as err:
        rec["status"] = RunStatus.BUDGET_ABORT.value
        rec["detail"] = str(err)
        if err.usage is not None:
            book(err.usage)  # the calls made before the limit was noticed were paid for
        return rec
    except Exception as err:  # the run failed for a reason of its own; the experiment goes on
        rec["status"] = RunStatus.AGENT_ERROR.value
        rec["detail"] = f"{type(err).__name__}: {err}"
        return rec

    assert result is not None
    rec.update(raw_output=result.raw_output, stop_reason=result.stop_reason, transcript=result.transcript, exposed=result.exposed)

    if result.error is not None and result.error.kind == "transport":
        rec["status"] = RunStatus.TRANSPORT_ERROR.value
        rec["detail"] = result.error.message if not rec["detail"] else f"{result.error.message} ({rec['detail']})"
        return rec
    if result.error is not None:
        # The model answered, but the agent flagged the answer as unusable (a refusal, a filtered reply): not scored, not retried.
        rec["status"] = RunStatus.AGENT_ERROR.value
        rec["detail"] = f"{result.error.kind}: {result.error.message}"
        return rec

    status, code = extract_code(result.raw_output, result.stop_reason)
    rec["code"] = code
    rec["behaviour"] = _behaviour(arm, result, code)
    if not status.scorable:
        rec["status"] = status.value
        return rec

    try:
        scored = scorer(task, code)
    except Exception as err:  # the scoring step failing is a result of its own, never a reason to lose the run
        rec["status"] = RunStatus.SCORER_ERROR.value
        rec["detail"] = f"{type(err).__name__}: {err}"
        return rec
    rec["status"] = (scored.status if scored.status != RunStatus.SCORED else status).value
    rec["detail"] = scored.detail
    rec["missing"] = scored.missing or None
    rec["score"] = _summarise_score(scored)
    return rec


# --------------------------------------------------------------------------- the experiment

@dataclass
class Plan:
    items: list[tuple[Task, Arm, int]]

    def __len__(self) -> int:
        return len(self.items)


def make_plan(tasks: Iterable[Task], arms: Iterable[Arm], k: int, seed: int) -> Plan:
    """Every (task, arm, rep), in an order fixed by the seed. Mixed rather than grouped by arm so that anything that
    drifts over time (the model, the load on it) is spread across the arms instead of landing on one."""
    tasks, arms = list(tasks), list(arms)
    for what, xs in (("arm", [a.value for a in arms]), ("task", [t.id for t in tasks])):
        dup = sorted({x for x in xs if xs.count(x) > 1})
        if dup:
            raise ValueError(f"duplicate {what}(s) in the plan: {dup}")
    items = [(t, a, r) for r in range(k) for t in tasks for a in arms]
    random.Random(seed).shuffle(items)
    return Plan(items)


# What must be the same for new runs to belong in an existing file. k, arms and limits may differ: extending a
# file with more repetitions or arms, or with a larger budget, is a normal use.
RESUME_MUST_MATCH = ("split", "seed", "task_file_sha256", "engine_version", "agent", "scoring")


def check_resumable(old: dict[str, Any], new: dict[str, Any]) -> None:
    diffs = [f"{k}: file has {old.get(k)!r}, this run has {new.get(k)!r}" for k in RESUME_MUST_MATCH if old.get(k) != new.get(k)]
    for arm, digest in (new.get("arm_digests") or {}).items():
        have = (old.get("arm_digests") or {}).get(arm)
        if have is not None and have != digest:
            diffs.append(f"arm {arm}: its prompt changed since the file was started")
    if diffs:
        raise ValueError("this run file was made under different settings; start a new file instead:\n  " + "\n  ".join(diffs))


def _is_final(rec: dict[str, Any]) -> bool:
    st = RunStatus(rec["status"])
    if st == RunStatus.BUDGET_ABORT:
        # Never started (attempts 0) is picked up again. Stopped part-way by its own limit is a result:
        # starting it over would re-draw exactly the long runs, and only in the arms that make them.
        return rec.get("attempts", 0) > 0
    return not st.retry_on_resume


def run_experiment(plan: Plan, agent: Agent, budget: Budget, out: RunFile, *, meta: dict[str, Any],
                   max_transport_retries: int = 2, sleep: Callable[[float], None] = time.sleep,
                   scorer: Callable[..., Scored] = score, progress: Callable[[str], None] | None = None) -> dict[str, int]:
    """Runs what has not yet reached a final status. Safe to call again on the same file."""
    existing = out.meta()
    if existing is None:
        out.append(meta)
    else:
        check_resumable(existing, meta)
    budget.carry_over(out.read())
    done = {rid for rid, r in out.runs().items() if _is_final(r)}

    counts: dict[str, int] = {}
    stopped: str | None = None
    for task, arm, rep in plan.items:
        rid = run_id(task.id, arm.value, rep)
        if rid in done:
            continue
        if stopped is None:
            stopped = budget.stop_reason()
        if stopped is not None:
            rec = {"kind": "run", "run_id": rid, "task_id": task.id, "arm": arm.value, "rep": rep, "split": task.split,
                   "stratum": task.stratum, "status": RunStatus.BUDGET_ABORT.value, "detail": stopped, "attempts": 0}
        else:
            budget.start_run()
            rec = execute(task, arm, rep, agent, budget, max_transport_retries=max_transport_retries, sleep=sleep, scorer=scorer)
        out.append(rec)
        counts[rec["status"]] = counts.get(rec["status"], 0) + 1
        if progress:
            progress(f"{rid}: {rec['status']}")
    return counts

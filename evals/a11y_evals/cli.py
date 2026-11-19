"""Command line: plan, run, report.

`--agent fake` runs the whole pipeline with a scripted agent and costs nothing. It exists to test the harness
and to see what a report looks like; its numbers say nothing about any model.
"""
from __future__ import annotations

import argparse
import dataclasses
import sys
from pathlib import Path

from . import provenance
from .agents.fake import FakeAgent, FakeBehavior
from .budget import Budget, Limits, PricingError, load_pricing
from .models import Arm, DEFAULT_ARMS, Task
from .report import render
from .runner import RunFile, make_plan, run_experiment
from .tasks import TaskError, load_tasks


def _demo_policy(task: Task, arm: Arm, rep: int) -> FakeBehavior:
    """A made-up effect, so a report can be looked at before there is a real agent."""
    if arm in (Arm.C, Arm.C_FORCED):
        return FakeBehavior(violations=2, checks=[2, 0], code_after_check=0, turns=3)
    return FakeBehavior(violations={Arm.A: 3, Arm.B: 2, Arm.B2: 1}[arm])


def _parse_arms(text: str) -> list[Arm]:
    try:
        return [Arm(a.strip()) for a in text.split(",") if a.strip()]
    except ValueError as err:
        raise argparse.ArgumentTypeError(f"unknown arm in {text!r}: {err}") from err


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="a11y-evals")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="run (or resume) an experiment")
    r.add_argument("--agent", choices=["fake", "strands"], default="fake")
    r.add_argument("--split", choices=["dev", "test"], default="dev")
    r.add_argument("--arms", type=_parse_arms, default=list(DEFAULT_ARMS), help="comma-separated, e.g. A,B,B2,C")
    r.add_argument("--k", type=int, default=1, help="repetitions per task and arm")
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--out", type=Path, required=True, help="JSONL run file (appended to; an existing file is resumed)")
    r.add_argument("--pricing", type=Path, help="YAML with input_per_mtok and output_per_mtok (required for billable agents)")
    r.add_argument("--max-runs", type=int, default=200)
    r.add_argument("--max-total-tokens", type=int, default=2_000_000)
    r.add_argument("--max-cost-usd", type=float, default=5.0)
    r.add_argument("--max-tokens-per-run", type=int, default=20_000)
    r.add_argument("--max-turns-per-run", type=int, default=8)
    r.add_argument("--dry-run", action="store_true", help="print the plan and the worst-case ceiling, call nothing")

    rep = sub.add_parser("report", help="print the markdown report for a run file")
    rep.add_argument("file", type=Path)
    return p


def _cmd_run(a: argparse.Namespace) -> int:
    if a.k < 1:
        print("error: --k must be at least 1", file=sys.stderr)
        return 2
    if a.agent == "strands":
        print("error: the Bedrock/Strands agent is not implemented yet (stage 2, after the AWS account is set up)", file=sys.stderr)
        return 2
    agent = FakeAgent(_demo_policy)
    try:
        tasks = load_tasks(a.split)
        pricing = load_pricing(a.pricing) if a.pricing else None
        limits = Limits(max_runs=a.max_runs, max_total_tokens=a.max_total_tokens, max_cost_usd=a.max_cost_usd,
                        max_tokens_per_run=a.max_tokens_per_run, max_turns_per_run=a.max_turns_per_run)
        budget = Budget(limits=limits, pricing=pricing, billable=agent.billable)
    except (TaskError, PricingError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 2

    try:
        plan = make_plan(tasks, a.arms, a.k, a.seed)
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
    worst = budget.worst_case(len(plan))
    print(f"plan: {len(tasks)} tasks x {len(a.arms)} arms x k={a.k} = {len(plan)} runs ({a.split} split, agent {a.agent})")
    print("worst case allowed by the limits: " + ", ".join(f"{k}={v:,.4g}" for k, v in worst.items()))
    if len(plan) > limits.max_runs:
        print(f"note: the plan is larger than max_runs ({limits.max_runs}); the rest will be recorded as budget_abort")
    if a.dry_run:
        return 0

    meta = provenance.collect(
        agent_description=agent.describe(), arms=[x.value for x in a.arms], split=a.split, k=a.k, seed=a.seed,
        limits=dataclasses.asdict(limits),
        pricing=dataclasses.asdict(pricing) if pricing else None,
    )
    try:
        counts = run_experiment(plan, agent, budget, RunFile(a.out), meta=meta)
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
    print("finished: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) if counts else "nothing to do (all runs already final)")
    return 0


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    if a.cmd == "run":
        return _cmd_run(a)
    if not a.file.is_file():
        print(f"error: {a.file} not found", file=sys.stderr)
        return 2
    sys.stdout.write(render(RunFile(a.file)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

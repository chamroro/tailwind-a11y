"""Markdown report from a run file. Everything stated here is computed from the records; nothing is typed in by hand,
except the fixed caveat that closes every report."""
from __future__ import annotations

from statistics import mean
from typing import Any

from .analysis import (BYPASS_KEYS, RunView, bypass_medians, compare, compare_distinct, floor_effect, per_task, status_table,
                       unscorable_rate, views)
from .models import Arm
from .runner import RunFile
from .stats import wilson

ARM_ORDER = [a.value for a in Arm]
# Pairs compared, in the order a reader should take them: instruction alone, the extra self-review turn, the tool beyond that, and the total.
PAIRS = [("A", "B"), ("B", "B2"), ("B2", "C"), ("A", "C")]

CAVEAT = (
    "The tool and the scorer are the same engine, so a lower count here is what the tool is built to produce, not "
    "independent evidence that the code is accessible. Zero findings is not \"accessible\": the engine reads only plain string "
    "`className` values and does not see inline styles, wrapper backgrounds or most behaviour. "
    "These numbers are for this model, these tasks and this date only."
)


def _pct(x: float) -> str:
    return f"{x:.0%}"


def _arms_present(vs: list[RunView]) -> list[str]:
    seen = {v.arm for v in vs}
    return [a for a in ARM_ORDER if a in seen]


def _fmt(x: float | None, nd: int = 2) -> str:
    return "-" if x is None else f"{x:.{nd}f}"


def _mean_or_none(xs: list[float]) -> float | None:
    return mean(xs) if xs else None


def render(run_file: RunFile) -> str:
    meta = run_file.meta()
    records = list(run_file.runs().values())
    vs = views(records)
    arms = _arms_present(vs)
    out: list[str] = []
    w = out.append

    w("# Evaluation report")
    w("")
    if meta:
        ag = meta.get("agent", {})
        w(f"Agent: `{ag.get('agent', '?')}`. Split: `{meta.get('split')}`. Repetitions per task and arm: {meta.get('k')}. "
          f"Seed: {meta.get('seed')}. Engine: {meta.get('engine_version')}. Harness commit: `{(meta.get('harness_git_sha') or '?')[:10]}`"
          f"{' (working tree had uncommitted changes)' if meta.get('harness_dirty') else ''}. "
          f"Task file sha256: `{(meta.get('task_file_sha256') or '?')[:12]}`.")
        w("")
    if not vs:
        w("No runs recorded.")
        w("")
        w(f"> {CAVEAT}")
        return "\n".join(out) + "\n"

    # ---- coverage
    if meta and meta.get("split"):
        try:
            from .tasks import load_tasks
            n_tasks = len(load_tasks(meta["split"]))
        except Exception:
            n_tasks = None
        if n_tasks:
            gaps = []
            for a in meta.get("arms", []):
                have = sum(1 for v in vs if v.arm == a)
                want = n_tasks * int(meta.get("k", 1))
                if have < want:
                    gaps.append(f"arm {a}: {have} of {want} planned runs have a record")
            if gaps:
                w("**Incomplete file:** " + "; ".join(gaps) + ". Comparisons below cover only what was recorded.")
                w("")

    # ---- status table
    w("## Run outcomes")
    w("")
    w("A run that produced no scoreable code is counted as not shown to be clean. It is never counted as zero findings.")
    w("")
    st = status_table(vs)
    cols = sorted({s for row in st.values() for s in row})
    w("| arm | runs | unscorable rate | " + " | ".join(cols) + " |")
    w("|---|---|---|" + "---|" * len(cols))
    for a in arms:
        n = sum(st[a].values())
        w(f"| {a} | {n} | {_pct(unscorable_rate(vs, a))} | " + " | ".join(str(st[a].get(c, 0)) for c in cols) + " |")
    w("")

    # ---- per arm summary
    w("## By arm")
    w("")
    w("`not shown clean` is the share of runs that are not (scored with no finding). `distinct findings` counts rule and class combinations once; "
      "`findings` is the raw count. Both are over scored runs only. `unread` is elements the engine said it could not read.")
    w("")
    w("| arm | not shown clean | distinct findings | findings | unread | strict findings | tokens per run | cost (USD) |")
    w("|---|---|---|---|---|---|---|---|")
    for a in arms:
        runs = [v for v in vs if v.arm == a]
        sc = [v for v in runs if v.scored]
        nsc = _mean_or_none(list(per_task(vs, a, "not_shown_clean").values()))
        w(f"| {a} | {_fmt(nsc)} | {_fmt(_mean_or_none([v.aa_unique for v in sc]))} | {_fmt(_mean_or_none([v.aa_violations for v in sc]))} | "
          f"{_fmt(_mean_or_none([v.aa_skipped for v in sc]))} | {_fmt(_mean_or_none([v.strict_violations for v in sc]))} | "
          f"{_fmt(_mean_or_none([v.tokens for v in runs if v.tokens]), 0)} | {sum(v.cost_usd for v in runs):.4f} |")
    w("")

    # ---- per task
    w("## By task")
    w("")
    w("Mean of `not shown clean` over the repetitions of each task (0 = clean in every repetition, 1 = in none).")
    w("")
    tasks = sorted({v.task_id for v in vs})
    strat = {v.task_id: v.stratum for v in vs}
    w("| task | stratum | " + " | ".join(arms) + " |")
    w("|---|---|" + "---|" * len(arms))
    pt = {a: per_task(vs, a, "not_shown_clean") for a in arms}
    for t in tasks:
        w(f"| {t} | {strat.get(t, '')} | " + " | ".join(_fmt(pt[a].get(t)) for a in arms) + " |")
    w("")

    # ---- comparisons
    w("## Comparisons")
    w("")
    w("Per-task differences, second arm minus first (negative = fewer runs not shown clean). The interval resamples tasks, not runs, "
      "and with this few tasks it is too narrow, so it is approximate and never used alone.")
    w("")
    floor, fd = floor_effect(vs, "A") if "A" in arms else (False, {})
    comps = [(a, b, compare(vs, a, b)) for a, b in PAIRS if a in arms and b in arms]
    comps = [(a, b, c) for a, b, c in comps if c is not None]
    if comps:
        w("| comparison | tasks | mean difference | approx. 95% interval | tasks down / same / up | upper-bound mean difference | reading |")
        w("|---|---|---|---|---|---|---|")
        for a, b, c in comps:
            reading = "consistent decrease in engine findings" if c.verdict == "consistent_decrease" else "difference not established"
            w(f"| {a} -> {b} | {c.n_tasks} | {c.mean_diff:+.2f} | [{c.low:+.2f}, {c.high:+.2f}] | "
              f"{c.signs['down']} / {c.signs['same']} / {c.signs['up']} | {c.upper_mean_diff:+.2f} | {reading} |")
        w("")
        for a, b, c in comps:
            if c.reasons:
                w(f"Why {a} -> {b} is not read as a decrease:")
                w("")
                for r in c.reasons:
                    w(f"- {r}")
                w("")
    else:
        w("Not enough arms with shared tasks to compare.")
        w("")
    dist = [(a, b, compare_distinct(vs, a, b)) for a, b in PAIRS if a in arms and b in arms]
    dist = [(a, b, d) for a, b, d in dist if d is not None]
    if dist:
        w("Second metric, distinct findings per scored run (descriptive; it does not decide the reading above, and scored runs only):")
        w("")
        w("| comparison | tasks | mean difference | approx. 95% interval | tasks down / same / up |")
        w("|---|---|---|---|---|")
        for a, b, (n, m, lo, hi, sg) in dist:
            w(f"| {a} -> {b} | {n} | {m:+.2f} | [{lo:+.2f}, {hi:+.2f}] | {sg['down']} / {sg['same']} / {sg['up']} |")
        w("")
        primary_n = {(a, b): c.n_tasks for a, b, c in comps}
        short = [f"{a} -> {b}: {n} of {primary_n[(a, b)]}" for a, b, (n, *_rest) in dist if (a, b) in primary_n and n < primary_n[(a, b)]]
        if short:
            w("Tasks where an arm had no scored run have no distinct-findings value and are left out here (" + "; ".join(short) +
              "). That leaves out the tasks where the arm failed, so read this table with the first one, not instead of it.")
            w("")
    if floor:
        w(f"Baseline floor effect: in arm A {_pct(fd['share_tasks_clean'])} of tasks have no finding and runs average "
          f"{fd['mean_unique']:.2f} distinct findings. The tool cannot show an effect on code that is already clean; "
          "do not read these comparisons.")
        w("")

    # ---- tool use
    c_arms = [a for a in ("C", "C_FORCED") if a in arms]
    if c_arms:
        w("## Tool use")
        w("")
        w("Whether the agent called the check tool, and what it did next. The first rate is over every run of the arm, failed runs included (they did not call it); the others are over runs that called it. Rates carry a Wilson 95% interval. "
          "`submitted what it checked` is the share of calling runs whose last checked code is the code handed in.")
        w("")
        w("| arm | runs | called the tool | changed code after first check | submitted what it checked | first check found something |")
        w("|---|---|---|---|---|---|")
        for a in c_arms:
            runs = [v for v in vs if v.arm == a]  # every run of the arm: one that failed before it could call the tool did not call it
            n = len(runs)
            called = [v for v in runs if v.behaviour and v.behaviour["called"]]
            changed = [v for v in called if v.behaviour.get("changed_code_after_first_check") is True]
            known = [v for v in called if v.behaviour.get("last_checked_is_submitted") is not None]
            same = [v for v in known if v.behaviour["last_checked_is_submitted"]]
            found = [v for v in called if (v.behaviour.get("first_check_violations") or 0) > 0]

            def rate(k: int, d: int) -> str:
                if d == 0:
                    return "-"
                lo, hi = wilson(k, d)
                return f"{k}/{d} ({_pct(k / d)}; {_pct(lo)}-{_pct(hi)})"

            w(f"| {a} | {n} | {rate(len(called), n)} | {rate(len(changed), len(called))} | {rate(len(same), len(known))} | {rate(len(found), len(called))} |")
        w("")
        if "C_FORCED" in c_arms:
            w("C_FORCED always calls the tool by instruction. It is an upper bound on what the tool can do, not a measure of what an installed tool does.")
            w("")

    # ---- bypass
    w("## How the code was written")
    w("")
    w("Medians per run, measured by parsing the code, not by the engine. Large differences between arms mean the arms are not writing "
      "comparable code, and a lower finding count may come from writing code the engine cannot read.")
    w("")
    w("| arm | " + " | ".join(k.replace("_", " ") for k in BYPASS_KEYS) + " |")
    w("|---|" + "---|" * len(BYPASS_KEYS))
    for a in arms:
        m = bypass_medians(vs, a)
        w(f"| {a} | " + " | ".join(f"{m[k]:g}" if k in m else "-" for k in BYPASS_KEYS) + " |")
    w("")

    # ---- cost
    total_cost = sum(v.cost_usd for v in vs)
    total_tokens = sum(v.tokens for v in vs)
    w("## Cost")
    w("")
    w(f"{len(vs)} runs, {total_tokens:,} tokens, {total_cost:.4f} USD at the price table recorded for this run.")
    w("")

    w("## Limits")
    w("")
    w(f"> {CAVEAT}")
    return "\n".join(out) + "\n"

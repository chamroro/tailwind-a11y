"""From run records to the numbers the report states, and the verdict on whether they may be read as a difference.

The rules here were fixed before any real run (see README). The two that matter most:

  * A run that could not be scored is never a run with no violations. The primary metric, "not shown
    to be clean", counts such a run as 1. Dropping unscorable runs would reward an arm for failing.
  * The tool and the scorer are the same engine, so a drop in what the engine finds is expected and is
    not evidence the code became accessible. The verdict only says whether the engine-measured
    difference is consistent and large enough to be told apart from noise.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean, median
from typing import Any, Iterable

from .models import Arm, RunStatus
from .stats import cluster_bootstrap, paired_diffs, sign_counts

# Pre-registered heuristics for "can this be called a difference". Rules of thumb, not theorems; stated
# in the README so a reader can disagree with them, and fixed before the first real run.
MIN_TASKS = 8                     # fewer compared tasks than this cannot support a reading, whatever the numbers
MIN_TASKS_IMPROVED = 0.8          # share of tasks that must move the same way
FLOOR_SHARE = 0.5                 # baseline: at least this share of tasks with no finding at all ...
FLOOR_MEAN_UNIQUE = 1.0           # ... and fewer than this many distinct findings per run, means no room to improve
MAX_UNSCORABLE_GAP = 0.15         # absolute difference in the unscorable rate between two compared arms
BYPASS_RATIO_BAND = (0.5, 2.0)    # a bypass measure may differ between arms by at most this factor (median)

BYPASS_KEYS = ("elements", "style_attrs", "dynamic_classnames", "arbitrary_value_classes", "custom_components", "lines")


@dataclass
class RunView:
    task_id: str
    arm: str
    rep: int
    stratum: str
    status: RunStatus
    # Findings, None when the run has no verdict.
    aa_violations: int | None = None
    aa_unique: int | None = None
    aa_skipped: int | None = None
    strict_violations: int | None = None
    bypass: dict[str, Any] = field(default_factory=dict)
    cost_usd: float = 0.0
    tokens: int = 0
    behaviour: dict[str, Any] | None = None

    @property
    def scored(self) -> bool:
        return self.status.scorable

    @property
    def not_shown_clean(self) -> int:
        """Primary metric: 1 unless the run was scored AND the engine found nothing."""
        return 0 if (self.scored and self.aa_violations == 0) else 1

    @property
    def upper_not_shown_clean(self) -> int:
        """Same, but a run with anything the engine said it could not read is also not shown clean."""
        return 0 if (self.scored and self.aa_violations == 0 and self.aa_skipped == 0) else 1


def views(records: Iterable[dict[str, Any]]) -> list[RunView]:
    out: list[RunView] = []
    for r in records:
        st = RunStatus(r["status"])
        v = RunView(task_id=r["task_id"], arm=r["arm"], rep=r["rep"], stratum=r.get("stratum", ""), status=st,
                    cost_usd=r.get("cost_usd") or 0.0, behaviour=r.get("behaviour"))
        u = r.get("usage")
        v.tokens = (u["input_tokens"] + u["output_tokens"]) if u else 0
        sc = r.get("score")
        if st.scorable and sc:
            aa, strict = sc["aa"], sc["strict"]
            v.aa_violations = len(aa["violations"])
            v.aa_unique = len({x["key"] for x in aa["violations"]})
            v.aa_skipped = len(aa["skips"])
            v.strict_violations = len(strict["violations"])
        if sc:
            v.bypass = sc.get("bypass", {})
        out.append(v)
    return out


def per_task(vs: list[RunView], arm: str, metric: str) -> dict[str, float]:
    """Mean of `metric` over the repetitions of each task, for one arm."""
    by: dict[str, list[float]] = {}
    for v in vs:
        if v.arm == arm:
            x = getattr(v, metric)
            if x is not None:
                by.setdefault(v.task_id, []).append(float(x))
    return {t: mean(xs) for t, xs in by.items()}


def status_table(vs: list[RunView]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for v in vs:
        out.setdefault(v.arm, {})
        out[v.arm][v.status.value] = out[v.arm].get(v.status.value, 0) + 1
    return out


def unscorable_rate(vs: list[RunView], arm: str) -> float:
    runs = [v for v in vs if v.arm == arm]
    return sum(1 for v in runs if not v.scored) / len(runs) if runs else 0.0


def bypass_medians(vs: list[RunView], arm: str) -> dict[str, float]:
    runs = [v for v in vs if v.arm == arm and v.bypass.get("parsed")]
    return {k: median([v.bypass.get(k, 0) for v in runs]) for k in BYPASS_KEYS} if runs else {}


def floor_effect(vs: list[RunView], arm: str = "A") -> tuple[bool, dict[str, float]]:
    """Whether the baseline leaves no room for the tool to show anything: most tasks with no finding at all,
    and fewer than one distinct finding per run on average."""
    nsc = per_task(vs, arm, "not_shown_clean")
    uniq = per_task(vs, arm, "aa_unique")
    if not nsc:
        return False, {}
    share_clean = sum(1 for x in nsc.values() if x == 0) / len(nsc)
    mean_unique = mean(uniq.values()) if uniq else 0.0
    return (share_clean >= FLOOR_SHARE and mean_unique < FLOOR_MEAN_UNIQUE), {"share_tasks_clean": share_clean, "mean_unique": mean_unique}


@dataclass
class Comparison:
    a: str
    b: str
    metric: str
    n_tasks: int
    mean_diff: float
    low: float
    high: float
    signs: dict[str, int]
    upper_mean_diff: float          # the same comparison on the upper-bound metric
    unscorable_gap: float
    bypass_flags: list[str]
    verdict: str                    # "consistent_decrease" | "indistinguishable"
    reasons: list[str]


def compare_distinct(vs: list[RunView], a: str, b: str, *, seed: int = 0) -> tuple[int, float, float, float, dict[str, int]] | None:
    """Second pre-registered metric: distinct findings per scored run. Descriptive only; the verdict comes from `compare`.
    Tasks where either arm has no scored run are left out."""
    diffs = paired_diffs(per_task(vs, a, "aa_unique"), per_task(vs, b, "aa_unique"))
    if not diffs:
        return None
    vals = list(diffs.values())
    m, lo, hi = cluster_bootstrap(vals, seed=seed)
    return len(vals), m, lo, hi, sign_counts(vals)


def compare(vs: list[RunView], a: str, b: str, *, seed: int = 0) -> Comparison | None:
    """Arm b against arm a on the primary metric (negative = b has fewer runs not shown to be clean)."""
    pa, pb = per_task(vs, a, "not_shown_clean"), per_task(vs, b, "not_shown_clean")
    diffs = paired_diffs(pa, pb)
    if not diffs:
        return None
    vals = list(diffs.values())
    m, lo, hi = cluster_bootstrap(vals, seed=seed)
    signs = sign_counts(vals)
    ud = paired_diffs(per_task(vs, a, "upper_not_shown_clean"), per_task(vs, b, "upper_not_shown_clean"))
    upper_mean = mean(ud.values()) if ud else float("nan")
    gap = abs(unscorable_rate(vs, a) - unscorable_rate(vs, b))

    flags: list[str] = []
    ma, mb = bypass_medians(vs, a), bypass_medians(vs, b)
    for k in BYPASS_KEYS:
        va, vb = ma.get(k, 0), mb.get(k, 0)
        if va == 0 and vb == 0:
            continue
        ratio = (vb / va) if va else float("inf")
        if not (BYPASS_RATIO_BAND[0] <= ratio <= BYPASS_RATIO_BAND[1]):
            flags.append(f"{k}: median {va:g} -> {vb:g}")

    reasons: list[str] = []
    if len(vals) < MIN_TASKS:
        reasons.append(f"only {len(vals)} tasks are compared (need at least {MIN_TASKS})")
    missing = max(len(pa), len(pb)) - len(vals)
    if missing:
        reasons.append(f"{missing} task(s) have runs in only one of the two arms and are left out of the comparison")
    base = "A" if any(v.arm == "A" for v in vs) else a
    floor, fdetail = floor_effect(vs, base)
    if floor:
        reasons.append(f"floor effect: {fdetail['share_tasks_clean']:.0%} of tasks have no finding in arm {base}, "
                       f"{fdetail['mean_unique']:.2f} distinct findings per run, so there is no room to improve")
    if signs["down"] / len(vals) < MIN_TASKS_IMPROVED:
        reasons.append(f"only {signs['down']}/{len(vals)} tasks went down (need {MIN_TASKS_IMPROVED:.0%})")
    if not (hi < 0):
        reasons.append("the approximate interval includes 0 or is above it")
    if not (upper_mean < 0):
        reasons.append("on the upper-bound metric (findings plus unreadable elements) the direction does not hold")
    if gap > MAX_UNSCORABLE_GAP:
        reasons.append(f"the unscorable rate differs by {gap:.0%} between the arms")
    if flags:
        reasons.append("how the code was written differs between the arms (" + "; ".join(flags) + ")")

    return Comparison(a=a, b=b, metric="not_shown_clean", n_tasks=len(vals), mean_diff=m, low=lo, high=hi, signs=signs,
                      upper_mean_diff=upper_mean, unscorable_gap=gap, bypass_flags=flags,
                      verdict="indistinguishable" if reasons else "consistent_decrease", reasons=reasons)

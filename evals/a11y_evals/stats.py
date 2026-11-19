"""The few statistics the report uses, with the standard library only.

The unit of replication is the TASK, not the run: repeating one task k times shrinks the noise within
that task but says nothing new about other tasks. So differences are computed per task first, and the
interval resamples tasks.
"""
from __future__ import annotations

import random
from statistics import mean
from typing import Sequence


def paired_diffs(a: dict[str, float], b: dict[str, float]) -> dict[str, float]:
    """b - a for every task present in both. A task missing from either side is left out of the comparison,
    and the caller reports how many were."""
    return {t: b[t] - a[t] for t in sorted(a.keys() & b.keys())}


def cluster_bootstrap(diffs: Sequence[float], *, n_boot: int = 10_000, seed: int = 0, level: float = 0.95) -> tuple[float, float, float]:
    """(mean, low, high) of the mean difference, resampling TASKS with replacement.

    With only ~10 tasks this percentile interval is known to come out too narrow, which is why the report
    calls it approximate and never uses it alone."""
    if not diffs:
        raise ValueError("no tasks to compare")
    rng = random.Random(seed)
    n = len(diffs)
    means = sorted(mean(rng.choices(diffs, k=n)) for _ in range(n_boot))
    lo = means[int(((1 - level) / 2) * n_boot)]
    hi = means[min(n_boot - 1, int((1 - (1 - level) / 2) * n_boot))]
    return mean(diffs), lo, hi


def sign_counts(diffs: Sequence[float], eps: float = 1e-12) -> dict[str, int]:
    """How many tasks went down / stayed the same / went up."""
    return {
        "down": sum(1 for d in diffs if d < -eps),
        "same": sum(1 for d in diffs if abs(d) <= eps),
        "up": sum(1 for d in diffs if d > eps),
    }


def wilson(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a proportion (used for rates such as 'the agent called the tool')."""
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))

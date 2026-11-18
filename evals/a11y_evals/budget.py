"""A hard cost ceiling, enforced in code.

Nothing here is a default price. A price table is something the person paying
fills in from the provider's current price page; a number written in this file
would be one nobody checked, and a missing table has to stop a billable run
rather than quietly cost nothing.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .models import Usage


class PricingError(ValueError):
    """The price table is missing or incomplete, so a billable run must not start."""


class BudgetExceeded(RuntimeError):
    """Raised inside an agent run when it crosses a per-run limit.

    It carries what the run had already used. The model calls that happened before the limit
    was noticed were paid for, so they must still be counted against the experiment's budget."""

    def __init__(self, message: str, usage: "Usage | None" = None):
        super().__init__(message)
        self.usage = usage


@dataclass(frozen=True)
class Pricing:
    input_per_mtok: float
    output_per_mtok: float

    def cost(self, usage: Usage) -> float:
        return usage.input_tokens / 1e6 * self.input_per_mtok + usage.output_tokens / 1e6 * self.output_per_mtok


def load_pricing(path: str | Path | None) -> Pricing:
    """Both prices must be present and positive numbers (USD per million tokens)."""
    if path is None:
        raise PricingError("no price table given: pass --pricing <file> (see pricing.example.yaml)")
    p = Path(path)
    if not p.is_file():
        raise PricingError(f"price table not found: {p}")
    data = yaml.safe_load(p.read_text()) or {}
    values = {}
    for key in ("input_per_mtok", "output_per_mtok"):
        v = data.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v <= 0:
            raise PricingError(f"{p}: {key} must be a positive number (USD per million tokens), got {v!r}")
        values[key] = float(v)
    return Pricing(**values)


@dataclass(frozen=True)
class Limits:
    max_runs: int
    max_total_tokens: int
    max_cost_usd: float
    max_tokens_per_run: int
    max_turns_per_run: int

    def __post_init__(self) -> None:
        for name in ("max_runs", "max_total_tokens", "max_cost_usd", "max_tokens_per_run", "max_turns_per_run"):
            v = getattr(self, name)
            if v <= 0:
                raise ValueError(f"{name} must be positive, got {v}")


@dataclass
class Budget:
    """Tracks spend across runs. `billable=False` (the fake agent) skips cost, never the other limits."""
    limits: Limits
    pricing: Pricing | None
    billable: bool = True
    runs_started: int = 0
    usage: Usage = field(default_factory=Usage)
    cost_usd: float = 0.0

    def __post_init__(self) -> None:
        if self.billable and self.pricing is None:
            raise PricingError("a billable run needs a price table")

    def spend_stop_reason(self) -> str | None:
        """Why no further model call may be made (tokens or cost), or None. Also checked before a transport retry."""
        lim = self.limits
        if self.usage.total_tokens >= lim.max_total_tokens:
            return f"max_total_tokens ({lim.max_total_tokens}) reached"
        if self.billable and self.cost_usd >= lim.max_cost_usd:
            return f"max_cost_usd ({lim.max_cost_usd}) reached"
        return None

    def stop_reason(self) -> str | None:
        """Why no further run may start, or None. Checked before every run."""
        if self.runs_started >= self.limits.max_runs:
            return f"max_runs ({self.limits.max_runs}) reached"
        return self.spend_stop_reason()

    def carry_over(self, records: "list[dict]") -> None:
        """Counts what earlier invocations on the same run file already spent, so the limits bound the file, not one process.

        Every record ever written counts, including ones a later record superseded (a retried run still cost what it cost)."""
        for r in records:
            if r.get("kind") != "run":
                continue
            if r.get("attempts"):
                self.runs_started += 1
            u = r.get("usage")
            if u:
                self.usage.add(Usage(input_tokens=u["input_tokens"], output_tokens=u["output_tokens"], turns=u.get("turns", 0)))
            if self.billable:
                self.cost_usd += r.get("cost_usd") or 0.0

    def start_run(self) -> None:
        self.runs_started += 1

    def check_run(self, so_far: Usage) -> None:
        """Called by an agent between model calls with that run's usage so far."""
        if so_far.total_tokens >= self.limits.max_tokens_per_run:
            raise BudgetExceeded(f"max_tokens_per_run ({self.limits.max_tokens_per_run}) reached", so_far)
        if so_far.turns >= self.limits.max_turns_per_run:
            raise BudgetExceeded(f"max_turns_per_run ({self.limits.max_turns_per_run}) reached", so_far)

    def record(self, run_usage: Usage) -> float:
        """Adds a finished (or aborted) run's usage and returns its cost."""
        self.usage.add(run_usage)
        cost = self.pricing.cost(run_usage) if (self.billable and self.pricing) else 0.0
        self.cost_usd += cost
        return cost

    def worst_case(self, n_runs: int) -> dict[str, float]:
        """What the plan is allowed to spend at most, for --dry-run.

        This is the ceiling the limits enforce, not a forecast. One model call per
        run can overshoot its per-run limit before the check sees it, and a
        provider's real price is whatever is in the price table."""
        lim = self.limits
        runs = min(n_runs, lim.max_runs)
        tokens = min(runs * lim.max_tokens_per_run, lim.max_total_tokens)
        out = {"runs": runs, "tokens": tokens}
        if self.billable and self.pricing:
            # Price every token at the dearer rate: the input/output split is not known in advance.
            dearer = max(self.pricing.input_per_mtok, self.pricing.output_per_mtok)
            out["cost_usd"] = min(tokens / 1e6 * dearer, lim.max_cost_usd)
        return out

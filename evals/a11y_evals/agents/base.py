"""What the runner needs from an agent, and nothing else.

Keeping this small is what lets the whole harness be built and checked with a fake agent before any
model is called: the real adapter (Strands + Bedrock, stage 2) implements the same two members.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..budget import Budget
from ..models import Arm, AgentResult, Task


@runtime_checkable
class Agent(Protocol):
    # True when a call costs money. Decides whether a price table is required.
    billable: bool

    def describe(self) -> dict:
        """Everything needed to say which model/configuration produced a result (recorded verbatim)."""
        ...

    def run(self, task: Task, arm: Arm, budget: Budget) -> AgentResult:
        """Runs one (task, arm). It must call budget.check_run(usage_so_far) between model calls and
        let BudgetExceeded propagate. It reports a failure to get any answer as AgentResult.error with
        kind 'transport' (the runner may retry that) and a bad answer as a normal result."""
        ...

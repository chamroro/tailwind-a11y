"""A deterministic stand-in for a model, so the harness can be checked before any model is called.

It writes real TSX with a known number of mistakes the real engine will find, so a test can say
"this arm was built to have 3 violations per run" and check that scoring and the report recover
exactly that, and, just as important, that they report no effect when none was built in.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from ..budget import Budget, BudgetExceeded
from ..models import AgentError, AgentResult, Arm, Task, ToolCall, Usage

VOID_TAGS = {"input", "img", "br", "hr"}

# Each of these is a different contrast mistake the engine reports, so N of them are N distinct
# violation types (what the unique-types metric counts), and the same one repeated is one type.
SLOTS = 9

LOW_CONTRAST_CLASSES = [
    "text-gray-400 bg-white",
    "text-gray-300 bg-white",
    "text-gray-200 bg-white",
    "text-yellow-300 bg-white",
    "text-blue-200 bg-white",
    "text-green-200 bg-white",
    "text-red-200 bg-white",
    "text-pink-200 bg-white",
]


def make_code(task: Task, n_violations: int, *, same_class: bool = False, extra: str = "") -> str:
    """A component that has what the task requires (all with safe classes) plus `n_violations` elements the
    engine will flag. `same_class` repeats one mistake instead of using distinct ones."""
    parts: list[str] = []
    for req in task.requires:
        for _ in range(req.min):
            if req.tag in VOID_TAGS:
                parts.append(f'<{req.tag} className="border border-gray-900" />')
            else:
                parts.append(f'<{req.tag} className="text-gray-900 bg-white">ok</{req.tag}>')
    # The element count stays the same whatever the number of mistakes: fixing a mistake changes a class, it does not delete an element.
    for i in range(max(SLOTS, n_violations)):
        if i < n_violations:
            cls = LOW_CONTRAST_CLASSES[0] if same_class else LOW_CONTRAST_CLASSES[i % len(LOW_CONTRAST_CLASSES)]
        else:
            cls = "text-gray-900 bg-white"
        parts.append(f'<p className="{cls}">paragraph {i}</p>')
    body = "\n      ".join(parts)
    return f"export function Component() {{\n  return (\n    <div>\n      {body}\n      {extra}\n    </div>\n  );\n}}"


def fenced(code: str) -> str:
    return f"Here is the component.\n\n```tsx\n{code}\n```\n"


@dataclass
class FakeBehavior:
    """What one run does. Everything defaults to a clean, quiet, successful run."""
    violations: int = 0
    same_class: bool = False
    raw_output: str | None = None          # overrides the generated answer (to test extraction failures)
    stop_reason: str | None = "end_turn"
    transport_failures: int = 0            # this many attempts fail with no output before one works
    model_error: bool = False              # answers badly (an error that must NOT be retried)
    raises: Exception | None = None       # the agent raising unexpectedly
    tokens: tuple[int, int] = (200, 400)   # input/output tokens used per turn
    turns: int = 1
    # --- the C arm's use of the tool ---
    checks: list[int] = field(default_factory=list)       # violations the tool reported on each call
    checked_other_code: bool = False       # asks the tool about code that is not what it submits
    code_after_check: int | None = None    # violations in the final code, if it revises after checking


Policy = Callable[[Task, Arm, int], FakeBehavior]


class FakeAgent:
    billable = False

    def __init__(self, policy: Policy):
        self.policy = policy
        # Completed runs per (task, arm): this is the repetition number the policy sees. A run that
        # fails with no output is not completed, so its retry is the same repetition.
        self._completed: dict[tuple[str, str], int] = {}
        # Transport failures already served for the run currently being attempted.
        self._failures_served: dict[tuple[str, str, int], int] = {}
        self.attempts = 0  # every call to run(), retries included

    def describe(self) -> dict:
        return {"agent": "fake", "model": None}

    def run(self, task: Task, arm: Arm, budget: Budget) -> AgentResult:
        self.attempts += 1
        key = (task.id, arm.value)
        rep = self._completed.get(key, 0)
        b = self.policy(task, arm, rep)

        if b.raises is not None:
            self._completed[key] = rep + 1
            raise b.raises

        served = self._failures_served.get((task.id, arm.value, rep), 0)
        if served < b.transport_failures:
            self._failures_served[(task.id, arm.value, rep)] = served + 1
            return AgentResult(error=AgentError("transport", "connection reset"))

        self._completed[key] = rep + 1

        usage = Usage()
        tool_calls: list[ToolCall] = []
        final_violations = b.violations
        for _ in range(max(1, b.turns)):
            budget.check_run(usage)  # raises BudgetExceeded when this run is over its own limit
            usage.add(Usage(input_tokens=b.tokens[0], output_tokens=b.tokens[1], turns=1))

        if arm in (Arm.C, Arm.C_FORCED):
            for n in b.checks:
                # Each call is about code that really has n findings, so what the tool reported is true of what it was shown.
                code_for_call = make_code(task, n + 7, same_class=True) if b.checked_other_code else make_code(task, n, same_class=b.same_class)
                tool_calls.append(ToolCall("check_tailwind_a11y", code=code_for_call, violations_reported=n, parsed=True))
            if b.code_after_check is not None:
                final_violations = b.code_after_check

        code = make_code(task, final_violations, same_class=b.same_class)
        raw = b.raw_output if b.raw_output is not None else fenced(code)
        err = AgentError("model", "refused") if b.model_error else None
        return AgentResult(
            raw_output=raw,
            stop_reason=b.stop_reason,
            usage=usage,
            tool_calls=tool_calls,
            error=err,
            transcript=[{"role": "assistant", "text": raw}],
            exposed={"fake": True},
        )

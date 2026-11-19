"""What each arm tells the agent. These strings ARE the independent variable, so they are
constants with hashes recorded in every result, and are not edited after a test run.

Fairness notes (see README):
  * B names the areas the tool covers but gives no verdict method and no answers
    (no thresholds worked out for a class, no "use text-gray-600").
  * B2 is B plus one turn in which the agent reviews and revises its own code. Without
    it, C minus B would mix the tool's information with the plain benefit of a second pass.
  * C adds nothing to the prompt beyond the tool: the server's own instructions are what a
    real user would get. Whether the agent calls it is its choice, and a run that never
    calls it still counts toward C (intention to treat).
  * The prompts are not padded to equal length; token counts per arm are recorded instead.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

from .models import Arm

# Appended to every task, identically for every arm.
TASK_SUFFIX = (
    "Write a single React component in TypeScript (TSX) styled with Tailwind CSS utility classes. "
    "Respond with only the code in one ```tsx code block."
)

_B_TEXT = (
    "The component must conform to WCAG 2.2 level AA. Pay particular attention to: "
    "contrast between text and its background, the size of interactive targets, "
    "visible keyboard focus indicators, and users who prefer reduced motion."
)

_B2_FOLLOWUP = (
    "Now review the component you just wrote against those same points, and respond with the final, "
    "revised version in one ```tsx code block."
)


@dataclass(frozen=True)
class ArmSpec:
    arm: Arm
    system_prompt: str
    followups: tuple[str, ...]   # user messages sent after the first answer
    tools: bool                  # the accessibility MCP server is attached

    def digest(self) -> str:
        blob = "\x1f".join([self.arm.value, self.system_prompt, *self.followups, str(self.tools), TASK_SUFFIX])
        return hashlib.sha256(blob.encode()).hexdigest()[:16]


ARM_SPECS: dict[Arm, ArmSpec] = {
    Arm.A: ArmSpec(Arm.A, "", (), False),
    Arm.B: ArmSpec(Arm.B, _B_TEXT, (), False),
    Arm.B2: ArmSpec(Arm.B2, _B_TEXT, (_B2_FOLLOWUP,), False),
    Arm.C: ArmSpec(Arm.C, "", (), True),
    # An upper bound on what the tool can do when the agent is made to use it; never the product's behaviour.
    Arm.C_FORCED: ArmSpec(
        Arm.C_FORCED,
        "Before you give your final answer, you must check your code with the accessibility tool and fix what it reports.",
        (),
        True,
    ),
}


def user_message(task_prompt: str) -> str:
    return f"{task_prompt}\n\n{TASK_SUFFIX}"

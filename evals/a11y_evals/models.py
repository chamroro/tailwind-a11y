"""Shared types. Nothing here does any work; the point is to fix, in one place,
what a run can end as, so that a failure can never be mistaken for a clean result.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any


class Arm(str, enum.Enum):
    A = "A"            # nothing said about accessibility
    B = "B"            # told to meet WCAG 2.2 AA, no tool
    B2 = "B2"          # B, plus a turn to review and revise its own code
    C = "C"            # the MCP tool is available (calling it is the agent's choice)
    C_FORCED = "C_FORCED"  # told it must call the tool: an upper bound, never the product's behaviour


DEFAULT_ARMS = (Arm.A, Arm.B, Arm.B2, Arm.C)


class RunStatus(str, enum.Enum):
    # --- the code was scored ---
    SCORED = "scored"
    MULTIPLE_BLOCKS = "multiple_blocks"  # scored on the last block (rule fixed in extract.py)

    # --- no verdict: every one of these is a failure to produce something
    # scorable, and none may ever be counted as "no violations" ---
    NO_CODE_BLOCK = "no_code_block"
    EMPTY = "empty"
    TRUNCATED = "truncated"          # hit max_tokens before finishing
    PARSED_FALSE = "parsed_false"    # code did not parse as JSX/TSX
    NO_JSX = "no_jsx"                # parsed, but contains no JSX at all
    UNSCORABLE = "unscorable"        # parsed, but lacks what the task asks for
    BUDGET_ABORT = "budget_abort"
    TRANSPORT_ERROR = "transport_error"  # no output was produced, retries exhausted
    AGENT_ERROR = "agent_error"      # the agent raised unexpectedly
    SCORER_ERROR = "scorer_error"    # the scoring step itself failed

    @property
    def scorable(self) -> bool:
        return self in (RunStatus.SCORED, RunStatus.MULTIPLE_BLOCKS)

    @property
    def retry_on_resume(self) -> bool:
        """A run that never got to try (budget) or never got an answer (transport) is
        attempted again when the experiment is resumed; every other status is final,
        because re-asking after a bad answer would be cherry-picking."""
        return self in (RunStatus.BUDGET_ABORT, RunStatus.TRANSPORT_ERROR)


@dataclass(frozen=True)
class Requirement:
    """The task needs at least `min` elements with this tag (e.g. a pricing card needs a button)."""
    tag: str
    min: int = 1


@dataclass(frozen=True)
class Task:
    id: str
    split: str           # "dev" | "test"
    stratum: str         # see tasks.STRATA
    prompt: str
    requires: tuple[Requirement, ...] = ()


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    turns: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.turns += other.turns


@dataclass
class ToolCall:
    """One call the agent made to the accessibility tool."""
    name: str
    code: str | None = None          # the code it asked the tool to check, when it passed code
    violations_reported: int | None = None
    parsed: bool | None = None


@dataclass
class AgentError:
    kind: str            # "transport": no output was generated; "model": it answered, badly
    message: str


@dataclass
class AgentResult:
    raw_output: str = ""
    stop_reason: str | None = None
    transcript: list[dict[str, Any]] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    tool_calls: list[ToolCall] = field(default_factory=list)
    error: AgentError | None = None
    # What the agent was actually shown, for the record (system prompt, tool schemas).
    exposed: dict[str, Any] = field(default_factory=dict)

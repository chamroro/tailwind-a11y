"""Pulls the code out of a model's answer, with one fixed rule for every arm.

The rule is part of the pre-registered method, so it is deliberately plain and is
not tuned per arm:

  * a code block is a ``` fence (indented by at most three spaces) with an optional language tag and optional
    attributes after it (```tsx title=App.tsx), closed by a ``` fence; Windows line endings are accepted.
    Fences of four or more backticks and ~~~ fences are not recognised;
  * blocks tagged tsx, jsx, ts, typescript, js, javascript, or untagged are candidates
    (anything else, such as ```bash or ```css, is not the component);
  * exactly one candidate -> that is the code;
  * several candidates      -> the LAST one that contains JSX is the code (a trailing usage snippet such as
                               `import { A } from "./A"` is not the component); if none contains JSX, the last one.
                               The run is marked multiple_blocks so reports can show how often it happened;
  * an unclosed fence is NOT a block (a half-written block is not a finished answer);
  * no candidate            -> no_code_block, or truncated if the model stopped on its
                               token limit, or empty if there is no text at all;
  * a model that stopped on its token limit while a fence was still open is truncated even if an
    earlier block was complete: that block was a draft, not the answer.
"""
from __future__ import annotations

import re

from .models import RunStatus

_CANDIDATE_LANGS = {"", "tsx", "jsx", "ts", "typescript", "js", "javascript"}

# A fence must open at the start of a line. The closing fence must be a line of
# its own, so a ``` inside a string in the code does not end the block early.
_BLOCK = re.compile(r"^ {0,3}```[ \t]*([A-Za-z0-9_+-]*)[^\n`]*\n(.*?)^ {0,3}```[ \t]*$", re.DOTALL | re.MULTILINE)
_FENCE_LINE = re.compile(r"^ {0,3}```", re.MULTILINE)
_JSX = re.compile(r"<[A-Za-z][A-Za-z0-9.]*[\s/>]")


def extract_code(raw: str, stop_reason: str | None = None) -> tuple[RunStatus, str | None]:
    """Returns (status, code). `code` is set only for the two scorable statuses."""
    if raw is None or not raw.strip():
        return RunStatus.EMPTY, None

    raw = raw.replace("\r\n", "\n")
    candidates = [m.group(2) for m in _BLOCK.finditer(raw) if m.group(1).lower() in _CANDIDATE_LANGS]
    stopped_on_limit = stop_reason in ("max_tokens", "length")
    if stopped_on_limit and len(_FENCE_LINE.findall(raw)) % 2 == 1:
        return RunStatus.TRUNCATED, None

    if not candidates:
        if stopped_on_limit:
            return RunStatus.TRUNCATED, None
        return RunStatus.NO_CODE_BLOCK, None

    with_jsx = [c for c in candidates if _JSX.search(c)]
    code = (with_jsx or candidates)[-1].strip("\n")
    if not code.strip():
        return RunStatus.NO_CODE_BLOCK, None
    if len(candidates) > 1:
        return RunStatus.MULTIPLE_BLOCKS, code
    return RunStatus.SCORED, code

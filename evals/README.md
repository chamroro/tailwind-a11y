# evals

A harness for measuring one narrow thing: when a coding agent writes a React component, does having the
`mcp-tailwind-a11y` tool change how many violations the **engine** finds in what it writes?

This is not an accessibility benchmark, and the harness cannot prove that code became more accessible. Read
"What may be claimed" before quoting any number from it.

This directory is not an npm workspace, is not published, and is not part of CI.

## Status

| Part | State |
|---|---|
| Task files, extraction, scoring, budget, runner, report, tests | done, tested with a scripted agent |
| Bedrock agent (`--agent strands`) | **not written**. It needs an AWS account and is the next stage. The command refuses to run. |
| Any number from a real model | **none yet** |

Everything the tests pin about scoring, status handling, budget enforcement and the reading rules holds without a
model. Nothing here says anything about a model's behaviour until a real run exists.

## What may be claimed

A result may be written as: "With the same engine used for scoring, the agent's output had N distinct engine
findings per run in arm X and M in arm Y, on K tasks, for model Z in YYYY-MM. Scorer and tool are the same engine, so
this is not independent validation." Also: how often the agent called the tool, how often it changed its code after
the tool spoke, what it cost, and whether instructions alone produced most of the difference.

It may not be written as: "accessibility improved by N%", "WCAG compliance rate", "N% fewer accessibility bugs",
or anything about the engine's precision or false-positive rate. The agent in the tool arm is shown the scorer's
verdicts while it works, so a drop is close to guaranteed by construction. Zero findings does not mean accessible:
the engine reads only plain string `className` values, and a button with only `p-2`, an inline `style={{ color }}`,
or a dark-mode-only low contrast produce neither a finding nor a skip (`tests/test_scoring.py` pins these).

## Design

Arms. **A** nothing. **B** a WCAG 2.2 AA instruction that names what the tool checks but not how it decides.
**B2** B plus one self-review turn, so that C minus B2 approximates what the tool adds beyond "look again".
**C** the published MCP server, calling optional (intention-to-treat: runs that never call it still count).
`C_FORCED`, if used, is an upper bound on what the tool can do and is reported under its own name.

Tasks are ordinary component requests with no accessibility words in them (the loader rejects prompts that match a
fixed list of such words; it cannot catch every phrasing, so prompts are also read by a person). Each lists the
kinds of element a valid answer must contain, so that an answer which deletes the content to avoid findings is
`unscorable` instead of clean. This counts JSX written in the source, not elements rendered (a `.map()` or a
reusable component renders many from one), so every minimum is 1. Tasks are split into `dev` (prompts and arm wording may be tuned) and
`test` (frozen before the reported run; its sha256 is stored in the run file).

Scoring calls the engine's `analyzeSource` directly through `node/inspect.mjs`, not through the MCP server. The
server truncates its response at 200 violations and adds a protocol layer; neither belongs in a measurement. The
syntax-tree measures (elements, inline styles, dynamic class names, arbitrary-value classes, custom components,
lines) are computed independently of the engine and reported per arm, because a lower finding count can come from
writing code the engine cannot read.

Code extraction (one rule for every arm, in `extract.py`): fenced blocks tagged tsx, jsx, ts, typescript, js,
javascript or untagged, optionally followed by attributes. One block is the answer; with several, the last one that
contains JSX (so a trailing "usage" snippet is not mistaken for the component), marked `multiple_blocks`. An
unclosed fence is not a block, and an answer cut off by the token limit while a fence was open is `truncated` even
if an earlier block was complete. `~~~` fences and fences of four or more backticks are not recognised.

Run statuses. Every run ends in exactly one: `scored`, `multiple_blocks` (scored on the last block), `no_code_block`,
`empty`, `truncated`, `parsed_false`, `no_jsx`, `unscorable`, `budget_abort`, `transport_error`, `agent_error`,
`scorer_error`. Only the first two have a verdict. The primary metric counts every other status as **not shown
clean**; it never counts a failure as zero findings. Only a run that produced no output at all (transport error) is
retried, and not once the token or cost limit is reached; a bad answer is never re-rolled, and neither is a run
that a per-run limit stopped part-way (re-drawing those would favour the arms that make long runs). An answer the
agent itself flags as unusable (a refusal) is `agent_error`, not scored. `scorer_error` and `agent_error` are final;
the stored code can be re-scored by hand, there is no automatic path for it yet.

Statistics. The unit is the task, not the run: repeating a task k times reduces noise inside that task and tells
nothing about other tasks. Differences are taken per task, the interval resamples tasks (and, with about ten tasks,
is too narrow, so it is called approximate), and sign counts are shown beside it. There are no p-values.

A comparison is read as a decrease only if all of these hold, and at least 8 tasks are compared, and otherwise the report says "difference not
established" and lists why: at least 80% of tasks went down; the approximate interval excludes zero; the direction
also holds when runs with unreadable elements are counted as not clean; the unscorable rates of the two arms are
within 15 points; the syntax-tree measures do not differ by more than a factor of two; and arm A (the untreated baseline, for
every pair) is not at a floor (half or more of tasks already clean, under one distinct finding per run). Tasks with
runs in only one of the two arms are left out of that comparison and named in the reading. The syntax-tree medians
cover every run that parsed, including ones later classed `unscorable`. These thresholds are fixed in
`a11y_evals/analysis.py` before any real run.

## Budget

A hard limit is enforced in code on runs, total tokens, cost, tokens per run and turns per run. The totals apply to the
run file as a whole: resuming counts what earlier invocations already spent, including failed attempts. Whichever is
reached first stops new runs; the rest are written as `budget_abort` so the plan's denominators stay visible. A run aborted
by a per-run limit still has its usage counted. There are no default prices: `--pricing` must name a file with both
numbers filled in from the provider's current price page, or a billable run refuses to start.
`--dry-run` prints the plan and the most the limits would allow.

## Use

```bash
python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
npm run build -w tailwind-a11y   # from the repository root; the scorer needs the built engine
pytest
python -m a11y_evals.cli run --agent fake --split dev --out runs/demo.jsonl --dry-run
python -m a11y_evals.cli run --agent fake --split dev --out runs/demo.jsonl
python -m a11y_evals.cli report runs/demo.jsonl
```

`--agent fake` writes scripted answers with a made-up effect so that the whole pipeline can be exercised for free;
its report says nothing about any model. Run files are append-only JSON lines and resumable: running the same command
again finishes only what is not final. A file cannot be resumed after the task file, a prompt, the engine, the
seed or the agent changed; start a new file. One overshoot is possible: a model call already in flight when a limit is
crossed still completes and is counted.

## Before a reported run

1. Pilot arm A alone on a few tasks. If most are already clean there is no room for the tool to show anything, and
   the right result is to change the tasks (as a separately named stress set), not to run the full experiment.
2. Freeze `tasks/test.yaml` and the analysis, commit, and run from a clean tree. The run file records the commit,
   whether the tree was dirty, the task-file hash, prompts' digests, the engine version and the lockfile hash.
3. Do not edit prompts or tasks after looking at test results.
4. Audit a blinded random sample of outputs by hand against a fixed rubric before saying anything about the
   engine's agreement with a human. The harness has no such number.

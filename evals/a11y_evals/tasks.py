"""Loads and validates the task files. The files are frozen before a test run (their hash is
recorded in the result), so everything that can go wrong with a task is rejected here."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import yaml

from .models import Requirement, Task

TASKS_DIR = Path(__file__).resolve().parents[1] / "tasks"

STRATA = {
    "natural": "an ordinary request; the engine can read what is asked for",
    "cn_allowed": "the project is said to use a cn() class helper, so the engine will often not be able to read the classes",
    "engine_blind": "the natural structure puts the background outside the element (wrappers, composition)",
    "control": "no coloured text or interactive element worth flagging; the tool should change nothing",
}
SPLITS = ("dev", "test")

# A task prompt must not hint at what the tool checks. This is enforced, not hoped for:
# a prompt that says "readable" or "accessible" measures the instruction, not the tool.
_FORBIDDEN = re.compile(
    # "aria" is matched as a whole word only: as a substring it fires on "variant", which is not a hint.
    r"\baria\b|aria-|access|a11y|wcag|contrast|screen[\s-]?reader|keyboard|focus|readab|legib|disab(?:led|ility)|"
    r"colou?r[\s-]?blind|reduced[\s-]?motion|touch[\s-]?target|tap[\s-]?target|inclusive",
    re.IGNORECASE,
)


class TaskError(ValueError):
    pass


def forbidden_terms(prompt: str) -> list[str]:
    return sorted({m.group(0).lower() for m in _FORBIDDEN.finditer(prompt)})


def _parse(entry: dict, split: str, source: str) -> Task:
    for key in ("id", "stratum", "prompt"):
        if not isinstance(entry.get(key), str) or not entry[key].strip():
            raise TaskError(f"{source}: every task needs a non-empty string {key!r} (got {entry!r})")
    if entry["stratum"] not in STRATA:
        raise TaskError(f"{source}: task {entry['id']!r} has unknown stratum {entry['stratum']!r}; known: {sorted(STRATA)}")
    hits = forbidden_terms(entry["prompt"])
    if hits:
        raise TaskError(f"{source}: task {entry['id']!r} prompt mentions {hits}; a prompt must not hint at what is checked")
    if not entry.get("requires"):
        raise TaskError(f"{source}: task {entry['id']!r} has no `requires`; without it an answer that drops the content to avoid findings would be scored as clean")
    reqs = []
    for r in entry.get("requires", []) or []:
        minimum = r.get("min", 1) if isinstance(r, dict) else None
        if not isinstance(r, dict) or ("tag" in r) == ("any_of" in r):
            raise TaskError(f"{source}: task {entry['id']!r} has an invalid requirement {r!r}: give exactly one of `tag` or `any_of`")
        tags = [r["tag"]] if "tag" in r else r["any_of"]
        if (not isinstance(tags, list) or not tags or len(set(tags)) != len(tags)
                or not all(isinstance(t, str) and t for t in tags)
                or isinstance(minimum, bool) or not isinstance(minimum, int) or minimum < 1):
            raise TaskError(f"{source}: task {entry['id']!r} has an invalid requirement {r!r}")
        reqs.append(Requirement(tags=tuple(tags), min=minimum))
    return Task(id=entry["id"], split=split, stratum=entry["stratum"], prompt=entry["prompt"].strip(), requires=tuple(reqs))


def load_tasks(split: str, directory: Path = TASKS_DIR) -> list[Task]:
    if split not in SPLITS:
        raise TaskError(f"split must be one of {SPLITS}, got {split!r}")
    path = directory / f"{split}.yaml"
    if not path.is_file():
        raise TaskError(f"task file not found: {path}")
    data = yaml.safe_load(path.read_text())
    if not isinstance(data, dict) or not isinstance(data.get("tasks"), list) or not data["tasks"]:
        raise TaskError(f"{path}: expected a mapping with a non-empty 'tasks' list")
    tasks = [_parse(e, split, str(path)) for e in data["tasks"]]
    ids = [t.id for t in tasks]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise TaskError(f"{path}: duplicate task ids {dupes}")
    return tasks


def load_all(directory: Path = TASKS_DIR) -> dict[str, list[Task]]:
    out = {s: load_tasks(s, directory) for s in SPLITS}
    overlap = {t.id for t in out["dev"]} & {t.id for t in out["test"]}
    if overlap:
        raise TaskError(f"task ids appear in both dev and test: {sorted(overlap)}")
    return out


def file_hash(split: str, directory: Path = TASKS_DIR) -> str:
    return hashlib.sha256((directory / f"{split}.yaml").read_bytes()).hexdigest()

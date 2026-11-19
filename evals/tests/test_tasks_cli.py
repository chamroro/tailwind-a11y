import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from a11y_evals import arms as arms_mod
from a11y_evals.cli import main
from a11y_evals.models import Arm
from a11y_evals.tasks import TaskError, forbidden_terms, load_all, load_tasks

EVALS = Path(__file__).resolve().parents[1]


def write(tmp_path, split, tasks):
    (tmp_path / f"{split}.yaml").write_text(yaml.safe_dump({"tasks": tasks}))
    return tmp_path


def entry(**o):
    return {**{"id": "t1", "stratum": "natural", "prompt": "Build a card with a button.", "requires": [{"tag": "button", "min": 1}]}, **o}


def test_shipped_tasks_load_and_do_not_overlap():
    allt = load_all()
    assert len(allt["dev"]) >= 3 and len(allt["test"]) >= 10
    ids = [t.id for ts in allt.values() for t in ts]
    assert len(ids) == len(set(ids))


def test_shipped_prompts_contain_no_hint_words():
    for ts in load_all().values():
        for t in ts:
            assert forbidden_terms(t.prompt) == [], t.id


@pytest.mark.parametrize("prompt", ["Make it accessible", "good contrast please", "keyboard friendly", "WCAG AA", "works with a screen reader",
                                    "with aria-label", "visible focus ring", "supports reduced motion", "large touch target"])
def test_hint_words_are_rejected(prompt):
    assert forbidden_terms(prompt)


def test_variant_is_not_a_hint():
    assert forbidden_terms("a button with primary and secondary variants") == []


def test_a_task_with_a_hint_does_not_load(tmp_path):
    with pytest.raises(TaskError):
        load_tasks("dev", write(tmp_path, "dev", [entry(prompt="Build an accessible card")]))


@pytest.mark.parametrize("bad", [
    entry(stratum="nope"), entry(requires=[]), entry(requires=[{"tag": "button", "min": 0}]), entry(id=""),
    entry(requires=[{"tag": "button", "any_of": ["button", "input"]}]),   # both forms
    entry(requires=[{"min": 1}]),                                          # neither form
    entry(requires=[{"any_of": []}]), entry(requires=[{"any_of": ["a", "a"]}]), entry(requires=[{"any_of": ["a", 3]}]),
    entry(requires=[{"any_of": "button"}]), entry(requires=[{"any_of": ["button"], "min": True}]), entry(requires=["button"]),
])
def test_malformed_tasks_do_not_load(tmp_path, bad):
    with pytest.raises(TaskError):
        load_tasks("dev", write(tmp_path, "dev", [bad]))


def test_duplicate_ids_do_not_load(tmp_path):
    with pytest.raises(TaskError):
        load_tasks("dev", write(tmp_path, "dev", [entry(), entry()]))


def test_ids_shared_between_dev_and_test_are_rejected(tmp_path):
    write(tmp_path, "dev", [entry()])
    write(tmp_path, "test", [entry()])
    with pytest.raises(TaskError):
        load_all(tmp_path)


def test_arm_prompts_do_not_leak_the_engines_rules():
    b = arms_mod.ARM_SPECS[Arm.B].system_prompt
    assert "WCAG 2.2" in b
    for leak in ("text-gray-600", "gray-600", "axe", "tailwind-a11y"):
        assert leak not in b
    assert arms_mod.ARM_SPECS[Arm.A].system_prompt in (None, "") or "WCAG" not in arms_mod.ARM_SPECS[Arm.A].system_prompt


def test_arm_digests_differ():
    d = {a: s.digest() for a, s in arms_mod.ARM_SPECS.items()}
    assert len(set(d.values())) == len(d)


# ----------------------------------------------------------------- command line

def test_dry_run_prints_plan_and_ceiling_and_writes_nothing(tmp_path, capsys):
    out = tmp_path / "x.jsonl"
    assert main(["run", "--split", "test", "--k", "2", "--out", str(out), "--dry-run"]) == 0
    text = capsys.readouterr().out
    assert "96 runs" in text and "worst case" in text and "tokens=" in text
    assert not out.exists()


def test_dry_run_ceiling_respects_the_limits(tmp_path, capsys):
    main(["run", "--split", "test", "--out", str(tmp_path / "x"), "--dry-run", "--max-runs", "5", "--max-tokens-per-run", "1000"])
    text = capsys.readouterr().out
    assert "runs=5" in text and "tokens=5,000" in text and "budget_abort" in text


@pytest.mark.usefixtures("cached_shim")
def test_a_run_then_a_report(tmp_path, capsys):
    out = tmp_path / "x.jsonl"
    assert main(["run", "--split", "dev", "--k", "1", "--out", str(out)]) == 0
    assert main(["run", "--split", "dev", "--k", "1", "--out", str(out)]) == 0
    assert "nothing to do" in capsys.readouterr().out
    assert main(["report", str(out)]) == 0
    assert "# Evaluation report" in capsys.readouterr().out


@pytest.mark.usefixtures("cached_shim")
def test_the_meta_record_says_what_produced_the_run(tmp_path):
    out = tmp_path / "x.jsonl"
    main(["run", "--split", "dev", "--out", str(out), "--arms", "A,B"])
    meta = json.loads(out.read_text().splitlines()[0])
    for key in ("engine_version", "task_file_sha256", "arm_digests", "harness_git_sha", "package_lock_sha256", "limits", "seed", "node", "python", "scoring"):
        assert meta.get(key) not in (None, ""), key
    assert set(meta["arm_digests"]) == {"A", "B"} and meta["agent"]["agent"] == "fake"


def test_the_live_agent_is_refused_without_a_model_and_writes_nothing(tmp_path, capsys):
    assert main(["run", "--agent", "strands", "--out", str(tmp_path / "x")]) == 2
    assert "--model-id" in capsys.readouterr().err
    assert not (tmp_path / "x").exists()


def test_invalid_limits_and_k_are_refused(tmp_path, capsys):
    assert main(["run", "--out", str(tmp_path / "x"), "--max-runs", "0"]) == 2
    assert main(["run", "--out", str(tmp_path / "x"), "--k", "0"]) == 2


def test_report_on_a_missing_file(tmp_path, capsys):
    assert main(["report", str(tmp_path / "none")]) == 2


def test_a_requirement_may_list_alternatives(tmp_path):
    t = load_tasks("dev", write(tmp_path, "dev", [entry(requires=[{"any_of": ["button", "input"], "min": 2}, {"tag": "a"}])]))[0]
    assert [(r.tags, r.min) for r in t.requires] == [(("button", "input"), 2), (("a",), 1)]
    assert t.requires[0].tag == "button" and t.requires[0].label == "button|input"


def test_a_tag_that_only_one_kind_of_markup_satisfies_is_named_in_the_prompt():
    """A requirement for `li` that the prompt does not ask for discards good answers that use another element
    (found in a pilot: a model wrote a list of badges as divs). Either the prompt says li, or the requirement has alternatives."""
    for split, tasks in load_all().items():
        for t in tasks:
            for r in t.requires:
                if r.tags == ("li",):
                    assert "li" in t.prompt.split(), f"{split}/{t.id} requires li but its prompt does not name it"

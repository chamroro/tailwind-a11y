import json

import pytest

from a11y_evals.agents.fake import FakeAgent, FakeBehavior, fenced, make_code
from a11y_evals.budget import BudgetExceeded
from a11y_evals.models import Arm, RunStatus
from a11y_evals.runner import RunFile, execute, make_plan, run_experiment, run_id
from a11y_evals.scoring import Scored

from helpers import make_budget


def quiet(task, arm, rep):
    return FakeBehavior(violations=1)


def stub_scorer(task, code, **kw):
    return Scored(RunStatus.SCORED, None)


def one(task, policy, arm=Arm.A, budget=None, retries=2, scorer=None):
    agent = FakeAgent(policy)
    b = budget or make_budget()
    kw = {"scorer": scorer} if scorer else {}
    return agent, b, execute(task, arm, 0, agent, b, max_transport_retries=retries, sleep=lambda s: None, **kw)


# ----------------------------------------------------------------- one run

def test_a_normal_run_is_scored_with_the_findings_recorded(task):
    _, _, rec = one(task, lambda t, a, r: FakeBehavior(violations=2))
    assert rec["status"] == "scored" and rec["attempts"] == 1
    assert len(rec["score"]["aa"]["violations"]) == 2
    assert rec["raw_output"].startswith("Here is")  # the answer is kept as given, not only the extracted code


def test_transport_failure_is_retried_and_stays_the_same_repetition(task):
    agent, _, rec = one(task, lambda t, a, r: FakeBehavior(transport_failures=2))
    assert rec["status"] == "scored" and rec["attempts"] == 3 and agent.attempts == 3


def test_transport_failure_beyond_retries_is_recorded_not_dropped(task):
    _, _, rec = one(task, lambda t, a, r: FakeBehavior(transport_failures=9), retries=2)
    assert rec["status"] == "transport_error" and rec["attempts"] == 3 and rec["score"] is None


def test_a_bad_answer_is_not_retried(task):
    agent, _, rec = one(task, lambda t, a, r: FakeBehavior(raw_output="I cannot help with that."))
    assert rec["status"] == "no_code_block" and agent.attempts == 1


def test_model_error_is_not_retried(task):
    agent, _, rec = one(task, lambda t, a, r: FakeBehavior(model_error=True))
    assert agent.attempts == 1


@pytest.mark.parametrize("behaviour,status", [
    (FakeBehavior(raw_output=""), "empty"),
    (FakeBehavior(raw_output="```tsx\nexport const A", stop_reason="max_tokens"), "truncated"),
    (FakeBehavior(raw_output=fenced("export const A = () => <div>;")), "parsed_false"),
    (FakeBehavior(raw_output=fenced("export const A = 1;")), "no_jsx"),
    (FakeBehavior(raw_output=fenced('export const A = () => <p className="text-gray-900">x</p>;')), "unscorable"),
])
def test_failures_to_produce_scorable_code_have_their_own_status_and_no_score_claim(task, behaviour, status):
    _, _, rec = one(task, lambda t, a, r: behaviour)
    assert rec["status"] == status
    assert not RunStatus(rec["status"]).scorable


def test_multiple_blocks_are_scored_and_marked(task):
    raw = fenced("export const x = <b />;") + fenced(make_code(task, 1))
    _, _, rec = one(task, lambda t, a, r: FakeBehavior(raw_output=raw))
    assert rec["status"] == "multiple_blocks" and len(rec["score"]["aa"]["violations"]) == 1


def test_an_agent_that_raises_is_recorded_and_does_not_escape(task):
    _, _, rec = one(task, lambda t, a, r: FakeBehavior(raises=RuntimeError("boom")))
    assert rec["status"] == "agent_error" and "boom" in rec["detail"]


def test_scorer_failure_is_recorded_as_such(task):
    def broken(t, c, **kw):
        return Scored(RunStatus.SCORER_ERROR, None, detail="node missing")
    _, _, rec = one(task, quiet, scorer=broken)
    assert rec["status"] == "scorer_error"


def test_a_run_over_its_own_limit_is_aborted_and_what_it_used_is_still_counted(task):
    b = make_budget(max_turns_per_run=3)
    _, _, rec = one(task, lambda t, a, r: FakeBehavior(turns=10, tokens=(200, 400)), budget=b)
    assert rec["status"] == "budget_abort"
    assert b.usage.total_tokens == 3 * 600  # three model calls were made and paid for
    assert rec["usage"]["output_tokens"] == 3 * 400


# ----------------------------------------------------------------- the C arm's use of the tool

def c_behaviour(task, behaviour):
    return one(task, lambda t, a, r: behaviour, arm=Arm.C)[2]["behaviour"]


def test_no_call_is_recorded_as_no_call(task):
    b = c_behaviour(task, FakeBehavior(violations=2))
    assert b["called"] is False and b["n_check_calls"] == 0 and b["changed_code_after_first_check"] is None


def test_call_then_fix(task):
    b = c_behaviour(task, FakeBehavior(violations=2, checks=[2, 0], code_after_check=0))
    assert b["called"] and b["n_check_calls"] == 2 and b["first_check_violations"] == 2
    assert b["changed_code_after_first_check"] is True and b["last_checked_is_submitted"] is True


def test_call_then_ignore(task):
    b = c_behaviour(task, FakeBehavior(violations=2, checks=[2]))
    assert b["called"] and b["changed_code_after_first_check"] is False and b["last_checked_is_submitted"] is True


def test_checked_code_that_is_not_the_submitted_code(task):
    b = c_behaviour(task, FakeBehavior(violations=0, checks=[0], checked_other_code=True))
    assert b["called"] and b["last_checked_is_submitted"] is False


def test_other_arms_have_no_behaviour_record(task):
    assert one(task, quiet, arm=Arm.A)[2]["behaviour"] is None


# ----------------------------------------------------------------- the file

def test_records_are_json_lines_and_last_one_wins(tmp_path):
    f = RunFile(tmp_path / "r.jsonl")
    f.append({"kind": "run", "run_id": "t|A|0", "status": "transport_error"})
    f.append({"kind": "run", "run_id": "t|A|0", "status": "scored"})
    f.append({"kind": "run", "run_id": "t|B|0", "status": "scored"})
    assert f.runs()["t|A|0"]["status"] == "scored" and len(f.runs()) == 2


def test_a_torn_last_line_is_ignored(tmp_path):
    f = RunFile(tmp_path / "r.jsonl")
    f.append({"kind": "run", "run_id": "a", "status": "scored"})
    with open(f.path, "a") as fh:
        fh.write('{"kind": "run", "run_id": "b", "sta')  # the process died mid-write
    assert list(f.runs()) == ["a"]


def test_corruption_in_the_middle_is_an_error_not_silently_skipped(tmp_path):
    f = RunFile(tmp_path / "r.jsonl")
    f.append({"kind": "run", "run_id": "a", "status": "scored"})
    with open(f.path, "a") as fh:
        fh.write("not json\n")
    f.append({"kind": "run", "run_id": "c", "status": "scored"})
    with pytest.raises(ValueError):
        f.read()


def test_each_record_is_one_line(tmp_path):
    f = RunFile(tmp_path / "r.jsonl")
    f.append({"kind": "run", "run_id": "a", "raw_output": "line1\nline2", "status": "scored"})
    assert len(f.path.read_text().splitlines()) == 1


# ----------------------------------------------------------------- the experiment

def experiment(tmp_path, tasks, policy=quiet, budget=None, k=1, arms=(Arm.A, Arm.B), agent=None, out=None):
    out = out or RunFile(tmp_path / "r.jsonl")
    agent = agent or FakeAgent(policy)
    counts = run_experiment(make_plan(tasks, list(arms), k, seed=1), agent, budget or make_budget(), out,
                            meta={"kind": "meta"}, sleep=lambda s: None, scorer=stub_scorer)
    return out, counts, agent


def test_plan_covers_every_combination_in_a_seeded_mixed_order(test_tasks):
    p = make_plan(test_tasks, [Arm.A, Arm.B, Arm.C], 2, seed=7)
    assert len(p) == len(test_tasks) * 3 * 2
    assert len({run_id(t.id, a.value, r) for t, a, r in p.items}) == len(p)
    assert [(t.id, a, r) for t, a, r in p.items] == [(t.id, a, r) for t, a, r in make_plan(test_tasks, [Arm.A, Arm.B, Arm.C], 2, seed=7).items]
    arms_in_first_half = {a for _, a, _ in p.items[: len(p) // 2]}
    assert len(arms_in_first_half) == 3  # not grouped by arm


def test_one_failing_run_does_not_stop_the_others(tmp_path, test_tasks):
    def policy(task, arm, rep):
        return FakeBehavior(raises=RuntimeError("x")) if task.id == test_tasks[0].id else FakeBehavior()
    out, counts, _ = experiment(tmp_path, test_tasks[:3], policy)
    assert counts == {"agent_error": 2, "scored": 4}
    assert out.meta() == {"kind": "meta"} and len(out.runs()) == 6


def test_budget_stop_writes_the_unrun_items_as_budget_abort(tmp_path, test_tasks):
    out, counts, agent = experiment(tmp_path, test_tasks[:3], budget=make_budget(max_runs=4))
    assert counts == {"scored": 4, "budget_abort": 2} and agent.attempts == 4
    assert len(out.runs()) == 6  # the denominators show what was planned


def test_resuming_runs_only_the_rest_and_never_double_counts(tmp_path, test_tasks):
    out, _, agent1 = experiment(tmp_path, test_tasks[:3], budget=make_budget(max_runs=4))
    before = {k: v for k, v in out.runs().items() if v["status"] == "scored"}
    _, counts, agent2 = experiment(tmp_path, test_tasks[:3], out=out)
    assert counts == {"scored": 2} and agent2.attempts == 2
    final = out.runs()
    assert len(final) == 6 and all(v["status"] == "scored" for v in final.values())
    assert all(final[k] == v for k, v in before.items())  # finished runs were left alone
    assert len([r for r in out.read() if r.get("kind") == "meta"]) == 1


def test_resume_does_not_re_roll_a_bad_answer(tmp_path, test_tasks):
    bad = lambda t, a, r: FakeBehavior(raw_output="no code")
    out, _, _ = experiment(tmp_path, test_tasks[:2], bad)
    _, counts, agent = experiment(tmp_path, test_tasks[:2], quiet, out=out)
    assert counts == {} and agent.attempts == 0
    assert all(v["status"] == "no_code_block" for v in out.runs().values())


def test_resume_retries_a_transport_failure(tmp_path, test_tasks):
    flaky = lambda t, a, r: FakeBehavior(transport_failures=99)
    out, counts, _ = experiment(tmp_path, test_tasks[:1], flaky, arms=(Arm.A,))
    assert counts == {"transport_error": 1}
    _, counts, _ = experiment(tmp_path, test_tasks[:1], quiet, arms=(Arm.A,), out=out)
    assert counts == {"scored": 1} and out.runs()["%s|A|0" % test_tasks[0].id]["status"] == "scored"


def test_budget_counts_each_run_once(tmp_path, test_tasks):
    b = make_budget()
    experiment(tmp_path, test_tasks[:2], budget=b)
    assert b.runs_started == 4 and b.usage.total_tokens == 4 * 600


# ----------------------------------------------------------------- fixes found in review

class Scripted:
    """An agent whose attempts are given one by one, to control exactly what each attempt used."""
    billable = False

    def __init__(self, results):
        self.results, self.attempts = list(results), 0

    def describe(self):
        return {"agent": "scripted"}

    def run(self, task, arm, budget):
        self.attempts += 1
        return self.results.pop(0)


def good(task, tokens=(10, 10)):
    from a11y_evals.models import AgentResult, Usage
    return AgentResult(raw_output=fenced(make_code(task, 0)), stop_reason="end_turn", usage=Usage(*tokens, 1))


def failed(tokens):
    from a11y_evals.models import AgentError, AgentResult, Usage
    return AgentResult(error=AgentError("transport", "reset"), usage=Usage(*tokens, 1))


def test_tokens_used_by_failed_attempts_are_counted(task):
    b = make_budget()
    agent = Scripted([failed((1000, 1000)), good(task)])
    rec = execute(task, Arm.A, 0, agent, b, max_transport_retries=2, sleep=lambda s: None)
    assert rec["status"] == "scored" and rec["attempts"] == 2
    assert b.usage.total_tokens == 2020 and rec["usage"]["input_tokens"] == 1010


def test_a_retry_is_not_made_once_the_token_budget_is_spent(task):
    b = make_budget(max_total_tokens=2000)
    agent = Scripted([failed((1000, 1000)), good(task)])
    rec = execute(task, Arm.A, 0, agent, b, max_transport_retries=2, sleep=lambda s: None)
    assert rec["status"] == "transport_error" and agent.attempts == 1 and "not retried" in rec["detail"]


def test_a_scorer_that_raises_is_recorded_and_the_spend_is_kept(task):
    b = make_budget()

    def boom(t, c, **kw):
        raise KeyError("engine_version")
    rec = execute(task, Arm.A, 0, FakeAgent(quiet), b, max_transport_retries=0, sleep=lambda s: None, scorer=boom)
    assert rec["status"] == "scorer_error" and "KeyError" in rec["detail"]
    assert rec["usage"]["input_tokens"] == 200 and b.usage.total_tokens == 600


def test_an_answer_the_agent_flags_as_unusable_is_not_scored(task):
    _, _, rec = one(task, lambda t, a, r: FakeBehavior(model_error=True, violations=0))
    assert rec["status"] == "agent_error" and "refused" in rec["detail"] and rec["score"] is None


def test_a_record_after_a_torn_line_is_not_lost(tmp_path):
    f = RunFile(tmp_path / "r.jsonl")
    f.append({"kind": "run", "run_id": "a", "status": "scored"})
    with open(f.path, "a") as fh:
        fh.write('{"kind": "run", "run_id": "b", "sta')
    f.append({"kind": "run", "run_id": "c", "status": "scored"})
    f.append({"kind": "run", "run_id": "d", "status": "scored"})
    assert list(f.runs()) == ["a", "c", "d"]


def test_text_that_cannot_be_encoded_does_not_lose_the_record(tmp_path):
    f = RunFile(tmp_path / "r.jsonl")
    f.append({"kind": "run", "run_id": "a", "raw_output": "bad \ud800 surrogate", "status": "scored"})
    assert f.runs()["a"]["raw_output"] == "bad \ud800 surrogate"


def test_a_run_stopped_by_its_own_limit_is_final_on_resume(tmp_path, test_tasks):
    long = lambda t, a, r: FakeBehavior(turns=10)
    out, counts, _ = experiment(tmp_path, test_tasks[:1], long, budget=make_budget(max_turns_per_run=3), arms=(Arm.A,))
    assert counts == {"budget_abort": 1}
    _, counts, agent = experiment(tmp_path, test_tasks[:1], quiet, arms=(Arm.A,), out=out)
    assert counts == {} and agent.attempts == 0
    assert out.runs()[run_id(test_tasks[0].id, "A", 0)]["status"] == "budget_abort"


def test_limits_apply_to_the_file_not_to_one_process(tmp_path, test_tasks):
    out, _, _ = experiment(tmp_path, test_tasks[:3], arms=(Arm.A,))           # 3 runs, 1800 tokens
    b = make_budget(max_total_tokens=1800)
    _, counts, agent = experiment(tmp_path, test_tasks[:3], arms=(Arm.A,), k=2, budget=b, out=out)
    assert agent.attempts == 0 and counts == {"budget_abort": 3}
    b = make_budget(max_runs=4)
    _, counts, agent = experiment(tmp_path, test_tasks[:3], arms=(Arm.A,), k=2, budget=b, out=RunFile(tmp_path / "r.jsonl"))
    assert agent.attempts == 1  # 3 runs already started, room for one more


def test_a_file_cannot_be_resumed_under_different_settings(tmp_path, test_tasks):
    out = RunFile(tmp_path / "r.jsonl")
    out.append({"kind": "meta", "split": "test", "seed": 1, "task_file_sha256": "aaa", "arm_digests": {"A": "x"}})
    with pytest.raises(ValueError, match="task_file_sha256"):
        run_experiment(make_plan(test_tasks[:1], [Arm.A], 1, 1), FakeAgent(quiet), make_budget(), out,
                       meta={"kind": "meta", "split": "test", "seed": 1, "task_file_sha256": "bbb", "arm_digests": {"A": "x"}})
    with pytest.raises(ValueError, match="arm A"):
        run_experiment(make_plan(test_tasks[:1], [Arm.A], 1, 1), FakeAgent(quiet), make_budget(), out,
                       meta={"kind": "meta", "split": "test", "seed": 1, "task_file_sha256": "aaa", "arm_digests": {"A": "changed"}})
    assert out.runs() == {}


def test_the_same_arm_twice_is_refused(test_tasks):
    with pytest.raises(ValueError, match="duplicate arm"):
        make_plan(test_tasks[:2], [Arm.A, Arm.A], 1, 0)
    with pytest.raises(ValueError, match="duplicate task"):
        make_plan([test_tasks[0], test_tasks[0]], [Arm.A], 1, 0)

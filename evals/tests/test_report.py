import pytest

from a11y_evals.agents.fake import FakeAgent, FakeBehavior
from a11y_evals.analysis import compare, compare_distinct, floor_effect, per_task, views
from a11y_evals.models import Arm
from a11y_evals.report import CAVEAT, render
from a11y_evals.runner import RunFile, make_plan, run_experiment
from a11y_evals.stats import cluster_bootstrap, paired_diffs, sign_counts, wilson

from helpers import make_budget

pytestmark = pytest.mark.usefixtures("cached_shim")


def run(tmp_path, tasks, policy, arms=(Arm.A, Arm.B, Arm.B2, Arm.C), k=1, name="r.jsonl"):
    out = RunFile(tmp_path / name)
    run_experiment(make_plan(tasks, list(arms), k, seed=3), FakeAgent(policy), make_budget(), out, meta={"kind": "meta"}, sleep=lambda s: None)
    return out


def by_arm(table):
    return lambda t, a, r: FakeBehavior(violations=table[a])


# ----------------------------------------------------------------- statistics

def test_paired_diffs_only_for_tasks_in_both():
    assert paired_diffs({"a": 1, "b": 2}, {"b": 5, "c": 9}) == {"b": 3}


def test_sign_counts():
    assert sign_counts([-1, -0.5, 0, 0, 2]) == {"down": 2, "same": 2, "up": 1}


def test_bootstrap_interval_collapses_for_identical_diffs_and_spans_zero_for_mixed():
    m, lo, hi = cluster_bootstrap([-1.0] * 10)
    assert (m, lo, hi) == (-1.0, -1.0, -1.0)
    m, lo, hi = cluster_bootstrap([-1, 1, -1, 1, -1, 1, 0, 0, 1, -1])
    assert lo < 0 < hi


def test_bootstrap_is_seeded():
    d = [-1, 0, 0.5, -0.25, 1]
    assert cluster_bootstrap(d, seed=4) == cluster_bootstrap(d, seed=4)


def test_bootstrap_without_tasks_is_an_error():
    with pytest.raises(ValueError):
        cluster_bootstrap([])


def test_wilson():
    lo, hi = wilson(0, 10)
    assert lo == 0.0 and 0.25 < hi < 0.35
    assert wilson(0, 0) == (0.0, 1.0)
    lo, hi = wilson(10, 10)
    assert hi == 1.0 and lo > 0.65


# ----------------------------------------------------------------- the pipeline recovers what was built in

def test_a_built_in_effect_is_recovered_exactly(tmp_path, test_tasks):
    out = run(tmp_path, test_tasks, by_arm({Arm.A: 3, Arm.B: 2, Arm.B2: 1, Arm.C: 0}), k=2)
    vs = views(out.runs().values())
    assert set(per_task(vs, "A", "aa_violations").values()) == {3.0}
    assert set(per_task(vs, "C", "aa_violations").values()) == {0.0}
    assert set(per_task(vs, "B", "aa_unique").values()) == {2.0}
    c = compare(vs, "A", "C")
    assert c.n_tasks == len(test_tasks) and c.mean_diff == -1.0 and (c.low, c.high) == (-1.0, -1.0)
    assert c.signs == {"down": len(test_tasks), "same": 0, "up": 0}
    assert c.verdict == "consistent_decrease" and c.reasons == []
    n, m, lo, hi, signs = compare_distinct(vs, "A", "C")
    assert m == -3.0


def test_with_no_effect_there_is_no_improvement_reading(tmp_path, test_tasks):
    out = run(tmp_path, test_tasks, by_arm({Arm.A: 3, Arm.B: 3, Arm.B2: 3, Arm.C: 3}), k=2)
    vs = views(out.runs().values())
    for a, b in [("A", "B"), ("B", "B2"), ("B2", "C"), ("A", "C")]:
        c = compare(vs, a, b)
        assert c.verdict == "indistinguishable" and c.mean_diff == 0.0
    text = render(out)
    assert "consistent decrease" not in text


def test_a_noisy_tie_is_not_read_as_an_improvement(tmp_path, test_tasks):
    # Task by task the arms differ in both directions with no net effect.
    ids = [t.id for t in test_tasks]

    def policy(task, arm, rep):
        flip = ids.index(task.id) % 2 == 0
        return FakeBehavior(violations=(0 if flip else 3) if arm == Arm.C else (3 if flip else 0))
    out = run(tmp_path, test_tasks, policy, arms=(Arm.A, Arm.C))
    c = compare(views(out.runs().values()), "A", "C")
    assert c.verdict == "indistinguishable" and c.low < 0 < c.high


def test_failing_to_produce_code_never_looks_like_an_improvement(tmp_path, test_tasks):
    # Arm C is "clean" only because half of its answers are not code at all.
    def policy(task, arm, rep):
        if arm == Arm.C:
            return FakeBehavior(raw_output="Here is a description of the component.")
        return FakeBehavior(violations=2)
    out = run(tmp_path, test_tasks, policy, arms=(Arm.A, Arm.C))
    vs = views(out.runs().values())
    assert all(v.not_shown_clean == 1 for v in vs if v.arm == "C")
    c = compare(vs, "A", "C")
    assert c.mean_diff == 0.0 and c.verdict == "indistinguishable"
    assert "unscorable rate differs" in " ".join(c.reasons)


def test_unscorable_runs_stay_in_the_denominator(tmp_path, test_tasks):
    def policy(task, arm, rep):
        return FakeBehavior(raw_output="nothing") if rep == 1 else FakeBehavior(violations=0)
    out = run(tmp_path, test_tasks[:3], policy, arms=(Arm.A,), k=2)
    vs = views(out.runs().values())
    assert len(vs) == 6
    assert set(per_task(vs, "A", "not_shown_clean").values()) == {0.5}  # half the repetitions had no verdict
    assert set(per_task(vs, "A", "aa_violations").values()) == {0.0}    # only the scored ones have a count


def test_a_clean_but_unreadable_run_is_not_shown_clean_in_the_upper_bound(tmp_path, test_tasks):
    dyn = lambda t, a, r: FakeBehavior(violations=0)
    out = run(tmp_path, test_tasks[:1], dyn, arms=(Arm.A,))
    v = views(out.runs().values())[0]
    assert v.not_shown_clean == 0 and v.upper_not_shown_clean == 0
    v.aa_skipped = 2
    assert v.upper_not_shown_clean == 1 and v.not_shown_clean == 0


def test_repetitions_do_not_make_the_interval_tighter(tmp_path, test_tasks):
    """The unit is the task: k=1 and k=5 of the same behaviour give the same interval."""
    ids = [t.id for t in test_tasks]
    policy = lambda task, arm, rep: FakeBehavior(violations=(0 if arm == Arm.C and ids.index(task.id) % 3 else 2))
    a = compare(views(run(tmp_path, test_tasks, policy, arms=(Arm.A, Arm.C), k=1, name="k1.jsonl").runs().values()), "A", "C")
    b = compare(views(run(tmp_path, test_tasks, policy, arms=(Arm.A, Arm.C), k=5, name="k5.jsonl").runs().values()), "A", "C")
    assert a.n_tasks == b.n_tasks == len(test_tasks)
    assert (a.mean_diff, a.low, a.high) == (b.mean_diff, b.low, b.high)


def test_floor_effect_blocks_the_reading(tmp_path, test_tasks):
    out = run(tmp_path, test_tasks, by_arm({Arm.A: 0, Arm.B: 0, Arm.B2: 0, Arm.C: 0}))
    vs = views(out.runs().values())
    assert floor_effect(vs, "A")[0] is True
    c = compare(vs, "A", "C")
    assert c.verdict == "indistinguishable" and any("floor effect" in r for r in c.reasons)
    assert "do not read these comparisons" in render(out)


def test_no_floor_when_the_baseline_has_findings(tmp_path, test_tasks):
    vs = views(run(tmp_path, test_tasks, by_arm({Arm.A: 3, Arm.B: 3, Arm.B2: 3, Arm.C: 0})).runs().values())
    assert floor_effect(vs, "A")[0] is False


def test_a_difference_in_how_code_is_written_blocks_the_reading(tmp_path, test_tasks):
    def policy(task, arm, rep):
        if arm == Arm.C:  # clean, but only by moving everything into inline styles
            return FakeBehavior(violations=0, raw_output="```tsx\n" + 'export const A = () => <div>' + "".join(
                f'<p style={{{{color: "#ccc"}}}}>{i}</p>' for i in range(8)) + "</div>;\n```")
        return FakeBehavior(violations=3)
    out = run(tmp_path, test_tasks, policy, arms=(Arm.A, Arm.C))
    c = compare(views(out.runs().values()), "A", "C")
    # Those answers also lack what the task requires, so they are unscorable and cannot look better; either way no improvement is read.
    assert c.verdict == "indistinguishable"


# ----------------------------------------------------------------- the rendered report

def test_report_always_ends_with_the_circularity_caveat(tmp_path, test_tasks):
    text = render(run(tmp_path, test_tasks[:3], by_arm({Arm.A: 1, Arm.B: 1, Arm.B2: 1, Arm.C: 0})))
    assert text.rstrip().endswith(CAVEAT)
    assert "same engine" in CAVEAT and "not independent evidence" in CAVEAT


def test_report_of_an_empty_file_says_so_and_keeps_the_caveat(tmp_path):
    text = render(RunFile(tmp_path / "none.jsonl"))
    assert "No runs recorded" in text and CAVEAT in text


def test_report_lists_status_counts_and_tool_use(tmp_path, test_tasks):
    def policy(task, arm, rep):
        if arm == Arm.C:
            return FakeBehavior(violations=2, checks=[2, 0], code_after_check=0)
        return FakeBehavior(raw_output="no code") if arm == Arm.B else FakeBehavior(violations=2)
    text = render(run(tmp_path, test_tasks[:4], policy, arms=(Arm.A, Arm.B, Arm.C)))
    assert "no_code_block" in text and "## Tool use" in text and "4/4 (100%" in text


# ----------------------------------------------------------------- the reading rules, on hand-built records

def hand_views(arm, per_task_not_clean):
    """RunViews from {task: [1 or 0 per repetition]}: 1 = a scored run with a finding, 0 = a scored clean run."""
    from a11y_evals.analysis import RunView
    from a11y_evals.models import RunStatus
    out = []
    for task_id, reps in per_task_not_clean.items():
        for i, x in enumerate(reps):
            out.append(RunView(task_id=task_id, arm=arm, rep=i, stratum="natural", status=RunStatus.SCORED,
                               aa_violations=int(x), aa_unique=int(x), aa_skipped=0, strict_violations=int(x)))
    return out


def lopsided():
    """8 tasks improve a little (-0.4), 2 get much worse (+1.0): 80% of tasks go down, the mean is -0.12, and
    resampling tasks can easily put the mean above zero."""
    a, c = {}, {}
    for i in range(8):
        a[f"t{i}"], c[f"t{i}"] = [1] * 10, [1] * 6 + [0] * 4
    for i in range(8, 10):
        a[f"t{i}"], c[f"t{i}"] = [0] * 10, [1] * 10
    return hand_views("A", a) + hand_views("C", c)


def test_a_mostly_negative_mean_is_not_enough_when_the_interval_includes_zero():
    c = compare(lopsided(), "A", "C")
    assert c.signs["down"] / c.n_tasks >= 0.8 and c.mean_diff < 0
    assert c.high > 0
    assert c.verdict == "indistinguishable" and any("interval" in r for r in c.reasons)


def test_the_interval_is_exactly_the_one_over_per_task_differences():
    vs = lopsided()
    c = compare(vs, "A", "C")
    diffs = list(paired_diffs(per_task(vs, "A", "not_shown_clean"), per_task(vs, "C", "not_shown_clean")).values())
    assert len(diffs) == c.n_tasks == 10
    assert (c.mean_diff, c.low, c.high) == cluster_bootstrap(diffs, seed=0)


def test_a_clear_consistent_decrease_is_read_as_one():
    a = {f"t{i}": [1] * 4 for i in range(10)}
    c = {f"t{i}": [0] * 4 for i in range(10)}
    r = compare(hand_views("A", a) + hand_views("C", c), "A", "C")
    assert r.verdict == "consistent_decrease"


# ----------------------------------------------------------------- every reading rule is pinned by a test that only it can fail

def with_bypass(vs, **b):
    for v in vs:
        v.bypass = {"parsed": True, **b}
    return vs


def ten(prefix_arm, not_clean, **kw):
    return hand_views(prefix_arm, {f"t{i}": [not_clean] * 4 for i in range(10)})


def test_fewer_than_80_percent_of_tasks_down_blocks_the_reading():
    a = {f"t{i}": [1] * 10 for i in range(10)}
    c = {f"t{i}": ([0] * 10 if i < 7 else [1] * 10) for i in range(10)}   # 7 of 10 improve, 3 unchanged
    r = compare(hand_views("A", a) + hand_views("C", c), "A", "C")
    assert r.mean_diff < 0 and r.high < 0           # the interval alone would pass
    assert r.verdict == "indistinguishable" and any("7/10" in x for x in r.reasons)


def test_the_upper_bound_must_agree_with_the_lower_bound():
    a = hand_views("A", {f"t{i}": [1] * 4 for i in range(10)})
    c = hand_views("C", {f"t{i}": [0] * 4 for i in range(10)})
    for v in c:
        v.aa_skipped = 3     # clean only on what the engine could read
    r = compare(a + c, "A", "C")
    assert r.mean_diff == -1.0 and r.upper_mean_diff == 0.0
    assert r.verdict == "indistinguishable" and any("upper-bound" in x for x in r.reasons)


def test_a_large_difference_in_how_code_is_written_blocks_the_reading():
    a = with_bypass(ten("A", 1), elements=10, style_attrs=0)
    c = with_bypass(ten("C", 0), elements=40, style_attrs=0)
    r = compare(a + c, "A", "C")
    assert r.verdict == "indistinguishable" and r.bypass_flags == ["elements: median 10 -> 40"]
    assert any("how the code was written" in x for x in r.reasons)


def test_something_appearing_from_nothing_counts_as_a_difference():
    a = with_bypass(ten("A", 1), elements=10, style_attrs=0)
    c = with_bypass(ten("C", 0), elements=10, style_attrs=6)
    assert compare(a + c, "A", "C").bypass_flags == ["style_attrs: median 0 -> 6"]


def test_a_difference_within_a_factor_of_two_is_tolerated():
    a = with_bypass(ten("A", 1), elements=10, style_attrs=0)
    c = with_bypass(ten("C", 0), elements=19, style_attrs=0)
    r = compare(a + c, "A", "C")
    assert r.bypass_flags == [] and r.verdict == "consistent_decrease"


def test_too_few_tasks_cannot_support_a_reading():
    a = hand_views("A", {f"t{i}": [1] * 4 for i in range(3)})
    c = hand_views("C", {f"t{i}": [0] * 4 for i in range(3)})
    r = compare(a + c, "A", "C")
    assert r.verdict == "indistinguishable" and any("need at least" in x for x in r.reasons)


def test_tasks_missing_from_one_arm_are_named_in_the_reading():
    a = hand_views("A", {f"t{i}": [1] * 4 for i in range(12)})
    c = hand_views("C", {f"t{i}": [0] * 4 for i in range(10)})
    r = compare(a + c, "A", "C")
    assert r.n_tasks == 10 and any("2 task(s)" in x for x in r.reasons)


def test_the_floor_is_judged_on_arm_a_for_every_pair():
    a = hand_views("A", {f"t{i}": [0] * 4 for i in range(10)})
    b = hand_views("B", {f"t{i}": [1] * 4 for i in range(10)})
    b2 = hand_views("B2", {f"t{i}": [0] * 4 for i in range(10)})
    r = compare(a + b + b2, "B", "B2")
    assert any("floor effect" in x and "arm A" in x for x in r.reasons)


def test_task_order_does_not_depend_on_hash_seed():
    d = paired_diffs({"b": 1, "a": 2, "c": 3}, {"c": 0, "a": 0, "b": 0})
    assert list(d) == ["a", "b", "c"]


def test_tool_use_rates_are_over_every_run_of_the_arm(tmp_path, test_tasks):
    def policy(task, arm, rep):
        if task.id == test_tasks[0].id:
            return FakeBehavior(transport_failures=99)   # no answer at all, so no record of tool use either
        return FakeBehavior(violations=2, checks=[2, 0], code_after_check=0)
    text = render(run(tmp_path, test_tasks[:4], policy, arms=(Arm.A, Arm.C)))
    assert "3/4 (75%" in text


def test_an_incomplete_file_is_flagged(tmp_path, test_tasks):
    out = RunFile(tmp_path / "r.jsonl")
    run_experiment(make_plan(test_tasks[:3], [Arm.A], 1, 0), FakeAgent(lambda t, a, r: FakeBehavior()), make_budget(), out,
                   meta={"kind": "meta", "split": "test", "arms": ["A"], "k": 1}, sleep=lambda s: None)
    assert "Incomplete file" in render(out) and "3 of 12" in render(out)

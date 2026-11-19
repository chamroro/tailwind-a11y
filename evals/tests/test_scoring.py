import json

import pytest

from a11y_evals.agents.fake import make_code
from a11y_evals.models import RunStatus
from a11y_evals.scoring import ScorerError, classify, run_shim, score

ENGINE_VERSION = json.load(open(__import__("a11y_evals.scoring", fromlist=["x"]).REPO_ROOT / "packages/tailwind-a11y/package.json"))["version"]


@pytest.mark.parametrize("n", [0, 1, 2, 4])
def test_golden_violation_counts(task, n):
    shim = run_shim(make_code(task, n))
    assert shim.aa.violation_count == n
    assert shim.aa.unique_types == n
    assert shim.aa.parsed


def test_same_mistake_repeated_is_one_distinct_finding(task):
    shim = run_shim(make_code(task, 4, same_class=True))
    assert shim.aa.violation_count == 4
    assert shim.aa.unique_types == 1


def test_scoring_is_deterministic(task):
    code = make_code(task, 3)
    a, b = run_shim(code), run_shim(code)
    assert (a.aa.violations, a.aa.skips, a.strict.violations, a.bypass) == (b.aa.violations, b.aa.skips, b.strict.violations, b.bypass)


def test_engine_version_is_recorded_and_real():
    assert run_shim("export const x = <p />;").engine_version == ENGINE_VERSION


def test_unparsable_code_is_parsed_false_not_clean(task):
    s = score(task, "export const A = () => <div>;")
    assert s.status == RunStatus.PARSED_FALSE
    assert not s.status.scorable


def test_parsed_without_jsx_is_a_different_status_from_unparsable(task):
    s = score(task, "export const A = 1;")
    assert s.status == RunStatus.NO_JSX
    assert s.shim.aa.parsed and s.shim.aa.violation_count == 0


def test_missing_required_element_is_unscorable(task):
    s = score(task, "export const A = () => <div className=\"text-gray-900\">just text</div>;")
    assert s.status == RunStatus.UNSCORABLE
    assert s.missing and not s.status.scorable


def test_code_that_has_what_the_task_requires_is_scored(task):
    assert score(task, make_code(task, 0)).status == RunStatus.SCORED


def test_failure_of_the_scorer_is_an_error_never_zero(task):
    s = score(task, "x", node="/nonexistent/node")
    assert s.status == RunStatus.SCORER_ERROR and s.shim is None


def test_run_shim_raises_on_failure():
    with pytest.raises(ScorerError):
        run_shim("x", node="/nonexistent/node")


def test_dynamic_class_name_is_skipped_not_clean():
    s = run_shim('export const A = ({c}) => <p className={c}>x</p>;')
    assert s.aa.violation_count == 0
    assert s.aa.skipped_count == 1
    assert s.bypass["dynamic_classnames"] == 1


def test_known_blind_spots_are_silent():
    """README states these as limits. If the engine starts seeing them this test fails, and the README must change with it."""
    code = (
        'export const A = () => (<div>\n'
        '  <button className="p-2">x</button>\n'
        '  <p style={{ color: "#ccc", backgroundColor: "#fff" }}>y</p>\n'
        '</div>);'
    )
    s = run_shim(code)
    assert s.aa.violation_count == 0 and s.aa.skipped_count == 0
    assert s.bypass["style_attrs"] == 1


def test_bypass_measures_come_from_the_syntax_tree():
    s = run_shim('export const A = () => <div><Foo className="text-[#ccc]" /><p style={{}} /></div>;')
    b = s.bypass
    assert b["elements"] == 3 and b["custom_components"] == 1 and b["style_attrs"] == 1 and b["arbitrary_value_classes"] == 1


def test_strict_is_reported_beside_aa(task):
    s = run_shim(make_code(task, 1))
    assert s.strict.violation_count >= s.aa.violation_count


def test_classification_order_scorer_error_first(task):
    shim = run_shim(make_code(task, 0))
    shim.aa.error = "boom"
    assert classify(task, shim).status == RunStatus.SCORER_ERROR


def test_dark_mode_only_low_contrast_is_silent():
    s = run_shim('export const A = () => <p className="dark:text-gray-700 dark:bg-gray-800">x</p>;')
    assert s.aa.violation_count == 0 and s.aa.skipped_count == 0


def test_tag_names_that_look_like_object_properties_are_counted_as_tags():
    s = run_shim("export const A = () => <div><constructor /><toString /></div>;")
    assert s.bypass["tag_counts"] == {"div": 1, "constructor": 1, "toString": 1}


def test_requirements_are_about_what_is_written_once_not_how_often(task):
    code = ('export const A = () => (<div>{[1, 2, 3].map(i => <li key={i}>x</li>)}'
            '<button className="text-gray-900 bg-white">go</button></div>);')
    s = score(task, code)  # pricing-tiers: one button and one li written once each render many
    assert s.status == RunStatus.SCORED, s.missing

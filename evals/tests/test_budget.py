import pytest

from a11y_evals.budget import Budget, BudgetExceeded, Limits, Pricing, PricingError, load_pricing
from a11y_evals.models import Usage

BIG = dict(max_runs=100, max_total_tokens=10**6, max_cost_usd=100.0, max_tokens_per_run=10**5, max_turns_per_run=50)


def budget(billable=True, **over):
    return Budget(limits=Limits(**{**BIG, **over}), pricing=Pricing(1.0, 5.0) if billable else None, billable=billable)


@pytest.mark.parametrize("key", ["max_runs", "max_total_tokens", "max_cost_usd", "max_tokens_per_run", "max_turns_per_run"])
@pytest.mark.parametrize("bad", [0, -1])
def test_limits_must_be_positive(key, bad):
    with pytest.raises(ValueError):
        Limits(**{**BIG, key: bad})


def test_any_single_limit_stops_new_runs():
    b = budget(max_runs=2)
    b.start_run(); b.start_run()
    assert "max_runs" in b.stop_reason()

    b = budget(max_total_tokens=1000)
    b.record(Usage(input_tokens=600, output_tokens=400, turns=1))
    assert "max_total_tokens" in b.stop_reason()

    b = budget(max_cost_usd=0.001)
    b.record(Usage(input_tokens=1000, output_tokens=0, turns=1))  # 1000 tokens at 1 USD / Mtok = 0.001
    assert "max_cost_usd" in b.stop_reason()

    assert budget().stop_reason() is None


def test_per_run_limits_raise_with_the_usage_so_far():
    b = budget(max_tokens_per_run=100)
    with pytest.raises(BudgetExceeded) as e:
        b.check_run(Usage(input_tokens=60, output_tokens=40, turns=1))
    assert e.value.usage.total_tokens == 100
    b = budget(max_turns_per_run=2)
    b.check_run(Usage(turns=1))
    with pytest.raises(BudgetExceeded):
        b.check_run(Usage(turns=2))


def test_record_returns_cost_and_accumulates():
    b = budget()
    assert b.record(Usage(input_tokens=1_000_000, output_tokens=1_000_000, turns=1)) == pytest.approx(6.0)
    assert b.cost_usd == pytest.approx(6.0)


def test_cost_limit_is_not_applied_to_a_non_billable_agent():
    b = budget(billable=False, max_cost_usd=0.000001)
    b.record(Usage(input_tokens=900_000, output_tokens=0, turns=1))
    assert b.stop_reason() is None and b.cost_usd == 0.0


def test_billable_run_without_prices_is_refused():
    with pytest.raises(PricingError):
        Budget(limits=Limits(**BIG), pricing=None, billable=True)


@pytest.mark.parametrize("content", ["", "input_per_mtok: 1\n", "input_per_mtok: null\noutput_per_mtok: null\n",
                                     "input_per_mtok: 0\noutput_per_mtok: 5\n", "input_per_mtok: true\noutput_per_mtok: 5\n",
                                     "input_per_mtok: '3'\noutput_per_mtok: 5\n", "input_per_mtok: -1\noutput_per_mtok: 5\n"])
def test_incomplete_price_tables_are_refused(tmp_path, content):
    p = tmp_path / "p.yaml"
    p.write_text(content)
    with pytest.raises(PricingError):
        load_pricing(p)


def test_missing_price_table_is_refused(tmp_path):
    with pytest.raises(PricingError):
        load_pricing(None)
    with pytest.raises(PricingError):
        load_pricing(tmp_path / "nope.yaml")


def test_the_shipped_example_is_not_usable_as_is():
    from pathlib import Path
    with pytest.raises(PricingError):
        load_pricing(Path(__file__).resolve().parents[1] / "pricing.example.yaml")


def test_valid_price_table(tmp_path):
    p = tmp_path / "p.yaml"
    p.write_text("input_per_mtok: 3\noutput_per_mtok: 15.5\n")
    assert load_pricing(p) == Pricing(3.0, 15.5)


def test_worst_case_is_the_ceiling_the_limits_enforce():
    b = budget(max_runs=10, max_tokens_per_run=1000, max_total_tokens=5000, max_cost_usd=100.0)
    w = b.worst_case(50)
    assert w["runs"] == 10 and w["tokens"] == 5000
    assert w["cost_usd"] == pytest.approx(5000 / 1e6 * 5.0)  # priced at the dearer of the two rates
    assert "cost_usd" not in budget(billable=False).worst_case(5)

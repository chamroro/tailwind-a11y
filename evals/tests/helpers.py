from a11y_evals.budget import Budget, Limits


def make_budget(**over) -> Budget:
    lim = dict(max_runs=10_000, max_total_tokens=10**9, max_cost_usd=1e6, max_tokens_per_run=10**7, max_turns_per_run=100)
    lim.update(over)
    return Budget(limits=Limits(**lim), pricing=None, billable=False)

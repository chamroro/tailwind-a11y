import json
import subprocess

import pytest

from a11y_evals.scoring import REPO_ROOT, SHIM
from a11y_evals.tasks import load_tasks

from helpers import make_budget


@pytest.fixture(scope="session", autouse=True)
def engine_is_built():
    """The scoring tests run the real engine. If it is not built they must fail, loudly, not skip: a skipped
    scorer test is a scorer nobody checked."""
    dist = REPO_ROOT / "packages" / "tailwind-a11y" / "dist"
    if not dist.is_dir():
        pytest.fail("the engine is not built: run `npm run build -w tailwind-a11y` at the repository root", pytrace=False)
    probe = subprocess.run(["node", str(SHIM)], input=json.dumps({"code": "export const x = <p />;", "file": "x.tsx"}),
                           capture_output=True, text=True, cwd=str(REPO_ROOT))
    if probe.returncode != 0:
        pytest.fail(f"the scoring shim does not run: {probe.stderr[-400:]}", pytrace=False)


@pytest.fixture(scope="session")
def test_tasks():
    return load_tasks("test")


@pytest.fixture
def task(test_tasks):
    return next(t for t in test_tasks if t.id == "pricing-tiers")


@pytest.fixture
def budget():
    return make_budget()


@pytest.fixture
def cached_shim(monkeypatch):
    """The shim is deterministic (a test pins that), so tests that run hundreds of identical samples through the
    whole pipeline may reuse its answer. Failures are not cached."""
    from a11y_evals import scoring
    real, memo = scoring.run_shim, {}

    def cached(code, file="snippet.tsx", node="node", timeout=60.0):
        key = (code, file, node)
        if key not in memo:
            memo[key] = real(code, file, node, timeout)
        return memo[key]

    monkeypatch.setattr(scoring, "run_shim", cached)

"""The Strands/Bedrock adapter, driven through the real Strands agent loop with a scripted model (no network).

What this can show: the loop, the hooks, the budget, the error mapping and the records are right. What it cannot
show is anything about a model; that needs a live run."""
import contextlib
import json

import pytest

pytest.importorskip("strands", reason="install the extra to run these: pip install -e '.[dev,strands]'")

from botocore.exceptions import ClientError  # noqa: E402
from strands import tool  # noqa: E402
from strands.models.model import Model  # noqa: E402
from strands.types.exceptions import ContextWindowOverflowException, ModelThrottledException  # noqa: E402

from a11y_evals import cli  # noqa: E402
from a11y_evals.agents.fake import make_code  # noqa: E402
from a11y_evals.agents.strands_bedrock import (BedrockSettings, CHECK_TOOL, PreflightError, StrandsBedrockAgent,  # noqa: E402
                                               ToolSession, classify, compose_system_prompt, describe_exception, message_text,
                                               parse_check_result, unwrap)
from a11y_evals.arms import ARM_SPECS  # noqa: E402
from a11y_evals.budget import BudgetExceeded  # noqa: E402
from a11y_evals.models import Arm, RunStatus  # noqa: E402
from a11y_evals.runner import execute  # noqa: E402

from helpers import make_budget  # noqa: E402

INSTRUCTIONS = "Checks Tailwind classes. Call it after writing UI code."


class ScriptedModel(Model):
    """Streams what the script says, in Bedrock ConverseStream events. An exception in the script is raised at that call."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0
        self.system_prompts: list[str | None] = []
        self.last_user_texts: list[str] = []

    def update_config(self, **model_config):
        pass

    def get_config(self):
        return {}

    async def structured_output(self, *a, **k):
        raise NotImplementedError

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.system_prompts.append(system_prompt)
        users = [b["text"] for m in messages if m["role"] == "user" for b in m["content"] if "text" in b]
        self.last_user_texts.append(users[-1] if users else "")
        step = self.script[self.calls]
        self.calls += 1
        if isinstance(step, BaseException):
            raise step
        blocks, stop, (tin, tout) = step
        yield {"messageStart": {"role": "assistant"}}
        for i, b in enumerate(blocks):
            if b[0] == "text":
                yield {"contentBlockDelta": {"delta": {"text": b[1]}, "contentBlockIndex": i}}
            else:
                _, name, args, tid = b
                yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": tid, "name": name}}, "contentBlockIndex": i}}
                yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(args)}}, "contentBlockIndex": i}}
            yield {"contentBlockStop": {"contentBlockIndex": i}}
        yield {"messageStop": {"stopReason": stop}}
        yield {"metadata": {"usage": {"inputTokens": tin, "outputTokens": tout, "totalTokens": tin + tout}, "metrics": {"latencyMs": 1}}}


def text_step(text, usage=(100, 50), stop="end_turn"):
    return ([("text", text)], stop, usage)


def tool_step(code, usage=(100, 50), tid="t1"):
    return ([("tool", CHECK_TOOL, {"code": code}, tid)], "tool_use", usage)


def fenced(code):
    return f"Here you go.\n\n```tsx\n{code}\n```\n"


@tool
def check_tailwind_a11y(code: str, strict: bool = False) -> dict:
    """Check code."""
    payload = {"summary": {"parsed": True, "violations": 2, "skipped": 0, "truncated": False}, "violations": [], "skipped": [], "warnings": []}
    return {"status": "success", "content": [{"text": json.dumps(payload)}]}


def tools_factory(instructions=INSTRUCTIONS):
    @contextlib.contextmanager
    def factory():
        yield ToolSession(tools=[check_tailwind_a11y], instructions=instructions, specs=[{"name": CHECK_TOOL}])
    return factory


def agent_with(script, **kw):
    model = ScriptedModel(script)
    settings = BedrockSettings(model_id="test-model", model_retry_attempts=1)  # 1: Strands must not sleep-and-retry in a test
    return StrandsBedrockAgent(settings, model=model, tools=kw.get("tools", tools_factory())), model


# ---------------------------------------------------------------- the arms reach the model as specified

def test_arm_a_sends_no_system_prompt_and_no_tools(task):
    agent, model = agent_with([text_step(fenced(make_code(task, 0)))])
    r = agent.run(task, Arm.A, make_budget())
    assert model.system_prompts == [None]
    assert r.tool_calls == [] and r.error is None
    assert r.stop_reason == "end_turn"
    assert (r.usage.input_tokens, r.usage.output_tokens, r.usage.turns) == (100, 50, 1)
    assert r.exposed["tools"] == [] and r.exposed["system_prompt"] is None


def test_arm_b_system_prompt_is_the_instruction_only(task):
    agent, model = agent_with([text_step(fenced(make_code(task, 0)))])
    agent.run(task, Arm.B, make_budget())
    assert model.system_prompts == [ARM_SPECS[Arm.B].system_prompt]


def test_arm_b2_asks_again_and_answer_is_the_second_message(task):
    first, second = fenced(make_code(task, 3)), fenced(make_code(task, 0))
    agent, model = agent_with([text_step(first), text_step(second, usage=(300, 80))])
    r = agent.run(task, Arm.B2, make_budget())
    assert model.calls == 2
    assert model.last_user_texts[1] == ARM_SPECS[Arm.B2].followups[0]
    assert r.raw_output == second
    assert (r.usage.input_tokens, r.usage.output_tokens, r.usage.turns) == (400, 130, 2)


def test_arm_c_gets_the_server_instructions_as_its_whole_system_prompt(task):
    agent, model = agent_with([text_step("done")])
    agent.run(task, Arm.C, make_budget())
    assert model.system_prompts == [INSTRUCTIONS]


def test_forced_arm_has_both_its_instruction_and_the_servers(task):
    agent, model = agent_with([text_step("done")])
    agent.run(task, Arm.C_FORCED, make_budget())
    assert model.system_prompts[0].startswith(ARM_SPECS[Arm.C_FORCED].system_prompt)
    assert model.system_prompts[0].endswith(INSTRUCTIONS)


def test_tool_arms_do_not_start_the_server_for_the_other_arms(task):
    started = []

    @contextlib.contextmanager
    def factory():
        started.append(1)
        yield ToolSession(tools=[check_tailwind_a11y], instructions=INSTRUCTIONS, specs=[])

    for arm in (Arm.A, Arm.B, Arm.B2):
        agent, _ = agent_with([text_step("x"), text_step("y")], tools=factory)
        agent.run(task, arm, make_budget())
    assert started == []


# ---------------------------------------------------------------- the tool arm's record

def test_tool_call_is_recorded_with_its_code_and_what_the_tool_said(task):
    checked, final = make_code(task, 2), make_code(task, 0)
    agent, _ = agent_with([tool_step(checked), text_step(fenced(final), usage=(300, 80))])
    r = agent.run(task, Arm.C, make_budget())
    assert len(r.tool_calls) == 1
    call = r.tool_calls[0]
    assert (call.name, call.code, call.violations_reported, call.parsed) == (CHECK_TOOL, checked, 2, True)
    assert r.raw_output == fenced(final)  # the last message, not the one that called the tool
    assert r.usage.turns == 2


def test_a_run_that_never_calls_the_tool_has_no_tool_calls(task):
    agent, _ = agent_with([text_step(fenced(make_code(task, 1)))])
    assert agent.run(task, Arm.C, make_budget()).tool_calls == []


def test_transcript_is_json_serialisable_and_has_the_tool_exchange(task):
    agent, _ = agent_with([tool_step(make_code(task, 2)), text_step("ok")])
    r = agent.run(task, Arm.C, make_budget())
    json.dumps(r.transcript)
    assert [m["role"] for m in r.transcript] == ["user", "assistant", "user", "assistant"]


# ---------------------------------------------------------------- the budget reaches inside the agent loop

def test_per_run_turn_limit_stops_the_loop_and_the_error_is_not_wrapped(task):
    agent, model = agent_with([tool_step(make_code(task, 1), tid="a"), tool_step(make_code(task, 1), tid="b"), text_step("never")])
    with pytest.raises(BudgetExceeded) as caught:
        agent.run(task, Arm.C, make_budget(max_turns_per_run=2))
    assert model.calls == 2  # the third call was never made
    assert (caught.value.usage.input_tokens, caught.value.usage.output_tokens, caught.value.usage.turns) == (200, 100, 2)


def test_per_run_token_limit_stops_after_the_call_that_crossed_it(task):
    agent, model = agent_with([tool_step(make_code(task, 1), usage=(900, 300)), text_step("never")])
    with pytest.raises(BudgetExceeded) as caught:
        agent.run(task, Arm.C, make_budget(max_tokens_per_run=1000))
    assert model.calls == 1
    assert caught.value.usage.total_tokens == 1200  # the overshoot is counted, not hidden


def test_runner_records_a_budget_abort_with_its_spend(task):
    agent, _ = agent_with([tool_step(make_code(task, 1), usage=(900, 300)), text_step("never")])
    b = make_budget(max_tokens_per_run=1000)
    rec = execute(task, Arm.C, 0, agent, b, max_transport_retries=0)
    assert rec["status"] == RunStatus.BUDGET_ABORT.value
    assert rec["usage"]["input_tokens"] == 900 and rec["usage"]["output_tokens"] == 300
    assert b.usage.total_tokens == 1200


# ---------------------------------------------------------------- failures are classified, and what was spent is kept

def client_error(code):
    return ClientError({"Error": {"Code": code, "Message": "x"}}, "ConverseStream")


@pytest.mark.parametrize("exc,expected", [
    (ModelThrottledException("slow"), "transport"),
    (client_error("AccessDeniedException"), "transport"),
    (client_error("ThrottlingException"), "transport"),
    (ConnectionError("reset"), "transport"),
    (TimeoutError("late"), "transport"),
    (ContextWindowOverflowException("too long"), "model"),
    (BudgetExceeded("x"), "budget"),
    (ValueError("a bug"), "unexpected"),
])
def test_classification(exc, expected):
    assert classify(exc) == expected


def test_classification_sees_through_the_event_loop_wrapper():
    from strands.types.exceptions import EventLoopException
    assert classify(EventLoopException(client_error("ThrottlingException"))) == "transport"
    assert isinstance(unwrap(EventLoopException(ValueError("x"))), ValueError)


def test_an_error_after_paid_calls_reports_a_transport_error_and_keeps_the_usage(task):
    agent, _ = agent_with([tool_step(make_code(task, 2), usage=(500, 200)), client_error("ServiceUnavailableException")])
    r = agent.run(task, Arm.C, make_budget())
    assert r.error is not None and r.error.kind == "transport"
    assert "ServiceUnavailableException" in r.error.message
    assert (r.usage.input_tokens, r.usage.output_tokens) == (500, 200)
    assert len(r.tool_calls) == 1


def test_runner_retries_transport_errors_and_books_every_attempt(task):
    agent, _ = agent_with([client_error("ThrottlingException"), text_step(fenced(make_code(task, 0)), usage=(120, 60))])
    b = make_budget()
    rec = execute(task, Arm.A, 0, agent, b, max_transport_retries=1, sleep=lambda s: None)
    assert rec["status"] == RunStatus.SCORED.value and rec["attempts"] == 2
    assert rec["usage"]["input_tokens"] == 120


def test_context_overflow_is_a_model_error_not_a_retry(task):
    agent, model = agent_with([ContextWindowOverflowException("too long"), text_step("never")])
    r = agent.run(task, Arm.A, make_budget())
    assert r.error.kind == "model" and model.calls == 1


def test_a_bug_propagates_with_its_own_type(task):
    agent, _ = agent_with([ValueError("a bug")])
    with pytest.raises(ValueError):
        agent.run(task, Arm.A, make_budget())
    rec = execute(task, Arm.A, 0, agent_with([ValueError("a bug")])[0], make_budget(), max_transport_retries=0)
    assert rec["status"] == RunStatus.AGENT_ERROR.value and "ValueError" in rec["detail"]


def test_hitting_max_tokens_gives_the_partial_text_and_the_runner_calls_it_truncated(task):
    partial = "Sure.\n\n```tsx\nexport function Component() {\n  return <div>"
    agent, _ = agent_with([text_step(partial, usage=(100, 4096), stop="max_tokens")])
    r = agent.run(task, Arm.A, make_budget())
    assert r.stop_reason == "max_tokens" and r.raw_output == partial and r.error is None
    rec = execute(task, Arm.A, 0, agent_with([text_step(partial, usage=(100, 4096), stop="max_tokens")])[0], make_budget(), max_transport_retries=0)
    assert rec["status"] == RunStatus.TRUNCATED.value


# ---------------------------------------------------------------- end to end through the runner and the real scorer

def test_a_tool_arm_run_is_scored_and_its_behaviour_recorded(task):
    checked, final = make_code(task, 2), make_code(task, 0)
    agent, _ = agent_with([tool_step(checked), text_step(fenced(final), usage=(300, 80))])
    rec = execute(task, Arm.C, 0, agent, make_budget(), max_transport_retries=0)
    assert rec["status"] == RunStatus.SCORED.value
    assert len(rec["score"]["aa"]["violations"]) == 0
    assert rec["behaviour"]["called"] is True
    assert rec["behaviour"]["first_check_violations"] == 2
    assert rec["behaviour"]["changed_code_after_first_check"] is True
    assert rec["behaviour"]["last_checked_is_submitted"] is False
    assert rec["exposed"]["system_prompt"] == INSTRUCTIONS


# ---------------------------------------------------------------- pure helpers

def test_parse_check_result_prefers_structured_content():
    r = {"structuredContent": {"summary": {"violations": 3, "parsed": True}}, "content": [{"text": "{}"}]}
    assert parse_check_result(r) == (3, True)


def test_parse_check_result_falls_back_to_the_text_block():
    r = {"content": [{"text": json.dumps({"summary": {"violations": 0, "parsed": False}})}]}
    assert parse_check_result(r) == (0, False)


@pytest.mark.parametrize("r", [{}, {"content": [{"text": "not json"}]}, {"content": [{"text": "[1]"}]},
                               {"structuredContent": {"summary": {"violations": True, "parsed": "yes"}}}])
def test_parse_check_result_says_nothing_it_was_not_told(r):
    assert parse_check_result(r) == (None, None)


def test_message_text_keeps_text_and_drops_reasoning_and_tool_blocks():
    m = {"role": "assistant", "content": [{"reasoningContent": {"reasoningText": {"text": "secret"}}}, {"text": "a"},
                                          {"toolUse": {"name": "x"}}, {"text": "b"}]}
    assert message_text(m) == "a\nb" and message_text(None) == ""


def test_compose_system_prompt():
    assert compose_system_prompt(ARM_SPECS[Arm.A], INSTRUCTIONS) is None  # instructions only go to arms with the tool
    assert compose_system_prompt(ARM_SPECS[Arm.C], None) is None


def test_describe_exception_names_the_aws_error_code():
    assert "AccessDeniedException" in describe_exception(client_error("AccessDeniedException"))


def test_describe_holds_no_credentials_and_names_the_model():
    d = StrandsBedrockAgent(BedrockSettings(model_id="m", profile="secret-profile-name")).describe()
    assert d["model_id"] == "m" and "secret-profile-name" not in json.dumps(d)


# ---------------------------------------------------------------- preflight and the command line

def test_preflight_ok_records_what_the_server_offers():
    agent, _ = agent_with([text_step("ok", usage=(14, 4))], tools=tools_factory())
    facts = agent.preflight()
    assert facts["server_tool_names"] == [CHECK_TOOL] and facts["preflight_tokens"] == {"input": 14, "output": 4}
    assert agent.describe()["server_instructions_sha"] == facts["server_instructions_sha"]


def test_preflight_fails_when_the_model_call_fails():
    agent, _ = agent_with([client_error("AccessDeniedException")])
    with pytest.raises(PreflightError, match="AccessDeniedException"):
        agent.preflight()


def test_preflight_fails_when_the_server_gives_no_instructions():
    agent, _ = agent_with([text_step("ok")], tools=tools_factory(instructions=None))
    with pytest.raises(PreflightError, match="instructions"):
        agent.preflight()


def test_preflight_fails_when_the_server_offers_other_tools():
    @contextlib.contextmanager
    def factory():
        yield ToolSession(tools=[], instructions=INSTRUCTIONS, specs=[{"name": CHECK_TOOL}, {"name": "other"}])
    agent, _ = agent_with([text_step("ok")], tools=factory)
    with pytest.raises(PreflightError, match="exactly"):
        agent.preflight()


def test_cli_needs_a_model_id(tmp_path, capsys):
    assert cli.main(["run", "--agent", "strands", "--out", str(tmp_path / "r.jsonl"), "--dry-run"]) == 2
    assert "--model-id" in capsys.readouterr().err


def test_cli_refuses_a_billable_run_without_prices(tmp_path, capsys):
    assert cli.main(["run", "--agent", "strands", "--model-id", "m", "--out", str(tmp_path / "r.jsonl"), "--dry-run"]) == 2
    assert "price" in capsys.readouterr().err


def test_cli_dry_run_touches_neither_aws_nor_npx(tmp_path, monkeypatch, capsys):
    import boto3
    monkeypatch.setattr(boto3, "Session", lambda *a, **k: pytest.fail("a dry run must not create an AWS session"))
    monkeypatch.setattr("subprocess.Popen", lambda *a, **k: pytest.fail("a dry run must not start a process"))
    prices = tmp_path / "p.yaml"
    prices.write_text("input_per_mtok: 1.0\noutput_per_mtok: 5.0\n")
    out = tmp_path / "r.jsonl"
    assert cli.main(["run", "--agent", "strands", "--model-id", "m", "--pricing", str(prices), "--out", str(out), "--dry-run"]) == 0
    assert not out.exists()
    assert "worst case" in capsys.readouterr().out


def test_cli_stops_before_recording_anything_when_preflight_fails(tmp_path, monkeypatch, capsys):
    import a11y_evals.agents.strands_bedrock as sb

    def boom(self):
        raise PreflightError("no access")
    monkeypatch.setattr(sb.StrandsBedrockAgent, "preflight", boom)
    prices = tmp_path / "p.yaml"
    prices.write_text("input_per_mtok: 1.0\noutput_per_mtok: 5.0\n")
    out = tmp_path / "r.jsonl"
    assert cli.main(["run", "--agent", "strands", "--model-id", "m", "--pricing", str(prices), "--out", str(out)]) == 2
    assert not out.exists() and "no access" in capsys.readouterr().err

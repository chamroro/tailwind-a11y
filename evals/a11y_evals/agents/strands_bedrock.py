"""The real agent: Strands Agents on Amazon Bedrock, with the published MCP server attached for the tool arms.

The choices that change what is measured (instructions in the system prompt, one exposed tool, an empty project root,
the last message as the answer) are listed in README.md under "The live agent"."""
from __future__ import annotations

import contextlib
import hashlib
import json
import shutil
import tempfile
from dataclasses import dataclass
from importlib import metadata
from typing import Any, Callable, ContextManager, Iterator, Mapping

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from mcp import StdioServerParameters
from mcp.client.stdio import stdio_client
from strands import Agent
from strands.event_loop._retry import ModelRetryStrategy
from strands.hooks import AfterModelCallEvent, AfterToolCallEvent, BeforeModelCallEvent, BeforeToolCallEvent
from strands.models import BedrockModel
from strands.models.model import Model
from strands.tools.mcp import MCPClient
from strands.types.exceptions import (ContextWindowOverflowException, EventLoopException, MCPClientInitializationError,
                                      MaxTokensReachedException, ModelThrottledException, ToolProviderException)

from ..arms import ARM_SPECS, ArmSpec, user_message
from ..budget import Budget, BudgetExceeded
from ..models import AgentError, AgentResult, Arm, Task, ToolCall, Usage

PACKAGE = "mcp-tailwind-a11y"
DEFAULT_SERVER_VERSION = "0.16.0"
CHECK_TOOL = "check_tailwind_a11y"


class PreflightError(RuntimeError):
    """Credentials, model access or the MCP server do not work. Raised before any run is recorded."""


@dataclass(frozen=True)
class BedrockSettings:
    model_id: str
    region: str = "us-west-2"
    profile: str | None = None
    max_tokens: int = 4096          # per model call; the per-run token limit is the budget's
    temperature: float = 1.0
    server_version: str = DEFAULT_SERVER_VERSION
    model_retry_attempts: int = 3   # throttling retries inside Strands; the runner has its own transport retries


@dataclass
class ToolSession:
    """What a live MCP connection hands the agent."""
    tools: list[Any]
    instructions: str | None
    specs: list[dict[str, Any]]


ToolsFactory = Callable[[], ContextManager[ToolSession]]


# --------------------------------------------------------------------------- pure helpers (unit-tested)

def sha(text: str | None) -> str | None:
    return None if text is None else hashlib.sha256(text.encode()).hexdigest()[:16]


def compose_system_prompt(spec: ArmSpec, server_instructions: str | None) -> str | None:
    parts = [p for p in (spec.system_prompt, server_instructions if spec.tools else None) if p]
    return "\n\n".join(parts) if parts else None


def message_text(message: Mapping[str, Any] | None) -> str:
    """The text of a message. Reasoning and tool blocks are not part of the answer."""
    if not message:
        return ""
    return "\n".join(b["text"] for b in message.get("content", []) if isinstance(b, Mapping) and isinstance(b.get("text"), str))


def parse_check_result(result: Mapping[str, Any]) -> tuple[int | None, bool | None]:
    """(violations, parsed) from a check_tailwind_a11y result, or None for what it did not say."""
    sc = result.get("structuredContent")
    if not isinstance(sc, Mapping):
        sc = None
        for block in result.get("content", []) or []:
            text = block.get("text") if isinstance(block, Mapping) else None
            if isinstance(text, str):
                try:
                    candidate = json.loads(text)
                except ValueError:
                    continue
                if isinstance(candidate, Mapping):
                    sc = candidate
                    break
    summary = sc.get("summary") if sc else None
    if not isinstance(summary, Mapping):
        return None, None
    v, p = summary.get("violations"), summary.get("parsed")
    return (v if isinstance(v, int) and not isinstance(v, bool) else None), (p if isinstance(p, bool) else None)


def unwrap(exc: BaseException) -> BaseException:
    """Strands wraps whatever a hook or model raised in EventLoopException."""
    for _ in range(8):
        inner = getattr(exc, "original_exception", None) if isinstance(exc, EventLoopException) else None
        if inner is None:
            break
        exc = inner
    return exc


def classify(exc: BaseException) -> str:
    """'budget' | 'truncated' | 'model' | 'transport' | 'unexpected'.

    transport: no usable answer came back (network, throttling, credentials, the MCP server not starting); the
    runner may try again, and on resume does. model: the model was reached and the request cannot succeed as
    posed. Anything else is a bug and is left to propagate."""
    exc = unwrap(exc)
    if isinstance(exc, BudgetExceeded):
        return "budget"
    if isinstance(exc, MaxTokensReachedException):
        return "truncated"
    if isinstance(exc, ContextWindowOverflowException):
        return "model"
    if isinstance(exc, (ModelThrottledException, ClientError, BotoCoreError, ConnectionError, TimeoutError,
                        ToolProviderException, MCPClientInitializationError)):
        return "transport"
    return "unexpected"


def describe_exception(exc: BaseException) -> str:
    exc = unwrap(exc)
    code = exc.response.get("Error", {}).get("Code") if isinstance(exc, ClientError) else None
    text = f"{type(exc).__name__}{f' ({code})' if code else ''}: {exc}"
    return text[:400]


def _json_safe(messages: Any) -> list[dict[str, Any]]:
    return json.loads(json.dumps(list(messages), default=lambda o: f"<{type(o).__name__}>"))


# --------------------------------------------------------------------------- the agent

class _RunState:
    def __init__(self) -> None:
        self.model_calls = 0                      # completed model calls
        self.tool_calls: list[ToolCall] = []
        self.by_id: dict[str, ToolCall] = {}


class StrandsBedrockAgent:
    billable = True

    def __init__(self, settings: BedrockSettings, *, model: Model | None = None, tools: ToolsFactory | None = None):
        self.settings = settings
        self._model_override = model
        self._model_cached: Model | None = None
        self._tools = tools or (lambda: _npx_session(settings.server_version))
        self._facts: dict[str, Any] = {}

    # ---- identity
    def describe(self) -> dict:
        s = self.settings
        return {
            "agent": "strands-bedrock", "model_id": s.model_id, "region": s.region, "temperature": s.temperature,
            "max_tokens_per_call": s.max_tokens, "mcp_server": f"{PACKAGE}@{s.server_version}", "exposed_tools": [CHECK_TOOL],
            "strands_agents": _version("strands-agents"), "boto3": boto3.__version__, "mcp_sdk": _version("mcp"),
            "model_retry_attempts": s.model_retry_attempts, **self._facts,
        }

    def _model(self) -> Model:
        if self._model_override is not None:
            return self._model_override
        if self._model_cached is None:
            s = self.settings
            session = boto3.Session(profile_name=s.profile, region_name=s.region)
            self._model_cached = BedrockModel(
                boto_session=session,
                boto_client_config=Config(connect_timeout=10, read_timeout=120, retries={"max_attempts": 2, "mode": "standard"}),
                model_id=s.model_id, max_tokens=s.max_tokens, temperature=s.temperature, streaming=True,
                use_native_token_count=False,  # no extra API call, and none that would need extra permission
            )
        return self._model_cached

    # ---- before anything is recorded
    def preflight(self) -> dict[str, Any]:
        """One tiny model call and one MCP handshake. Proves credentials, region, model access and that the tool
        server starts, so a misconfiguration is an error now and not a hundred recorded failures later."""
        try:
            agent = Agent(model=self._model(), system_prompt="Reply with the single word: ok", callback_handler=None,
                          context_manager=False, retry_strategy=ModelRetryStrategy(max_attempts=1))
            result = agent("ping")
        except Exception as err:
            raise PreflightError(f"the model call failed: {describe_exception(err)}") from err
        used = result.metrics.accumulated_usage
        try:
            with self._tools() as session:
                names = [s["name"] for s in session.specs]
                instructions = session.instructions
        except Exception as err:
            raise PreflightError(f"the MCP server did not start: {describe_exception(err)}") from err
        if names != [CHECK_TOOL]:
            raise PreflightError(f"expected exactly the tool {CHECK_TOOL!r}, the server offers {names}")
        if not instructions:
            raise PreflightError("the server sent no instructions; arm C would not be what an installed tool gives")
        self._facts = {"server_tool_names": names, "server_instructions_sha": sha(instructions)}
        return {"preflight_tokens": {"input": used.get("inputTokens", 0), "output": used.get("outputTokens", 0)}, **self._facts}

    # ---- one run
    def run(self, task: Task, arm: Arm, budget: Budget) -> AgentResult:
        spec = ARM_SPECS[arm]
        state = _RunState()
        agent: Agent | None = None
        exposed: dict[str, Any] = {"model_id": self.settings.model_id, "region": self.settings.region,
                                   "temperature": self.settings.temperature, "arm_digest": spec.digest()}

        def usage_now() -> Usage:
            u = agent.event_loop_metrics.accumulated_usage if agent is not None else {}
            return Usage(input_tokens=int(u.get("inputTokens", 0)), output_tokens=int(u.get("outputTokens", 0)), turns=state.model_calls)

        def before_model(_event: BeforeModelCallEvent) -> None:
            budget.check_run(usage_now())  # BudgetExceeded is unwrapped below

        def after_model(event: AfterModelCallEvent) -> None:
            if event.stop_response is not None:
                state.model_calls += 1

        def before_tool(event: BeforeToolCallEvent) -> None:
            args = event.tool_use.get("input") or {}
            code = args.get("code") if isinstance(args, Mapping) else None
            call = ToolCall(event.tool_use.get("name", "?"), code=code if isinstance(code, str) else None)
            state.tool_calls.append(call)
            state.by_id[event.tool_use.get("toolUseId", "")] = call

        def after_tool(event: AfterToolCallEvent) -> None:
            call = state.by_id.get(event.tool_use.get("toolUseId", ""))
            if call is not None and event.exception is None and isinstance(event.result, Mapping):
                call.violations_reported, call.parsed = parse_check_result(event.result)

        try:
            with contextlib.ExitStack() as stack:
                session = stack.enter_context(self._tools()) if spec.tools else None
                system = compose_system_prompt(spec, session.instructions if session else None)
                exposed.update(system_prompt=system, system_prompt_sha=sha(system),
                               tools=session.specs if session else [], server_instructions_sha=sha(session.instructions) if session else None)
                agent = Agent(model=self._model(), tools=list(session.tools) if session else [], system_prompt=system,
                              callback_handler=None, context_manager=False,
                              retry_strategy=ModelRetryStrategy(max_attempts=self.settings.model_retry_attempts))
                agent.hooks.add_callback(BeforeModelCallEvent, before_model)
                agent.hooks.add_callback(AfterModelCallEvent, after_model)
                agent.hooks.add_callback(BeforeToolCallEvent, before_tool)
                agent.hooks.add_callback(AfterToolCallEvent, after_tool)
                result = None
                for turn in (user_message(task.prompt), *spec.followups):
                    result = agent(turn)
        except Exception as raw:
            return self._failed(raw, agent, state, usage_now(), exposed)

        assert result is not None
        return AgentResult(raw_output=message_text(result.message), stop_reason=result.stop_reason,
                           transcript=_json_safe(agent.messages), usage=usage_now(), tool_calls=state.tool_calls, exposed=exposed)

    def _failed(self, raw: Exception, agent: Agent | None, state: _RunState, usage: Usage, exposed: dict[str, Any]) -> AgentResult:
        exc = unwrap(raw)
        kind = classify(exc)
        transcript = _json_safe(agent.messages) if agent is not None else []
        if kind == "budget":
            assert isinstance(exc, BudgetExceeded)
            if exc.usage is None:
                exc.usage = usage
            raise exc
        if kind == "truncated":
            # Strands has already put the partial message in agent.messages; the answer is what was written before the cut.
            partial = next((m for m in reversed(agent.messages) if m.get("role") == "assistant"), None) if agent is not None else None
            return AgentResult(raw_output=message_text(partial), stop_reason="max_tokens", transcript=transcript, usage=usage,
                               tool_calls=state.tool_calls, exposed=exposed)
        if kind in ("transport", "model"):
            return AgentResult(usage=usage, transcript=transcript, tool_calls=state.tool_calls, exposed=exposed,
                               error=AgentError(kind, describe_exception(exc)))
        raise exc  # a bug, not a failed run: let the runner record it as agent_error with the real exception named


# --------------------------------------------------------------------------- the real MCP connection

def _version(dist: str) -> str | None:
    try:
        return metadata.version(dist)
    except metadata.PackageNotFoundError:
        return None


@contextlib.contextmanager
def _npx_session(server_version: str) -> Iterator[ToolSession]:
    """Starts the published server with `npx` against an empty project root, so no run can read anything from disk
    and no config file can be found. The directory is new for every run and removed afterwards."""
    root = tempfile.mkdtemp(prefix="a11y-evals-root-")
    try:
        client = MCPClient(
            lambda: stdio_client(StdioServerParameters(command="npx", args=["-y", f"{PACKAGE}@{server_version}", "--root", root])),
            tool_filters={"allowed": [CHECK_TOOL]}, startup_timeout=60,
        )
        with client:
            tools = list(client.list_tools_sync())
            specs = [dict(t.tool_spec) for t in tools]
            yield ToolSession(tools=tools, instructions=client.server_instructions, specs=specs)
    finally:
        shutil.rmtree(root, ignore_errors=True)

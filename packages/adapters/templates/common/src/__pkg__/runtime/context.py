"""Per-run state: ARC events, spans, usage, limits and tool-call records.

The framework adapter calls into the active RunContext from its model and tool
hooks; nothing here depends on a specific agent framework.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .. import settings as spec

_current: contextvars.ContextVar[RunContext] = contextvars.ContextVar("armature_run")


def current() -> RunContext:
    return _current.get()


def now_ms() -> float:
    return round(time.time() * 1000, 3)


def new_id() -> str:
    return uuid.uuid4().hex


class RunAborted(Exception):
    """Stops a run with an ARC error code (limit_exceeded, timeout, model_error, ...)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Final:
    text: str


@dataclass
class Interrupted:
    """The agent paused before running tools that need approval."""

    tool_call_ids: list[str]


@dataclass
class EvalOptions:
    case_id: str | None = None
    trial: int | None = None
    fixtures: dict[str, Any] = field(default_factory=dict)
    stubs: dict[str, dict[str, Any]] = field(default_factory=dict)


class RunContext:
    def __init__(
        self,
        run_id: str,
        thread_id: str,
        model_id: str,
        limits: dict[str, Any],
        eval_options: EvalOptions | None = None,
        eval_mode: bool = False,
    ) -> None:
        self.run_id = run_id
        self.eval_mode = eval_mode
        self.thread_id = thread_id
        self.model_id = model_id
        self.limits = limits
        self.eval = eval_options
        self.events: list[dict[str, Any]] = []
        self._changed = asyncio.Event()
        self.closed = False
        self.started_ms = now_ms()
        self.root = self._span("invoke_agent", f"invoke_agent {spec.NAME}", parent=None)
        self.spans: list[dict[str, Any]] = [self.root]
        self.usage: dict[str, Any] = {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "model_calls": 0,
            "cost_usd": 0.0 if spec.PRICE_INPUT is not None or model_id == spec.MOCK_MODEL_ID else None,
        }
        self.tool_calls: list[dict[str, Any]] = []
        self.approvals: list[dict[str, Any]] = []
        self.executed_tools = 0
        self.aborted: RunAborted | None = None
        self._chat_span: dict[str, Any] | None = None
        self._text_id: str | None = None
        self.last_text = ""

    # -- events -------------------------------------------------------------

    def activate(self) -> contextvars.Token:
        return _current.set(self)

    def emit(self, event: dict[str, Any]) -> None:
        if self.closed:
            return
        self.events.append(event)
        changed, self._changed = self._changed, asyncio.Event()
        changed.set()

    def close_stream(self) -> None:
        """Marks the end of one streamed phase (a finish, an interrupt or an error)."""
        self.closed = True
        changed, self._changed = self._changed, asyncio.Event()
        changed.set()

    def reopen(self) -> None:
        self.closed = False

    async def subscribe(self, start: int = 0):
        i = start
        while True:
            while i < len(self.events):
                yield self.events[i]
                i += 1
            if self.closed:
                return
            await self._changed.wait()

    def custom(self, name: str, value: dict[str, Any]) -> None:
        self.emit({"type": "CUSTOM", "name": name, "value": value})

    # -- spans --------------------------------------------------------------

    def _span(self, operation: str, name: str, parent: str | None, **attributes: Any) -> dict[str, Any]:
        return {
            "span_id": new_id(),
            "parent_id": parent,
            "name": name,
            "operation": operation,
            "start_ms": now_ms(),
            "end_ms": None,
            "status": "unset",
            "attributes": attributes,
        }

    def child_span(self, operation: str, name: str, **attributes: Any) -> dict[str, Any]:
        span = self._span(operation, name, self.root["span_id"], **attributes)
        self.spans.append(span)
        return span

    @staticmethod
    def end_span(span: dict[str, Any], status: str = "ok") -> None:
        span["end_ms"] = now_ms()
        span["status"] = status

    # -- limits -------------------------------------------------------------

    def abort(self, code: str, message: str) -> RunAborted:
        if self.aborted is None:
            self.aborted = RunAborted(code, message)
        return self.aborted

    def check_abort(self) -> None:
        if self.aborted is not None:
            raise self.aborted

    # -- model hooks --------------------------------------------------------

    def model_start(self) -> None:
        self.check_abort()
        max_steps = self.limits["max_steps"]
        if self.usage["model_calls"] >= max_steps:
            raise self.abort("limit_exceeded", f"max_steps ({max_steps}) reached")
        self._chat_span = self.child_span("chat", f"chat {self.model_id}", **{"gen_ai.request.model": self.model_id})

    def text_delta(self, delta: str) -> None:
        if not delta:
            return
        if self._text_id is None:
            self._text_id = new_id()
            self.emit({"type": "TEXT_MESSAGE_START", "messageId": self._text_id, "role": "assistant"})
        self.emit({"type": "TEXT_MESSAGE_CONTENT", "messageId": self._text_id, "delta": delta})

    @property
    def text_open(self) -> bool:
        """True while streamed text deltas of the current model call are being emitted."""
        return self._text_id is not None

    def model_failed(self, error: BaseException) -> RunAborted:
        if self._chat_span is not None:
            self.end_span(self._chat_span, "error")
            self._chat_span = None
        self._close_text()
        if isinstance(error, RunAborted):
            return self.abort(error.code, error.message)
        return self.abort("model_error", f"{type(error).__name__}: {error}")

    def _close_text(self) -> None:
        if self._text_id is not None:
            self.emit({"type": "TEXT_MESSAGE_END", "messageId": self._text_id})
            self._text_id = None

    def model_end(
        self,
        *,
        input_tokens: int,
        output_tokens: int,
        text: str,
        tool_calls: list[dict[str, Any]],
        streamed: bool,
    ) -> None:
        """Records one completed model call and emits its text and tool-call events."""
        from .registry import TOOLS

        span = self._chat_span
        self._chat_span = None
        cost = self._cost(input_tokens, output_tokens)
        u = self.usage
        u["model_calls"] += 1
        u["input_tokens"] += input_tokens
        u["output_tokens"] += output_tokens
        u["total_tokens"] += input_tokens + output_tokens
        if u["cost_usd"] is not None and cost is not None:
            u["cost_usd"] = round(u["cost_usd"] + cost, 8)
        if span is not None:
            span["attributes"].update(
                {"gen_ai.usage.input_tokens": input_tokens, "gen_ai.usage.output_tokens": output_tokens}
            )
            self.end_span(span)
        self.custom(
            "armature.usage",
            {"model": self.model_id, "input_tokens": input_tokens, "output_tokens": output_tokens, "cost_usd": cost},
        )
        if text and not streamed:
            self.text_delta(text)
        self._close_text()
        if text:
            self.last_text = text
        for call in tool_calls:
            args_text = json.dumps(call["args"], ensure_ascii=False)
            self.emit({"type": "TOOL_CALL_START", "toolCallId": call["id"], "toolCallName": call["name"]})
            self.emit({"type": "TOOL_CALL_ARGS", "toolCallId": call["id"], "delta": args_text})
            self.emit({"type": "TOOL_CALL_END", "toolCallId": call["id"]})
            tool = TOOLS.get(call["name"])
            if tool is not None and tool.requires_approval:
                self.tool_calls.append(
                    {
                        "id": call["id"],
                        "name": call["name"],
                        "args": call["args"],
                        "side_effect": tool.side_effect,
                        "status": "pending_approval",
                        "approval": "pending",
                        "stubbed": False,
                    }
                )
        max_tokens = self.limits["max_tokens"]
        if u["total_tokens"] > max_tokens:
            raise self.abort("limit_exceeded", f"max_tokens ({max_tokens}) exceeded")
        max_cost = self.limits["max_cost_usd"]
        if u["cost_usd"] is not None and u["cost_usd"] > max_cost:
            raise self.abort("limit_exceeded", f"max_cost_usd ({max_cost}) exceeded")

    def _cost(self, input_tokens: int, output_tokens: int) -> float | None:
        if self.model_id == spec.MOCK_MODEL_ID:
            return 0.0
        if spec.PRICE_INPUT is None or spec.PRICE_OUTPUT is None:
            return None
        return round((input_tokens * spec.PRICE_INPUT + output_tokens * spec.PRICE_OUTPUT) / 1_000_000, 8)

    # -- tool-call records --------------------------------------------------

    def record_for(self, call_id: str) -> dict[str, Any] | None:
        return next((r for r in self.tool_calls if r["id"] == call_id), None)

    def pending_approvals(self) -> list[dict[str, Any]]:
        return [
            {"tool_call_id": r["id"], "name": r["name"], "args": r["args"], "side_effect": r["side_effect"]}
            for r in self.tool_calls
            if r["status"] == "pending_approval"
        ]

    def tool_result_event(self, call_id: str, content: str) -> None:
        self.emit(
            {"type": "TOOL_CALL_RESULT", "messageId": new_id(), "toolCallId": call_id, "content": content, "role": "tool"}
        )

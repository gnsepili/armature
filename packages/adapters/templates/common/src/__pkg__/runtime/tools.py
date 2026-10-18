"""Tool execution shared by every framework adapter.

Adapters hand each tool call to `invoke`, which applies the run's limits, eval stubs,
argument validation, timeouts and retries, and records the call for ARC.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from .context import RunAborted, current, now_ms

MAX_RESULT_CHARS = 16_000
DENIED_MESSAGE = "The user denied this tool call. Do not retry it."
WRITE_EFFECTS = ("write", "destructive")


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    side_effect: str
    requires_approval: bool
    idempotent: bool
    timeout_s: float
    args_model: type[BaseModel]
    handler: Callable[[Any], Any]
    input_schema: dict[str, Any]


def serialize(value: Any) -> str:
    if isinstance(value, str):
        text = value
    elif isinstance(value, BaseModel):
        text = value.model_dump_json()
    else:
        text = json.dumps(value, ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + f"... [truncated {len(text) - MAX_RESULT_CHARS} chars]"
    return text


def _jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    try:
        json.dumps(value)
        return value
    except TypeError:
        return json.loads(json.dumps(value, default=str))


async def _call(tool: ToolSpec, args: BaseModel) -> Any:
    if inspect.iscoroutinefunction(tool.handler):
        return await asyncio.wait_for(tool.handler(args), tool.timeout_s)
    return await asyncio.wait_for(asyncio.to_thread(tool.handler, args), tool.timeout_s)


def _record(name: str, call_id: str, args: dict[str, Any], side_effect: str) -> dict[str, Any]:
    ctx = current()
    record = ctx.record_for(call_id)
    if record is None:
        record = {
            "id": call_id,
            "name": name,
            "args": args,
            "side_effect": side_effect,
            "status": "completed",
            "approval": "not_required",
            "stubbed": False,
        }
        ctx.tool_calls.append(record)
    return record


async def invoke(name: str, call_id: str, args: dict[str, Any]) -> str:
    """Runs one tool call and returns the content to send back to the model."""
    from .registry import TOOLS

    ctx = current()
    ctx.check_abort()
    tool = TOOLS.get(name)
    if tool is None:
        content = f"Error: unknown tool {name!r}"
        record = _record(name, call_id, args, "none")
        record.update(status="error", error=content, duration_ms=0)
        ctx.tool_result_event(call_id, content)
        return content

    limit = ctx.limits["max_tool_calls"]
    if ctx.executed_tools >= limit:
        raise ctx.abort("limit_exceeded", f"max_tool_calls ({limit}) reached")
    ctx.executed_tools += 1

    record = _record(name, call_id, args, tool.side_effect)
    if "edited_args" in record:  # the reviewer changed the arguments before approving
        args = record.pop("edited_args")
    record["args"] = args
    span = ctx.child_span(
        "execute_tool", f"execute_tool {name}", **{"gen_ai.tool.name": name, "gen_ai.tool.call.id": call_id}
    )
    started = now_ms()
    status, error, result = "completed", None, None
    try:
        parsed = tool.args_model.model_validate(args)
        stub = (ctx.eval.stubs.get(name) if ctx.eval else None) or None
        if stub is None and ctx.eval_mode and tool.side_effect in WRITE_EFFECTS:
            stub = {"result": {"ok": True, "stubbed": True}}
        if stub is not None:
            record["stubbed"] = True
            if stub.get("delay_ms"):
                await asyncio.sleep(stub["delay_ms"] / 1000)
            if stub.get("error"):
                status, error = "error", str(stub["error"])
            else:
                result = stub.get("result")
        else:
            attempts = 2 if tool.idempotent else 1
            for attempt in range(attempts):
                try:
                    result = _jsonable(await _call(tool, parsed))
                    break
                except (NotImplementedError, RunAborted):
                    raise
                except TimeoutError:
                    if attempt == attempts - 1:
                        status, error = "error", f"timed out after {tool.timeout_s}s"
                except Exception as exc:  # the model sees the error and can recover
                    if attempt == attempts - 1:
                        status, error = "error", f"{type(exc).__name__}: {exc}"
    except ValidationError as exc:
        status, error = "error", f"invalid arguments: {exc.errors(include_url=False)}"
    except NotImplementedError:
        status, error = "error", f"{name} is not implemented yet; implement it in tools/{name}.py"

    content = f"Error: {error}" if status == "error" else serialize(result)
    record.update(status=status, error=error, duration_ms=round(now_ms() - started, 3))
    if status == "completed":
        record["result"] = result
    ctx.end_span(span, "ok" if status == "completed" else "error")
    ctx.tool_result_event(call_id, content)
    return content


def deny(call_id: str) -> str:
    """Marks a pending call as denied and returns the message the model receives instead."""
    ctx = current()
    record = ctx.record_for(call_id)
    if record is not None:
        record.update(status="denied", approval="denied")
    ctx.tool_result_event(call_id, DENIED_MESSAGE)
    return DENIED_MESSAGE

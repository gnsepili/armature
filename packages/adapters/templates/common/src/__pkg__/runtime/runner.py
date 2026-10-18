"""Run lifecycle: start, stream, pause for approval, resume, finish.

Each run executes as an asyncio task so a dropped client connection never cancels
it; `/runs/wait` and `/runs/stream` are two views of the same task.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from .. import settings as spec
from . import output
from .context import EvalOptions, Final, Interrupted, RunAborted, RunContext, new_id, now_ms
from .tools import deny

MAX_RUNS = 1000


class AgentAdapter(Protocol):
    """Implemented by the framework layer in agent.py."""

    async def run(self, ctx: RunContext, key: str, messages: list[dict[str, Any]]) -> Final | Interrupted: ...
    async def resume(self, ctx: RunContext, key: str, decisions: list[dict[str, Any]]) -> Final | Interrupted: ...
    async def history(self, key: str) -> list[dict[str, Any]]: ...
    async def delete(self, key: str) -> None: ...
    async def close(self) -> None: ...


class RunConflict(Exception):
    pass


class RunNotFound(Exception):
    pass


class InvalidRequest(Exception):
    pass


@dataclass
class Run:
    ctx: RunContext
    key: str
    status: str = "running"
    output: Any = None
    error: dict[str, str] | None = None
    messages: list[dict[str, Any]] = field(default_factory=list)
    task: asyncio.Task | None = None
    active_ms: float = 0.0

    @property
    def run_id(self) -> str:
        return self.ctx.run_id

    @property
    def thread_id(self) -> str:
        return self.ctx.thread_id

    def result(self) -> dict[str, Any]:
        ctx = self.ctx
        return {
            "run_id": ctx.run_id,
            "thread_id": ctx.thread_id,
            "status": self.status,
            "output": self.output,
            "messages": self.messages,
            "tool_calls": ctx.tool_calls,
            "usage": ctx.usage,
            "pending_approvals": ctx.pending_approvals() if self.status == "interrupted" else [],
            "error": self.error,
        }

    def record(self) -> dict[str, Any]:
        return {
            **self.result(),
            "spans": self.ctx.spans,
            "approvals": self.ctx.approvals,
            "duration_ms": round(self.active_ms, 3) if self.status != "running" else None,
        }


def _messages(raw: str | list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(raw, str):
        return [{"role": "user", "content": raw}]
    return [{"role": m["role"], "content": m["content"]} for m in raw]


class RunManager:
    def __init__(self, agent: AgentAdapter, *, model_id: str, eval_mode: bool, limits: dict[str, Any]) -> None:
        self.agent = agent
        self.model_id = model_id
        self.eval_mode = eval_mode
        self.limits = limits
        self.runs: OrderedDict[str, Run] = OrderedDict()
        self.busy: dict[str, str] = {}

    # -- public API ---------------------------------------------------------

    def start(
        self,
        *,
        input: str | list[dict[str, Any]],
        thread_id: str | None = None,
        eval_options: EvalOptions | None = None,
    ) -> Run:
        thread_id = thread_id or new_id()
        if thread_id in self.busy:
            raise RunConflict(f"thread {thread_id} already has run {self.busy[thread_id]} in progress or paused")
        run_id = new_id()
        ctx = RunContext(run_id, thread_id, self.model_id, self.limits, eval_options, self.eval_mode)
        key = thread_id if spec.SESSION_MEMORY["enabled"] else run_id
        run = Run(ctx=ctx, key=key)
        self._remember(run)
        self.busy[thread_id] = run_id
        messages = _messages(input)
        self._launch(run, lambda: self.agent.run(ctx, key, messages))
        return run

    def resume(self, run_id: str, decisions: list[dict[str, Any]]) -> Run:
        run = self.get(run_id)
        if run.status != "interrupted":
            raise RunConflict(f"run {run_id} is {run.status}, not waiting for approval")
        pending = [p["tool_call_id"] for p in run.ctx.pending_approvals()]
        by_id = {d["tool_call_id"]: d for d in decisions}
        unknown = sorted(set(by_id) - set(pending))
        missing = [p for p in pending if p not in by_id]
        if unknown or missing:
            raise InvalidRequest(
                f"decisions must cover exactly the pending tool calls {pending}; "
                f"missing {missing}, unknown {unknown}"
            )
        ordered = [by_id[p] for p in pending]
        ctx = run.ctx
        for d in ordered:
            record = ctx.record_for(d["tool_call_id"])
            edited = d.get("edited_args") is not None
            if d["approve"]:
                record["approval"] = "approved"
                if edited:
                    record["args"] = record["edited_args"] = d["edited_args"]
            ctx.approvals.append(
                {"tool_call_id": d["tool_call_id"], "decision": "approved" if d["approve"] else "denied", "edited": edited}
            )
        run.status = "running"
        ctx.reopen()

        async def phase() -> Final | Interrupted:
            for d in ordered:
                if not d["approve"]:
                    deny(d["tool_call_id"])
            return await self.agent.resume(ctx, run.key, ordered)

        self._launch(run, phase)
        return run

    def get(self, run_id: str) -> Run:
        run = self.runs.get(run_id)
        if run is None:
            raise RunNotFound(run_id)
        return run

    async def wait(self, run: Run) -> Run:
        assert run.task is not None
        await asyncio.shield(run.task)
        return run

    async def history(self, thread_id: str) -> list[dict[str, Any]]:
        if not spec.SESSION_MEMORY["enabled"]:
            return []
        return await self.agent.history(thread_id)

    async def delete_thread(self, thread_id: str) -> None:
        if thread_id in self.busy:
            raise RunConflict(f"thread {thread_id} has a run in progress or paused")
        if spec.SESSION_MEMORY["enabled"]:
            await self.agent.delete(thread_id)

    async def shutdown(self) -> None:
        tasks = [r.task for r in self.runs.values() if r.task and not r.task.done()]
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # -- internals ----------------------------------------------------------

    def _remember(self, run: Run) -> None:
        self.runs[run.run_id] = run
        while len(self.runs) > MAX_RUNS:
            oldest = next((rid for rid, r in self.runs.items() if r.status != "running"), None)
            if oldest is None:
                break
            evicted = self.runs.pop(oldest)
            if self.busy.get(evicted.thread_id) == oldest:  # an abandoned approval
                self.busy.pop(evicted.thread_id)

    def _launch(self, run: Run, phase: Callable[[], Awaitable[Final | Interrupted]]) -> None:
        run.ctx.emit({"type": "RUN_STARTED", "threadId": run.thread_id, "runId": run.run_id})
        run.task = asyncio.create_task(self._drive(run, phase))

    async def _drive(self, run: Run, phase: Callable[[], Awaitable[Final | Interrupted]]) -> None:
        ctx = run.ctx
        ctx.activate()
        started = now_ms()
        timeout_s = self.limits["timeout_s"]
        outcome: Final | Interrupted | None = None
        try:
            async with asyncio.timeout(timeout_s):
                outcome = await phase()
                if isinstance(outcome, Final):
                    run.output = await self._final_output(run, outcome)
        except TimeoutError:
            ctx.abort("timeout", f"run exceeded timeout_s ({timeout_s})")
        except RunAborted as exc:
            ctx.abort(exc.code, exc.message)
        except output.OutputInvalid as exc:
            ctx.abort("structured_output_invalid", str(exc))
        except asyncio.CancelledError:
            ctx.abort("internal", "the server shut down during the run")
            raise
        except Exception as exc:  # anything else is a bug in a tool or the adapter
            ctx.abort("internal", f"{type(exc).__name__}: {exc}")
        finally:
            run.active_ms += now_ms() - started
            try:
                run.messages = await self.agent.history(run.key)
            except Exception:
                pass
            self._settle(run, outcome)
            if not spec.SESSION_MEMORY["enabled"] and run.status != "interrupted":
                try:  # without session memory a run's state is only needed until it settles
                    await self.agent.delete(run.key)
                except Exception:
                    pass

    async def _final_output(self, run: Run, outcome: Final) -> Any:
        try:
            return output.parse(outcome.text)
        except output.OutputInvalid as exc:
            repair = await self.agent.run(run.ctx, run.key, [{"role": "user", "content": output.repair_prompt(exc)}])
            if not isinstance(repair, Final):
                raise
            return output.parse(repair.text)

    def _settle(self, run: Run, outcome: Final | Interrupted | None) -> None:
        ctx = run.ctx
        ctx.root["end_ms"] = now_ms()
        if ctx.aborted is not None:
            run.status = "error"
            run.error = {"code": ctx.aborted.code, "message": ctx.aborted.message}
            ctx.root["status"] = "error"
            for record in ctx.tool_calls:
                if record["status"] == "pending_approval":
                    record.update(status="denied", approval="denied")
            self.busy.pop(run.thread_id, None)
            ctx.emit({"type": "RUN_ERROR", "message": ctx.aborted.message, "code": ctx.aborted.code})
        elif isinstance(outcome, Interrupted):
            run.status = "interrupted"
            ctx.root["status"] = "unset"
            approvals = ctx.pending_approvals()
            ctx.custom("armature.approval_required", {"run_id": run.run_id, "approvals": approvals})
            ctx.emit(
                {
                    "type": "RUN_FINISHED",
                    "threadId": run.thread_id,
                    "runId": run.run_id,
                    "outcome": {
                        "type": "interrupt",
                        "interrupts": [
                            {"id": a["tool_call_id"], "reason": "tool_approval", "toolCallId": a["tool_call_id"]}
                            for a in approvals
                        ],
                    },
                }
            )
        else:
            run.status = "success"
            ctx.root["status"] = "ok"
            self.busy.pop(run.thread_id, None)
            ctx.emit(
                {
                    "type": "RUN_FINISHED",
                    "threadId": run.thread_id,
                    "runId": run.run_id,
                    "outcome": {"type": "success"},
                }
            )
        ctx.close_stream()

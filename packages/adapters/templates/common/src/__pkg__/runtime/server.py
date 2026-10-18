"""ARC v1 HTTP server: the stable contract Armature's playground, evals and chat speak.

Endpoints: GET /health, GET /manifest, POST /runs/wait, POST /runs/stream,
GET /runs/{run_id}, POST /runs/{run_id}/resume, GET and DELETE /threads/{thread_id}.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .. import settings as spec
from ..settings import Settings, load_settings
from .context import EvalOptions
from .registry import TOOLS
from .runner import InvalidRequest, Run, RunConflict, RunManager, RunNotFound

ARC_VERSION = 1


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InputMessage(_Strict):
    role: Literal["user", "assistant"]
    content: str


class Stub(_Strict):
    result: Any = None
    error: str | None = None
    delay_ms: float | None = None


class EvalMetadata(_Strict):
    case_id: str | None = None
    trial: int | None = Field(default=None, ge=1)
    fixtures: dict[str, Any] = Field(default_factory=dict)
    stubs: dict[str, Stub] = Field(default_factory=dict)


class Metadata(BaseModel):
    model_config = ConfigDict(extra="allow")
    eval: EvalMetadata | None = None


class RunRequest(_Strict):
    thread_id: str | None = Field(default=None, min_length=1)
    input: str | list[InputMessage]
    metadata: Metadata | None = None

    @field_validator("input")
    @classmethod
    def _not_empty(cls, value: str | list[InputMessage]) -> str | list[InputMessage]:
        if not value:
            raise ValueError("input must not be empty")
        return value


class Decision(_Strict):
    tool_call_id: str
    approve: bool
    edited_args: dict[str, Any] | None = None


class ResumeRequest(_Strict):
    decisions: list[Decision] = Field(min_length=1)
    stream: bool = False


def manifest() -> dict[str, Any]:
    schema = spec.STRUCTURED_OUTPUT_SCHEMA
    return {
        "arc_version": ARC_VERSION,
        "name": spec.NAME,
        "description": spec.DESCRIPTION,
        "framework": spec.FRAMEWORK,
        "pattern": spec.PATTERN,
        "model": {"provider": spec.MODEL_PROVIDER, "id": spec.MODEL_ID},
        "tools": [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema,
                "side_effect": t.side_effect,
                "requires_approval": t.requires_approval,
            }
            for t in TOOLS.values()
        ],
        "limits": spec.LIMITS,
        "capabilities": {
            "session_memory": spec.SESSION_MEMORY["enabled"],
            "streaming": True,
            "approvals": any(t.requires_approval for t in TOOLS.values()),
            "edited_args": True,
            "structured_output": {"enabled": True, "schema": schema} if schema else {"enabled": False},
        },
    }


def _sse(run: Run, start: int) -> StreamingResponse:
    async def body():
        async for event in run.ctx.subscribe(start):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    from ..agent import create_agent

    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        agent = await create_agent(settings)
        app.state.runs = RunManager(
            agent, model_id=settings.model_id, eval_mode=settings.eval_mode, limits=settings.limits
        )
        try:
            yield
        finally:
            await app.state.runs.shutdown()
            await agent.close()

    app = FastAPI(title=spec.NAME, description=spec.DESCRIPTION, version="0.1.0", lifespan=lifespan)

    def runs() -> RunManager:
        return app.state.runs

    def start(req: RunRequest) -> Run:
        eval_meta = req.metadata.eval if req.metadata else None
        if eval_meta is not None and not settings.eval_mode:
            raise HTTPException(400, "metadata.eval is only accepted when ARMATURE_EVAL_MODE=1")
        options = None
        if eval_meta is not None:
            options = EvalOptions(
                case_id=eval_meta.case_id,
                trial=eval_meta.trial,
                fixtures=eval_meta.fixtures,
                stubs={k: v.model_dump(exclude_none=True) for k, v in eval_meta.stubs.items()},
            )
        raw = req.input if isinstance(req.input, str) else [m.model_dump() for m in req.input]
        try:
            return runs().start(input=raw, thread_id=req.thread_id, eval_options=options)
        except RunConflict as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "arc_version": ARC_VERSION,
            "framework": spec.FRAMEWORK,
            "eval_mode": settings.eval_mode,
            "model_mode": settings.model_mode,
            "ready": settings.ready(),
        }

    @app.get("/manifest")
    async def get_manifest() -> dict[str, Any]:
        return manifest()

    @app.post("/runs/wait")
    async def run_wait(req: RunRequest) -> dict[str, Any]:
        run = start(req)
        await runs().wait(run)
        return run.result()

    @app.post("/runs/stream")
    async def run_stream(req: RunRequest) -> StreamingResponse:
        return _sse(start(req), 0)

    @app.get("/runs/{run_id}")
    async def get_run(run_id: str) -> dict[str, Any]:
        try:
            return runs().get(run_id).record()
        except RunNotFound as exc:
            raise HTTPException(404, f"run {run_id} not found") from exc

    @app.post("/runs/{run_id}/resume", response_model=None)
    async def resume(run_id: str, req: ResumeRequest) -> dict[str, Any] | StreamingResponse:
        manager = runs()
        try:
            offset = len(manager.get(run_id).ctx.events)
            run = manager.resume(run_id, [d.model_dump(exclude_none=True) for d in req.decisions])
        except RunNotFound as exc:
            raise HTTPException(404, f"run {run_id} not found") from exc
        except RunConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except InvalidRequest as exc:
            raise HTTPException(400, str(exc)) from exc
        if req.stream:
            return _sse(run, offset)
        await manager.wait(run)
        return run.result()

    @app.get("/threads/{thread_id}")
    async def get_thread(thread_id: str) -> dict[str, Any]:
        messages = await runs().history(thread_id)
        if not messages:
            raise HTTPException(404, f"thread {thread_id} not found")
        return {"thread_id": thread_id, "messages": messages}

    @app.delete("/threads/{thread_id}")
    async def delete_thread(thread_id: str) -> dict[str, Any]:
        try:
            await runs().delete_thread(thread_id)
        except RunConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        return {"thread_id": thread_id, "deleted": True}

    return app

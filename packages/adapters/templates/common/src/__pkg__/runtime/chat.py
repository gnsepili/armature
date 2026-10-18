"""Terminal chat that runs the agent in-process, with the same runtime as the server."""

from __future__ import annotations

import asyncio
import json
import sys

from .. import settings as spec
from ..settings import load_settings
from .runner import Run, RunManager

DIM, BOLD, RESET = ("\033[2m", "\033[1m", "\033[0m") if sys.stdout.isatty() else ("", "", "")


async def _ask(prompt: str) -> str:
    return (await asyncio.to_thread(input, prompt)).strip()


async def _show(run: Run, start: int) -> None:
    async for event in run.ctx.subscribe(start):
        kind = event["type"]
        if kind == "TEXT_MESSAGE_START":
            print(f"{BOLD}agent>{RESET} ", end="", flush=True)
        elif kind == "TEXT_MESSAGE_CONTENT":
            print(event["delta"], end="", flush=True)
        elif kind == "TEXT_MESSAGE_END":
            print()
        elif kind == "TOOL_CALL_START":
            print(f"{DIM}  -> {event['toolCallName']}{RESET}", end="", flush=True)
        elif kind == "TOOL_CALL_ARGS":
            print(f"{DIM}({event['delta']}){RESET}")
        elif kind == "TOOL_CALL_RESULT":
            content = event["content"]
            print(f"{DIM}  <- {content[:200]}{'...' if len(content) > 200 else ''}{RESET}")
        elif kind == "RUN_ERROR":
            print(f"error [{event['code']}]: {event['message']}")


async def chat() -> None:
    from ..agent import create_agent

    settings = load_settings()
    agent = await create_agent(settings)
    manager = RunManager(agent, model_id=settings.model_id, eval_mode=False, limits=settings.limits)
    thread_id: str | None = None
    print(f"{BOLD}{spec.NAME}{RESET} ({settings.model_id}, {settings.model_mode} mode). Ctrl-D or /exit to quit.")
    try:
        while True:
            try:
                text = await _ask("you> ")
            except EOFError:
                print()
                break
            if not text:
                continue
            if text in {"/exit", "/quit"}:
                break
            if text == "/new":
                thread_id = None
                print("new conversation")
                continue
            run = manager.start(input=text, thread_id=thread_id)
            await _show(run, 0)
            await manager.wait(run)
            while run.status == "interrupted":
                decisions = []
                for pending in run.ctx.pending_approvals():
                    args = json.dumps(pending["args"], ensure_ascii=False)
                    answer = await _ask(f"approve {pending['name']}({args})? [y/N] ")
                    decisions.append({"tool_call_id": pending["tool_call_id"], "approve": answer.lower() in {"y", "yes"}})
                offset = len(run.ctx.events)
                manager.resume(run.run_id, decisions)
                await _show(run, offset)
                await manager.wait(run)
            if spec.SESSION_MEMORY["enabled"]:
                thread_id = run.thread_id
    finally:
        await manager.shutdown()
        await agent.close()

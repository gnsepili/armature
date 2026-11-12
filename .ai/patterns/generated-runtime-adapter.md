# Pattern: Generated Runtime with a Framework Adapter Seam

## Overview

Every generated project contains the same self-contained Python runtime (`runtime/`) that implements ARC v1,
run lifecycle, limits, approvals, tool dispatch, cost and span recording. The only framework-specific file is
`agent.py`, which implements the small `AgentAdapter` protocol for LangGraph or the OpenAI Agents SDK. The
runtime is templated from `packages/adapters/templates/common`; the adapter from `.../langgraph` or
`.../openai-agents`.

## Purpose

- Identical external behaviour (ARC, limits, approvals, eval hooks) regardless of framework.
- Keep framework code small and readable for coding agents and humans who will edit it.
- Satisfy the rule that generated projects never import an Armature package: all runtime code is copied in.

## Where Used

- Templates: `packages/adapters/templates/common/src/__pkg__/runtime/` (`server.py`, `runner.py`, `context.py`,
  `tools.py`, `output.py`, `prompt.py`, `chat.py`, `registry.py.hbs`, `tool_args.py.hbs`),
  `settings.py.hbs`, `__main__.py.hbs`.
- Adapters: `packages/adapters/templates/langgraph/src/__pkg__/agent.py.hbs` and
  `packages/adapters/templates/openai-agents/src/__pkg__/agent.py.hbs`.
- User-owned tool stubs: `packages/adapters/templates/common/src/__pkg__/tools/__tool__.py.hbs`.
- Generated tests: `packages/adapters/templates/common/tests/` (`test_arc.py`, `test_guardrails.py`,
  `test_tools.py`).
- Planning inputs: [`ProjectPlan`](../../packages/core/src/plan.ts:39), [`PlannedTool`](../../packages/core/src/plan.ts:16).
- Layer selection: [`templateLayers`](../../packages/adapters/src/index.ts:17).
- Modules: [adapters](../modules/adapters.md), [core](../modules/core.md).

## Implementation Details

- **Server** (`server.py`): `create_app(settings)` returns a FastAPI app with strict pydantic request models
  and the eight ARC routes (lines 159-215).
- **Runs** (`runner.py`): `RunManager` starts each run as an asyncio task, so a dropped HTTP client never
  cancels it; `/runs/wait` and `/runs/stream` are two views of the same task. It enforces one active run per
  thread (`RunConflict`), maps unknown ids to `RunNotFound`, validates input (`InvalidRequest`), settles runs
  as completed, interrupted (waiting for approval), failed or aborted, and repairs structured output once.
- **Context** (`context.py`): a `RunContext` in a contextvar collects ARC events, spans, usage, limits and tool
  records; `model_start`/`model_end` update tokens and cost, `RunAborted` carries a stable error code.
- **Tools** (`tools.py`): `invoke(name, call_id, args)` is the single choke point that applies limits, eval
  stubs, argument validation, timeouts, retries (idempotent tools only) and approval bookkeeping.
- **LangGraph adapter**: `create_agent` plus an `ArmatureMiddleware` with `awrap_model_call` and
  `awrap_tool_call`; approvals use human-in-the-loop interrupts so a paused run survives in the checkpointer;
  optional sqlite checkpointing.
- **OpenAI Agents adapter**: `ArmatureHooks(RunHooks)` for LLM start/end, tools call through the runtime,
  approvals use the SDK's `needs_approval`, and the RunState is kept in memory; `SQLiteSession` for memory.

## Code Example

```python
class AgentAdapter(Protocol):  # runtime/runner.py
    async def run(self, ctx, key, messages): ...
    async def resume(self, ctx, key, decisions): ...
    async def history(self, key): ...
    async def delete(self, key): ...
    async def close(self): ...
```

Adding a framework means providing a new `agent.py.hbs` that implements this protocol and routes every tool
through `runtime.tools.invoke`.

## Common Scenarios

- A write tool is called: `invoke` checks the approval policy; the run ends `interrupted`; the client resumes
  with approve, deny or edited args.
- Eval mode: tool stubs from the case replace handlers and write tools never run for real.
- Limit breach: the run ends with a RUN_ERROR carrying partial output.
- Model failure: surfaced as a run error; the model error path is covered by generated tests.

## Rules & Constraints

- Generated code must not import `armature` or `@armature` anything.
- Tool files (`tools/*.py`), prompts, README, `tests/test_tools.py` and the project workflow are
  `generated-once`; runtime and adapter files are managed.
- Settings are constants rendered from `armature.yaml` with environment overrides (`load_settings`); secrets
  come from env or `.env`, never templates.
- Keep the adapter thin; behaviour shared by both frameworks belongs in `runtime/`.

## Common Gotchas

- OpenAI Agents keeps RunState in memory, so a pending approval is lost on server restart; LangGraph keeps it
  in the checkpointer.
- Anthropic models are supported through LangGraph only (compat check rejects the combination otherwise).
- Python package names replace `-` with `_`; reserved names are rejected at compile time.

## Anti-Patterns

- Calling tool handlers directly from an adapter, bypassing `invoke` (breaks limits, stubs, approvals).
- Putting framework-specific branching in `runtime/` templates.

## Related Patterns

- [ARC contract](arc-contract-and-client.md) is the external interface.
- [Ownership lock](ownership-lock-and-templates.md) decides who owns each generated file.
- [Deterministic generation](deterministic-generation-and-catalog.md) pins the dependencies used here.
- [Handoff kit](handoff-kit.md) tells coding agents how to edit this code.

## Background

ADR 0002 (ARC v1) and ADR 0001 (layout) govern this boundary; the P0 scope is a single agent with tools on
LangGraph and OpenAI Agents SDK.

## Modules Using This Pattern

- [adapters](../modules/adapters.md)
- [core](../modules/core.md)
- [arc](../modules/arc.md)

## Related Patterns (Why They Connect)

- [arc-contract-and-client](arc-contract-and-client.md): the one runtime boundary.
- [ownership-lock-and-templates](ownership-lock-and-templates.md): both decide what generation may overwrite.

# Module: adapters (`@armature/adapters`)

## Purpose & Scope

### What This Module Does

`packages/adapters` is a templates package. Its TypeScript surface is tiny (`TEMPLATE_VERSION`,
`templateLayers(framework)`), but its `templates/` tree is where almost all of a generated Python project
comes from: the FastAPI server that speaks ARC, the run lifecycle, tool execution with approvals, settings,
prompts, offline pytest suites, a GitHub workflow and README, plus one `agent.py.hbs` per framework.

Templates are rendered by `core` (see [core.md](core.md)). This module has no logic besides locating the
template directory in a source checkout or inside the bundled CLI.

### Boundaries

- IN: Handlebars templates, the `ownership.json` of the common layer, the template version constant, layer
  ordering (`common` first, then the framework layer).
- OUT: rendering, hashing and writing (core); the coding-agent handoff files such as `AGENTS.md`, `docs/`
  and skills (see [handoff.md](handoff.md)); ARC schemas on the TypeScript side (see [arc.md](arc.md)).
- Generated projects must not import any Armature package. The runtime in `templates/common/src/__pkg__/runtime`
  is self-contained Python (FastAPI and pydantic plus the framework package, with versions pinned in
  `core/catalog/versions.json`). The LangGraph adapter uses `InMemorySaver` or `AsyncSqliteSaver` depending on
  `session_memory.backend`.

## Key Components

| File | Role |
| --- | --- |
| `../../packages/adapters/src/index.ts:6` | `TEMPLATE_VERSION = "2"`; bump whenever a template change alters output |
| `../../packages/adapters/src/index.ts:17` | `templateLayers(framework)` returns `[common, <framework>]` and throws for unknown frameworks |
| `templates/common/ownership.json` | `generated-once` globs: `README.md`, `src/*/tools/*.py`, `src/*/prompts/**`, `tests/test_tools.py`, `.github/workflows/armature.yml` |
| `templates/common/src/__pkg__/runtime/server.py` | FastAPI app; routes at `server.py:159-215`: `/health`, `/manifest`, `/runs/wait`, `/runs/stream`, `/runs/{id}`, `/runs/{id}/resume`, `/threads/{id}` (GET, DELETE) |
| `templates/common/src/__pkg__/runtime/runner.py` | `RunManager`, `Run`, `AgentAdapter` protocol (`run`, `resume`, `history`, `delete`, `close`) |
| `templates/common/src/__pkg__/runtime/context.py` | `RunContext`: ARC events, spans, usage, limits, `RunAborted` |
| `templates/common/src/__pkg__/runtime/tools.py` | `invoke()` and `deny()`: approvals, timeouts, side-effect records shared by both frameworks |
| `templates/common/src/__pkg__/runtime/registry.py.hbs` | Tool registry generated from the plan |
| `templates/common/src/__pkg__/runtime/tool_args.py.hbs` | Pydantic argument models per tool |
| `templates/common/src/__pkg__/runtime/output.py`, `prompt.py`, `chat.py` | Structured output parse/repair, system prompt assembly, terminal chat |
| `templates/common/src/__pkg__/settings.py.hbs` | Settings from the spec plus env (`ARMATURE_MODEL_MODE`, `ARMATURE_MOCK_URL`, `ARMATURE_EVAL_MODE`, `ARMATURE_SESSION_DB`) |
| `templates/common/src/__pkg__/tools/__tool__.py.hbs` | One user-owned tool file per planned tool (stub or implemented) |
| `templates/common/tests/*.hbs` | `conftest.py`, `test_arc.py`, `test_guardrails.py`, `test_tools.py` |
| `templates/langgraph/src/__pkg__/agent.py.hbs` | LangGraph adapter (the only framework-specific agent code) |
| `templates/openai-agents/src/__pkg__/agent.py.hbs` | OpenAI Agents SDK adapter |

## API Surface

TypeScript: `TEMPLATE_VERSION` and `templateLayers(framework: string): string[]`.

Generated Python surface (what a user sees in a project): `python -m <package> serve|chat`, the ARC HTTP
routes listed above, and the per-tool modules under `src/<package>/tools/`. The ARC contract itself is
described in [arc-contract-and-client](../patterns/arc-contract-and-client.md) and in `docs/adr/0002-arc-v1.md`.

## Dependencies

### Internal Modules

None in code. `core` imports it; the build script `../../packages/cli/scripts/build.mjs` copies
`packages/adapters/templates` to `dist/templates`.

### External Services

At runtime the *generated* project talks to its configured model provider (OpenAI, Anthropic, or an
OpenAI-compatible base URL). In offline mode (`ARMATURE_MODEL_MODE=mock`) it talks to the mock LLM instead
(see [mock-llm.md](mock-llm.md)).

### Patterns Used

[generated-runtime-adapter](../patterns/generated-runtime-adapter.md),
[ownership-lock-and-templates](../patterns/ownership-lock-and-templates.md),
[arc-contract-and-client](../patterns/arc-contract-and-client.md),
[deterministic-generation-and-catalog](../patterns/deterministic-generation-and-catalog.md).

## Data Flow

```
ProjectPlan (core) --> Handlebars context {...plan, tool?, armature_version}
   common/*  then  <framework>/*   (later layer replaces same output path)
   --> src/<pkg>/{__main__,settings,runtime/*,tools/*,agent}.py, tests/*, pyproject.toml, README.md, ...
```

At runtime in the generated project: HTTP request -> `server.py` -> `RunManager.start` -> framework adapter
`run()` -> model + tools via `tools.invoke` -> ARC events appended to `RunContext` -> SSE stream or
`/runs/wait` result.

## Key Behaviors

### Rendering rules

1. `renderProject` walks each layer in sorted order. Files ending `.hbs` are compiled with `noEscape` and
   `strict` mode, so a missing variable is a render error, not an empty string.
2. Path segments starting `dot_` become `.` (for example `dot_github` -> `.github`), `__pkg__` becomes the
   Python package name, `__tool__` expands once per planned tool.
3. A blank rendering omits the file; this is how templates are conditional.
4. `ownership.json` globs mark files `generated-once`; everything else is `managed`.

### Approval and limits behavior in the runtime

- Tools whose `side_effect` is `write` or `destructive` pause the run for approval when
  `policies.approvals.<kind>` is `require`; `POST /runs/{id}/resume` with decisions continues it, and a deny
  yields a denied tool record without calling the tool (`tools.deny`).
- Limit breaches abort with an ARC `RUN_ERROR` carrying code `limit_exceeded` (`max_steps`, `max_tool_calls`,
  `max_tokens`, `max_cost_usd`; see `runtime/context.py:173` and `runtime/tools.py:97`) or `timeout`
  (`timeout_s`, `runtime/runner.py:209`), with partial output kept.
- Eval metadata is only accepted when `ARMATURE_EVAL_MODE=1`; otherwise the request is rejected (ARC check
  `eval_gate`).

### Error scenarios

- A tool that times out or raises: the tool record gets status `error` (for example `timed out after Ns`,
  `runtime/tools.py:134`).
- Unparseable structured output: one repair prompt (`runtime/runner.py:244`), then `structured_output_invalid`
  aborts the run (`runtime/runner.py:221`).
- Unknown run id: HTTP 404; resuming a run that is not interrupted: 409 (`RunConflict`).

### Why This Flow

A common runtime plus a thin per-framework adapter keeps ARC behavior identical across frameworks, so one
conformance suite (see [arc.md](arc.md)) and one eval runner (see [evals.md](evals.md)) work for both.

## Configuration

- `generated-once` globs in `templates/common/ownership.json`.
- Framework dependency versions come from `core/catalog/versions.json` through the plan, not from templates.
- Environment variables read by the generated settings: the model API key variable named in the spec,
  `ARMATURE_MODEL_MODE` (`live` or `mock`), `ARMATURE_MOCK_URL`, `ARMATURE_EVAL_MODE`, `ARMATURE_SESSION_DB`.

## Testing

- Rendering assertions: `../../packages/core/test/langgraph-templates.test.ts` and
  `../../packages/core/test/openai-agents-templates.test.ts` (these live in core because core renders).
- Behavior of the real generated project: `../../tests-integration/langgraph.test.ts` and
  `../../tests-integration/openai-agents.test.ts` (need `uv`; see [tests-integration.md](tests-integration.md)).
- The generated `tests/` folder is itself the project's offline pytest suite (`armature test --only unit`).

## Performance Considerations

Templates are read from disk on every render; there is no cache. The generated server keeps run state in
memory and persists threads in SQLite only when `session_memory.backend` is `sqlite`.

## Gotchas & Constraints

### Never Do This

- Never `import armature` or any `@armature` code from a template.
- Never put a timestamp, UUID or absolute path in a template (determinism rule).
- Never edit a template without checking whether `TEMPLATE_VERSION` should be bumped.

### Always Do This

- Put shared behavior in `templates/common`; only framework API calls belong in `<framework>/agent.py.hbs`.
- Use only framework APIs and versions pinned in `core/catalog/versions.json`.

### Common Mistakes

- Adding a user-editable file but forgetting its glob in `ownership.json`, so `generate` later overwrites
  user edits.
- Expecting `README.md` to refresh on `generate`: it is generated-once.

### Edge Cases

- `dot_gitignore` has no `.hbs` suffix, so it is copied verbatim.
- The bundle copies templates next to `dist/armature.js`; `templatesRoot()` checks both `../templates`
  (source) and `./templates` (bundle).

### Business Rules

- Both adapters must satisfy all seven ARC checks; a framework that cannot is not supported.
- Only `single_agent_tools` is generated; workflow, supervisor and rag_chat patterns are not implemented.

## Security Considerations

Generated `.env.example` lists variable names with empty values. The generated app defaults to binding
`127.0.0.1` through the CLI, and eval metadata is gated off outside eval mode so a production app cannot be
steered by a request header body. `telemetry.capture_content` defaults to false so spans omit message text.

## Features Implemented

[init](../features/init.md), [generate-and-sync](../features/generate-and-sync.md),
[chat](../features/chat.md) (terminal chat in the generated app and `armature chat` against ARC),
[test](../features/test.md), [arc-http-api](../features/arc-http-api.md).

## Related Documentation

- Modules: [core](core.md), [handoff](handoff.md), [arc](arc.md), [mock-llm](mock-llm.md).
- Patterns: [generated-runtime-adapter](../patterns/generated-runtime-adapter.md).
- Architecture: [module-interactions](../architecture/module-interactions.md).

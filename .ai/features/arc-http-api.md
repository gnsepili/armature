# Feature: ARC HTTP API (Agent Runtime Contract v1)

## What Users Can Do

- Call any generated agent through one HTTP contract: health, manifest, runs (wait or stream), resume approvals, threads.
- Verify an app with the conformance suite.

## Screens/Routes

HTTP routes (no UI)

## Backend APIs Called

`GET /health`, `GET /manifest`, `POST /runs/wait`, `POST /runs/stream` (SSE), `GET /runs/{id}`, `POST /runs/{id}/resume` (404, 409, 400), `GET` and `DELETE /threads/{id}`; client in `../../packages/arc/src/client.ts:39-58`.

## Components

`packages/arc/src/{types,client,events,conformance}.ts`; server in generated Python (`packages/adapters` templates).

## State Management

Run records and threads live in the generated app (memory or SQLite).

## Business Rules

- Conformance checks: health_manifest, tool_run, approval, limits, spans, isolation, eval_gate.
- Eval mode is enabled by `ARMATURE_EVAL_MODE=1`; `eval_gate` expects it to be refused otherwise.
- Contract changes need an ADR (`../../docs/adr/0002-arc-v1.md`).

## User Flow

1. Client builds request.
2. App runs agent, emits events.
3. Approval pauses the run; client resumes.
4. Record is fetched or streamed.

## Navigation Flow

[dev](dev.md), [chat](chat.md), [eval-run](eval-run.md) and [test](test.md) all use it.

## Related Features

- [playground-ui](playground-ui.md)
- [chat](chat.md)
- [eval-run](eval-run.md)

## Dependencies

Generated app.

## Error Scenarios

Timeouts (client 120 s, conformance 60 s), resume conflicts 409.

## Performance

SSE streaming avoids buffering.

## Modules Involved

- [arc](../modules/arc.md)
- [adapters](../modules/adapters.md)
- [mock-llm](../modules/mock-llm.md)

## Patterns Used

- [arc-contract-and-client](../patterns/arc-contract-and-client.md)
- [generated-runtime-adapter](../patterns/generated-runtime-adapter.md)

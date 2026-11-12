# Pattern: ARC v1 Contract and the Shared ArcClient

## Overview

ARC (Agent Runtime Contract) v1 is the HTTP+SSE interface every generated agent exposes. It is defined three
times and kept consistent by tests: zod types in `packages/arc`, a conformance suite that exercises a live
server, and the Python FastAPI server template. All Armature tooling that talks to an agent (playground,
`chat`, eval runner, `doctor --probe`, conformance) goes through one `ArcClient`.

## Purpose

- One runtime contract across frameworks, so evals and the playground work for LangGraph and OpenAI Agents
  alike.
- Streaming events based on `@ag-ui/core` 1.0.4 types (ADR 0002) with Agent-Protocol-style endpoint naming.
- Verify any server (including the reference server in tests) with a framework-neutral suite.

## Where Used

- Types: [`Health`, `Manifest`](../../packages/arc/src/types.ts:8) and run request/result types in the same file.
- Client: [`ArcClient`](../../packages/arc/src/client.ts:18), [`parseSse`](../../packages/arc/src/client.ts:78).
- Event validation: [`validateEventStream`](../../packages/arc/src/events.ts:11).
- Conformance: [`CHECKS`](../../packages/arc/src/conformance.ts:42), [`runConformance`](../../packages/arc/src/conformance.ts:88).
- Server side: `packages/adapters/templates/common/src/__pkg__/runtime/server.py` (routes at lines 159-215).
- Consumers: [`chatCommand`](../../packages/cli/src/commands/chat.ts:118), [`startEvalSession`](../../packages/evals/src/session.ts:46),
  the playground `app.js` (browser, plain fetch), [`projectConformance`](../../packages/cli/src/project.ts:48).
- Modules: [arc](../modules/arc.md), [adapters](../modules/adapters.md), [playground](../modules/playground.md).

## Implementation Details

Endpoints (server.py): `GET /health`, `GET /manifest`, `POST /runs/wait`, `POST /runs/stream`,
`GET /runs/{run_id}`, `POST /runs/{run_id}/resume`, `GET /threads/{thread_id}`, `DELETE /threads/{thread_id}`.

- `ArcClient.request` is a thin `fetch` wrapper with `AbortSignal.timeout`; non-2xx becomes `ArcHttpError`.
- Streaming uses `parseSse`, which splits on blank lines, joins `data:` lines, ignores comments and stops
  at `[DONE]`. Each payload is an `ArcEvent` (`BaseEvent` plus loose fields).
- Resume has a stream and a wait form; the client always sends the `stream` flag explicitly.
- Approvals are a pause: the run result/event stream reports pending approvals; the client calls resume with
  decisions (approve, deny, optionally edited args).
- Seven conformance checks: health/manifest schema, scripted tool run (stream equals wait), approval flow,
  limits, spans, eval-trial isolation and the eval-mode gate. A check returns PASS, FAIL or NOT_APPLICABLE.

## Code Example

```ts
const client = new ArcClient(app.url, 60_000);
const result = await client.wait({ thread_id, input: "hello" });
for await (const ev of client.stream({ thread_id, input: "again" })) console.log(ev.type);
```

## Common Scenarios

- Interactive chat: stream events, print text deltas, ask for approvals, resume.
- Eval trial: `wait`, then loop on `resume` (max 25 times) while approvals are pending, then `getRun` for the
  spans/tool record and `deleteThread`.
- Conformance: script the mock LLM for a given first user message, run the check, inspect the mock log.

## Rules & Constraints

- ARC changes (endpoints, event shapes, health/manifest fields) need an ADR and a conformance update.
- A dropped client must never cancel a run: runs are server-side tasks and `wait` and `stream` are views of
  the same task.
- Eval-mode metadata (stubs, ids) is rejected unless the server started with `ARMATURE_EVAL_MODE=1`.
- The normative ARC description is `docs/adr/0002-arc-v1.md` plus the Zod schemas in `packages/arc/src/types.ts`.

## Common Gotchas

- Browser code cannot import the TypeScript client; `packages/playground/public/app.js` reimplements SSE
  parsing and must follow the same contract.
- `Health` and `Manifest` are `.loose()` on purpose so servers can add fields.
- The websocket interface exists in the spec enum but is not implemented.

## Anti-Patterns

- Calling the agent through framework APIs directly in tooling; always use ARC.
- Asserting on streamed event order beyond what `validateEventStream` guarantees.

## Related Patterns

- [Generated runtime adapter](generated-runtime-adapter.md) implements the server.
- [Mock LLM scripted testing](mock-llm-scripted-testing.md) drives conformance deterministically.
- [Eval case lifecycle](eval-case-lifecycle.md) consumes run records.

## Background

ADR 0002 (`docs/adr/0002-arc-v1.md`) records the choice of `@ag-ui/core` 1.0.4 and endpoint naming.

## Modules Using This Pattern

- [arc](../modules/arc.md)
- [evals](../modules/evals.md)
- [cli](../modules/cli.md)
- [playground](../modules/playground.md)
- [adapters](../modules/adapters.md)

## Related Patterns (Why They Connect)

- [generated-runtime-adapter](generated-runtime-adapter.md): the Python side of ARC.
- [mock-llm-scripted-testing](mock-llm-scripted-testing.md): offline determinism.

# Module: arc (`@armature/arc`)

## Purpose & Scope

### What This Module Does

`packages/arc` defines ARC v1, the HTTP contract every generated agent serves, from the TypeScript side:
zod schemas for each payload, a fetch-based client with an SSE parser, a validator for event streams, and a
seven-check conformance suite. ARC reuses AG-UI events for streaming (`@ag-ui/core`) and an Agent
Protocol-style set of routes for runs and threads. Armature-specific data rides on two AG-UI `CUSTOM` events,
`armature.approval_required` and `armature.usage`.

The generated Python server implements the contract (see [adapters.md](adapters.md)); this package is what the
playground, `armature chat`, the eval runner and `armature test`/`doctor` use to talk to it and to check it.

### Boundaries

- IN: payload schemas (`Health`, `Manifest`, `RunRequest`, `RunResult`, `RunRecord`, `ResumeRequest`,
  `Thread`, `Span`, `Usage`, `ErrorCode`), `ArcClient`, `parseSse`, `validateEventStream`, `streamedText`,
  `runConformance`, `arcSchemas()`.
- OUT: running or launching the app (core's `launchApp`, see [core.md](core.md)); the server implementation
  (Python templates); the mock model (see [mock-llm.md](mock-llm.md)); the web UI (see
  [playground.md](playground.md)).
- The normative ARC description is `docs/adr/0002-arc-v1.md` plus these schemas.

## Key Components

| Symbol | Location | Role |
| --- | --- | --- |
| `ARC_VERSION = 1`, `SideEffect`, `Health`, `Manifest`, `ManifestTool` | `../../packages/arc/src/types.ts:4` | Discovery payloads |
| `RunRequest`, `EvalMetadata`, `InputMessage` | `../../packages/arc/src/types.ts:85` | Run input; `metadata.eval` carries `case_id`, `trial`, `fixtures`, `stubs` |
| `RunResult`, `RunRecord`, `ToolCallRecord`, `Usage`, `Span`, `RunError`, `ErrorCode` | `../../packages/arc/src/types.ts:94` | Run outcome, spans and errors |
| `Decision`, `ResumeRequest`, `PendingApproval`, `Thread` | `../../packages/arc/src/types.ts:143` | Approvals and thread history |
| `CUSTOM_EVENTS` | `../../packages/arc/src/types.ts:215` | `armature.approval_required`, `armature.usage` |
| `arcSchemas()` | `../../packages/arc/src/types.ts:220` | JSON Schemas written to `schemas/` by `scripts/export-schemas.ts` |
| `ArcClient`, `ArcHttpError`, `parseSse` | `../../packages/arc/src/client.ts:18` | Minimal client: `health`, `manifest`, `wait`, `stream`, `getRun`, `resume`, `resumeStream`, `getThread`, `deleteThread` |
| `validateEventStream`, `streamedText` | `../../packages/arc/src/events.ts:11` | AG-UI schema plus ARC sequencing checks |
| `CHECKS`, `runConformance` | `../../packages/arc/src/conformance.ts:42` / `:88` | The seven conformance checks |
| `reference-server.ts` | `../../packages/arc/test/reference-server.ts` | Test double that implements ARC in Node |

## API Surface

HTTP routes served by every generated agent (implemented in `adapters/.../runtime/server.py:159-215`):

- `GET /health`, `GET /manifest`
- `POST /runs/wait` (blocking JSON `RunResult`), `POST /runs/stream` (SSE AG-UI events)
- `GET /runs/{run_id}` (`RunRecord` with spans), `POST /runs/{run_id}/resume` (JSON or SSE with
  `stream: true`)
- `GET /threads/{thread_id}`, `DELETE /threads/{thread_id}`

Conformance checks (`CHECKS`): `health_manifest`, `tool_run`, `approval`, `limits`, `spans`, `isolation`,
`eval_gate`. A check result is `PASS`, `FAIL` or `NOT_APPLICABLE`.

Error codes: `limit_exceeded`, `timeout`, `model_error`, `tool_error`, `structured_output_invalid`,
`invalid_request`, `internal`. Run status: `success`, `error`, `interrupted`. Tool call status:
`pending_approval`, `completed`, `error`, `denied`.

## Dependencies

### Internal Modules

`@armature/mock-llm` (the conformance suite imports `synthesize` and drives the mock's `/__mock/*` API).

### External Services

`@ag-ui/core` (event schemas, `EventSchema`) and `zod`. At runtime the client talks to whatever ARC URL it is
given (a local generated app).

### Patterns Used

[arc-contract-and-client](../patterns/arc-contract-and-client.md),
[schema-first-contracts](../patterns/schema-first-contracts.md),
[mock-llm-scripted-testing](../patterns/mock-llm-scripted-testing.md).

## Data Flow

```
client (playground/chat/evals) --ArcClient--> generated app (FastAPI)
   POST /runs/stream  ==> SSE: RUN_STARTED, TEXT_MESSAGE_*, TOOL_CALL_*, CUSTOM(usage), RUN_FINISHED | RUN_ERROR
   interrupted run     ==> CUSTOM armature.approval_required {approvals[]} then RUN_FINISHED(interrupt)
   POST /runs/{id}/resume {decisions[], stream}  ==> continues the same run
   GET  /runs/{id}     ==> RunRecord (messages, tool calls, usage, spans) for grading
```

## Key Behaviors

### Conformance run (`runConformance`)

1. Builds an `ArcClient` for the eval-mode app and optionally a second one for a normal-mode app
   (`normalApp`), and a `MockControl` for the mock URL (a trailing `/v1` is stripped).
2. For each check, scripts the mock with a unique nonce-based first user message, runs the request, and
   asserts: schemas (`Health`, `Manifest`, `RunResult`, `RunRecord`), the event stream
   (`validateEventStream`), tool results, approvals (approve completes; deny continues without calling the
   tool), limit breach yielding `RUN_ERROR` without hanging, spans (an `invoke_agent` root with `chat` and
   `execute_tool` children), isolation of two eval trials, and the eval gate (eval metadata rejected outside
   eval mode).
3. Each check is independent; failures are collected and never stop the suite. A check that cannot apply reports `NOT_APPLICABLE`: `approval` when no tool requires approval
   (`conformance.ts:228`), `limits` when no tool runs without approval or the limits are above 100
   (`conformance.ts:314-316`), and `eval_gate` when no `normalApp` URL is given (`conformance.ts:402`).
4. `onCheck` streams each result to the caller for live output.

### Event validation

`validateEventStream` requires: valid AG-UI events, `RUN_STARTED` first, exactly one terminal event
(`RUN_FINISHED` or `RUN_ERROR`) last, balanced `TEXT_MESSAGE_*` and `TOOL_CALL_*` lifecycles, and well formed
`CUSTOM` payloads. On a resume stream, pass the ids of calls that ended in the paused stream via
`endedToolCalls`.

### Error scenarios

- Non-2xx response: `ArcHttpError(status, body, path)` with a message of at most 300 body characters.
- Client timeout: `AbortSignal.timeout` (120 s default, 60 s in conformance).
- Malformed response: a `Fail` with `... does not match the ARC schema at <path>: <message>`.

### Why This Flow

A single schema plus conformance suite is the guarantee that frameworks are interchangeable: evals,
playground and chat never need framework-specific code.

## Configuration

`ArcClient(baseUrl, timeoutMs = 120_000)`; `ConformanceOptions { app, normalApp?, mockUrl, timeoutMs?,
onCheck? }`. The schemas published to `schemas/` come from `arcSchemas()`; CI diffs them.

## Testing

`../../packages/arc/test/conformance.test.ts` runs the suite against `reference-server.ts` (a Node ARC
implementation): it expects all seven checks to pass, expects `eval_gate` to fail when pointed at an
eval-mode app as the normal app, exercises `validateEventStream` on good and bad streams, and checks that the
ARC JSON schemas are published. The Python
implementation is validated end to end in `../../tests-integration/*.test.ts` (see
[tests-integration.md](tests-integration.md)).

## Performance Considerations

SSE is parsed incrementally (`parseSse` over a `ReadableStream`); nothing buffers a whole run. Conformance
starts two app processes (done by cli `project.ts`), so it costs a few seconds.

## Gotchas & Constraints

### Never Do This

- Never change ARC payloads, routes, event names or error codes without an ADR (`docs/adr/0002-arc-v1.md`).
- Never accept `metadata.eval` in a normal-mode app; the eval gate keeps graders' stubs out of production.

### Always Do This

- Keep `.loose()` on server-produced payloads so the server may add fields, and `.strict()` on requests
  (`RunRequest`, `EvalMetadata`) so typos are rejected.
- Update the Python templates and `reference-server.ts` together with any schema change.

### Common Mistakes

- Forgetting `normalApp` and then seeing `eval_gate` reported as `NOT_APPLICABLE`.
- Treating `interrupted` as an error: it is a normal pause awaiting approval decisions.

### Edge Cases

- `Health.model_mode` is `live` or `mock`; `ready` carries non-secret facts such as whether the key is set.
- `SideEffect` exists both here and in `@armature/schema` with the same values.

### Business Rules

- Write and destructive tools pause for approval unless the spec sets `allow`.
- Eval metadata (`case_id`, `trial`, `fixtures`, `stubs`) is accepted only in eval mode.
- `Usage.cost_usd` may be unknown; graders and gates label it `NOT_MEASURED` instead of guessing.

## Security Considerations

Approval decisions are the user's only guard on write and destructive tools, so the conformance suite proves
that a denied call is never executed. The client sends no credentials; ARC apps are expected on loopback or a
trusted network.

## Features Implemented

[arc-http-api](../features/arc-http-api.md), [chat](../features/chat.md), [playground-ui](../features/playground-ui.md),
[eval-run](../features/eval-run.md), [test](../features/test.md), [doctor](../features/doctor.md).

## Related Documentation

- Modules: [adapters](adapters.md), [mock-llm](mock-llm.md), [evals](evals.md), [cli](cli.md),
  [playground](playground.md).
- Patterns: [arc-contract-and-client](../patterns/arc-contract-and-client.md).
- ADR: `../../docs/adr/0002-arc-v1.md`.

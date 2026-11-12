# Pattern: Mock LLM with Scripts, Smoke and Null Modes

## Overview

`@armature/mock-llm` is a local OpenAI-compatible HTTP server (`/v1/chat/completions`, `/v1/models`) that
replaces a real model. It has three behaviours: replay a script keyed by the first user message, a "smoke"
heuristic that calls a tool once with schema-derived arguments and then summarizes, and a "null" mode that
always declines. A small `/__mock/*` control API lets tests and the eval runner load scripts and read the
request log.

## Purpose

- Run generated agents offline, deterministically and for free (`armature dev --offline`, offline evals,
  conformance, integration tests).
- Prove that graders and benchmarks discriminate: the null agent must fail every substantive case, and a
  reference trajectory replayed through scripts must pass its own graders.
- Check what the agent actually sent to the model via the request log.

## Where Used

- Server: [`createMockLlm`](../../packages/mock-llm/src/server.ts:53), [`startMockLlm`](../../packages/mock-llm/src/server.ts:198),
  [`smoke`](../../packages/mock-llm/src/server.ts:229), constant [`NULL_AGENT_REPLY`](../../packages/mock-llm/src/server.ts:17).
- Argument synthesis: [`synthesize`](../../packages/mock-llm/src/synthesize.ts:7).
- Types: [`Script`, `ScriptStep`, `MockMode`](../../packages/mock-llm/src/types.ts:50).
- `dev --offline`: [`devCommand`](../../packages/cli/src/commands/dev.ts:135) starts the mock and sets
  `ARMATURE_MODEL_MODE=mock` and `ARMATURE_MOCK_URL` for the child app.
- Eval runner: [`runSuite`](../../packages/evals/src/suite.ts:60) and
  [`validateDynamic`](../../packages/evals/src/suite.ts:104).
- Conformance control client: `MockControl` in [`conformance.ts`](../../packages/arc/src/conformance.ts:54).
- Tests: `packages/mock-llm/test/mock-llm.test.ts`, `tests-integration/harness.ts`.
- Modules: [mock-llm](../modules/mock-llm.md), [evals](../modules/evals.md), [tests-integration](../modules/tests-integration.md).

## Implementation Details

- Scripts are stored by trimmed `match` text. A script step is `{ text }`, `{ tool_calls }` or
  `{ error: { status, message } }`; steps are served by assistant-turn index within a conversation, and an
  exhausted script answers `[mock] script exhausted`. `delay_ms` delays each step (timeout tests).
- Control routes: `POST/DELETE /__mock/scripts`, `PUT /__mock/mode` (`smoke` or `null`), `GET/DELETE
  /__mock/log`. Unknown routes return 404.
- Smoke mode picks the tool whose name appears in the user text (else the first tool), builds arguments with
  `synthesize`, and after a tool result returns a summary. If the system prompt carries an output schema it
  returns schema-shaped JSON. Chunks stream OpenAI-style with usage and `[DONE]`.
- Null mode never calls tools and always replies with `NULL_AGENT_REPLY`.
- The request log records model, stream flag, messages and tool names for every call.

## Code Example

```ts
const mock = await startMockLlm();
mock.addScripts([{ match: "Where is order 42?", steps: [
  { tool_calls: [{ name: "lookup_order", args: { order_id: "42" } }] },
  { text: "Order 42 shipped." },
] }]);
// point the generated app at mock.baseUrl, run a case, then:
expect(mock.log().length).toBe(2);
await mock.close();
```

## Common Scenarios

- Offline playground: smoke mode answers every message with one tool call plus a summary.
- Offline eval case with a reference trajectory: `runSuite` converts the reference into a `Script` with
  `match = firstUserText(case)`; cases without references fall back to smoke.
- Benchmark validation: switch to null mode and expect every non-smoke, non-refusal case to fail.
- Error handling: script `{ error: { status: 429, message } }` to exercise model-error paths.

## Rules & Constraints

- Mock results are labelled MOCK and can never be compared with LIVE runs (`compareRuns` refuses).
- The mock is shared per session, so offline eval trials that use `beforeTrial` run on a single worker.
- Smoke mode is "never a quality signal": do not draw conclusions about agent quality from it.
- Costs from the mock are not real; cost gates only measure live runs.

## Common Gotchas

- `match` is the exact first user message; whitespace differences matter after trimming only at the ends.
- Scripts persist across conversations until cleared; tests must call `clearScripts` or restart the mock.
- Chat paths are matched with `endsWith`, so `/v1/chat/completions` and `/chat/completions` both work.

## Anti-Patterns

- Asserting on real-model wording from mock output.
- Sharing one mock between concurrent trials that load different scripts.

## Related Patterns

- [Eval case lifecycle](eval-case-lifecycle.md) uses null and reference replay validation.
- [ARC contract](arc-contract-and-client.md): conformance scripts the mock through `MockControl`.
- [Testing conventions](testing-conventions.md) lists where the mock is used in tests.

## Background

No ADR is dedicated to the mock; ADR 0005 (`docs/adr/0005-eval-cli.md`) describes offline vs live evals that
depend on it.

## Modules Using This Pattern

- [mock-llm](../modules/mock-llm.md)
- [arc](../modules/arc.md)
- [evals](../modules/evals.md)
- [cli](../modules/cli.md)
- [tests-integration](../modules/tests-integration.md)

## Related Patterns (Why They Connect)

- [testing-conventions](testing-conventions.md): how all of this is verified.
- [eval-case-lifecycle](eval-case-lifecycle.md): cases move DRAFT to VERIFIED to frozen.

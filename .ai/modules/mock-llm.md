# Module: mock-llm (`@armature/mock-llm`)

## Purpose & Scope

### What This Module Does

`packages/mock-llm` is a small in-process HTTP server that imitates the OpenAI chat-completions API so a
generated agent can run with no API key and no network. It serves three kinds of replies: scripted replies
matched by the first user message, a "smoke" heuristic that calls a tool once with schema-synthesized
arguments, and a "null" mode that always refuses. It also exposes a control API under `/__mock/` so tests and
the ARC conformance suite can load scripts, switch modes and read the request log.

It is used by `armature dev --offline`, `armature test` (conformance), `armature doctor --conformance`, `armature eval run --offline`, `armature eval validate` (the null-agent check) and the unit
tests.

### Boundaries

- IN: `/v1/chat/completions` (JSON and SSE), `/v1/models`, `/health`, the `/__mock/*` control routes, argument
  synthesis from JSON Schema, a 500-entry request log, scripted errors and delays.
- OUT: Anthropic-style endpoints (the generated app talks to the mock through an OpenAI-compatible client in
  mock mode for both frameworks); any grading or quality judgement (a smoke reply "is never a quality
  signal", `../../packages/mock-llm/src/server.ts:224`); persistence.
- The mock is for wiring and determinism, not for measuring the agent. Eval results produced offline are
  labelled accordingly by [evals.md](evals.md).

## Key Components

| Symbol | Location | Role |
| --- | --- | --- |
| `createMockLlm`, `startMockLlm` | `../../packages/mock-llm/src/server.ts:53` / `:198` | Build the server and listen; `startMockLlm` fills in `url` and `baseUrl` (`.../v1`) |
| `smoke` | `../../packages/mock-llm/src/server.ts:229` | Heuristic reply: call the named or first tool once, then summarize the tool result |
| `NULL_AGENT_REPLY` | `../../packages/mock-llm/src/server.ts:17` | `"I can't help with that."` returned in null mode |
| `textOf` | `../../packages/mock-llm/src/server.ts:43` | Flattens string or part-array message content |
| `synthesize` | `../../packages/mock-llm/src/synthesize.ts:7` | Builds a small valid value from a JSON Schema (const, default, enum, anyOf, allOf, `$ref`) |
| `Script`, `ScriptStep`, `MockMode`, `LoggedRequest`, `ChatRequest` | `../../packages/mock-llm/src/types.ts:55` | Types for scripts, modes and logs |
| `fromStep` | `../../packages/mock-llm/src/server.ts` | Turns a script step into text, tool calls or an HTTP error |

## API Surface

HTTP (all on `127.0.0.1`; `mock.url`, and `mock.baseUrl = url + "/v1"`):

| Route | Behavior |
| --- | --- |
| `GET /health` or `/` | `{ ok: true, mode }` |
| `GET .../models` | One model, id `mock-model` |
| `POST .../chat/completions` | Reply per mode; `stream: true` returns SSE chunks |
| `POST /__mock/scripts` | Body `Script` or `{scripts: Script[]}`; keyed by the trimmed `match`; returns 201 |
| `DELETE /__mock/scripts` | Clears scripts |
| `PUT /__mock/mode` | `{mode: "smoke" | "null"}`, else 400 |
| `GET /__mock/log`, `DELETE /__mock/log` | Read or clear the logged requests (`{requests: [...]}`) |

Programmatic: the `MockLlm` object offers `setMode`, `addScripts`, `clearScripts`, `log`, `clearLog`,
`close`. Script steps are `{text}`, `{tool_calls: [{id?, name, args?}]}` or `{error: {status, message}}`;
`delay_ms` on a script delays each step.

## Dependencies

### Internal Modules

None (`types.ts`, `synthesize.ts` are local). It is imported by `cli` (`dev`, `project.ts`, `eval`), `evals`
(`session.ts`), and `arc` (its conformance suite imports `synthesize` and drives the control API over HTTP).

### External Services

None. Node's `http` module only.

### Patterns Used

[mock-llm-scripted-testing](../patterns/mock-llm-scripted-testing.md),
[app-process-launching](../patterns/app-process-launching.md) (the launcher sets `ARMATURE_MOCK_URL`),
[testing-conventions](../patterns/testing-conventions.md).

## Data Flow

```
generated app (ARMATURE_MODEL_MODE=mock, ARMATURE_MOCK_URL=<mock.baseUrl>)
   --> POST /v1/chat/completions
        first user message trimmed == script.match ? --> next script step (per-script counter)
        else mode == "null" ? --> NULL_AGENT_REPLY
        else smoke(req) --> tool call (first call) or summary text
   --> JSON or SSE response, usage estimated at ~4 chars per token, entry appended to the log (max 500)
```

## Key Behaviors

### Script matching and stepping

1. The server finds the first `user` message in the request and trims its text.
2. If a script has that exact `match`, the reply is the step numbered by how many assistant messages follow the latest user
   message (so each new user turn restarts the script at step 0); when steps run out, the text is `[mock] script exhausted`.
3. A step with `error` yields an HTTP error with the given status and message (used to test `model_error`).
4. Scripts are re-registered under the trimmed match, so whitespace differences do not matter.

### Smoke heuristic

1. Only when there are tools and no tool result yet after the last user message: choose the tool whose name
   (or name with underscores as spaces) appears in the user text, otherwise the first tool, and call it with
   `synthesize(parameters)`.
2. If the request carries an output JSON Schema (either `response_format.json_schema.schema` or an
   `OUTPUT_SCHEMA` block in a system message), return `synthesize(schema)` as JSON text.
3. If a tool result came back, reply `Mock response: <tool> returned <first 200 chars>`.
4. Otherwise reply `Mock response (turn N): <first 200 chars of user text>`.

### Null mode

Every reply is `I can't help with that.`, regardless of tools. `eval validate` uses this "null agent" to
check that no VERIFIED case passes for a do-nothing agent (see
[eval-validate-and-freeze](../features/eval-validate-and-freeze.md)).

### Error scenarios

- Unknown route: 404 `mock-llm has no route <METHOD> <path>`.
- Bad `PUT /__mock/mode`: 400 `mode must be smoke or null`.
- Port busy: `startMockLlm` rejects on the `error` event of `listen`.

### Why This Flow

Exact-match scripts make ARC conformance and unit tests deterministic; the smoke mode makes a fresh project
runnable and testable straight after `init` with zero setup; the null mode gives evals a zero baseline.

## Configuration

`MockLlmOptions { port = 0 (random), host = "127.0.0.1", mode = "smoke", scripts = [] }`. Callers pass
`port: 0` so parallel tests and sessions never collide. The log is capped at `LOG_LIMIT = 500` requests.

## Testing

`../../packages/mock-llm/test/mock-llm.test.ts` covers scripts, smoke, null mode, SSE streaming, control
routes and the log. The ARC conformance test (`../../packages/arc/test/conformance.test.ts`) drives it
through the control API.

## Performance Considerations

All state is in memory; replies are synchronous except for `delay_ms`. The request log is truncated at 500
entries, trimmed from the front.

## Gotchas & Constraints

### Never Do This

- Never treat a score from the mock model as agent quality; offline evals only validate plumbing.
- Never bind the mock to a non-loopback host by default.

### Always Do This

- Match the **first** user message exactly (after trim) when scripting; steps are counted from the latest
  user turn, so a later user turn in the same conversation restarts at the script's first step.
- Close the mock (`await mock.close()`) in `finally`, as `cli/src/project.ts:projectConformance` does.

### Common Mistakes

- Scripting by the latest user message instead of the first one.
- Forgetting that the OpenAI-compatible base URL must end in `/v1` (`mock.baseUrl`), while the control API
  lives at the bare `mock.url`.

### Edge Cases

- `synthesize` stops at depth 8 and returns `null`; it picks the first non-null `anyOf` variant.
- Message content may be a string or an array of parts; `textOf` handles both.

### Business Rules

- Token usage in mock replies is an estimate (`ceil(chars / 4)`), so mock cost is not a measurement.

## Security Considerations

The server is unauthenticated and loopback-only by default; it holds no secrets and never forwards requests.

## Features Implemented

[dev](../features/dev.md) (`--offline`), [test](../features/test.md), [eval-run](../features/eval-run.md)
(`--offline`), [eval-validate-and-freeze](../features/eval-validate-and-freeze.md) (null agent),
[arc-http-api](../features/arc-http-api.md) (conformance scripts).

## Related Documentation

- Modules: [arc](arc.md), [evals](evals.md), [cli](cli.md), [adapters](adapters.md).
- Patterns: [mock-llm-scripted-testing](../patterns/mock-llm-scripted-testing.md).
- Architecture: [module-interactions](../architecture/module-interactions.md).

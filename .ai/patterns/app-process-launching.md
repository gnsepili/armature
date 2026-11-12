# Pattern: Launching the Generated App as a Child Process

## Overview

Armature never imports generated Python code. Anything that needs the agent running (`dev`, `eval run`,
`doctor --probe`, `test --only conformance`, integration tests) starts `python -m <package> serve` inside the
project's `.venv`, waits for `/health`, and talks to it over ARC. The shared helpers live in
`packages/core/src/app.ts`.

## Purpose

- One launch path with consistent port selection, health waiting, log capture and shutdown.
- Clear failure modes with actionable hints when the venv is missing or the app crashes at startup.

## Where Used

- Helpers: [`venvPython`](../../packages/core/src/app.ts:9), [`requireVenv`](../../packages/core/src/app.ts:15),
  [`freePort`](../../packages/core/src/app.ts:27), [`waitHealthy`](../../packages/core/src/app.ts:38),
  [`launchApp`](../../packages/core/src/app.ts:66).
- Dev server: [`devCommand`](../../packages/cli/src/commands/dev.ts:135).
- Eval sessions: [`startEvalSession`](../../packages/evals/src/session.ts:46).
- Conformance: [`projectConformance`](../../packages/cli/src/project.ts:48).
- Tests: `tests-integration/harness.ts`.
- Modules: [core](../modules/core.md), [cli](../modules/cli.md), [evals](../modules/evals.md).

## Implementation Details

- `requireVenv` checks `.venv/bin/python` (or `Scripts/python.exe` on Windows) and throws an environment
  error with the hint `uv sync --extra dev`.
- `launchApp` picks a free port (or uses the one given), spawns the server with the caller's `env`, keeps the
  last 20 000 characters of output, and awaits `waitHealthy` (200 ms polling, 60 s default timeout, aborts if
  the child exits early).
- On a failed start it stops the child and appends the last 15 log lines to the error message.
- `stop()` sends SIGTERM and falls back to SIGKILL after 5 s.
- `dev` uses `stdio: "inherit"` so users see server logs; sessions use `"pipe"`.

## Code Example

```ts
const app = await launchApp({ dir, package: plan.package, env: { ...process.env, ARMATURE_EVAL_MODE: "1" } });
try {
  const client = new ArcClient(app.url);
  await client.health();
} finally {
  await app.stop();
}
```

## Common Scenarios

- `dev --offline`: mock LLM URL passed via env, app on port 8000 by default, playground on 5174.
- Eval: app started with `ARMATURE_EVAL_MODE=1`; `health.eval_mode` is verified before trials.
- Conformance: the app is launched twice, with eval mode on and off, each with a temporary
  `ARMATURE_SESSION_DB`.

## Rules & Constraints

- Always stop the app in a `finally` or signal handler.
- Pass environment explicitly (`io.env`); do not rely on the parent's `process.env` inside library code.
- The app command line is `python -m <package> serve --host H --port P`; the template `__main__.py.hbs` owns
  that contract.

## Common Gotchas

- A port returned by `freePort` can be taken before the child binds; the health check will fail with the
  app's own log excerpt.
- Windows uses a different venv layout; always go through `venvPython`.
- Missing API keys for live runs are detected before launch in eval (`hasApiKey`), not by the app.

## Anti-Patterns

- Spawning Python from commands with ad hoc `spawn` calls.
- Importing generated modules into the Node process.

## Related Patterns

- [Io abstraction](io-abstraction-testable-cli.md) supplies the environment.
- [ARC contract](arc-contract-and-client.md) is what runs after launch.
- [Mock LLM testing](mock-llm-scripted-testing.md) is the usual model endpoint when offline.

## Background

ADR 0003 and ADR 0006 define `dev`, `doctor` and `test` behaviour built on this helper.

## Modules Using This Pattern

- [core](../modules/core.md)
- [cli](../modules/cli.md)
- [evals](../modules/evals.md)
- [tests-integration](../modules/tests-integration.md)

## Related Patterns (Why They Connect)

- [mock-llm-scripted-testing](mock-llm-scripted-testing.md): offline determinism.
- [arc-contract-and-client](arc-contract-and-client.md): the one runtime boundary.

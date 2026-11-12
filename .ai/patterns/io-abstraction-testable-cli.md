# Pattern: Io Abstraction for a Testable CLI

## Overview

Every command is an exported function `(io: Io, ...args) => number | Promise<number>`. `Io` bundles working
directory, environment, output writers, stdin reader and an `interactive` flag. The binary passes
`processIo()`; tests pass an in-memory implementation.

## Purpose

- Run CLI commands in-process under vitest without spawning a shell.
- Make "never block without a TTY" (ADR 0003) a checkable property: prompts happen only when
  `io.interactive` is true.
- Keep commands deterministic by reading environment through `io.env`, not `process.env`.

## Where Used

- Definition: [`Io`](../../packages/cli/src/io.ts:5), [`processIo`](../../packages/cli/src/io.ts:16).
- Command wiring: [`program`](../../packages/cli/src/index.ts:27) and [`run`](../../packages/cli/src/index.ts:198).
- Interactive gating: [`initCommand`](../../packages/cli/src/commands/init.ts:41) decides whether to run the
  wizard; [`chatCommand`](../../packages/cli/src/commands/chat.ts:118) accepts an injectable `Ask`.
- Test helpers: `packages/cli/test/helpers.ts` and the command tests in `packages/cli/test/*.test.ts`.
- Module doc: [cli](../modules/cli.md).

## Implementation Details

- `interactive` is `stdin.isTTY && stdout.isTTY && !CI`. Any of `--yes`, `--config` or `--json` also disables
  the wizard.
- Output helpers (`printJson`, `printFailure`, `c.*` colors) take `io`; colors turn off when stdout is not a
  TTY or `NO_COLOR` is set.
- Commands never read `process.cwd()`; they resolve their directory from `io.cwd` plus an optional argument.
- Long-running commands (`dev`, `chat`) receive the same `io` and register signal handlers only when run for
  real; tests drive them with injected asks and small servers.

## Code Example

```ts
// test style used by packages/cli/test
const out: string[] = [];
const io: Io = { cwd: tmp, env: {}, stdout: (t) => out.push(t), stderr: () => {}, readStdin: async () => "", interactive: false };
const code = await run(["generate", "--json"], io);
expect(code).toBe(0);
```

## Common Scenarios

- `armature init --config -` reads a spec from `io.readStdin()` so agents can pipe a spec.
- CI runs without a TTY, so `init` without `--yes` still works using defaults.
- `chat` approvals prompt only in a terminal; otherwise approvals follow flags.

## Rules & Constraints

- Do not touch `process.stdout`, `process.env` or `process.cwd()` directly in commands.
- Anything that can prompt must check `io.interactive` first.
- `--json` mode prints exactly one JSON document to stdout for result-style commands.

## Common Gotchas

- Forgetting to pass `io.env` to child processes causes tests to leak the developer's real keys.
- `run` auto-detects `--json` from argv; a command that builds its own error output should still call
  `printFailure` with that flag.

## Anti-Patterns

- Global state in command modules; keep it in the function scope.
- Using `console.log` in commands.

## Related Patterns

- [Error and exit codes](error-and-exit-codes.md): `run` is where thrown errors are printed.
- [App process launching](app-process-launching.md): commands pass `io.env` into the child app.
- [Testing conventions](testing-conventions.md) describes the vitest layout.

## Background

ADR 0003 (`docs/adr/0003-cli-surface-v0.md`) defines the flag surface and the no-blocking rule.

## Modules Using This Pattern

- [cli](../modules/cli.md)
- [tests-integration](../modules/tests-integration.md)

## Related Patterns (Why They Connect)

- [error-and-exit-codes](error-and-exit-codes.md): failures need stable codes for scripts.
- [testing-conventions](testing-conventions.md): how all of this is verified.

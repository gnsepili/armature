# Pattern: Typed Errors and Stable Exit Codes

## Overview

Expected failures are thrown as `ArmatureError` carrying one of six stable exit codes and an optional hint.
The CLI entry point never calls `process.exit`; it catches everything, converts it with `toFailure`, prints it
(text or `--json`) and returns the numeric code to `bin.ts`.

## Purpose

- Give scripts and CI a stable, documented exit-code contract (`docs/cli.md`).
- Separate "the user/spec is wrong" (1), "feature not supported" (2), "refused to overwrite" (3), "eval gate
  failed" (4) and "environment problem" (5) from success (0).
- Keep library packages free of process control so they can be unit-tested and reused.

## Where Used

- Definition: [`ExitCode` and `ArmatureError`](../../packages/core/src/errors.ts:2).
- Mapping and printing: [`toFailure`](../../packages/cli/src/io.ts:50), [`printFailure`](../../packages/cli/src/io.ts:58).
- Top-level handler: [`run`](../../packages/cli/src/index.ts:198) (detects `--json` from argv so even option
  parse errors are machine-readable).
- Throw sites: lock parsing ([`lock.ts:60`](../../packages/core/src/lock.ts:60)), init target check
  ([`write.ts:45`](../../packages/core/src/write.ts:45)), `requireVenv` ([`app.ts:15`](../../packages/core/src/app.ts:15)),
  benchmark freezing ([`freeze.ts:61`](../../packages/evals/src/freeze.ts:61)).
- Doctor encodes per-check exit codes in `DoctorCheck` ([`doctor.ts:29`](../../packages/cli/src/commands/doctor.ts:29)).
- Modules: [core](../modules/core.md), [cli](../modules/cli.md), [evals](../modules/evals.md).

## Implementation Details

- Codes: `ok 0`, `validation 1`, `unsupported 2`, `overwriteRefused 3`, `evalGateFailed 4`, `environment 5`.
- `toFailure` maps `ArmatureError` to its own code, `SchemaError` to `validation` (with issues), and any other
  thrown value to `environment`. Unknown bugs therefore surface as exit 5 with the raw message.
- Commands that finish normally but must signal a non-zero outcome return a number (for example `eval run`
  returns 4 when a gate fails, `dev` returns 5 if the app dies) instead of throwing.
- Commander is configured with `exitOverride`; `--help`/`--version` become code 0 and other commander errors
  become 1 (`index.ts:204-208`).

## Code Example

```ts
throw new ArmatureError(
  `no virtual environment in ${dir}`,
  ExitCode.environment,
  "run `uv sync --extra dev` in the project first",
);
```

The hint is printed on its own `hint` line (text mode) or in the JSON `error.hint` field.

## Common Scenarios

- Invalid `armature.yaml`: `SchemaError` -> exit 1 with per-path issues.
- Spec uses `workflow` pattern: compat error -> exit 2 (unsupported), not 1.
- `armature init` into a non-empty directory: exit 3 unless `--force`.
- Frozen benchmark drift or failed gates on `eval run`: exit 4.
- Missing uv, venv, API key or unreachable app: exit 5.

## Rules & Constraints

- Exit codes are a public contract; changing or adding one needs an ADR (`docs/adr/`).
- Library code throws; only `packages/cli/src/bin.ts` ends the process.
- Always provide a hint when the user can fix the problem with a command.
- `--json` output for failures is `{ ok: false, error: { message, exit_code, hint?, issues? } }`.

## Common Gotchas

- A plain `Error` is exit 5, which can hide a validation bug; wrap expected failures in `ArmatureError`.
- Do not print and then throw: `run` prints once.
- `printFailure` writes text errors to stderr but JSON errors to stdout.

## Anti-Patterns

- Calling `process.exit` inside a command or library function (breaks tests that call `run(argv, io)`).
- Returning exit 1 for "not supported yet" situations.

## Related Patterns

- [Io abstraction](io-abstraction-testable-cli.md) is how `run` captures the printed failure in tests.
- [Schema-first contracts](schema-first-contracts.md) produce the `SchemaError` mapped here.
- [Eval case lifecycle](eval-case-lifecycle.md) uses exit 4 for gate failures.

## Background

ADR 0001 (exit codes in the layout decision), ADR 0003 (CLI surface and "never block without a TTY") and
`docs/cli.md` document the table.

## Modules Using This Pattern

- [core](../modules/core.md)
- [cli](../modules/cli.md)
- [evals](../modules/evals.md)

## Related Patterns (Why They Connect)

- [io-abstraction-testable-cli](io-abstraction-testable-cli.md): keeps commands testable without a process.

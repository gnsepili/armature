# Feature: Doctor (`armature doctor`)

## What Users Can Do

- Diagnose the environment and project readiness; optionally probe the live model or run conformance.

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

None over HTTP, except `--probe` (one live model call) and `--conformance` (mock plus ARC).

## Components

`packages/cli/src/commands/doctor.ts`, `project.ts` (`projectConformance`).

## State Management

Stateless.

## Business Rules

- Statuses: ok, warn, fail, skip.
- Checks: node 22+, uv, venv (exit 5), dependencies, dev dependencies, scaffold lock and drift, model key and tool `auth_env`.
- Returns the first failing check's exit code.

## User Flow

1. Run checks in order.
2. Optionally probe and conformance.
3. Print table or JSON; exit code from first failure.

## Navigation Flow

doctor -> fix env -> [dev](dev.md).

## Related Features

- [test](test.md)
- [dev](dev.md)

## Dependencies

node, uv, Python venv.

## Error Scenarios

Failures carry their own exit codes (venv: 5).

## Performance

Probe costs a live call.

## Modules Involved

- [cli](../modules/cli.md)
- [core](../modules/core.md)
- [arc](../modules/arc.md)
- [mock-llm](../modules/mock-llm.md)

## Patterns Used

- [error-and-exit-codes](../patterns/error-and-exit-codes.md)
- [app-process-launching](../patterns/app-process-launching.md)

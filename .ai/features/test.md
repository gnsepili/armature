# Feature: Test (`armature test`)

## What Users Can Do

- Check a generated project: golden (managed files match a fresh render), unit (project pytest), conformance (ARC against the mock).

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

ARC conformance checks over HTTP against the mock-backed app.

## Components

`packages/cli/src/commands/test.ts`.

## State Management

Stateless; temp session DBs for conformance.

## Business Rules

- Parts: `golden | unit | conformance`.
- Unit runs `python -m pytest -q -p no:cacheprovider`; pytest missing is exit 5.
- Failure exits 1; environment failure exits 5.

## User Flow

1. Select parts.
2. Run each and collect results.
3. Print `all tests passed` or failures.

## Navigation Flow

[generate-and-sync](generate-and-sync.md) -> test.

## Related Features

- [doctor](doctor.md)
- [arc-http-api](arc-http-api.md)

## Dependencies

Python venv, mock-llm.

## Error Scenarios

Missing pytest: 5. Golden drift: 1.

## Performance

Unit and conformance start Python.

## Modules Involved

- [cli](../modules/cli.md)
- [core](../modules/core.md)
- [arc](../modules/arc.md)
- [mock-llm](../modules/mock-llm.md)

## Patterns Used

- [testing-conventions](../patterns/testing-conventions.md)
- [mock-llm-scripted-testing](../patterns/mock-llm-scripted-testing.md)
- [arc-contract-and-client](../patterns/arc-contract-and-client.md)

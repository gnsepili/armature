# Feature: Eval run (`armature eval run`)

## What Users Can Do

- Run a suite against the mock (`--offline`) or the live model with budget and seed control.

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

ARC `/runs/wait`, `/runs/{id}/resume`, `/runs/{id}`, `DELETE /threads/{id}` with eval metadata.

## Components

`packages/cli/src/commands/eval.ts`; `packages/evals/src/{session,run,suite,grade,metrics,snapshot}.ts`.

## State Management

Writes `evals/runs/<YYYYMMDD-HHMMSS-suite>/run.json` and `report.md`.

## Business Rules

- Flags: `--suite` (default dev), `--case`, `--sample`, `--seed` (0), `--trials`, `--offline`, `--max-cost`, `--concurrency`, `--json`.
- Live mode needs the model key (exit 5 otherwise).
- Draft cases never fail gates except smoke and contract.
- Offline runs are sequential.

## User Flow

1. Start session (eval mode, mock when offline).
2. For each case and trial: fresh thread, wait, resume approvals (max 25), fetch record.
3. Grade, summarize, evaluate gates, write snapshot.
4. Exit non-zero when gates fail.

## Navigation Flow

[eval-validate-and-freeze](eval-validate-and-freeze.md) -> run -> [eval-report-and-compare](eval-report-and-compare.md).

## Related Features

- [eval-report-and-compare](eval-report-and-compare.md)
- [arc-http-api](arc-http-api.md)

## Dependencies

A project venv; model key for live.

## Error Scenarios

Timeout: failure kind timeout; HTTP problems: contract; budget exhausted: budget gate fails.

## Performance

Cost estimate shown first; concurrency from run policy.

## Modules Involved

- [evals](../modules/evals.md)
- [cli](../modules/cli.md)
- [arc](../modules/arc.md)
- [core](../modules/core.md)
- [mock-llm](../modules/mock-llm.md)

## Patterns Used

- [eval-case-lifecycle](../patterns/eval-case-lifecycle.md)
- [arc-contract-and-client](../patterns/arc-contract-and-client.md)
- [app-process-launching](../patterns/app-process-launching.md)
- [mock-llm-scripted-testing](../patterns/mock-llm-scripted-testing.md)

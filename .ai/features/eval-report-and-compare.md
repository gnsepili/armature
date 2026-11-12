# Feature: Eval report and compare (`armature eval report|compare`)

## What Users Can Do

- Re-render a past run (default latest) with `report [run]`, `-C`, `--reveal`.
- Compare two runs with significance testing.

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

None (reads snapshots).

## Components

`packages/cli/src/commands/eval.ts`; `packages/evals/src/{report,compare,snapshot,stats}.ts`.

## State Management

Reads `evals/runs/*`; aggregate-only suites keep full data outside the repo.

## Business Rules

- A case moves only when Fisher exact p <= 0.1.
- Only cases present in both runs with equal hashes count.
- `compare` exits 4 when gates fail.

## User Flow

1. Resolve runs.
2. Compute verdicts: improved, regressed, within_noise, unchanged.
3. Print comparison and gates.

## Navigation Flow

[eval-run](eval-run.md) -> report/compare.

## Related Features

- [eval-run](eval-run.md)

## Dependencies

evals only.

## Error Scenarios

Unknown run id: failure; held-out case details need `--reveal`.

## Performance

Local file reads.

## Modules Involved

- [evals](../modules/evals.md)
- [cli](../modules/cli.md)

## Patterns Used

- [eval-case-lifecycle](../patterns/eval-case-lifecycle.md)
- [error-and-exit-codes](../patterns/error-and-exit-codes.md)

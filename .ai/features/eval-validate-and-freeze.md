# Feature: Eval plan, validate and freeze (`armature eval plan|validate|freeze`)

## What Users Can Do

- See the benchmark shape without leaking held-out cases (`plan`).
- Lint the benchmark statically and dynamically (`validate --static`, `--suite`).
- Freeze reviewed cases into `evals/benchmark.lock` (`freeze`).

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

Dynamic validation uses ARC against an eval-mode app with the null mock.

## Components

`packages/cli/src/commands/eval.ts`; engine `packages/evals/src/{load,lint,suite,freeze}.ts`.

## State Management

Files: `evals/evalspec.yaml`, suite case files, `evals/benchmark.lock`.

## Business Rules

- `plan` never prints case ids or inputs.
- Freeze needs no validation errors, a non-empty dev suite with all cases VERIFIED, and at least one VERIFIED held-out case when configured.
- A case that passes the null agent is an error.

## User Flow

1. Load benchmark and lint.
2. Dynamic: run null agent and reference trajectories.
3. Freeze: write hashes, spec hash and grader version; prints `frozen evals/benchmark.lock`.

## Navigation Flow

[init](init.md) seeds -> review to VERIFIED -> validate -> freeze -> [eval-run](eval-run.md).

## Related Features

- [eval-run](eval-run.md)
- [eval-report-and-compare](eval-report-and-compare.md)

## Dependencies

evals, arc, mock-llm.

## Error Scenarios

Validation errors block freeze; a malformed lock needs refreezing.

## Performance

Static is instant; dynamic starts an app.

## Modules Involved

- [evals](../modules/evals.md)
- [cli](../modules/cli.md)
- [schema](../modules/schema.md)
- [arc](../modules/arc.md)
- [mock-llm](../modules/mock-llm.md)

## Patterns Used

- [eval-case-lifecycle](../patterns/eval-case-lifecycle.md)
- [schema-first-contracts](../patterns/schema-first-contracts.md)

# Pattern: Eval Case Lifecycle (Trust, Freeze, Snapshot, Compare)

## Overview

Armature's eval-first workflow treats a benchmark as evidence that must not drift silently. Cases are
authored (often by a coding agent) as `DRAFT_UNVERIFIED`, reviewed by a human to `REVIEWED`/`VERIFIED`,
frozen into `evals/benchmark.lock`, run against the generated agent, summarized into metrics and gates,
snapshotted under `evals/runs/<id>/`, and compared across runs with significance testing.

## Purpose

- Prevent "grading your own homework": drafts never fail gates, a frozen benchmark flags edits, held-out
  suites can be aggregate-only.
- Make runs reproducible and comparable: every snapshot records hashes, mode label (MOCK or LIVE), seed and
  banners explaining anything unusual.
- Detect weak benchmarks: lint finds duplicate or leaky cases and graders that cannot discriminate.

## Where Used

- Loading and hashing: [`loadBenchmark`](../../packages/evals/src/load.ts:115), [`hashValue`](../../packages/evals/src/load.ts:67),
  [`firstUserText`](../../packages/evals/src/load.ts:211).
- Lint: [`lintBenchmark`](../../packages/evals/src/lint.ts:59).
- Dynamic validation: [`validateDynamic`](../../packages/evals/src/suite.ts:104).
- Freeze: [`freezeBenchmark`](../../packages/evals/src/freeze.ts:61), [`checkFrozen`](../../packages/evals/src/freeze.ts:99).
- Running: [`startEvalSession`](../../packages/evals/src/session.ts:46), [`runCases`](../../packages/evals/src/run.ts:142),
  [`runSuite`](../../packages/evals/src/suite.ts:60).
- Grading and metrics: [`gradeTrial`](../../packages/evals/src/grade.ts:198), [`summarize`](../../packages/evals/src/metrics.ts:74),
  [`evaluateGates`](../../packages/evals/src/metrics.ts:165).
- Snapshots: [`buildSnapshot`](../../packages/evals/src/snapshot.ts:185), [`writeSnapshot`](../../packages/evals/src/snapshot.ts:259).
- Comparison: [`compareRuns`](../../packages/evals/src/compare.ts:46).
- CLI: [`evalRunCommand`](../../packages/cli/src/commands/eval.ts:156), [`evalFreezeCommand`](../../packages/cli/src/commands/eval.ts:323).
- Modules: [evals](../modules/evals.md), [cli](../modules/cli.md), [schema](../modules/schema.md).

## Implementation Details

1. **Trust levels** (`Trust` in `schema/src/eval.ts:28`): `DRAFT_UNVERIFIED`, `REVIEWED`, `VERIFIED`.
   `Summary.basis` becomes VERIFIED, DRAFT or NONE; DRAFT-basis results never fail gates.
2. **Validate**: schema parse, lint (shingle overlap of 8 words against agent text and between cases,
   unknown tools, weak graders) and optionally dynamic checks against a mock session: the null agent must fail
   every non-smoke, non-refusal case; each reference trajectory must pass its own graders.
3. **Freeze**: requires zero validation errors, a non-empty dev suite, all dev cases VERIFIED and at least one
   VERIFIED held-out case. `buildBenchmarkLock` hashes each case; held-out suites outside the project are
   recorded as `{count, sha256}`. The `candidates` suite is skipped.
4. **Run**: `checkFrozen` produces a `FrozenDiff`; drift adds a "BENCHMARK CHANGED" banner and a failing
   `benchmark_frozen` gate. Trials use fresh thread ids, resume approvals (up to 25 times) and record spans.
5. **Grade**: only `output` and `constraint` graders execute (`P0_GRADERS`); `state`, `judge`, `custom` are
   `not_measured` ("grader not available in P0").
6. **Gates**: critical failures, contract failures, smoke, required measurements, frozen benchmark, budget,
   target dev pass^k and target cost per task.
7. **Snapshot**: `evals/runs/<id>/run.json` and `report.md`. Aggregate-only suites write full per-case
   results to `<suite.dir>/runs/<id>.json` and store `cases: null` in the repo copy.
8. **Compare**: Fisher exact test per case, paired bootstrap CI, verdicts improved, regressed, within_noise or
   unchanged (`SIGNIFICANCE = 0.1`). Different suites, different labels or `cases: null` are refused.

## Code Example

```ts
const bench = loadBenchmark(dir);
const frozen = checkFrozen(bench); // FrozenDiff | null
const session = await startEvalSession({ dir, offline: false, env });
const outcome = await runSuite({ session, cases, trials: 3, concurrency: 4, budgetUsd });
const summary = summarize(outcome, { seed });
```

`evalRunCommand` then calls `evaluateGates`, `buildSnapshot` and `writeSnapshot` (arguments omitted here).

## Common Scenarios

- First benchmark: coding agent drafts cases, human sets `trust: VERIFIED`, `armature eval freeze`.
- Regression check after a change: `eval run` then `eval compare latest <earlier id>`.
- Budget protection: `--max-cost` (default from `run_policy.max_cost_usd_per_run`) stops trials and sets
  `budget_exhausted`; live runs print an `estimateCost` first.
- Cheap sampling: `--sample N --seed S` picks a reproducible subset in suite order.

## Rules & Constraints

- Do not mark cases VERIFIED on behalf of a human (the handoff skills say so).
- MOCK and LIVE results must never be compared or mixed.
- Judges, state graders and custom graders are not implemented; never claim they are measured.
- Changing the eval case format, snapshot format or exit codes requires an ADR (ADR 0005, 0006).

## Common Gotchas

- `eval run` exit 4 means a gate failed, not that the command crashed.
- Frozen hashes include case content; reformatting YAML without changing the parsed value does not change it
  because hashing uses canonical JSON.
- Live runs need the API key either in the environment or in the project's `.env`; otherwise exit 5.
- Offline `suite.config.mode: live` is a mismatch that the command rejects.

## Anti-Patterns

- Editing frozen cases to make a failing run pass.
- Relying on a smoke-mode MOCK run as evidence of quality.

## Related Patterns

- [Mock LLM testing](mock-llm-scripted-testing.md) powers offline runs and dynamic validation.
- [ARC contract](arc-contract-and-client.md) is how trials talk to the agent.
- [Error and exit codes](error-and-exit-codes.md) defines exit 4.
- [App process launching](app-process-launching.md) starts the agent for a session.

## Background

ADR 0005 (`docs/adr/0005-eval-cli.md`) specifies the eval CLI and snapshot format; ADR 0006 covers
`doctor`, `test` and the eval plan. Live-eval CI is planned and not implemented.

## Modules Using This Pattern

- [evals](../modules/evals.md)
- [schema](../modules/schema.md)
- [core](../modules/core.md)
- [cli](../modules/cli.md)

## Related Patterns (Why They Connect)

- [mock-llm-scripted-testing](mock-llm-scripted-testing.md): offline determinism.
- [app-process-launching](app-process-launching.md): shared way to start generated apps.

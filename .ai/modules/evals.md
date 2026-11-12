# Module: evals (`@armature/evals`)

## Purpose & Scope

### What This Module Does

`packages/evals` is the evaluation engine behind `armature eval ...`. It loads a project's benchmark
(`evals/evalspec.yaml` plus case files in suites), lints and validates it, starts the generated app in eval
mode (against the mock model or a live model), runs each case through ARC for one or more trials, grades the
recorded run with deterministic graders, summarizes metrics with confidence intervals, evaluates gates, writes
a snapshot, compares two snapshots with a significance test, and freezes the benchmark with a lock file.

The workflow is eval-first: cases start as `DRAFT_UNVERIFIED` seeds written by `init`, a human reviews them to
`VERIFIED`, and only then does the benchmark freeze and gates apply to quality numbers.

### Boundaries

- IN: loading and hashing cases, lint rules, null-agent and reference validation, sessions, the trial runner,
  graders, metrics and gates, snapshots under `evals/runs/`, comparison, report rendering, benchmark lock,
  statistics (bootstrap, Fisher exact, pass@k).
- OUT: command parsing, printing and exit codes (see [cli.md](cli.md)); the ARC client (see [arc.md](arc.md));
  schema shapes (see [schema.md](schema.md)); seed case generation (core `seeds.ts`, see [core.md](core.md)).
- P0 graders are `output` and `constraint` only. `state`, `judge` and `custom` graders are not executed; their
  checks are reported `not_measured`. Live-eval CI is not implemented.

## Key Components

| Symbol | Location | Role |
| --- | --- | --- |
| `loadBenchmark`, `loadEvalSpec`, `EVALSPEC_PATH`, `FIXTURES_DIR`, `hashValue`, `canonical` | `../../packages/evals/src/load.ts:115` | Read spec, suites, cases, references; collect `Issue`s; hash cases |
| `expandSuitePath`, `projectIdOf` | `../../packages/evals/src/load.ts:69` / `:92` | Suites may live outside the repo (held-out), keyed by a project id |
| `lintBenchmark` | `../../packages/evals/src/lint.ts:59` | Static rules (see Key Behaviors) |
| `startEvalSession`, `loadPlan`, `hasApiKey` | `../../packages/evals/src/session.ts:46` | Launch mock (optional) and app in eval mode |
| `runCases`, `trialOf`, `casePassed` | `../../packages/evals/src/run.ts:142` | Trial runner with approvals and budget |
| `runSuite`, `sampleCases`, `estimateCost`, `validateDynamic` | `../../packages/evals/src/suite.ts:60` | Suite orchestration, seeded sampling, cost estimate, null-agent/reference check |
| `gradeTrial`, `matchesSchema`, `GRADERS_VERSION` | `../../packages/evals/src/grade.ts:198` | Deterministic grading; version `"1"` |
| `summarize`, `evaluateGates`, `gatesPassed`, `NOT_MEASURED`, `DIMENSIONS` | `../../packages/evals/src/metrics.ts:74` | Scores, dimensions, gates |
| `buildSnapshot`, `writeSnapshot`, `readSnapshot`, `listRuns`, `newRunId`, `hashPaths` | `../../packages/evals/src/snapshot.ts:185` | `evals/runs/<id>/run.json` and `report.md` |
| `compareRuns`, `renderComparison`, `SIGNIFICANCE` | `../../packages/evals/src/compare.ts:46` | Case-level A/B with Fisher exact (p <= 0.1) |
| `renderMarkdown`, `renderTerminal`, `pct` | `../../packages/evals/src/report.ts:30` | Report rendering |
| `freezeBenchmark`, `checkFrozen`, `readBenchmarkLock`, `BENCHMARK_LOCK` | `../../packages/evals/src/freeze.ts:61` | `evals/benchmark.lock` |
| `rng`, `bootstrapCi`, `pairedBootstrapCi`, `fisherExact`, `passAtK`, `passPowK` | `../../packages/evals/src/stats.ts:4` | Dependency-free statistics |

## API Surface

Everything is re-exported from `packages/evals/src/index.ts`. The CLI is the only caller outside tests.
Important shapes: `EvalSession { plan, client, manifest, mock, app, mode: "MOCK" | "LIVE", stop }`,
`RunOptions { client, cases, trials, concurrency, budgetUsd, approvals?, beforeTrial?, onTrial? }`,
`RunOutcome { cases, spent_usd, cost_incomplete, budget_exhausted, wall_ms }`, `Gate { name, passed, detail }`,
`Measured = number | "NOT_MEASURED"`.

## Dependencies

### Internal Modules

`@armature/arc` (client, `RunRecord`), `@armature/core` (`loadSpec`, `compile`, `launchApp`, `ArmatureError`,
`ExitCode`), `@armature/mock-llm` (`startMockLlm`), `@armature/schema` (specs, cases).

### External Services

A live model provider only when the session is started without `--offline`; the generated app (not this
package) holds the key. Requires the project's `.venv` (core's `launchApp`).

### Patterns Used

[eval-case-lifecycle](../patterns/eval-case-lifecycle.md), [mock-llm-scripted-testing](../patterns/mock-llm-scripted-testing.md),
[arc-contract-and-client](../patterns/arc-contract-and-client.md), [app-process-launching](../patterns/app-process-launching.md),
[error-and-exit-codes](../patterns/error-and-exit-codes.md).

## Data Flow

```
evals/evalspec.yaml + evals/<suite>/*.yaml --loadBenchmark--> Benchmark{spec, suites, issues}
   --lintBenchmark--> issues         --startEvalSession--> app (ARMATURE_EVAL_MODE=1) [+ mock]
   --runSuite/runCases--> POST /runs/wait (metadata.eval) --> resume approvals --> GET /runs/{id}
   --gradeTrial--> TrialGrade --summarize+evaluateGates--> Summary/Gate[]
   --buildSnapshot/writeSnapshot--> evals/runs/<YYYYMMDD-HHMMSS-suite>/{run.json,report.md}
   compare(A,B) --> Comparison (verdicts + gates)       freeze --> evals/benchmark.lock
```

## Key Behaviors

### One trial (`execute` in `run.ts`)

1. Create a fresh `thread_id` (random UUID) so trials share no memory.
2. `client.wait` with `metadata.eval { case_id, trial, fixtures?, stubs? }`.
3. While the run is `interrupted` with pending approvals (max 25 resumes), answer each approval from the
   queue of decisions (default: approve).
4. Fetch the full `RunRecord` with `getRun` and delete the thread afterwards.
5. A client timeout becomes failure kind `timeout`; any other HTTP or network problem becomes a `contract`
   failure. Contract failures and smoke failures gate even for draft cases.

### Offline suites

`runSuite` with a mock clears scripts and sets smoke mode before each trial, then adds the case's reference
trajectory as a script keyed by the first user text. Trials run one at a time then, because the mock is shared.

### Lint rules (selection from `lint.ts`)

Refusal-category cases must be severity critical; every grader must check something; regex graders must
compile; constraint tool names must exist in the manifest; references may call only known tools; cases
without a reference are warned (cannot prove passable); duplicate inputs, case wording leaking into the system
prompt or tool descriptions, dev suites below `min_dev_cases`, and an imbalance of should-act versus
should-not cases (under 20% of either) are also reported.

### Dynamic validation (`validateDynamic`)

Sets the mock to null mode and runs the target cases; any VERIFIED case that passes against the null agent is
flagged (a grader a refusing agent satisfies is too weak). Then it replays each case's reference trajectory and
reports those that do not pass. The CLI prints "null agent: N checked, M passing (should be 0)".

### Gates (`evaluateGates`)

`critical_failures`, `contract`, `smoke` (only for the smoke suite), `required_measurements`,
`benchmark_frozen`, `budget`, and optional targets `target_dev_pass_k` and `target_cost_per_task`. When there
are no VERIFIED cases, numbers are computed over drafts and labelled DRAFT, and drafts never fail a gate
(smoke and contract failures excepted, since those are wiring).

### Compare

`compareRuns` only counts cases present in both runs with equal case hashes. A case moves to `improved` or
`regressed` only when Fisher's exact test over its trials gives p <= 0.1 (`SIGNIFICANCE`); otherwise it is
`within_noise` or `unchanged`. The CLI exits 4 when the comparison's gates fail (for example task-success
regression beyond `gates.max_task_success_regression`).

### Freeze

`freezeBenchmark` refuses unless validation has no errors, the dev suite exists with every case `VERIFIED`, and
a held-out suite (if configured) has at least one `VERIFIED` case. It writes `evals/benchmark.lock` with
per-case hashes, the eval spec hash, `graders_version` and an aggregate hash for out-of-repo suites.

### Error scenarios

- No API key in live mode: `ArmatureError` exit 5 ("set it in the environment or .env, or pass --offline").
- App not in eval mode: exit 5.
- Budget exhausted: the run stops, `budget_exhausted: true`, a `budget` gate fails.
- Invalid `benchmark.lock`: exit 1 with "run `armature eval freeze` again".

### Why This Flow

Hashing every case and the grader version makes "the benchmark did not move" checkable, so a score
change is attributable to the agent, not to edited tests. Held-out suites live outside the repo and are only
aggregated in the repo copy of a run (`aggregate_only`), so an assistant cannot read their cases.

## Configuration

`evals/evalspec.yaml` (`EvalSpec`): objectives, suites, graders, gates (`critical_failures_allowed`,
`max_task_success_regression`, `fail_on_missing_required_measurements`), targets, `min_dev_cases`,
`run_policy` (`max_cost_usd_per_run`, `concurrency`, `case_timeout_s`). CLI flags override per run (see
[eval-run](../features/eval-run.md)).

## Testing

`../../packages/evals/test/evals.test.ts` covers loading, lint, grading, metrics, snapshots, compare and
freeze; `../../packages/cli/test/eval.test.ts` covers the commands against a fake ARC app; real runs happen in
`../../tests-integration` (`evalCli` helper, see [tests-integration.md](tests-integration.md)).

## Performance Considerations

Concurrency defaults to the spec's `run_policy.concurrency` (max 32); offline runs are sequential. Bootstrap
CIs use 2,000 resamples and need at least 10 values (`MIN_BOOTSTRAP_N`). `estimateCost` is a rough upper bound
(`min(max_steps, 8)` calls per trial, 3,000 input and 400 output tokens each).

## Gotchas & Constraints

### Never Do This

- Never print case ids or inputs of held-out suites (the `eval plan` command is built to avoid it).
- Never turn a missing measurement into 0; report `NOT_MEASURED`.

### Always Do This

- Seed any random choice (`--seed`, default 0) so samples and intervals reproduce.
- Bump `GRADERS_VERSION` when grading logic changes, so frozen locks notice.

### Common Mistakes

- Assuming offline scores mean quality: the mock model only proves wiring.
- Editing a case after freezing and expecting the old comparison to hold: the case hash changes and it is
  excluded from compare.

### Edge Cases

- `candidates` suite cases are excluded from the freeze.
- Cost may be unknown for a trial; `spent_usd` then is a lower bound (`cost_incomplete`).

### Business Rules

- Task success counts VERIFIED cases only.
- Draft cases never fail gates except for smoke and contract failures.
- Freeze requires human-reviewed (`VERIFIED`) cases.

## Security Considerations

Held-out cases stay outside the repository; the in-repo snapshot for such suites has `cases: null`. Outbound
trace export is fixed to `disabled` by the schema. Live runs spend money, hence the default budget cap
(`max_cost_usd_per_run`, default 5) and the `--max-cost` flag.

## Features Implemented

[eval-validate-and-freeze](../features/eval-validate-and-freeze.md), [eval-run](../features/eval-run.md),
[eval-report-and-compare](../features/eval-report-and-compare.md).

## Related Documentation

- Modules: [cli](cli.md), [arc](arc.md), [core](core.md), [mock-llm](mock-llm.md), [schema](schema.md).
- Patterns: [eval-case-lifecycle](../patterns/eval-case-lifecycle.md).
- ADR: `../../docs/adr/0005-eval-cli.md`.

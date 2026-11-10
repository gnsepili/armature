# ADR 0005 — The `armature eval` commands and run snapshots

**Status:** Accepted

## Context

The PRD makes evals the center of the workflow: a human-owned benchmark, drafted before the
agent is built, frozen once reviewed, and then used to gate every change. The coding agent's
skills (`build-benchmark`, `optimize-agent`, `debug-run`) and CI both drive this through the
CLI, so the commands, their flags, the exit codes and the files they write are contracts.

## Decision

**Commands.** One group, `armature eval`:

| Command                                                                                                                      | Does                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `validate [dir] [--static] [--suite <name>]...`                                                                              | Static lint, then (unless `--static`) a null-agent pass and a replay of every reference trajectory against the mock model |
| `run [dir] [--suite dev] [--case <id>]... [--sample N --seed S] [--trials N] [--offline] [--max-cost USD] [--concurrency N]` | Runs a suite through ARC in eval mode and writes a snapshot                                                               |
| `report [run\|latest] [-C dir] [--reveal]`                                                                                   | Prints a run's markdown report                                                                                            |
| `compare <a> <b> [-C dir] [--reveal]`                                                                                        | Case-by-case comparison of two runs of one suite                                                                          |
| `freeze [dir]`                                                                                                               | Writes `evals/benchmark.lock`                                                                                             |

All take `--json`. Run references are an exact id, `latest`, or a unique part of an id.

**Exit codes** are those of ADR 0003. `validate` exits 1 on any error-level issue. `run`
exits 4 when a gate fails and `compare` exits 4 when a comparison gate fails. A missing key
or `.venv` is 5.

**Modes.** `--offline` runs the app against the bundled mock model, with each case's
reference trajectory scripted where one exists. Offline results are labelled `MOCK` and check
wiring, never quality. A suite's `mode` (`offline`, `live`, `any`) is enforced: a live-only
suite refuses `--offline` and an offline-only suite (smoke) requires it.

**Snapshots.** Each run writes `evals/runs/<YYYYMMDD-HHMMSS>-<suite>/run.json` and
`report.md` (UTC; a `-2` suffix on collision). `evals/runs/` is gitignored in generated
projects. A snapshot records the code, prompt, tool-schema and manifest hashes, the model, the
dataset hash and the benchmark state (`frozen`, `changed`, `unfrozen`), so `compare` can say
what changed between two runs. For `report: aggregate_only` suites (held-out), the repo copy
has `cases: null` and the full copy goes next to the suite, outside the repo; `--reveal` reads
it.

**Comparison.** Only cases present in both runs with the same hash count. A case is
`improved` or `regressed` only when Fisher's exact test on its trials gives p <= 0.1;
otherwise it is `within_noise` or `unchanged`. MOCK and LIVE runs are never compared. Gates
apply only when both runs share VERIFIED cases: the task-success regression gate fails when
the 95% paired-bootstrap interval lies entirely below `-max_task_success_regression`, and a
VERIFIED critical case that passed every trial and now fails is a regression.

**Freeze** refuses while any dev case is not VERIFIED, while the held-out suite (if present)
has no VERIFIED case, or while validation reports errors.

## Consequences

- Agents can run the whole loop without a terminal or an API key (`validate`, offline `run`),
  and cannot mistake a MOCK score for evidence.
- Snapshot fields may grow; `schema_version` changes when a field changes meaning.
- Single-trial flips read as noise by design; resolving them means adding trials.

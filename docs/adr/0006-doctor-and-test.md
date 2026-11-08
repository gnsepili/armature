# ADR 0006 — `armature doctor`, `armature test` and `armature eval plan`

**Status:** Accepted

## Context

ADR 0003 left `doctor` and `test` to a later decision. Both end up in scripts: `doctor` in
container builds and onboarding docs, `test` in the CI workflow every project is generated
with. Their checks, statuses, flags and exit codes are therefore contracts. The PRD also lists
`armature eval plan` among the P0 eval commands, which ADR 0005 did not cover.

## Decision

**`armature doctor [dir] [--probe] [--conformance] [--json]`** runs checks in order and
reports each as `ok`, `warn`, `fail` or `skip`:

| Check | Fails (exit) when | Warns when |
| --- | --- | --- |
| node | Node is older than 22 (5) | |
| uv | | `uv` is not on `PATH` |
| spec | `armature.yaml` is missing or invalid (its own code: 1 or 2) | |
| model | | the model is not in the bundled catalog |
| lock / scaffold | there is no `armature.lock` (1) | the template version moved, the scaffold is stale, or managed files were edited |
| venv, python, dependencies | no `.venv`, the package is not installed, or a runtime pin is missing or different (5) | Python is outside the supported versions |
| dev deps | | a dev pin (pytest) is missing; only `armature test` needs it |
| api key, tool secrets | | an `api_key_env` or a tool's `auth_env` is unset |
| probe | the live call errors (5) | the model answered without calling a tool |
| conformance | an ARC v1 check fails (1) | |

The exit code is that of the first failed check, else 0. Warnings never change it, so
`doctor` can run in a production image without dev dependencies or in CI without a key.
`probe` and `conformance` report `skip` when an earlier check failed.

`--probe` is opt-in. The PRD lists the capability probe as part of `doctor`; it spends money
and needs a key, so running it by default would make `doctor` unsafe in CI and in hooks. It
sends one fixed message with every tool stubbed, preferring a read-only tool, and reports
whether a tool was called with its tokens, cost and latency.

`--conformance` serves the app twice against a fresh mock model (eval mode on and off, as
check 7 requires), with session databases in a temporary directory, and runs ARC v1.

**`armature test [dir] [--only <part>]... [--json]`** runs three parts in this order:
`golden` (a dry-run `generate`: managed files must match what `armature.yaml` and the current
templates render, and no managed file may be hand-edited), `unit` (the project's pytest suite
with `ARMATURE_EVAL_MODE=0`) and `conformance` (as above). An unknown part exits 1. The run
exits 0 when every selected part passes, 5 when a part could not run for lack of `.venv` or
pytest, and 1 otherwise. No part needs a model key.

**`armature eval plan [dir] [--json]`** prints the objectives, each suite's mode, trials, case
count, trust and category tallies, the gates and targets, the freeze state (`not frozen`,
`frozen` or `changed since freeze`) and the remaining steps to a trustworthy benchmark. It
never prints case ids or inputs, so it is safe for held-out suites. It exits 1 when the
benchmark has error-level load issues, else 0.

**Generated CI.** Every project gets `.github/workflows/armature.yml` (generated once, then
the user's) that runs `uv sync --extra dev`, `armature test` and
`armature eval run --suite smoke --offline` with the CLI pinned to the generating version.
The templates gain an `armature_version` value for this; it is the CLI's version, so output
stays deterministic for a given release.

## Consequences

- `doctor` and `test` share one conformance runner, so they cannot disagree about ARC.
- Pinning the CLI in the workflow means a CLI upgrade shows up as a reviewable diff only if the
  user edits it; `doctor` warns about template-version drift to prompt that.
- Install hints across the CLI and generated README say `uv sync --extra dev`, which installs
  what `test` needs.

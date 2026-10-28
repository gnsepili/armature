# ADR 0003 — CLI surface for 0.1: init, generate, plan, dev, chat

**Status:** Accepted

## Context

The PRD lists the P0 commands and asks that every one of them work without a person at the
keyboard, because coding assistants and CI drive the CLI as often as people do. Flags, `--json`
output and exit codes are public contracts (see the ADR index), so the first set needs a record.

## Decision

**Commands.** `init [dir]`, `generate [dir]`, `plan [dir]`, `dev [dir]` and `chat`. Directory
arguments default to the current directory, except `init`, which defaults to `./<name>`.
`doctor`, `test` and the `eval` group are added by later ADRs.

**Never block without a terminal.** `init` prompts only when stdin and stdout are TTYs, `CI` is
unset, and none of `--yes`, `--config` or `--json` was given. Otherwise it builds the spec from
flags and defaults. `chat -m` prompts for approvals only in a terminal; elsewhere it reports the
paused run and exits 0.

**Spec flags.** `--name`, `--description`, `--framework`, `--pattern`, `--provider`, `--model`,
`--base-url`, plus three repeatable ones:

- `--with <token>`: `memory`, `memory:sqlite`, `no-memory`. New tokens are additive.
- `--tool name:side_effect:arg1,arg2`: side effect is one of `none|read|write|destructive`
  (default `read`); args are strings. Types and descriptions are edited in `armature.yaml`.
- `--assistant claude|codex|generic|both`.

`--config <file>` (YAML or JSON, `-` for stdin) starts from a partial spec that flags then
override. A framework or pattern that the schema knows but the compiler does not support yet is
accepted by the flag parser so the compiler can report it with exit 2 and the support matrix.

**Exit codes** (unchanged from `ExitCode` in core): 0 ok, 1 validation (bad spec, bad flag,
unknown option), 2 unsupported (planned framework or pattern, or an uncatalogued model without
`--experimental`), 3 overwrite refused (`init` over an existing `armature.yaml` or a non-empty
directory without `--force`), 4 eval gate failed, 5 environment (no venv, app unreachable).

**`--force`** replaces edited _managed_ files. It never overwrites files the user owns
(`tools/*.py`, prompts) once they are tracked in `armature.lock`.

**`--json`.** Success is `{ok: true, command, ...}`; failure is `{ok: false, error: {message,
exit_code, hint?, issues?[{path, message}]}}` on stdout, and the process exits with the same code. `init` and `generate` return `dir, mode,
dry_run, name, package, framework, compat, files[{path, action}], counts, dependencies` (`init`
adds `spec`). `plan` returns `dir, mode, plan, compat, files, counts, secrets, tasks`.
`chat -m --json` prints the ARC `/runs/wait` result with `ok`.

**`dev`.** Starts `python -m <package> serve` from `.venv` on `--app-port` (8000), waits for
`/health`, and serves the playground on `--port` (5174), proxying `/arc/*` to the app and
exposing `GET /__armature/info`. `--offline` starts the bundled mock model and sets
`ARMATURE_MODEL_MODE=mock`. Both bind `127.0.0.1` unless `--host` says otherwise.

## Deviations from the PRD and ADR 0001

- **Playground stack.** The PRD sketches a React/Vite playground. 0.1 ships a static,
  dependency-free page (HTML, one JS module, CSS) served by the CLI. It needs no build step,
  adds nothing to the install, and is small enough to audit. A framework can replace it later
  without changing ARC or the `/__armature/info` endpoint.
- **Bundler.** ADR 0001 named tsup. The CLI is bundled with esbuild directly
  (`packages/cli/scripts/build.mjs`): one entry point, ESM, dependencies left external, and
  templates and the playground copied next to the bundle.

## Consequences

- Assistants can run the whole loop (`init --yes --json`, `plan --json`, `generate --json`,
  `chat -m --json`) and branch on exit codes alone.
- Renaming or removing a flag, a `--with` token or a JSON field needs a new ADR.

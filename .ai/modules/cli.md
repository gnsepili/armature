# Module: cli (`armature-agents`, binary `armature`)

## Purpose & Scope

### What This Module Does

`packages/cli` is the user-facing TypeScript CLI. It parses arguments with commander, maps each command onto the
libraries (`core`, `evals`, `arc`, `mock-llm`, `playground`, `schema`), prints human or `--json` output, and
turns errors into stable exit codes. It is also bundled with esbuild into `dist/armature.js` for npm.

### Boundaries

- IN: command wiring (`src/index.ts`), commands (`src/commands/*.ts`), the `Io` abstraction (`src/io.ts`), the
  init wizard and flag-to-spec mapping (`wizard.ts`, `spec.ts`), project helpers (`project.ts`), report helpers
  (`report.ts`), the dev playground server, the build script.
- OUT: generation logic ([core.md](core.md)), eval engine ([evals.md](evals.md)), runtime code in generated
  projects ([adapters.md](adapters.md)).

## Key Components

| Piece | Location | Role |
| --- | --- | --- |
| `bin.ts` | `../../packages/cli/src/bin.ts` | Calls `run(process.argv)` and sets the exit code |
| `run`, `buildProgram` | `../../packages/cli/src/index.ts` | commander with `exitOverride`; never calls `process.exit`; `toFailure` maps `ArmatureError` to its code, schema errors to 1, anything else to 5 |
| Command registration | `index.ts:42-135` | init (42), generate (65), sync (77), plan (89), dev (98), chat (109), doctor (118), test (127), eval (135) |
| `Io`, `processIo`, `c`, `printJson`, `printFailure` | `../../packages/cli/src/io.ts` | Injected cwd, env, stdout, stderr, stdin, interactivity |
| `projectPlan`, `scaffoldDrift`, `projectConformance` | `../../packages/cli/src/project.ts` | Shared by plan, doctor, test |
| `startPlaygroundServer` | `../../packages/cli/src/commands/dev.ts` | Static files, `/arc/*` proxy, `/__armature/info` |
| `scripts/build.mjs` | `../../packages/cli/scripts/build.mjs` | esbuild bundle and asset copy |

## API Surface

Commands: `init`, `generate`, `sync`, `plan`, `dev`, `chat`, `doctor`, `test`, and `eval` with `plan`,
`validate`, `run`, `report`, `compare`, `freeze`. Flags and exit codes are a public contract documented in
`../../docs/cli.md` and the ADRs (`../../docs/adr/`); changing them needs an ADR. The package exports `run` and
`Io` for tests and the integration harness.

## Dependencies

### Internal Modules

`@armature/core`, `@armature/schema`, `@armature/evals`, `@armature/arc`, `@armature/mock-llm`,
`@armature/playground`, `@armature/handoff` (via core output). npm: `commander`, `@clack/prompts`, `yaml`,
`zod`, `handlebars`, `@ag-ui/core`.

### External Services

`uv` and Python (checked by `doctor`, used by `test`, `dev`), and a model provider unless `--offline`.

### Patterns Used

[io-abstraction-testable-cli](../patterns/io-abstraction-testable-cli.md),
[error-and-exit-codes](../patterns/error-and-exit-codes.md),
[app-process-launching](../patterns/app-process-launching.md),
[deterministic-generation-and-catalog](../patterns/deterministic-generation-and-catalog.md).

## Data Flow

```
argv -> commander -> command fn(opts, io) -> library calls -> Io.stdout/stderr (or printJson)
                         \-> throws ArmatureError -> toFailure -> printFailure -> exit code
```

## Key Behaviors

### `init`

Reads `--config` (YAML mapping, or `-` for stdin). Refuses when `armature.yaml` exists without `--force` (exit
3). The wizard runs only when interactive and none of `--yes`, `--config`, `--json` is set; otherwise
`specFromFlags` builds the spec and `specToYaml` serializes it. It calls `generate` (with
`allowExperimental: interactive || experimental`), writes `armature.yaml` unless `--dry-run`, then prints next
steps (`uv sync --extra dev`, `armature dev --offline`, `claude` then `/build-agent`) and lists stub tools.

### `sync`

Calls `generate` with `handoffOnly: true`; refreshes only handoff files (AGENTS.md, CLAUDE.md, MCP configs,
`docs/`, skills). Fails with exit 1 if there is no lock.

### `dev`

Requires the venv first. Defaults: playground port 5174, app port 8000, host 127.0.0.1. `--offline` starts the
mock and sets `ARMATURE_MODEL_MODE=mock` and `ARMATURE_MOCK_URL`; otherwise it warns when the model key
variable is unset. It spawns `python -m <package> serve`, waits for health, serves the playground and opens the
browser unless `--no-open`. Ctrl-C exits 0; an app crash exits 5.

### `chat`

Terminal client over ARC streaming. Handles `armature.approval_required` by asking per approval. REPL commands:
`/new`, `/exit` (also `/quit`). `--json` requires `--message`. Checks the URL is reachable and hints
`armature dev`.

### `doctor`

Checks (status ok, warn, fail, skip): node 22+, uv, venv (exit 5), dependencies, dev dependencies, scaffold lock
and drift, model key and tool `auth_env`. Optional `--probe` makes one live model call; `--conformance` runs ARC
conformance against the mock. Returns the first failing check's exit code.

### `test`

Parts `golden | unit | conformance` (`--only`). golden compares managed files with a fresh render; unit runs
`python -m pytest -q -p no:cacheprovider` (pytest missing gives exit 5); conformance starts the mock and two app
instances. Failure exits 1, or 5 on environment failure.

### `eval ...`

See [evals.md](evals.md) and the eval features. `eval compare` exits 4 when gates fail.

### Error scenarios

`ArmatureError` carries its exit code (for example 3 for refusing to overwrite, 5 for environment problems);
commander usage errors are reported through `exitOverride` without exiting the process.

### Why This Flow

`run` returning a code instead of exiting lets tests and the integration harness call the whole CLI in
process with a fake `Io`.

## Configuration

Flags per command (`../../docs/cli.md`); `NO_COLOR` is honored by `c`. Build config in
`packages/cli/scripts/build.mjs`: esbuild, `src/bin.ts` to `dist/armature.js`, esm, node22, npm deps external,
chmod 755; copies core templates to `dist/templates`, handoff templates to `dist/handoff`, playground assets to
`dist/playground`.

## Testing

`../../packages/cli/test/`: `commands.test.ts`, `sync.test.ts`, `chat-dev.test.ts`, `doctor-test.test.ts`,
`eval.test.ts`, with helpers (`tempDir`, `testIo`, `cli`) in `helpers.ts`. All run `run(argv, io)` in process.

## Performance Considerations

`doctor`, `test` and `dev` spawn Python processes and dominate runtime; everything else is local file work.

## Gotchas & Constraints

### Never Do This

- Never call `process.exit` inside commands; return or throw.
- Never read `process.env` or `process.cwd()` directly; use `io.env` and `io.cwd`.

### Always Do This

- Offer `--json` for machine output and keep it free of colors.
- Add an ADR when changing flags or exit codes.

### Common Mistakes

- Forgetting to copy a new asset directory in `build.mjs`, so the bundled CLI misses it.

### Edge Cases

- `init` into a non-empty directory exits 3 unless `--force` (ignorable files exempt).
- The bundled CLI must work from a path with spaces (checked in CI).

### Business Rules

- Generated projects must not import an Armature runtime package.
- Generation is deterministic.

## Security Considerations

The CLI never prints API key values; `doctor` only reports whether variables are set. The dev proxy binds to
127.0.0.1 and refuses path escapes with 403.

## Features Implemented

[init](../features/init.md), [generate-and-sync](../features/generate-and-sync.md), [plan](../features/plan.md),
[dev](../features/dev.md), [chat](../features/chat.md), [doctor](../features/doctor.md),
[test](../features/test.md), [eval-validate-and-freeze](../features/eval-validate-and-freeze.md),
[eval-run](../features/eval-run.md), [eval-report-and-compare](../features/eval-report-and-compare.md).

## Related Documentation

[core](core.md), [evals](evals.md), [playground](playground.md), [repo-tooling](repo-tooling.md),
`../../docs/cli.md`, `../../docs/adr/`.

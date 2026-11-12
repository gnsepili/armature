# Module: core (`@armature/core`)

## Purpose & Scope

### What This Module Does

`packages/core` is the generator engine. It turns a validated `AgentSpec` into a deterministic list of
files, decides which of them may be written on disk (ownership and the `armature.lock` file), writes them,
and also hosts the helpers other commands need to run a generated project (`launchApp`, venv lookup,
model and version catalogs).

The pipeline is: `loadSpec` -> `checkCompatibility` -> `planProject` (spec to `ProjectPlan`) ->
`renderProject` (Handlebars layers to `RenderedFile[]`) -> `applyFiles` (lock-aware write) -> `buildLock`.
`compile()` runs everything up to render; `generate()` adds the write and the lock.

### Boundaries

- IN: spec loading and compatibility, project planning, template rendering, seed eval files, the lock file,
  safe writing with ownership rules, the model/version catalogs, the `ArmatureError` and `ExitCode` contract,
  launching and health-waiting a generated Python app.
- OUT: zod shapes (see [schema.md](schema.md)); the template files themselves
  (`packages/adapters/templates`, see [adapters.md](adapters.md)) and the handoff kit (see
  [handoff.md](handoff.md)); any CLI printing (see [cli.md](cli.md)); eval running (see [evals.md](evals.md)).
- Generated projects never import this package. Its output is plain Python plus metadata.

## Key Components

| Symbol | Location | Role |
| --- | --- | --- |
| `loadSpec`, `parseSpecText`, `SPEC_FILE` | `../../packages/core/src/compile.ts:14` | Read and validate `armature.yaml` |
| `compile` | `../../packages/core/src/compile.ts:47` | Compat check + plan + render (no disk writes) |
| `generate` | `../../packages/core/src/compile.ts:106` | Init or update: compile, apply, write the lock |
| `renderWithLock` | `../../packages/core/src/compile.ts:167` | Render plus lock for golden tests and `plan` |
| `readLock` | `../../packages/core/src/compile.ts:71` | Parse `armature.lock` or return null |
| `checkCompatibility` | `../../packages/core/src/compat.ts:46` | `supported`, `degraded`, `experimental`, `unsupported` findings |
| `planProject`, `planDependencies` | `../../packages/core/src/plan.ts:178` | Spec to `ProjectPlan`, pinned dependency list |
| `renderProject`, `pyLiteral`, `globToRegExp` | `../../packages/core/src/render.ts:94` | Layered Handlebars render and ownership globs |
| `seedEvalFiles` | `../../packages/core/src/seeds.ts:341` | Draft eval cases and `evalspec.yaml` written at init |
| `applyFiles`, `assertInitTarget` | `../../packages/core/src/write.ts:61` | Ownership-aware writer returning `PlannedAction[]` |
| `buildLock`, `parseLock`, `LOCK_FILE`, `LockSchema` | `../../packages/core/src/lock.ts:31` | Lock content: hashes and ownership |
| `versionsCatalog`, `modelCatalog`, `findModel`, `suggestedModels` | `../../packages/core/src/catalog.ts:32` | Verified pins and model prices |
| `launchApp`, `requireVenv`, `venvPython`, `freePort`, `waitHealthy` | `../../packages/core/src/app.ts:66` | Run the generated app as a child process |
| `ArmatureError`, `ExitCode` | `../../packages/core/src/errors.ts:2` | Exit-code contract |
| `ARMATURE_VERSION`, `GENERATOR` | `../../packages/core/src/version.ts:2` | `0.1.0`, `armature-agents` |

Data files: `../../packages/core/catalog/versions.json` (framework pins, `verified_at` 2026-11-12) and
`../../packages/core/catalog/models.json` (models and USD prices per 1M tokens, `verified_at` 2026-11-13).

## API Surface

Everything is exported from `packages/core/src/index.ts`. The commonly used pieces:

- `generate({ dir, specText?, specPath?, dryRun?, force?, allowExperimental?, handoffOnly? })` returns
  `{ mode: "init" | "update", actions, lock, plan, compat, dryRun, ... }`.
- `compile(spec, { allowExperimental })` returns `{ plan, files, compat }`.
- `applyFiles({ dir, files, previous, force, dryRun })` returns `{ actions, ... }` where each action is one of
  `create`, `update`, `unchanged`, `skip-modified`, `skip-owned`, `remove`, `keep-orphan`.
- `ExitCode = { ok: 0, validation: 1, unsupported: 2, overwriteRefused: 3, evalGateFailed: 4, environment: 5 }`.
- `launchApp({ dir, package, env })` returns a `RunningApp { url, stop(), logs() }`.

## Dependencies

### Internal Modules

- `@armature/schema`: spec parsing and `SchemaError`.
- `@armature/adapters`: `templateLayers(framework)` and `TEMPLATE_VERSION`.
- `@armature/handoff`: `handoffLayer()`, `withSkillCopies`, `isHandoffPath`.

### External Services

None. `launchApp` starts a local Python process from the project's `.venv`; nothing is called over the
network except that process's own `/health` on `127.0.0.1`.

### Patterns Used

[ownership-lock-and-templates](../patterns/ownership-lock-and-templates.md),
[deterministic-generation-and-catalog](../patterns/deterministic-generation-and-catalog.md),
[error-and-exit-codes](../patterns/error-and-exit-codes.md),
[app-process-launching](../patterns/app-process-launching.md),
[handoff-kit](../patterns/handoff-kit.md), [schema-first-contracts](../patterns/schema-first-contracts.md).

## Data Flow

```
armature.yaml --loadSpec--> AgentSpec --checkCompatibility--> CompatReport (exit 2 on unsupported)
   --planProject--> ProjectPlan --renderProject([...templateLayers, handoffLayer()])--> RenderedFile[]
   + seedEvalFiles(plan) --withSkillCopies--> files
   --applyFiles(previous = readLock(dir))--> PlannedAction[] (+ disk writes) --buildLock--> armature.lock
```

## Key Behaviors

### `generate()` (init or update)

1. Parse the spec from `specText` (init passes the YAML it just produced) or read `armature.yaml`.
2. Read the existing lock. With no lock and `handoffOnly`, throw: `sync` needs a generated project.
3. `compile()` runs `checkCompatibility`. `unsupported` throws `ArmatureError` with exit 2. `experimental`
   throws exit 2 only when `allowExperimental === false`.
4. With no lock, `assertInitTarget(dir, force)` refuses to write into a non-empty directory (exit 3).
5. `withSkillCopies` mirrors `.agents/skills/**` into `.claude/skills/**` unless the user edited the
   canonical skill.
6. `applyFiles` compares each rendered file with disk and the previous lock and records a `PlannedAction`.
7. Unless `dryRun`, `buildLock` is serialized to `armature.lock`.

### `applyFiles` decisions

- No file on disk: `create`. Same hash as rendered: `unchanged`.
- File differs and its disk hash equals the lock hash (user did not edit): `update`.
- File differs and the user edited it: `skip-modified` (managed) and it stays; `--force` overwrites managed
  files only.
- `generated-once` files that differ from the render are `skip-owned` once a lock exists, even with `--force`;
  a tracked `generated-once` file the user deleted also stays deleted (`skip-owned`) unless `--force`.
- Managed lock entries with no rendered file: `remove` if untouched (or with `--force`), otherwise
  `keep-orphan`. Orphans that are `generated-once` are never removed.
- With no lock at all (init, including `init --force` into an existing directory) a differing file is
  treated as pristine and is overwritten.

### Error scenarios

- Missing `armature.yaml`: validation error (exit 1) with the path.
- Unsupported framework, pattern or interface: exit 2 listing every blocking finding.
- Target directory not empty: exit 3 (`overwriteRefused`).
- `launchApp` with no `.venv`: exit 5 telling the user to run `uv sync --extra dev`.

### Why This Flow

Rendering is a pure function of the spec, template layers and Armature version (no clock, no random ids,
no machine paths), so two runs produce identical bytes. The lock then lets updates distinguish "behind the
spec" from "edited by the user" without a three-way merge.

## Configuration

- Template version `TEMPLATE_VERSION = "2"` (in adapters) is written to the lock; a project generated by an
  older template version is simply seen as out of date.
- `catalog/versions.json` and `catalog/models.json` are the only place framework pins and model IDs live.
  Do not invent entries; verify and update `verified_at` (see
  [deterministic-generation-and-catalog](../patterns/deterministic-generation-and-catalog.md)).
- `generation.template_version` in the spec is accepted by the schema but ignored by the P0 generator.

## Testing

`packages/core/test/`: `compat.test.ts`, `render.test.ts`, `plan.test.ts`, `lock-write.test.ts`,
`seeds.test.ts`, `handoff.test.ts`, `langgraph-templates.test.ts` and `openai-agents-templates.test.ts`
(golden-style assertions over rendered files). Tests use temp directories and `renderWithLock`; none need
Python. Real generated-project behavior is covered by `../../tests-integration` (see
[tests-integration.md](tests-integration.md)).

## Performance Considerations

Rendering walks the template trees synchronously and compiles each Handlebars template once per file; the
whole project is a few dozen files, so generation is milliseconds. `waitHealthy` polls `/health` every 200 ms
up to 60 s; `launchApp` keeps only the last 20,000 characters of child logs.

## Gotchas & Constraints

### Never Do This

- Never put timestamps, random ids or absolute paths in rendered files; `Generation is deterministic` is a
  repository rule (`../../AGENTS.md`).
- Never write to disk from `compile()` or `renderWithLock()`; only `generate()` writes.
- Never overwrite a `generated-once` file; users own them after init.

### Always Do This

- Route all exits through `ArmatureError` with an `ExitCode`; the CLI converts it (see [cli.md](cli.md)).
- Pin framework versions and models in the catalogs, not inline in templates.

### Common Mistakes

- Assuming `--force` rewrites everything: it only overwrites edited `managed` files and an existing project
  at init; `generated-once` files are never replaced.
- Treating `experimental` as blocked by default: only an explicit `allowExperimental: false` blocks it. The
  CLI passes `--experimental` for `generate`/`sync`, so those block by default, while `plan`, `dev`, `doctor`
  and eval commands pass `true`.
- Forgetting that blank rendered content deletes the file from the output, which is how templates are made
  conditional.

### Edge Cases

- `openai_compatible` providers and models not in the catalog are `experimental`, not `unsupported`.
- Tool templates named `__tool__` are expanded once per planned tool; the `dot_` prefix becomes `.`.
- CRLF is normalized to LF and a single trailing newline is enforced before hashing.

### Business Rules

- P0 supports `langgraph` and `openai-agents` with `single_agent_tools` in Python only.
- `generated-once` globs come from each layer's `ownership.json` (adapters and handoff).

## Security Considerations

The lock stores SHA-256 hashes only. `plan` output includes secret *names* (env var names) never values.
`launchApp` passes through the caller's environment; callers (`dev`, eval sessions) set only mock URLs and
model mode flags. The generated app binds to `127.0.0.1` by default.

## Features Implemented

[init](../features/init.md), [generate-and-sync](../features/generate-and-sync.md), [plan](../features/plan.md),
[dev](../features/dev.md), [doctor](../features/doctor.md), [test](../features/test.md),
[eval-run](../features/eval-run.md) (through `launchApp`).

## Related Documentation

- Modules: [schema](schema.md), [adapters](adapters.md), [handoff](handoff.md), [cli](cli.md).
- Patterns: [ownership-lock-and-templates](../patterns/ownership-lock-and-templates.md),
  [deterministic-generation-and-catalog](../patterns/deterministic-generation-and-catalog.md).
- Architecture: [module-interactions](../architecture/module-interactions.md).
- ADRs: `../../docs/adr/0001-package-name-and-layout.md`, `../../docs/adr/0004-handoff-kit-and-sync.md`.

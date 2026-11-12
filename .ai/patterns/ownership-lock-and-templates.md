# Pattern: Template Rendering and the Ownership Lock

## Overview

Armature never writes generated files directly. It renders Handlebars templates from layered template
directories into an in-memory list of `RenderedFile` objects, tags every file as `managed` or
`generated-once`, and then reconciles that list against the target directory using `armature.lock`. The lock
records the SHA-256 of each file Armature last wrote, which lets later runs tell "stale because the spec
changed" from "edited by the user".

## Purpose

- Make regeneration safe: re-running `armature generate` or `armature sync` must never destroy user edits.
- Keep generation deterministic: same spec, same bytes, no timestamps or machine paths (repository rule in
  `AGENTS.md`).
- Separate framework code (always regenerated) from user-owned code (tools, prompts, README, tool tests)
  that is created once and then left alone.

## Where Used

- Rendering: [`renderProject`](../../packages/core/src/render.ts:94) and the ownership rule loader at
  [`render.ts:73`](../../packages/core/src/render.ts:73).
- Lock model: [`buildLock`](../../packages/core/src/lock.ts:31), [`parseLock`](../../packages/core/src/lock.ts:60).
- Reconciliation: [`applyFiles`](../../packages/core/src/write.ts:61) and
  [`assertInitTarget`](../../packages/core/src/write.ts:45).
- Orchestration: [`generate`](../../packages/core/src/compile.ts:106).
- Ownership declarations: `packages/adapters/templates/common/ownership.json` and
  `packages/handoff/templates/ownership.json`.
- CLI surface: `armature init`, `generate`, `sync` ([cli module](../modules/cli.md)) and drift detection in
  `scaffoldDrift` ([`project.ts:33`](../../packages/cli/src/project.ts:33)).
- Module docs: [core](../modules/core.md), [adapters](../modules/adapters.md), [handoff](../modules/handoff.md).

## Implementation Details

1. `templateLayers(framework)` (`packages/adapters/src/index.ts:17`) returns the layer directories
   (`common`, then the framework directory). `handoffLayer()` adds the handoff kit.
2. `renderProject(plan, layers)` walks each layer, renders `*.hbs` files with Handlebars (`strict: true`,
   `noEscape: true`; helpers `json`, `py`, `eq`, `ne`, `and`, `or`, `not`, `includes`, `upper`, `join`) and
   copies other files verbatim. Later layers override earlier ones at the same output path. A template whose
   rendered output is blank removes that path, which is how templates are made conditional on the plan.
3. Path rewriting (`outputPath`, `render.ts:79`): a `dot_` prefix becomes `.`, `__pkg__` becomes the Python
   package name, and `__tool__` expands once per planned tool.
4. Ownership comes from each layer's `ownership.json`: a list of globs (compiled by `globToRegExp`) whose
   matches are `generated-once`; everything else is `managed`.
5. `lockEntries` hashes the rendered content; `buildLock` sorts files and dependencies so the lock is stable
   and records `spec_sha256`, `template_version`, `generator_version` and pinned dependencies.
6. `applyFiles` compares rendered content with disk and the previous lock, producing a `PlannedAction` per
   file. Action kinds are `create`, `update`, `unchanged`, `skip-modified`, `skip-owned`, `remove` and
   `keep-orphan` (`write.ts:7-21`).

## Code Example

```ts
// packages/core/src/compile.ts (shape, simplified)
const compiled = compile(spec, { allowExperimental }); // compat check, plan, renderProject, seeds
const previous = readLock(dir); // null on first run
const { actions, entries } = applyFiles({ dir, files, previous, force, dryRun });
const lock = buildLock({ /* framework, template version, spec text, deps */ files: entries });
```

`applyFiles` is the only place that touches the target directory. With `dryRun` it computes the same
actions without writing, which `armature generate --dry-run`, `armature plan` and `scaffoldDrift` all rely on.

## Common Scenarios

- **Fresh init**: no lock, empty directory; every file is `create`. `assertInitTarget` refuses a non-empty
  directory without `--force` (exit 3).
- **Spec edited, no file edits**: managed files whose hash differs from the new render become `update`.
- **User edited a managed file**: the on-disk hash no longer matches the lock; the action is `skip-modified`
  and the CLI prints "kept (edited)". `--force` overwrites.
- **Generated-once file exists or was deleted**: once a lock exists it is never rewritten, not even with
  `--force`, and a tracked file the user deleted stays deleted (`skip-owned`, "kept (yours)"). New tools get a
  new `tools/<name>.py` stub because that path is not yet in the lock.
- **Tool removed from spec**: its managed files are `remove`; a changed orphan is `keep-orphan`.
- **`sync`**: calls `generate` with `handoffOnly: true`, so only the handoff layer is reconciled.

## Rules & Constraints

- Generated projects must not import any Armature runtime package (`AGENTS.md`). Templates are self-contained.
- Never put timestamps, random ids or absolute paths in templates; the lock and golden tests would drift.
- Changing which files are `generated-once` is a contract change visible to users; bump `TEMPLATE_VERSION`
  in `packages/adapters/src/index.ts` and cover it in the template tests.
- The lock schema (`LockSchema`, `lock.ts:13`) is `.loose()` so newer keys are tolerated, but
  `lock_version` must equal 1.
- Handoff docs (`docs/*.md`, `BUILD_STATUS.md`) are `generated-once` because coding agents edit them.

## Common Gotchas

- Adding a template without registering it in `ownership.json` makes it `managed`, so user edits show as
  drift and `armature test --only golden` fails.
- `--force` only applies to managed files; it cannot reset a user-owned file once the lock tracks it.
- `armature.yaml` and `armature.lock` are in `IGNORABLE` (`write.ts:35`) for the empty-directory check; other
  files are not.
- Handlebars runs with `strict: true`: referencing a missing plan field throws at render time, not silently.
- Line endings are normalized only when hashing the spec (`buildLock`), not file contents.

## Anti-Patterns

- Writing files with `fs.writeFileSync` from a command. Always go through `applyFiles` so the lock stays true.
- Making a template depend on the current date, hostname or username.
- Treating `generated-once` as "optional": the file is still part of the lock and is tracked for orphan
  detection.

## Related Patterns

- [Deterministic generation and catalog pinning](deterministic-generation-and-catalog.md) feeds the pinned
  versions rendered into `pyproject.toml`.
- [Schema-first contracts](schema-first-contracts.md) validates the spec before it is planned and rendered.
- [Handoff kit](handoff-kit.md) reuses the same rendering and lock path for assistant files.
- [Generated runtime architecture](generated-runtime-adapter.md) describes what the rendered files contain.

## Background

ADR `docs/adr/0004-handoff-kit-and-sync.md` introduced `sync` and handoff ownership; ADR 0001 fixed the
layout. The two-ownership model exists because coding agents are expected to edit tools and docs after the
first generation.

## Modules Using This Pattern

- [core](../modules/core.md)
- [adapters](../modules/adapters.md)
- [handoff](../modules/handoff.md)
- [cli](../modules/cli.md)

## Related Patterns (Why They Connect)

- [deterministic-generation-and-catalog](deterministic-generation-and-catalog.md): reproducible output.
- [handoff-kit](handoff-kit.md): assistant-facing generated files.

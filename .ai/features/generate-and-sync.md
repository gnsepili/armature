# Feature: Generate and sync (`armature generate`, `armature sync`)

## What Users Can Do

- Regenerate a project from an edited `armature.yaml` without losing hand-edited files.
- Refresh only the assistant handoff kit (AGENTS.md, CLAUDE.md, docs, skills) with `sync`.
- Use `--force` to overwrite modified managed files.

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

None over HTTP. Core `generate` in `../../packages/core/src/compile.ts:106`.

## Components

`packages/cli/src/commands/generate.ts`, `sync.ts`.

## State Management

`armature.lock` records hashes of managed files; decisions are create, update, unchanged, skip-modified, skip-owned, remove, keep-orphan.

## Business Rules

- Generated-once files (README, tools, prompts, tests/test_tools.py, workflow, docs) are never overwritten once present and tracked.
- Modified managed files are skipped unless `--force`.
- `sync` requires an existing lock (exit 1) and touches handoff paths only.
- `sync` passes `allowExperimental: Boolean(--experimental)`.

## User Flow

1. Load and validate `armature.yaml`.
2. Compile plan and render templates deterministically.
3. `applyFiles` decides per file and writes.
4. Update lock; print a summary of decisions.

## Navigation Flow

Edit `armature.yaml` -> generate -> [test](test.md) or [dev](dev.md).

## Related Features

- [init](init.md)
- [plan](plan.md)
- [handoff-kit](handoff-kit.md)

## Dependencies

Core, handoff, adapters templates.

## Error Scenarios

No lock with sync: exit 1. Skipped files are reported, not errors.

## Performance

Linear in file count.

## Modules Involved

- [cli](../modules/cli.md)
- [core](../modules/core.md)
- [handoff](../modules/handoff.md)
- [adapters](../modules/adapters.md)

## Patterns Used

- [ownership-lock-and-templates](../patterns/ownership-lock-and-templates.md)
- [deterministic-generation-and-catalog](../patterns/deterministic-generation-and-catalog.md)
- [handoff-kit](../patterns/handoff-kit.md)

# Feature: Init (`armature init`)

## What Users Can Do

- Scaffold a new agent project from flags, a YAML config, stdin, or an interactive wizard.
- Preview with `--dry-run` and get machine output with `--json`.
- Overwrite an existing project deliberately with `--force`.

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

None over HTTP. Calls core `generate` and `specToYaml`/`specFromFlags` (`../../packages/cli/src/commands/init.ts`, `spec.ts`, `wizard.ts`).

## Components

`packages/cli/src/commands/init.ts`, `wizard.ts` (clack prompts), `spec.ts`.

## State Management

Stateless. Writes `armature.yaml`, generated files and `armature.lock` to the target directory.

## Business Rules

- Refuses if `armature.yaml` exists and not `--force` (exit 3).
- Wizard only when interactive and none of `--yes`, `--config`, `--json`.
- `generate` is called with `allowExperimental: interactive || --experimental`.
- Seed eval cases are written as `DRAFT_UNVERIFIED`.

## User Flow

1. Parse args and read `--config` (mapping or `-`).
2. Build spec via wizard or flags, validate with schema.
3. Generate files (or plan only for `--dry-run`).
4. Write `armature.yaml`.
5. Print next steps: `uv sync --extra dev`, `armature dev --offline`, `claude` then `/build-agent`, plus stub tools.

## Navigation Flow

init -> (uv sync) -> [dev](dev.md) / [eval-validate-and-freeze](eval-validate-and-freeze.md).

## Related Features

- [generate-and-sync](generate-and-sync.md)
- [plan](plan.md)
- [dev](dev.md)

## Dependencies

Core generation, schema validation, node only (no Python needed to init).

## Error Scenarios

Existing project: exit 3. Invalid spec: schema error, exit 1. Non-empty target dir: exit 3 unless `--force`.

## Performance

File generation only; no network.

## Modules Involved

- [cli](../modules/cli.md)
- [core](../modules/core.md)
- [schema](../modules/schema.md)
- [handoff](../modules/handoff.md)

## Patterns Used

- [deterministic-generation-and-catalog](../patterns/deterministic-generation-and-catalog.md)
- [ownership-lock-and-templates](../patterns/ownership-lock-and-templates.md)
- [io-abstraction-testable-cli](../patterns/io-abstraction-testable-cli.md)

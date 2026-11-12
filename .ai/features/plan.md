# Feature: Plan (`armature plan`)

## What Users Can Do

- See what generation would produce (files, tools, dependencies, drift) without writing.

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

None over HTTP. `projectPlan` and `scaffoldDrift` in `../../packages/cli/src/project.ts`.

## Components

`packages/cli/src/commands/plan.ts`, `project.ts`.

## State Management

Stateless, read-only.

## Business Rules

- Never writes files.
- Drift states: stale (create/update/remove) versus edited (skip-modified/keep-orphan).

## User Flow

1. Load spec.
2. Compute `ProjectPlan` and compare with the lock and disk.
3. Print human or `--json` output.

## Navigation Flow

plan -> [generate-and-sync](generate-and-sync.md).

## Related Features

- [generate-and-sync](generate-and-sync.md)
- [doctor](doctor.md)

## Dependencies

Core plan and write modules.

## Error Scenarios

Missing or invalid spec: schema error (exit 1).

## Performance

Fast.

## Modules Involved

- [cli](../modules/cli.md)
- [core](../modules/core.md)

## Patterns Used

- [deterministic-generation-and-catalog](../patterns/deterministic-generation-and-catalog.md)
- [io-abstraction-testable-cli](../patterns/io-abstraction-testable-cli.md)

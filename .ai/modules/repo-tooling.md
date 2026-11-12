# Module: repo-tooling

## Purpose & Scope

### What This Module Does

Repository-level tooling and documentation: the schema export script, the CI workflow, the ADRs and the CLI
reference. Root config (`package.json`, `biome.json`, `tsconfig.json`, `schemas/`) sits outside the mapped source
roots but is described here.

### Boundaries

- IN: `scripts/export-schemas.ts`, `docs/adr/*`, `docs/cli.md`, `.github/workflows/ci.yml`.
- OUT: package code; `schemas/*.json` are generated output.

## Key Components

| Piece | Location | Role |
| --- | --- | --- |
| Schema export | `../../scripts/export-schemas.ts` | Writes `schemas/*.json` from `jsonSchemas()` and `arcSchemas()`; `--check` verifies |
| CI | `../../.github/workflows/ci.yml` | Jobs `check`, `unit`, `integration` |
| ADRs | `../../docs/adr/` (0001 to 0006) | Contract decisions |
| CLI reference | `../../docs/cli.md` | Flags, exit codes |

## API Surface

Root scripts: `pnpm build`, `test`, `test:watch`, `typecheck`, `lint`, `format`, `schemas`, `test:integration`.

## Dependencies

### Internal Modules

[schema](schema.md) and [arc](arc.md) (schema sources), [cli](cli.md) (bundle smoke test).

### External Services

GitHub Actions, `astral-sh/setup-uv`, pnpm 12, Node 22 and 24.

### Patterns Used

[schema-first-contracts](../patterns/schema-first-contracts.md), [testing-conventions](../patterns/testing-conventions.md).

## Data Flow

`packages/schema` and `packages/arc` Zod -> `pnpm schemas` -> `schemas/*.json` -> CI `git diff --exit-code schemas`.

## Key Behaviors

CI `check` (ubuntu): `pnpm lint`, `pnpm typecheck`, schemas up to date, `pnpm build`, then the bundled CLI is
smoke-tested from a path with spaces (`init --yes`, `eval validate --static`, `test --only golden`). `unit` runs
`pnpm test` on ubuntu, macOS, Windows with Node 22 and 24. `integration` runs `pnpm test:integration` on the same
OS set with Python 3.11 to 3.13 and `ARMATURE_IT_OUT` under a path with spaces.

### Error scenarios

Schema drift fails `check`; commit regenerated `schemas/`.

### Why This Flow

Published JSON Schemas are public contracts; CI proves they match the Zod sources.

## Configuration

Biome: 2 spaces, line width 110, double quotes; `.agents` and `.ai` are ignored. Node >= 22, pnpm 12.

## Testing

CI is the test of this module.

## Performance Considerations

Integration matrix is the slowest job (9 combinations).

## Gotchas & Constraints

### Never Do This

- Never change public contracts without an ADR.

### Always Do This

- Run `pnpm schemas` after editing `packages/schema`.

### Common Mistakes

- Trusting ADR 0001 on bundling: it names tsup, but the build uses esbuild.

### Edge Cases

- ADRs are never rewritten after acceptance; supersede them with a new ADR.

### Business Rules

- Not implemented: live-eval CI (CI only runs offline evals).

## Security Considerations

Workflow permissions are `contents: read`. No secrets are used.

## Features Implemented

Supports every feature indirectly; see [agents.md](../agents.md).

## Related Documentation

[schema](schema.md), [cli](cli.md), [tests-integration](tests-integration.md).

## What and why

<!-- One behaviour change per PR. Link the issue it closes. -->

## How it was tested

- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass
- [ ] `pnpm test:integration` passes (needed for template or runtime changes)
- [ ] New or changed behaviour has a test

## Checklist

- [ ] Public contract changes (schemas, ARC, eval case format, CLI flags, exit codes) have an ADR in `docs/adr/`
- [ ] Schema changes: ran `pnpm schemas` and committed `schemas/`
- [ ] New framework versions or model IDs were verified and pinned in `packages/core/catalog/`
- [ ] User-visible changes are in `CHANGELOG.md` under _Unreleased_

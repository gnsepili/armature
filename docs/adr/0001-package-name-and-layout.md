# ADR 0001 — npm package name and monorepo layout

**Status:** Accepted

## Context

The PRD names the CLI `armature`. The npm name `armature` is already registered by an unrelated
project, so `npx armature` cannot install this tool.

## Decision

- Publish as **`armature-agents`**; the installed binary is still **`armature`**
  (`npx armature-agents init`, then `armature …`).
- One pnpm workspace. Internal packages (`@armature/schema`, `arc`, `mock-llm`, `core`,
  `adapters`, `evals`, `handoff`) are private and bundled into the published CLI with tsup, so
  users install exactly one package and the internal API can change freely.
- Node ≥ 22, ESM only.

## Consequences

- Docs and generated files say `npx armature-agents` for first use and `armature` afterwards.
- If the `armature` name becomes available we can publish an alias without breaking anyone.

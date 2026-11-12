# Armature: Agent Context Index

Start here. Load only what the task needs (see `../.agents/skills/repo-context/SKILL.md`).

## System Overview

Armature is a TypeScript CLI (npm package `armature-agents`, binary `armature`) that compiles `armature.yaml`
into framework-native Python agent projects with an eval-first workflow. P0 scope: LangGraph and OpenAI Agents
SDK, single agent with tools. Not implemented: workflow, supervisor and rag_chat patterns, RAG, agent MCP
servers, websocket interface, TypeScript output, the other eight known frameworks, state/judge/custom graders,
live-eval CI. The product contract is the PRD; contributor rules are in `../AGENTS.md`.

## Tech Stack

TypeScript (Node >= 22, ESM), pnpm 12 workspace, Zod, commander, @clack/prompts, Handlebars, yaml, esbuild
(bundle), vitest, Biome. Generated projects are Python 3.11-3.13 managed with `uv`, using pinned LangGraph or
OpenAI Agents SDK versions (`versions.json`, `models.json`).

## Directory Structure

```
packages/schema      Zod specs, JSON Schema export
packages/core        compile, render, lock, write, launchApp, seeds, catalog
packages/adapters    framework templates + Python runtime copied into generated projects
packages/handoff     assistant-facing templates (AGENTS.md, CLAUDE.md, skills, MCP config)
packages/arc         ARC v1 client, events, conformance suite
packages/mock-llm    scripted OpenAI-compatible server
packages/evals       benchmark loader, lint, runner, graders, metrics, snapshots, freeze
packages/playground  static web UI assets
packages/cli         commands, Io, dev server, esbuild bundle
tests-integration    end-to-end generated-project tests (slow, need uv)
scripts, docs, .github   schema export, ADRs and CLI reference, CI
schemas/             generated JSON Schemas (do not edit)
```

## Code Conventions

Biome: 2 spaces, line width 110, double quotes. TypeScript source imports with `.ts` extensions. Tests are
vitest files in each package's `test/`. Commands never call `process.exit`; they return codes or throw
`ArmatureError`. Generation is deterministic (no timestamps, random IDs, machine paths in managed files).

## Configuration

`armature.yaml` (spec, schema in `packages/schema`), `armature.lock` (ownership hashes), `evals/evalspec.yaml`,
`evals/benchmark.lock`. Env toggles in generated apps: `ARMATURE_EVAL_MODE`, `ARMATURE_MODEL_MODE`,
`ARMATURE_MOCK_URL`, `ARMATURE_SESSION_DB`. Integration tests: `ARMATURE_IT_OUT`, `ARMATURE_IT_PYTHON`.

## Development Workflow

`pnpm install`; `pnpm test` (unit); `pnpm typecheck`; `pnpm lint`; `pnpm schemas` after changing
`packages/schema`; `pnpm build` (esbuild bundle); `pnpm test:integration` (slow). Public contracts change only
with an ADR in `../docs/adr/`. Pin verified framework APIs and model IDs in `versions.json` / `models.json`.

## Cross-Cutting Concerns

Exit codes ([error-and-exit-codes](patterns/error-and-exit-codes.md)); testable CLI I/O
([io-abstraction-testable-cli](patterns/io-abstraction-testable-cli.md)); schema as contract
([schema-first-contracts](patterns/schema-first-contracts.md)); deterministic generation
([deterministic-generation-and-catalog](patterns/deterministic-generation-and-catalog.md)); ownership
([ownership-lock-and-templates](patterns/ownership-lock-and-templates.md)).

## Common Patterns

- [ownership-lock-and-templates](patterns/ownership-lock-and-templates.md)
- [schema-first-contracts](patterns/schema-first-contracts.md)
- [error-and-exit-codes](patterns/error-and-exit-codes.md)
- [io-abstraction-testable-cli](patterns/io-abstraction-testable-cli.md)
- [arc-contract-and-client](patterns/arc-contract-and-client.md)
- [mock-llm-scripted-testing](patterns/mock-llm-scripted-testing.md)
- [deterministic-generation-and-catalog](patterns/deterministic-generation-and-catalog.md)
- [eval-case-lifecycle](patterns/eval-case-lifecycle.md)
- [app-process-launching](patterns/app-process-launching.md)
- [generated-runtime-adapter](patterns/generated-runtime-adapter.md)
- [handoff-kit](patterns/handoff-kit.md)
- [testing-conventions](patterns/testing-conventions.md)

## Module Map

| Module | Doc | Source |
| --- | --- | --- |
| schema | [modules/schema.md](modules/schema.md) | `packages/schema` |
| core | [modules/core.md](modules/core.md) | `packages/core` |
| adapters | [modules/adapters.md](modules/adapters.md) | `packages/adapters` |
| handoff | [modules/handoff.md](modules/handoff.md) | `packages/handoff` |
| arc | [modules/arc.md](modules/arc.md) | `packages/arc` |
| mock-llm | [modules/mock-llm.md](modules/mock-llm.md) | `packages/mock-llm` |
| evals | [modules/evals.md](modules/evals.md) | `packages/evals` |
| playground | [modules/playground.md](modules/playground.md) | `packages/playground` |
| cli | [modules/cli.md](modules/cli.md) | `packages/cli` |
| tests-integration | [modules/tests-integration.md](modules/tests-integration.md) | `tests-integration` |
| repo-tooling | [modules/repo-tooling.md](modules/repo-tooling.md) | `scripts`, `docs`, `.github` |

## Features Map

| Feature | Doc |
| --- | --- |
| init | [features/init.md](features/init.md) |
| generate and sync | [features/generate-and-sync.md](features/generate-and-sync.md) |
| plan | [features/plan.md](features/plan.md) |
| dev | [features/dev.md](features/dev.md) |
| chat | [features/chat.md](features/chat.md) |
| doctor | [features/doctor.md](features/doctor.md) |
| test | [features/test.md](features/test.md) |
| eval plan, validate, freeze | [features/eval-validate-and-freeze.md](features/eval-validate-and-freeze.md) |
| eval run | [features/eval-run.md](features/eval-run.md) |
| eval report, compare | [features/eval-report-and-compare.md](features/eval-report-and-compare.md) |
| ARC HTTP API | [features/arc-http-api.md](features/arc-http-api.md) |
| playground UI | [features/playground-ui.md](features/playground-ui.md) |
| handoff kit | [features/handoff-kit.md](features/handoff-kit.md) |

## Architecture

[architecture/module-interactions.md](architecture/module-interactions.md). A data model doc is intentionally
omitted: the CLI is stateless; persistent state is only `armature.lock`, `evals/benchmark.lock` and
`evals/runs` snapshots.

## External Systems

`uv` and Python, model providers (OpenAI or OpenAI-compatible `base_url`), the docs MCP endpoints used by
assistants (`https://docs.langchain.com/mcp`, `https://developers.openai.com/mcp`), GitHub Actions. Details in
the architecture doc.

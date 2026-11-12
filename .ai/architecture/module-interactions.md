# Module Interactions

## System Architecture Overview

Armature is a TypeScript monorepo (pnpm workspace, Node >= 22) whose product is a CLI, `armature`
(npm package `armature-agents`). The CLI compiles a declarative `armature.yaml` into a framework-native Python
agent project (LangGraph or OpenAI Agents SDK at P0, single agent with tools). The generated project is a
standalone Python package; it never imports an Armature runtime package. Everything Armature knows about a
generated project at runtime goes through one HTTP contract, ARC v1.

The packages form a small dependency graph. `schema` (Zod specs and JSON Schema export) is the base. `adapters`
holds the framework templates and the Python runtime that ends up inside generated projects; `handoff` holds
assistant-facing templates (AGENTS.md, skills, MCP config). `core` compiles specs into files, owns the lock and
ownership logic, and launches generated apps. `mock-llm` is an OpenAI-compatible scripted server. `arc` is the
client, event schemas and conformance suite. `evals` runs benchmarks over ARC. `playground` ships static web
assets. `cli` wires all of them into commands and bundles to a single `dist/armature.js`.

Two principles shape the interactions. First, generation is deterministic and ownership-aware: files are managed
(refreshed unless edited) or generated-once (never overwritten), tracked by `armature.lock`. Second, the product
is eval-first: every project ships a benchmark skeleton, an offline mock path, and an ARC eval mode, so wiring
can be proven without a model key. Planned but not implemented: workflow and supervisor patterns, RAG, agent MCP
servers, non-P0 frameworks, state/judge/custom graders, live-eval CI.

```
                         +----------------------------+
                         |            cli             |  commands, Io, exit codes, dev server
                         +--+----+----+----+----+-----+
                            |    |    |    |    |
              +-------------+    |    |    |    +-------------+
              v                  v    v    v                  v
          +--------+        +-------+ +------+ +-----------+ +------------+
          | evals  |------->|  arc  | | core | | mock-llm  | | playground |
          +---+----+        +---+---+ +--+---+ +-----------+ +------------+
              |                 |        |  \         ^
              |                 +--------|---\--------+  (arc conformance imports synthesize)
              +-----------------|--------+    \
              |                 |       +-------v-----+   +---------+
              +----> mock-llm   |       |  adapters   |   | handoff |
              +----> schema <---+-------+  (templates)|   | (tmpl)  |
                                        +-------------+   +---------+
 core -> adapters, handoff, schema.  handoff -> none.  generated project <-HTTP(ARC)-> arc client
```

## Data Flow

### Flow 1: init and generate

1. `cli init` builds a spec (wizard, flags, or `--config`) and validates it with `schema`.
2. `core.generate` derives a `ProjectPlan`, renders `adapters` and `handoff` templates (Handlebars, deterministic),
   and decides per file with `applyFiles` against `armature.lock`.
3. Files and the lock are written; `armature.yaml` is written by the CLI.

Why this flow: a single deterministic compile step keeps regeneration safe (hash-based ownership) and makes
golden tests (`armature test --only golden`) possible.

### Flow 2: dev and chat

1. `cli dev` requires the venv, optionally starts `mock-llm`, and spawns the generated app via `core.launchApp`.
2. `startPlaygroundServer` serves `playground` assets, proxies `/arc/*` to the app and exposes
   `/__armature/info`.
3. The browser (or `cli chat` through the `arc` client) streams runs and answers approvals.

Why this flow: the proxy gives the browser one origin and keeps the app a plain ARC server.

### Flow 3: eval run

1. `evals.loadBenchmark` reads spec and suites; lint and validate run first.
2. `startEvalSession` launches the app with `ARMATURE_EVAL_MODE=1` (and a mock when offline).
3. `runCases` calls `arc` `wait`/`resume`/`getRun` per trial; `gradeTrial`, `summarize`, `evaluateGates` follow.
4. `writeSnapshot` stores `evals/runs/<id>/`; `compareRuns` and `freezeBenchmark` operate on stored data.

Why this flow: graders see only the recorded run, so results are reproducible and held-out cases never reach an
assistant-readable directory.

## Communication Patterns

- In process: packages import each other through their `src/index.ts` barrels (TypeScript source imports).
- HTTP: the only runtime boundary between Armature and a generated project is ARC (REST plus SSE); see
  [arc-contract-and-client](../patterns/arc-contract-and-client.md).
- Child processes: `core.launchApp` spawns `python -m <package> serve`; `cli test` spawns pytest.
- Environment variables toggle behavior in the app: `ARMATURE_EVAL_MODE`, `ARMATURE_MODEL_MODE`,
  `ARMATURE_MOCK_URL`, `ARMATURE_SESSION_DB`.
- Files: `armature.yaml`, `armature.lock`, `evals/**`, `schemas/*.json`.

## Cross-Module Contracts

| Contract | Producer | Consumers | Evidence |
| --- | --- | --- | --- |
| Spec shapes and defaults | [schema](../modules/schema.md) | core, evals, cli | `packages/schema/src/index.ts` |
| Published JSON Schemas | schema, arc via `scripts/export-schemas.ts` | external tools, CI diff | `schemas/` |
| `RenderedFile` / `HandoffFile` structural shape | core, handoff | each other without importing | [handoff](../modules/handoff.md) |
| ARC v1 HTTP and events | generated app, [arc](../modules/arc.md) | cli, evals, playground | `packages/arc/src/types.ts` |
| Scripted LLM API | [mock-llm](../modules/mock-llm.md) | arc conformance, evals, cli dev/test | `packages/mock-llm/src/server.ts` |
| Ownership globs | `ownership.json` in adapters and handoff | core `render.ts` | [core](../modules/core.md) |
| Exit codes | core `ArmatureError` | cli | [error-and-exit-codes](../patterns/error-and-exit-codes.md) |
| Eval case format | schema | evals, seeds in core | [eval-case-lifecycle](../patterns/eval-case-lifecycle.md) |

Public contracts (schemas, ARC, eval case format, CLI flags, exit codes) change only with an ADR in
`../../docs/adr/`.

## External Dependencies

| Dependency | Used by | Evidence |
| --- | --- | --- |
| `uv` and Python 3.11-3.13 | doctor, test, dev, integration tests | `packages/cli/src/commands/doctor.ts`, `tests-integration/harness.ts` |
| LangGraph and OpenAI Agents SDK (pinned in `versions.json`) | generated projects | `packages/adapters` |
| Model provider API (OpenAI or compatible `base_url`) | live runs, `doctor --probe` | `packages/schema` model spec |
| docs MCP servers `https://docs.langchain.com/mcp`, `https://developers.openai.com/mcp` | assistants only | `packages/handoff/src/index.ts` |
| commander, @clack/prompts, yaml, zod, handlebars, @ag-ui/core, esbuild | cli, core, schema, arc | package manifests |
| GitHub Actions, setup-uv | CI | `.github/workflows/ci.yml` |

## Known Constraints

- Node >= 22; pnpm 12; Python 3.11+ for generated projects.
- Only `langgraph` and `openai-agents` are P0; eight other `KnownFramework` entries are not implemented.
- Eval graders: only `output` and `constraint`.
- Offline eval runs are sequential because the mock is shared.
- Generated projects must never import an Armature runtime package; generation must be deterministic.
- ADR 0001 names tsup though the build uses esbuild.

## Circular Dependencies

None at the package level. `core -> handoff` is one-way; `handoff` re-declares `HandoffFile` to mirror
`RenderedFile` precisely to avoid a cycle. `arc -> mock-llm` (conformance uses `synthesize`) and
`evals -> arc, core, mock-llm, schema` are acyclic.

## Unclear Boundaries

- Project helpers in `packages/cli/src/project.ts` (`projectConformance`) orchestrate mock plus app plus arc and could
  arguably live in `core` or `arc`; they are CLI-owned today.
- Eval seed cases are written by `core` (generation) but their format is owned by `schema` and consumed by `evals`.
- The dev playground server is in `cli`, while its assets are in `playground`.

See also [agents.md](../agents.md) for the module and feature maps.

## Package Dependency Table

| Package | Depends on (internal) | Evidence |
| --- | --- | --- |
| schema | none | `packages/schema/package.json` |
| adapters | none (templates and Python runtime) | `packages/adapters` |
| handoff | none | `packages/handoff` |
| core | adapters, handoff, schema | `packages/core/src/compile.ts` |
| mock-llm | none | `packages/mock-llm` |
| arc | mock-llm | `packages/arc/src/conformance.ts` |
| evals | arc, core, mock-llm, schema | `packages/evals/src/session.ts` |
| playground | none | `packages/playground/src/index.ts` |
| cli | core, schema, evals, arc, mock-llm, playground | `packages/cli/src/index.ts` |

## Runtime Topology During `armature dev --offline`

```
terminal: armature dev
   |-- mock-llm (in process, random port)            <- ARMATURE_MOCK_URL
   |-- python -m <pkg> serve (port 8000)  <-- ARC --  playground server (port 5174)
   '-- playground server: static files + /arc/* proxy + /__armature/info  <-- browser
```

## Runtime Topology During `armature eval run --offline`

```
armature (in process)
   |-- mock-llm (smoke mode, scripts per trial)
   '-- app (ARMATURE_EVAL_MODE=1, ARMATURE_MODEL_MODE=mock)  <-- arc client (wait/resume/getRun)
```

## Failure Propagation

- Library code throws `ArmatureError(code)`; the CLI's `toFailure` maps it to the exit code and prints it with
  `printFailure`. Unknown errors become exit 5.
- App crashes during `dev` end the command with exit 5; during evals they surface as `contract` failures.
- Child processes are always stopped in `finally` blocks (`launchApp` handles expose `stop`).

## Change Guide

| If you change | Also check |
| --- | --- |
| `packages/schema` | `pnpm schemas`, seeds in core, eval loader, docs |
| Adapter templates | golden tests, `ownership.json`, integration tests |
| ARC types or routes | adapters server, arc client, conformance, ADR 0002 |
| CLI flags or exit codes | `docs/cli.md`, an ADR, cli tests |
| Eval grading logic | bump `GRADERS_VERSION`, freeze lock behavior |

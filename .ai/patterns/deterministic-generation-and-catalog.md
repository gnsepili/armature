# Pattern: Deterministic Generation and Pinned Catalogs

## Overview

Generation is a pure function of `armature.yaml`, the template version and two checked-in catalogs:
`packages/core/catalog/versions.json` (Python, framework and runtime dependency pins) and
`packages/core/catalog/models.json` (model ids, context windows, capabilities, prices). Nothing in a managed
file depends on time, randomness or the machine.

## Purpose

- Reproducible output: the same spec yields byte-identical files, which golden tests and `scaffoldDrift`
  rely on.
- Honesty about versions: dependency and model facts are verified once, pinned with a `verified_at` date, and
  never invented (repository rule: "Never invent framework APIs or model IDs").
- Predictable support boundary: the compatibility check decides what is supported, degraded, experimental or
  unsupported before any file is rendered.

## Where Used

- Catalog access: [`versionsCatalog`, `modelCatalog`, `findModel`, `suggestedModels`](../../packages/core/src/catalog.ts:32).
- Compatibility: [`checkCompatibility`](../../packages/core/src/compat.ts:46), `SUPPORTED_FRAMEWORKS` and
  `SUPPORTED_PATTERNS` ([`compat.ts:19`](../../packages/core/src/compat.ts:19)).
- Planning: [`planProject`](../../packages/core/src/plan.ts:178), [`planDependencies`](../../packages/core/src/plan.ts:161).
- Compile pipeline: [`compile`](../../packages/core/src/compile.ts:47).
- Seeds (starter eval files): [`seedEvalFiles`](../../packages/core/src/seeds.ts:341), `slug` for stable case ids.
- Version constants: [`ARMATURE_VERSION`, `GENERATOR`](../../packages/core/src/version.ts:2); template version
  in [`adapters/src/index.ts:6`](../../packages/adapters/src/index.ts:6).
- Cost estimates: [`estimateCost`](../../packages/evals/src/suite.ts:31) uses catalog prices.
- Modules: [core](../modules/core.md), [adapters](../modules/adapters.md).

## Implementation Details

1. `loadSpec` parses and validates the YAML (see schema pattern).
2. `checkCompatibility` yields findings at levels error, warning or info and a status among supported,
   degraded, experimental and unsupported. Errors cover language, framework, pattern, python version,
   provider, session backend, RAG, MCP servers, the websocket interface, reserved Python package names and
   Python keywords used as tool or argument names. Unknown models and `openai_compatible` endpoints are
   allowed but flagged experimental (cost NOT_MEASURED for unknown models).
3. `compile(spec, { allowExperimental })` throws exit 2 for any unsupported spec, and also for experimental
   specs when `allowExperimental === false` (the `--experimental` flag opts in; `generate`/`sync` pass the flag value, other callers pass
   `true`).
4. `planProject` turns the spec into a `ProjectPlan`: Python package name (`pythonPackageName`), planned
   tools with pydantic type mapping, approval policy, limits, dependency list from the catalog and default
   API key env names.
5. Rendering and ownership follow the [lock pattern](ownership-lock-and-templates.md).
6. `seedEvalFiles` adds starter `evals/` files (evalspec, smoke/dev cases) derived from the plan, with
   refusal phrases from `REFUSAL_PHRASES`.

## Code Example

```ts
// packages/core/src/compile.ts:47 (abridged)
const compat = checkCompatibility(spec);
if (compat.status === "unsupported") throw new ArmatureError("this spec cannot be generated: ...", ExitCode.unsupported);
const plan = planProject(spec);
const files = renderProject(plan, [...templateLayers(plan.framework), handoffLayer()]);
```

## Common Scenarios

- Updating a pin: install into a clean Python 3.12 venv, run the adapter contract tests, then edit
  `versions.json` and bump `verified_at`.
- Adding a model: add an entry to `models.json` with price per 1M tokens; unlisted models still work but
  cost is not measured.
- Adding a framework: new template layer, a `Framework` enum entry already exists in `KnownFramework`, update
  `SUPPORTED_FRAMEWORKS` and compat provider tables.

## Rules & Constraints

- No timestamps, random ids or machine paths in generated managed files.
- Pins change only together with the adapter contract tests (note in `versions.json`).
- Public contracts change only with an ADR.
- The catalog is data: do not hard-code versions in templates.

## Common Gotchas

- `versions.json` is read at module load; tests that need different pins must mock the module.
- `TEMPLATE_VERSION` must be bumped when template output changes in a way users should notice.
- Only an explicit `allowExperimental: false` blocks experimental specs. `generate` and `sync` always pass
  `Boolean(--experimental)` (so they block by default), `init` passes `interactive || --experimental`, and
  `plan`, `dev`, `doctor`, the wizard preview and eval loading pass `true`.

## Anti-Patterns

- Computing paths with `process.cwd()` or embedding dates in templates.
- Referencing model ids that are not in `models.json` in docs or examples.

## Related Patterns

- [Schema-first contracts](schema-first-contracts.md) precede compatibility checks.
- [Ownership lock](ownership-lock-and-templates.md) records the pins in `armature.lock`.
- [Eval case lifecycle](eval-case-lifecycle.md) uses seeds and catalog prices.

## Background

ADR 0001 sets the layout; the catalog notes in `versions.json` and `models.json` document how pins are
verified.

## Modules Using This Pattern

- [core](../modules/core.md)
- [cli](../modules/cli.md)
- [schema](../modules/schema.md)

## Related Patterns (Why They Connect)

- [ownership-lock-and-templates](ownership-lock-and-templates.md): both decide what generation may overwrite.
- [schema-first-contracts](schema-first-contracts.md): specs and wire shapes are defined once and reused.

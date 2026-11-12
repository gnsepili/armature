# Pattern: Schema-First Contracts (zod)

## Overview

Every user-facing document format is defined once as a zod schema in `packages/schema` and consumed by the
rest of the code as inferred TypeScript types. JSON Schema files in `schemas/` are generated from the same
zod definitions.

## Purpose

- One source of truth for `armature.yaml` (AgentSpec), `evals/evalspec.yaml` (EvalSpec) and eval case files.
- Strict parsing (`.strict()` objects) so typos fail loudly instead of being ignored.
- Machine-readable JSON Schemas for editors and for coding agents that author specs and cases.

## Where Used

- Spec schema: [`AgentSpec`](../../packages/schema/src/agent-spec.ts:76) with enums at
  [`agent-spec.ts:6-23`](../../packages/schema/src/agent-spec.ts:6).
- Eval schemas: [`EvalCase`](../../packages/schema/src/eval.ts:97), [`EvalSpec`](../../packages/schema/src/eval.ts:156),
  graders at [`eval.ts:33-85`](../../packages/schema/src/eval.ts:33).
- Parse helpers and error type: [`parseWith`](../../packages/schema/src/index.ts:33),
  [`SchemaError`](../../packages/schema/src/index.ts:14), [`jsonSchemas`](../../packages/schema/src/index.ts:56).
- Schema export script: [`scripts/export-schemas.ts`](../../scripts/export-schemas.ts), run by `pnpm schemas`.
- CI guard: `.github/workflows/ci.yml` runs `pnpm schemas && git diff --exit-code schemas`.
- Consumers: [core](../modules/core.md) (`loadSpec`, `checkCompatibility`), [evals](../modules/evals.md)
  (`loadBenchmark`), [cli](../modules/cli.md) (`specFromFlags` builds a spec input).
- Module doc: [schema](../modules/schema.md).

## Implementation Details

- `parseWith(schema, value, source)` wraps `safeParse` and throws `SchemaError` carrying a list of
  `SchemaIssue` (path plus message). It never returns a partial result.
- `parseYamlText` parses YAML and reports syntax errors with the source name.
- The AgentSpec uses `superRefine` (`agent-spec.ts:182`) for three cross-field rules: structured output needs a
  `schema`, custom tool names must be unique, and `openai_compatible` needs `model.base_url`.
- `KnownFramework` lists more frameworks than `Framework`; only `langgraph` and `openai-agents` are
  generatable. `Pattern` likewise includes `workflow`, `supervisor` and `rag_chat`, which are accepted by the
  schema but rejected later by compatibility checks as unsupported.
- `P0_GRADERS` (`eval.ts:85`) names the graders that actually execute; the schema accepts `state`, `judge`
  and `custom` so benchmarks can be authored ahead of the engine.

## Code Example

```ts
import { parseAgentSpec, SchemaError } from "@armature/schema";

try {
  const spec = parseAgentSpec(parseYamlText(text, "armature.yaml"));
} catch (e) {
  if (e instanceof SchemaError) console.error(e.issues); // surfaced by toFailure as exit 1
}
```

`toFailure` in the CLI maps `SchemaError` to the validation exit code with the issue list, so schema authors
get consistent error output across commands.

## Common Scenarios

- Adding a spec field: add it to the zod object, regenerate with `pnpm schemas`, commit `schemas/*.json`,
  and write an ADR when the change affects a public contract.
- Rejecting an unsupported-but-valid value: leave the enum alone and add a finding in `checkCompatibility`.
- Authoring eval cases: `armature eval validate` parses each case with `EvalCase` and reports
  `Issue`s with file paths.

## Rules & Constraints

- Public contracts (schemas, ARC, eval case format) change only with an ADR in `docs/adr/`.
- Keep objects `.strict()`; the schema package must stay free of Node-only APIs.
- IDs follow regexes exported from the schema (`SLUG`, `TOOL_NAME`, `CASE_ID`).
- Never hand-edit `schemas/*.json`; they are build output of `pnpm schemas`.

## Common Gotchas

- Forgetting `pnpm schemas` makes CI fail on the `git diff --exit-code schemas` step.
- Compatibility errors (`checkCompatibility`, `packages/core/src/compat.ts:46`) cover non-python language,
  unsupported framework, pattern, python version, provider and session backend.
- `AgentSpecInput` (pre-default) and `AgentSpec` (post-default) differ; `specFromFlags` returns the input type.
- A value that passes the schema can still be unsupported (`exit 2`), which is different from invalid (`exit 1`).

## Anti-Patterns

- Re-declaring spec shapes as ad hoc interfaces in other packages.
- Loosening a schema to tolerate a typo instead of improving the error message.

## Related Patterns

- [Error and exit-code model](error-and-exit-codes.md) turns `SchemaError` into exit 1.
- [Eval case lifecycle](eval-case-lifecycle.md) relies on the eval schemas and hashes validated cases.
- [Deterministic generation](deterministic-generation-and-catalog.md): the compatibility step runs after parse.

## Background

ADR 0001 sets the package layout; the PRD referenced in `AGENTS.md` is the product contract that these
schemas encode.

## Modules Using This Pattern

- [schema](../modules/schema.md)
- [core](../modules/core.md)
- [evals](../modules/evals.md)
- [cli](../modules/cli.md)
- [arc](../modules/arc.md)
- [repo-tooling](../modules/repo-tooling.md)

## Related Patterns (Why They Connect)

- [arc-contract-and-client](arc-contract-and-client.md): the one runtime boundary.
- [eval-case-lifecycle](eval-case-lifecycle.md): cases move DRAFT to VERIFIED to frozen.

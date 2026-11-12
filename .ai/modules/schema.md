# Module: schema (`@armature/schema`)

## Purpose & Scope

### What This Module Does

`packages/schema` owns the zod definitions for every user-authored file Armature reads and for the JSON
Schemas it publishes: `armature.yaml` (`AgentSpec`), `evals/evalspec.yaml` (`EvalSpec`), eval case files
(`EvalCase`) and reference trajectories (`ReferenceTrajectory`). It also provides the one error type for bad
input (`SchemaError`) and the parse helpers that turn YAML text into validated, defaulted objects.

Everything downstream (core, evals, cli) treats a parsed `AgentSpec` as trusted. Strict objects
(`.strict()`) reject unknown keys, so typos in `armature.yaml` fail loudly rather than being ignored.

### Boundaries

- IN: field shapes, enums, defaults, cross-field rules (`superRefine`), regexes for slugs, tool names and
  case ids, the JSON Schema export, `SchemaError` formatting.
- OUT: deciding whether a spec is *supported* by the generator (that is `core/src/compat.ts`, see
  [core.md](core.md)); reading files from disk (core's `loadSpec`, evals' `loadBenchmark`); the ARC wire
  schemas (those live in `packages/arc/src/types.ts`, see [arc.md](arc.md)).
- The schema deliberately accepts more than P0 can generate (all five `Interface` values, four `Pattern`
  values, ten `KnownFramework` entries). Rejection is core's job, so the error carries a clear exit code 2
  message instead of a parse failure.

## Key Components

| Symbol | Location | Role |
| --- | --- | --- |
| `AgentSpec` | `../../packages/schema/src/agent-spec.ts:76` | The `armature.yaml` contract |
| `Framework`, `KnownFramework`, `Pattern`, `Provider`, `Interface` | `../../packages/schema/src/agent-spec.ts:6` | Enums; `Framework` is the two P0 targets, `KnownFramework` adds 8 more names that compat rejects |
| `CustomTool`, `ToolArg`, `SideEffect` | `../../packages/schema/src/agent-spec.ts:25` | Tool declarations with `none/read/write/destructive` side effects |
| `Intent`, `Example`, `Limits` | `../../packages/schema/src/agent-spec.ts:47` | Purpose text, examples seeded into evals, run limits |
| `EvalSpec` | `../../packages/schema/src/eval.ts:156` | Objectives, suites, gates, targets, run policy, provenance |
| `EvalCase` | `../../packages/schema/src/eval.ts:97` | One benchmark case: input, graders, trust, origin |
| `Grader` union | `../../packages/schema/src/eval.ts:76` | `output`, `constraint`, `state`, `judge`, `custom`; `P0_GRADERS` is only output and constraint |
| `ReferenceTrajectory`, `ReferenceStep` | `../../packages/schema/src/eval.ts:124` | Known-good tool/answer sequences used to validate cases |
| `SchemaError`, `parseWith`, `parseYamlText` | `../../packages/schema/src/index.ts:14` | Error type and helpers |
| `parseAgentSpec`, `parseEvalSpec`, `parseEvalCase`, `parseReference` | `../../packages/schema/src/index.ts:47` | Named entry points with default source labels |
| `jsonSchemas()` | `../../packages/schema/src/index.ts:56` | Produces the four published JSON Schemas |

## API Surface

Everything is re-exported from `packages/schema/src/index.ts`, so consumers import from `@armature/schema`.

- Types: `AgentSpec` (parsed output), `AgentSpecInput` (`z.input`, used by the CLI when it builds a spec from
  flags), `CustomTool`, `SideEffect`, `EvalCase`, `EvalSpec`, `Grader`, `ReferenceStep`, `ReferenceTrajectory`.
- Constants: `SLUG` (`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`), `TOOL_NAME` (`^[a-z][a-z0-9_]{0,63}$`), `CASE_ID`
  (`^[a-z0-9][a-z0-9-]{0,79}$`), `P0_GRADERS`, `REFUSAL_CATEGORIES`.
- Functions: `parseWith(schema, value, source)`, `parseYamlText(text, source)`, the four `parse*` helpers,
  `jsonSchemas()`.
- Errors: `SchemaError { source, issues[{path, message}] }`. Its message lists one `- path: message` line per
  issue and the CLI prints it verbatim (see [error-and-exit-codes](../patterns/error-and-exit-codes.md)).

## Dependencies

### Internal Modules

None. `schema` is a leaf; `core`, `evals`, `cli`, `arc` (indirectly through `SideEffect` duplication, see
Gotchas) and the root script `scripts/export-schemas.ts` depend on it.

### External Services

None. npm dependencies are `zod` (v4 API: `z.toJSONSchema`, `z.literal`, `.loose()`) and `yaml`.

### Patterns Used

- [schema-first-contracts](../patterns/schema-first-contracts.md): the schema is the source of truth, the JSON
  Schemas in `schemas/` are generated and diff-checked in CI.
- [error-and-exit-codes](../patterns/error-and-exit-codes.md): `SchemaError` maps to exit 1.

## Data Flow

```
armature.yaml text -> parseYamlText -> unknown -> AgentSpec (zod safeParse + superRefine) -> AgentSpec
                                                           \-> SchemaError { source, issues[] }
```

`core/src/compile.ts:36` (`parseSpecText`) calls `parseYamlText` then `parseAgentSpec`. Evals call
`parseEvalSpec` and `parseEvalCase` from `packages/evals/src/load.ts`. `scripts/export-schemas.ts` calls
`jsonSchemas()` and `arcSchemas()` and writes `schemas/*.json`.

## Key Behaviors

### Parsing an `armature.yaml`

1. `parseYamlText` runs `yaml.parse` with `prettyErrors`. A YAML syntax error becomes a `SchemaError` with
   path `""` and message `not valid YAML: ...`.
2. `parseWith(AgentSpec, value, source)` runs `safeParse`. Defaults are filled in here: for example
   `interfaces` defaults to `terminal, web_playground, rest_openapi, sse`, approvals default to `require` for
   both `write` and `destructive`, and `capabilities.session_memory` defaults to enabled with the `memory`
   backend.
3. Three `superRefine` rules run last: structured output enabled needs a `schema`; custom tool names must be
   unique; `openai_compatible` needs `model.base_url`.
4. On failure, zod issues are flattened to `{path: "a.b.c", message}`.

### Error scenarios

- Unknown key anywhere: `Unrecognized key` issue, because every object is `.strict()` (the exception is
  `capabilities.rag`, which uses `.catchall(z.unknown())` because RAG is not built).
- `schema_version` other than `1`: literal mismatch.
- `name` not matching `SLUG`: message `name must be a lowercase slug (letters, digits, hyphens), 3-64
  characters`.

### Why This Flow

Validation happens once at the edge so that templates, planners and graders can assume shape. Returning all
issues at once (not the first) lets the CLI show a complete fix list.

## Configuration

No runtime configuration. Related files: `schemas/armature.schema.json`, `schemas/evalspec.schema.json`,
`schemas/eval-case.schema.json`, `schemas/reference.schema.json` (generated, committed, outside the context-map
source roots). Regenerate with `pnpm schemas`; CI runs `pnpm schemas --check` in the `check` job
(`../../.github/workflows/ci.yml`).

## Testing

`packages/schema/test/schema.test.ts` covers defaults, strictness, the three superRefine rules, and the JSON
Schema export. Run with `pnpm test` (root vitest, `packages/*/test/**/*.test.ts`). See
[testing-conventions](../patterns/testing-conventions.md).

## Performance Considerations

Parsing is synchronous and runs once per command; spec files are small. `jsonSchemas()` is only called by the
schema export script.

## Gotchas & Constraints

### Never Do This

- Never change a field, enum, default or regex without an ADR in `docs/adr/`: the schema is a public contract
  (see `../../AGENTS.md`). Regenerate `schemas/*.json` in the same change.
- Never add a runtime import of `@armature/*` into generated Python projects; schema stays TypeScript-only.

### Always Do This

- Add `.strict()` to new objects so typos fail.
- Put cross-field checks in `superRefine` with a precise `path` so editors point at the right line.

### Common Mistakes

- Assuming a value accepted by the schema is generatable: `workflow`, `supervisor`, `rag_chat`, `websocket`,
  `typescript` and the eight extra frameworks parse fine and are rejected later by `checkCompatibility`.
- Using `z.infer` where the CLI needs `z.input`: `specFromFlags` returns `AgentSpecInput` because defaults are
  not yet applied.
- `SideEffect` is defined twice, in `agent-spec.ts:21` and in `packages/arc/src/types.ts:6`, with the same
  values. Keep them in sync.

### Edge Cases

- `capabilities.structured_output` accepts a boolean and is preprocessed into `{enabled: bool}`.
- `graders.defaults` accepts `outcome` as a synonym of `output`.
- Case `trials` is capped at 50; `concurrency` at 32.

### Business Rules

- Approvals default to `require` for write and destructive tools; generated runtime enforces this (see
  [generated-runtime-adapter](../patterns/generated-runtime-adapter.md)).
- `telemetry.capture_content` defaults to false; `run_policy.outbound_trace_export` can only be `disabled`.
- `run_policy.tool_mode` can only be `sandbox`.

## Security Considerations

The schema never stores secrets: `model.api_key_env` and tool `auth_env` hold environment variable *names*
(regex `^[A-Z][A-Z0-9_]*$`), never values. `telemetry.capture_content: false` by default keeps prompts out of
traces.

## Features Implemented

- [init](../features/init.md) builds a spec and validates it through this module.
- [generate-and-sync](../features/generate-and-sync.md) loads and validates the spec before rendering.
- [plan](../features/plan.md) shows the validated, defaulted spec projection.
- [eval-validate-and-freeze](../features/eval-validate-and-freeze.md) validates eval specs and cases.

## Related Documentation

- Patterns: [schema-first-contracts](../patterns/schema-first-contracts.md),
  [error-and-exit-codes](../patterns/error-and-exit-codes.md),
  [eval-case-lifecycle](../patterns/eval-case-lifecycle.md).
- Modules: [core](core.md), [evals](evals.md), [cli](cli.md), [arc](arc.md).
- Architecture: [module-interactions](../architecture/module-interactions.md).
- Source: `../../packages/schema/src/agent-spec.ts`, `../../packages/schema/src/eval.ts`,
  `../../packages/schema/src/index.ts`.

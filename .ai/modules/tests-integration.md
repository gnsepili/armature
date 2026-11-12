# Module: tests-integration

## Purpose & Scope

### What This Module Does

`tests-integration/` holds slow end-to-end tests that generate real projects for each P0 framework, install them
with `uv`, run their own pytest suites, serve them for ARC conformance, and drive the CLI in process. They run
offline against the mock LLM once uv has cached the pinned wheels.

### Boundaries

- IN: `harness.ts`, `langgraph.test.ts`, `openai-agents.test.ts`, `vitest.config.ts`.
- OUT: unit tests (they live in each package's `test/` directory, run by `pnpm test`).
- Do not read or commit `tests-integration/.out` (generated projects). The suite is skipped when `uv` is absent
  (`describe.skipIf(!hasUv())`).

## Key Components

| Symbol | Location | Role |
| --- | --- | --- |
| `OUT`, `PYTHON` | `../../tests-integration/harness.ts:14` | Output dir (`ARMATURE_IT_OUT`, default `.out`) and Python version (`ARMATURE_IT_PYTHON`, default 3.12) |
| `hasUv` | `harness.ts:18` | Skip guard |
| `generateProject` | `harness.ts:22` | Writes `armature.yaml` as JSON, forces python_version, calls `generate` |
| `install`, `pytest` | `harness.ts:33`, `:39` | `uv venv`, `uv pip install -e .[dev]`; project pytest |
| `conformance`, `summary` | `harness.ts:49`, `:73` | Two apps (eval mode on and off) plus mock; `runConformance` |
| `evalCli`, `armature` | `harness.ts:78`, `:83` | In-process CLI runs |

## API Surface

Test-only helpers; nothing is published.

## Dependencies

### Internal Modules

`arc` (`runConformance`), `core` (`generate`, `launchApp`, `venvPython`), `mock-llm`, and `cli` (`run`), imported
by relative source paths.

### External Services

`uv`, a Python 3.11 to 3.13 toolchain, and pinned wheels from the package index on first install. No model key.

### Patterns Used

[testing-conventions](../patterns/testing-conventions.md), [mock-llm-scripted-testing](../patterns/mock-llm-scripted-testing.md),
[app-process-launching](../patterns/app-process-launching.md).

## Data Flow

```
spec object -> generateProject (armature.yaml + generate) -> install (uv) -> pytest(project)
            -> conformance (mock + 2 apps -> runConformance) -> evalCli validate/run smoke --offline
            -> armature test / doctor in process
```

## Key Behaviors

1. `beforeAll` generates and installs once per framework.
2. Each project's generated tests must pass.
3. ARC conformance must pass: all seven checks (see [arc.md](arc.md)).
4. `eval validate` exits 0 and `eval run --suite smoke --offline` exits 0 and prints `PASS`.
5. `armature test` exits 0 and prints "all tests passed"; `armature doctor` passes without a model key.

### Error scenarios

Failed assertions include the conformance summary and captured app logs, so CI output explains the cause.

### Why This Flow

It proves the generated Python works with the pinned framework versions, which unit tests cannot.

## Configuration

`vitest.config.ts`: includes `tests-integration/**/*.test.ts`, 600 s test and hook timeouts, no file
parallelism. Run with `pnpm test:integration`. CI sets `ARMATURE_IT_OUT` to a path with spaces and a Python
matrix of 3.11, 3.12, 3.13.

## Testing

This module is the tests. Unit tests: `pnpm test`.

## Performance Considerations

Slow (install plus servers). Serial by design, because apps and the mock bind ports.

## Gotchas & Constraints

### Never Do This

- Never add these tests to the default `pnpm test` run.

### Always Do This

- Keep output paths space-safe; CI relies on it.

### Common Mistakes

- Running with a stale `.out` directory; `generateProject` removes the project dir first.

### Edge Cases

- Missing `uv` skips the suites silently.

### Business Rules

- Generated projects must run offline with the mock.

## Security Considerations

No secrets are used; the mock replaces the provider.

## Features Implemented

Verifies [init](../features/init.md), [generate-and-sync](../features/generate-and-sync.md),
[test](../features/test.md), [doctor](../features/doctor.md), [eval-run](../features/eval-run.md),
[arc-http-api](../features/arc-http-api.md) end to end.

## Related Documentation

[arc](arc.md), [core](core.md), [cli](cli.md), [repo-tooling](repo-tooling.md).

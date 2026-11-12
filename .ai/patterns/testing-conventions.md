# Pattern: Testing Conventions (vitest, golden templates, generated pytest)

## Overview

Armature is tested at four levels: unit tests per package (vitest, `packages/*/test/**/*.test.ts`),
in-process CLI tests through the `Io` abstraction, golden/template tests that render projects without writing
them, and slow integration tests that generate real Python projects, install them with uv and run their own
pytest suites plus ARC conformance. Generated projects also ship pytest suites that check ARC and guardrails.

## Purpose

- Keep the fast loop (`pnpm test`) offline and under seconds per file.
- Catch template drift and runtime regressions where users would feel them: in the generated Python project.
- Make the contract (ARC, exit codes, lock behaviour) executable.

## Where Used

- Root config: `vitest.config.ts` (includes `packages/*/test/**/*.test.ts`, timeout 30 s).
- Integration config: `tests-integration/vitest.config.ts` (timeouts 600 s, no file parallelism).
- Harness: [`generateProject`, `install`, `pytest`, `conformance`](../../tests-integration/harness.ts:22).
- CLI helpers: [`cli`, `testIo`, `tempDir`](../../packages/cli/test/helpers.ts:38).
- Template tests: `packages/core/test/langgraph-templates.test.ts`,
  `openai-agents-templates.test.ts`, `handoff.test.ts`, `render.test.ts`, `lock-write.test.ts`.
- Reference ARC server for conformance: `packages/arc/test/reference-server.ts`.
- Generated pytest templates: `packages/adapters/templates/common/tests/`.
- CI: `.github/workflows/ci.yml` (check, unit matrix, integration matrix).
- Modules: [tests-integration](../modules/tests-integration.md), [cli](../modules/cli.md), [adapters](../modules/adapters.md).

## Implementation Details

- Commands: `pnpm test`, `pnpm test:watch`, `pnpm typecheck`, `pnpm lint` (Biome), `pnpm schemas`,
  `pnpm test:integration`.
- CLI tests call `run(argv, io)` with an in-memory `Io`, `NO_COLOR` set and `interactive: false`.
- Template tests render in memory with `renderWithLock` or `generate({ dryRun })` and assert on file contents.
- Integration tests skip when `uv` is missing (`hasUv`), generate into `tests-integration/.out` (or
  `ARMATURE_IT_OUT`), run `uv venv` and `uv pip install -e .[dev]`, run `python -m pytest`, then launch the app
  twice (eval mode on and off) against a mock LLM and run ARC conformance.
- Generated `test_arc.py` covers health/manifest, text and tool-call runs, stream well-formedness, approval
  approve and deny, limits, model error, eval metadata gating and session memory; `test_guardrails.py` covers
  approval policy, write tools never running for real in eval mode, edited approval args, no double-resume,
  limits, timeouts, tool errors and structured output repair.
- `armature test` runs golden drift, unit pytest (with `ARMATURE_EVAL_MODE=0`) and conformance in a project.

## Code Example

```ts
const r = await cli(dir, ["generate", "--json"]);
expect(r.code).toBe(0);
expect(r.json().ok).toBe(true);
```

## Common Scenarios

- Changing a template: update the template tests, bump `TEMPLATE_VERSION` if output changes, run
  `pnpm test` and then (locally) `pnpm test:integration`.
- Adding a command: add a test using `cli()` and cover `--json` plus exit codes.
- Changing the spec schema: run `pnpm schemas` and commit the diff.

## Rules & Constraints

- Unit tests must not need network, Python or uv.
- Integration tests are slow; do not run them in tight loops. CI runs them on three OSes and Python 3.11-3.13
  in directories with spaces to catch path bugs.
- Do not read or commit `tests-integration/.out`.

## Common Gotchas

- Windows path separators: templates normalize with `/`; keep it that way in assertions.
- The harness writes the spec as JSON (valid YAML) to avoid a YAML dependency.
- Integration conformance needs both mock-mode runs; do not reuse a session DB between them.

## Anti-Patterns

- Tests that call `process.exit` or read the developer's real environment variables.
- Asserting on timestamps or ordering that the generator does not guarantee.

## Related Patterns

- [Io abstraction](io-abstraction-testable-cli.md), [Mock LLM testing](mock-llm-scripted-testing.md) and
  [ARC contract](arc-contract-and-client.md) supply the fixtures.
- [Ownership lock](ownership-lock-and-templates.md) is what the golden tests exercise.

## Background

ADR 0006 (`docs/adr/0006-doctor-and-test.md`) defines `armature test`; CI is `.github/workflows/ci.yml`.

## Modules Using This Pattern

- [tests-integration](../modules/tests-integration.md)
- [cli](../modules/cli.md)
- [repo-tooling](../modules/repo-tooling.md)

## Related Patterns (Why They Connect)

- [io-abstraction-testable-cli](io-abstraction-testable-cli.md): keeps commands testable without a process.
- [mock-llm-scripted-testing](mock-llm-scripted-testing.md): offline determinism.

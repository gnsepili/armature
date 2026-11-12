# Contributing to Armature

Thanks for helping. Armature is small on purpose: it compiles a spec into a plain project and
then gets out of the way. Most good contributions make the generated project better, the
benchmark more honest, or the CLI easier to script.

## Before you start

- **Bugs:** open an issue with the bug template. Include `armature --version`, your OS, and
  `armature doctor --json` output if the problem is in a generated project.
- **Features:** open a feature request first. Anything that touches a public contract (the
  `armature.yaml` or eval schemas, ARC, the eval case format, CLI flags or exit codes) needs an
  [ADR](docs/adr/) and is easier to agree on before code exists.
- **New frameworks or patterns:** start a discussion in an issue. Each one needs verified version
  pins and a conformance-passing template, which is real work to maintain.

## Setup

Requires Node 22+, pnpm 12, and [uv](https://docs.astral.sh/uv/) for the integration tests.

```bash
pnpm install
pnpm test                 # unit tests, a few seconds
pnpm typecheck && pnpm lint
pnpm test:integration     # generates, installs and tests real Python projects (~2 min)
```

Run the CLI from source with `pnpm exec tsx packages/cli/src/bin.ts <command>`, or build the
bundle with `pnpm build` and run `node packages/cli/dist/armature.js`.

## Where things live

| Package               | What it does                                                    |
| --------------------- | --------------------------------------------------------------- |
| `packages/schema`     | Zod schemas for `armature.yaml`, `evalspec.yaml` and eval cases |
| `packages/core`       | compile, plan, render, lockfile, safe writes, catalogs          |
| `packages/adapters`   | framework templates and the Python runtime copied into projects |
| `packages/arc`        | the runtime contract, its client and the conformance suite      |
| `packages/evals`      | benchmark loading, lint, runner, graders, reports, freeze       |
| `packages/handoff`    | `AGENTS.md`, `CLAUDE.md` and skills for coding agents           |
| `packages/mock-llm`   | scripted OpenAI-compatible server for offline runs              |
| `packages/playground` | the static web playground                                       |
| `packages/cli`        | commands and the published `armature-agents` bundle             |

Coding agents (and people who like maps) can start at [AGENTS.md](AGENTS.md) and `.ai/agents.md`.

## Rules that keep the project honest

- Generated projects never import an Armature package.
- Generation is deterministic: no timestamps, random IDs or machine paths in managed files. The
  golden tests will tell you if you break this.
- Never invent framework APIs or model IDs. Pin only what you verified, in
  `packages/core/catalog/versions.json` and `models.json`, and say how you verified it in the PR.
- If you change `packages/schema`, run `pnpm schemas` and commit the regenerated `schemas/`.
- Template changes need a passing `pnpm test:integration` for the framework you touched.

## Pull requests

- Keep PRs focused; one behaviour change per PR is easiest to review.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for titles
  (`feat(cli): …`, `fix(adapters): …`, `docs: …`).
- Add or update tests. Bug fixes should come with a test that fails without the fix.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under _Unreleased_ for user-visible changes.

By contributing you agree that your contributions are licensed under the
[MIT license](LICENSE), and that you will follow the [code of conduct](CODE_OF_CONDUCT.md).

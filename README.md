# Armature

An armature is the skeleton a sculptor builds before adding clay. This CLI builds the
skeleton of an AI agent, plus a benchmark written before the agent exists. Your coding agent
(Claude Code or Codex) adds the clay.

```bash
npx armature-agents init support-bot
```

You describe the agent in `armature.yaml`: framework, model, tools, memory, approvals. Armature
compiles that into a plain Python project for **LangGraph** or the **OpenAI Agents SDK**. The
project runs right away on a bundled mock model, has no Armature runtime dependency, and
includes:

- an HTTP server speaking one runtime contract (ARC), so the playground, chat, eval runner
  and conformance suite work the same for every framework;
- a seed benchmark (`evals/`), with every case marked `DRAFT_UNVERIFIED` until a person
  reviews it;
- generated unit tests, a CI workflow that needs no model key, and a handoff kit
  (`AGENTS.md`, `CLAUDE.md`, skills) that tells the coding agent how to build against the
  benchmark without gaming it.

Armature is not an agent framework, a hosted platform or an LLM wrapper. It makes sure the
skeleton is valid, runs, and reports honestly what is done. Credentials, real tool
implementations and security decisions are still yours.

## Quickstart

Requires Node 22+, and [uv](https://docs.astral.sh/uv/) with Python 3.11–3.13 for the generated
project.

```bash
npx armature-agents init support-bot --yes \
  --tool lookup_order:read:order_id \
  --tool issue_refund:write:order_id,amount
cd support-bot
uv sync --extra dev
npx armature-agents dev --offline     # playground on the mock model; no key needed
npx armature-agents test              # golden scaffold, unit tests, ARC conformance
```

With a key in `.env` (see `.env.example`), run `armature doctor --probe` and then
`armature dev` against the real model.

## The workflow

1. **Spec.** `init` writes `armature.yaml` and generates the project. Edit the spec and run
   `armature generate`. Managed files are regenerated; files you edited, and files Armature
   only writes once (tool bodies, prompts, README), are left alone.
2. **Benchmark first.** `armature eval plan` shows what the benchmark covers and what is left
   to do. Grow the `dev` suite, review each case, set `trust: VERIFIED`, then
   `armature eval freeze`. From then on, every report says whether the cases changed.
3. **Build.** Open Claude Code or Codex in the project. The `build-agent` skill implements
   tools and prompts one change at a time, running `armature eval run` after each.
4. **Prove it.** Compare runs with `armature eval compare`. Live runs are capped by
   `--max-cost`. A held-out suite kept outside the repo reports aggregates only, so it can catch
   overfitting.

Offline runs use the mock model and are labelled `MOCK`: they check wiring, not quality.
Draft cases are reported but never gate.

## Commands

| Command                                                       | Does                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `init`                                                        | Wizard or flags → `armature.yaml` and a generated project            |
| `generate`                                                    | Re-render managed files from the spec                                |
| `plan`                                                        | Spec, architecture, compatibility status and tasks                   |
| `sync`                                                        | Refresh the coding-agent handoff kit                                 |
| `dev` / `chat`                                                | Local playground / terminal chat against the running app             |
| `doctor`                                                      | Toolchain, pins, secrets; `--conformance`, `--probe` (one paid call) |
| `test`                                                        | Golden scaffold, generated unit tests, ARC conformance               |
| `eval plan \| validate \| run \| report \| compare \| freeze` | The benchmark loop                                                   |

Every command takes `--json` and runs without a terminal. Exit codes: 0 ok, 1 validation,
2 unsupported, 3 overwrite refused, 4 eval gate failed, 5 environment. See the
[CLI reference](docs/cli.md).

## Scope

This is an alpha. Supported today: Python, LangGraph and the OpenAI Agents SDK, one agent with
tools, OpenAI, Anthropic and OpenAI-compatible providers, in-memory or SQLite session memory,
approvals for write and destructive tools, and structured output. Framework versions and model
IDs are pinned to what was verified, in
[`versions.json`](packages/core/catalog/versions.json) and
[`models.json`](packages/core/catalog/models.json). Other models need `--experimental`.

Planned: workflow and supervisor patterns, more frameworks, MCP servers, and live-eval CI with
baselines.

## Design rules

- Generated projects never import an Armature package. Delete Armature and the project still
  runs.
- Generation is deterministic: the same spec and CLI version always produce the same bytes.
- Public contracts (schemas, ARC, the eval case format, CLI flags and exit codes) change only
  through an [ADR](docs/adr/).

## Development

```bash
pnpm install
pnpm test               # unit tests
pnpm test:integration   # generates, installs and tests real projects; needs uv
pnpm typecheck && pnpm lint
```

The workspace is in `packages/`: `schema` (spec and eval schemas), `core` (compiler, catalogs,
renderer), `adapters` (framework templates), `arc` (the runtime contract and conformance suite),
`mock-llm`, `evals`, `handoff`, `playground`, and `cli`, which bundles everything into the
`armature-agents` package. Coding agents start at [AGENTS.md](AGENTS.md).

## License

[Apache-2.0](LICENSE)

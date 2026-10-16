# Armature — contributor guide for coding agents

Armature is a TypeScript CLI (npm package `armature-agents`, binary `armature`) that compiles
`armature.yaml` into framework-native Python agent projects with an eval-first workflow.
The product contract is the PRD; P0 scope is LangGraph + OpenAI Agents SDK, single agent with tools.

## Commands

- `pnpm install` — install workspace dependencies (Node >= 22, pnpm 12)
- `pnpm test` — unit tests (vitest)
- `pnpm typecheck` / `pnpm lint` — TypeScript and Biome
- `pnpm schemas` — regenerate `schemas/*.json` after changing `packages/schema`

## Rules

- Generated projects must never import an Armature runtime package.
- Generation is deterministic: no timestamps, random IDs, or machine paths in managed files.
- Public contracts (schemas, ARC, eval case format, CLI flags, exit codes) change only with an ADR in `docs/adr/`.
- Never invent framework APIs or model IDs; pin what was verified in `versions.json` / `models.json`.

<!-- repo-context:start -->
## Repository context

For work in this repository, read `.ai/agents.md` when it exists and follow
`.agents/skills/repo-context/SKILL.md`. Load only the context relevant to the task.
Before completing code changes, reconcile affected `.ai` module, feature, pattern,
and architecture context with the code; update `.ai/context-map.json` for new or
removed source areas and validate it with the bundled checker. If no context
change is needed, report the reason. Preserve unrelated edits and repository rules.
For read-only tasks, report context drift without editing files. If `.ai` is absent,
initialize it only when setup is requested; start at Step 0 and complete the sequence.
For generation and maintenance, read the applicable full original prompts under
`.agents/skills/repo-context/prompts/` as routed by SKILL.md. Preserve their detailed
templates, walkthrough requirements, and verification checklists.
<!-- repo-context:end -->

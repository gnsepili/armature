# Pattern: The Handoff Kit (Instructions for Coding Agents)

## Overview

Alongside the Python project, Armature renders a "handoff kit" so a coding assistant can finish the build:
`AGENTS.md`, `CLAUDE.md` (imports AGENTS.md), `docs/` (spec, architecture, tool contracts, implementation
plan, build status), five Agent Skills under `.agents/skills/`, and docs-MCP configuration for the
assistant (`.mcp.json`, `.codex/config.toml`). `armature sync` refreshes the kit without touching the rest of
the project.

## Purpose

- Make the generated repository self-describing for Claude Code, Codex and generic agents.
- Keep user and agent edits to docs safe (generated-once) while skills and instructions can be refreshed.
- Encode the eval-first workflow as skills: `build-agent`, `add-tool`, `build-benchmark`, `debug-run`,
  `optimize-agent`.

## Where Used

- Layer location and path rules: [`handoffLayer`](../../packages/handoff/src/index.ts:30),
  [`isHandoffPath`](../../packages/handoff/src/index.ts:40).
- Claude skill mirroring: [`withSkillCopies`](../../packages/handoff/src/index.ts:76).
- Skill validation: [`validateSkill`](../../packages/handoff/src/index.ts:142), [`validateSkills`](../../packages/handoff/src/index.ts:166).
- Compile and sync: [`compile`](../../packages/core/src/compile.ts:47) (adds the handoff layer),
  [`generate`](../../packages/core/src/compile.ts:106) (`handoffOnly`), [`syncCommand`](../../packages/cli/src/commands/sync.ts:19).
- Templates: `packages/handoff/templates/` including `ownership.json`.
- Modules: [handoff](../modules/handoff.md), [core](../modules/core.md), [cli](../modules/cli.md).

## Implementation Details

- Canonical skills live in `.agents/skills/` (read by Codex and others). Claude Code reads only
  `.claude/skills/`, so `withSkillCopies` mirrors them there when `assistant.targets` includes `claude`.
- `withSkillCopies` respects user changes: when the canonical skill on disk was edited (hash differs from the
  lock) the edited content is mirrored instead of the rendered one unless `--force`; skills the user added are
  mirrored too.
- `isHandoffPath` defines what `sync` refreshes: `AGENTS.md`, `CLAUDE.md`, `.mcp.json`,
  `.codex/config.toml`, `docs/**`, `.agents/skills/**`, `.claude/skills/**`.
- Ownership (`handoff/templates/ownership.json`): `docs/AGENT_SPEC.md`, `ARCHITECTURE.md`,
  `TOOL_CONTRACTS.md`, `IMPLEMENTATION_PLAN.md` and `BUILD_STATUS.md` are generated-once.
- `sync` requires an existing `armature.lock` (otherwise exit 1) and preserves the lock's spec hash,
  template version and dependencies, since only handoff files are touched.
- The docs-MCP configs target the coding assistant (documentation lookup). They are not an Armature MCP
  server and not a runtime capability of the generated agent.

## Code Example

```ts
// packages/core/src/compile.ts (abridged): a sync only reconciles handoff paths
if (opts.handoffOnly && previous) {
  files = files.filter((f) => isHandoffPath(f.path));
}
```

## Common Scenarios

- `armature init` then `claude` and `/build-agent`: the skill drives the build with the user's spec.
- Armature upgrade: `armature sync` refreshes instructions and skills; edited skills are kept.
- Targets `codex` or `generic`: only the canonical `.agents/skills/` exist.

## Rules & Constraints

- Skills need valid frontmatter (name and description); the template tests call `validateSkills`.
- Skill text must not claim unimplemented features (workflow, supervisor, MCP servers, judges).
- Only a human may mark eval cases VERIFIED; the `build-benchmark` skill states this.

## Common Gotchas

- Editing `.claude/skills/*` directly is overwritten from `.agents/skills/`; edit the canonical copy.
- `.mcp.json` and `.codex/config.toml` are refreshed by sync, so local additions should go elsewhere.

## Anti-Patterns

- Adding assistant-specific logic to the Python runtime.
- Hand-editing `docs/` templates in generated projects expecting sync to merge changes.

## Related Patterns

- [Ownership lock](ownership-lock-and-templates.md) provides the mechanism.
- [Generated runtime adapter](generated-runtime-adapter.md) is what the skills teach the assistant to edit.
- [Eval case lifecycle](eval-case-lifecycle.md) is the workflow the benchmark skill describes.

## Background

ADR 0004 (`docs/adr/0004-handoff-kit-and-sync.md`) defines the kit and `sync`.

## Modules Using This Pattern

- [handoff](../modules/handoff.md)
- [core](../modules/core.md)
- [cli](../modules/cli.md)

## Related Patterns (Why They Connect)

- [ownership-lock-and-templates](ownership-lock-and-templates.md): both decide what generation may overwrite.

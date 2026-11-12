# Feature: Handoff kit

## What Users Can Do

- Give coding assistants (Claude, Codex) project instructions, docs and skills generated from the spec.

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

None. Files: AGENTS.md, CLAUDE.md, `.mcp.json`, `.codex/config.toml`, `docs/*`, and skills (add-tool, build-agent, build-benchmark, debug-run, optimize-agent).

## Components

`packages/handoff/src/index.ts` and templates.

## State Management

Tracked in `armature.lock`; docs are generated-once.

## Business Rules

- Skill names are 1-64 lowercase letters, digits, single hyphens, matching the directory; descriptions 1-1024 chars.
- The docs MCP config is for assistants only; agent MCP servers are not implemented.
- `sync` refreshes only handoff paths.

## User Flow

1. Render handoff templates with the plan.
2. `generate` writes them; `sync` refreshes them.

## Navigation Flow

[init](init.md) prints `claude` then `/build-agent`.

## Related Features

- [generate-and-sync](generate-and-sync.md)
- [init](init.md)

## Dependencies

None.

## Error Scenarios

Invalid skill frontmatter fails generation.

## Performance

Static templates.

## Modules Involved

- [handoff](../modules/handoff.md)
- [core](../modules/core.md)

## Patterns Used

- [handoff-kit](../patterns/handoff-kit.md)
- [ownership-lock-and-templates](../patterns/ownership-lock-and-templates.md)

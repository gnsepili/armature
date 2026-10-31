# ADR 0004 — Coding-agent handoff kit and `armature sync`

**Status:** Accepted

## Context

The PRD's handoff kit is what lets Claude Code or Codex finish a generated project: an
instruction file, a spec and plan in `docs/`, task-specific skills and access to the
framework's documentation while coding. Each assistant reads these from different places, and
the files go stale when `armature.yaml` changes. The file layout is part of what users and their
assistants depend on, and `sync` adds a CLI command, so both need a record.

## Decision

**Files.** Every project gets `AGENTS.md` (the canonical instructions) and
`docs/{AGENT_SPEC,ARCHITECTURE,TOOL_CONTRACTS,IMPLEMENTATION_PLAN,BUILD_STATUS}.md`. Skills
live in `.agents/skills/<name>/SKILL.md`, the Agent Skills location Codex reads:
`build-agent`, `add-tool`, `build-benchmark`, `optimize-agent` and `debug-run`, with
framework-specific `references/<framework>.md` where wiring differs.

**Per-assistant files**, chosen by `assistant.targets`:

- `claude`: `CLAUDE.md` (imports `AGENTS.md` with `@AGENTS.md`), a managed copy of every skill
  in `.claude/skills/` (Claude Code does not read `.agents/skills`), and `.mcp.json` with the
  framework's documentation MCP server when `assistant.docs_mcp` is on.
- `codex`: `.codex/config.toml` with the same docs server under `[mcp_servers.<name>]`. Codex
  reads it only in trusted projects.

The docs servers are hosted HTTP endpoints: `https://docs.langchain.com/mcp` for LangGraph and
`https://developers.openai.com/mcp` for the OpenAI Agents SDK. They are build-time help for the
coding assistant, not part of the agent's runtime.

**Ownership.** `AGENTS.md`, `CLAUDE.md`, skills and the MCP configs are managed: regenerated,
but kept when edited unless `--force`. The five `docs/` files are generated once: created when
missing and never overwritten, because the assistant and the human edit them as work
progresses (the plan's checkboxes, the build status labels). A skill the user edits in
`.agents/skills/`, or one they add there, is what gets copied to `.claude/skills/`, so the two
trees never disagree.

**`armature sync [dir]`.** Re-renders only the handoff files (the paths above) from the current
`armature.yaml`, with the same keep-your-edits rules and flags as `generate` (`--spec`,
`--force`, `--dry-run`, `--experimental`, `--verbose`, `--json`). Runtime code, tools, tests and
evals are not touched, and their entries in `armature.lock`, along with the lock's
`spec_sha256`, `template_version` and `dependencies`, are carried over unchanged, so a later
`generate` still sees the runtime as out of date if the spec moved. `sync` needs an existing
`armature.lock` (exit 1 otherwise). `--json` has the same shape as `generate` with
`command: "sync"`.

**Skill frontmatter** follows the Agent Skills rules: `name` is 1–64 lowercase letters, digits
and single hyphens and matches its directory; `description` is 1–1024 characters. Armature's
own tests check every rendered skill against these rules.

## Consequences

- Editing a skill and running `sync` is the supported way to keep Claude Code's copy current.
- A project generated for one assistant can add another by editing `assistant.targets` and
  running `sync`.
- The docs MCP URLs are third-party endpoints; if one moves, it is a template change, not a
  contract change.

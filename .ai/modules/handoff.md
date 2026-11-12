# Module: handoff (`@armature/handoff`)

## Purpose & Scope

### What This Module Does

`packages/handoff` carries the coding-agent handoff kit: the files that let Claude Code, Codex or another
Agent Skills client continue the work inside a generated project. The kit is a Handlebars template layer
(`AGENTS.md`, `CLAUDE.md`, `docs/*.md`, five skills, and docs-MCP config) plus a small TypeScript API for
locating that layer, recognizing which generated paths belong to it, mirroring skills for Claude Code, and
validating skill frontmatter.

`core` renders the handoff layer through the same pipeline as the adapter templates
(`[...templateLayers(framework), handoffLayer()]`). `armature sync` refreshes only these paths.

### Boundaries

- IN: handoff templates, `handoffLayer()`, `isHandoffPath()`, `withSkillCopies()`, `validateSkill(s)`,
  `frontmatter()`, and the `ownership.json` that makes the five `docs/*.md` files generated-once.
- OUT: rendering and writing (core, see [core.md](core.md)); the runtime code (adapters, see
  [adapters.md](adapters.md)); the repo-context skill under `.agents/skills/repo-context` that maintains
  this very `.ai/` folder (not shipped to generated projects; see [repo-tooling.md](repo-tooling.md)).
- The "docs MCP" files (`.mcp.json`, `.codex/config.toml`) point coding assistants at framework
  documentation servers. They are not an agent runtime MCP integration; MCP servers for the agent itself are
  not implemented.

## Key Components

| Symbol or file | Location | Role |
| --- | --- | --- |
| `CANONICAL_SKILLS`, `CLAUDE_SKILLS` | `../../packages/handoff/src/index.ts:14` | `.agents/skills/` and `.claude/skills/` prefixes |
| `HandoffFile` | `../../packages/handoff/src/index.ts:19` | Structural copy of core's `RenderedFile` (core depends on this package, not the reverse) |
| `handoffLayer()` | `../../packages/handoff/src/index.ts:30` | Finds `templates/` in source or `handoff/` in the bundle |
| `isHandoffPath()` | `../../packages/handoff/src/index.ts:40` | True for `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `.codex/config.toml`, `docs/**`, and both skill trees |
| `withSkillCopies()` | `../../packages/handoff/src/index.ts:76` | Adds managed `.claude/skills/**` copies of canonical skills |
| `frontmatter()`, `validateSkill()`, `validateSkills()` | `../../packages/handoff/src/index.ts:123` | Agent Skills rules check |
| `templates/AGENTS.md.hbs`, `templates/CLAUDE.md.hbs` | `../../packages/handoff/templates/` | Project instructions rendered from the plan |
| `templates/docs/*.md.hbs` | `AGENT_SPEC`, `ARCHITECTURE`, `BUILD_STATUS`, `IMPLEMENTATION_PLAN`, `TOOL_CONTRACTS` | Generated-once project docs |
| `templates/dot_agents/skills/*` | `add-tool`, `build-agent`, `build-benchmark`, `debug-run`, `optimize-agent` | The five skills; `add-tool` and `debug-run` have per-framework `references/*.md.hbs` |
| `templates/dot_mcp.json.hbs`, `templates/dot_codex/config.toml.hbs` | | Docs MCP config, conditional on `assistant.docs_mcp` and `assistant.targets` |

## API Surface

- `handoffLayer(): string` - absolute path of the template directory.
- `isHandoffPath(path: string): boolean` - the set that `sync` refreshes.
- `withSkillCopies(files, { targets, dir?, previous?, force? }): HandoffFile[]` - pure when `dir` is
  omitted (used by `compile` and golden tests); with `dir` it reads canonical skills from disk.
- `validateSkill(path, content): SkillIssue[]` and `validateSkills(files)`.
- `frontmatter(content): Record<string,string> | null`.

## Dependencies

### Internal Modules

None. `core` and the CLI build script depend on it.

### External Services

None at build or run time. The rendered `.mcp.json` names `https://docs.langchain.com/mcp` (LangGraph) or
`https://developers.openai.com/mcp` (OpenAI Agents) for the *assistant* to read documentation; Armature
itself never calls them.

### Patterns Used

[handoff-kit](../patterns/handoff-kit.md), [ownership-lock-and-templates](../patterns/ownership-lock-and-templates.md),
[deterministic-generation-and-catalog](../patterns/deterministic-generation-and-catalog.md).

## Data Flow

```
templates/*.hbs --renderProject (core)--> RenderedFile[] --withSkillCopies--> + .claude/skills/** copies
   --sync filter: isHandoffPath--> applyFiles (previous lock entries limited to handoff paths)
   --> AGENTS.md, CLAUDE.md, docs/*, .agents/skills/**, .claude/skills/**, .mcp.json, .codex/config.toml
```

## Key Behaviors

### Skill mirroring (`withSkillCopies`)

1. If the spec's `assistant.targets` lacks `claude`, files are returned unchanged.
2. Canonical skills are collected from the rendered files.
3. With a project directory, each file under `.agents/skills/` on disk is examined. A skill file that
   Armature does not render (the user added it) is mirrored from disk. A rendered file whose on-disk hash
   differs from the lock hash (the user edited it) wins over the template unless `force` is set.
4. Every canonical path gets a managed `.claude/skills/...` copy. Because copies are managed, a copy whose
   canonical file disappears becomes an orphan and is removed (or kept if edited).

### Running `sync`

`generate({ handoffOnly: true })` filters rendered files to `isHandoffPath`, limits the previous lock to the
same paths, applies them, and keeps all non-handoff lock entries untouched. The lock's `spec_sha256`,
`template_version` and `dependencies` stay as they were because sync leaves the runtime as generated.

### Error scenarios

- `sync` in a directory with no `armature.lock`: validation error telling the user to run `generate` first.
- A skill with bad frontmatter: reported by `validateSkills` (name must be 1-64 lowercase letters, digits and
  single hyphens, match the directory, and a description of 1-1024 characters is required).

### Why This Flow

The assistant instructions change more often than runtime code. Splitting them out lets a user refresh
guidance after upgrading Armature without touching tools, prompts or tests.

## Configuration

- Spec fields: `assistant.targets` (`claude`, `codex`, `generic`; default `claude, codex`) and
  `assistant.docs_mcp` (default true).
- Ownership: `templates/ownership.json` marks `docs/AGENT_SPEC.md`, `docs/ARCHITECTURE.md`,
  `docs/TOOL_CONTRACTS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/BUILD_STATUS.md` as `generated-once`; the
  instructions, skills and MCP config stay `managed`.

## Testing

`../../packages/handoff/test/handoff.test.ts` covers skill mirroring and validation; `../../packages/core/test/handoff.test.ts`
covers rendering the layer through `compile`. `../../packages/cli/test/sync.test.ts` covers the command.

## Performance Considerations

`withSkillCopies` with a directory walks only `.agents/skills/` and hashes with SHA-256; negligible.

## Gotchas & Constraints

### Never Do This

- Never make `handoff` import `core` (the dependency is one way; `HandoffFile` exists to avoid the cycle).
- Never render skill content that mentions a framework API not pinned in `versions.json`.

### Always Do This

- Keep skill `name` equal to its directory name.
- Describe skill triggers in `description`; assistants use it to decide when to load the skill.

### Common Mistakes

- Editing `.claude/skills/**` directly: copies follow the canonical `.agents/skills/**`, so edit those.
- Expecting `sync` to update `docs/*.md`: they are generated-once, so `sync` reports `skip-owned`.

### Edge Cases

- `.DS_Store` files are ignored when walking skills.
- CRLF in frontmatter is normalized before parsing.

### Business Rules

- Skills are canonical in `.agents/skills/` for Codex and copied to `.claude/skills/` for Claude Code.
- The five shipped skills cover the benchmark-first workflow: design, benchmark, build, debug and optimize.

## Security Considerations

The docs MCP entries are HTTP URLs of third-party documentation servers read by the assistant; they carry no
credentials. Codex only reads `.codex/config.toml` in trusted projects (stated in the template).

## Features Implemented

[handoff-kit](../features/handoff-kit.md), [generate-and-sync](../features/generate-and-sync.md),
[init](../features/init.md).

## Related Documentation

- Modules: [core](core.md), [adapters](adapters.md), [cli](cli.md).
- Patterns: [handoff-kit](../patterns/handoff-kit.md).
- ADR: `../../docs/adr/0004-handoff-kit-and-sync.md`.
- Architecture: [module-interactions](../architecture/module-interactions.md).

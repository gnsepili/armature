# `.ai` Repository Context

Structured, code-verified context for coding agents working on Armature.

## For LLM Agents: Navigation Workflow

1. Read [agents.md](agents.md) for the overview and maps.
2. Open the module doc for the area you touch (`modules/`), then the feature docs it lists (`features/`).
3. Open pattern docs (`patterns/`) before writing code that follows a repeated convention.
4. Use [architecture/module-interactions.md](architecture/module-interactions.md) for cross-module changes.
5. Treat the source as truth; if a doc disagrees, fix the doc.

## For Humans: Structure

```
.ai/
  agents.md                      index and conventions
  patterns/                      12 cross-cutting patterns
  modules/                       11 module docs
  features/                      13 feature docs (CLI commands, ARC, playground, handoff)
  architecture/module-interactions.md
  context-map.json               maps docs to source globs (validated)
```

No `data-model.md`: the CLI is stateless (see `context-map.json` `omitted_artifacts`).

## Maintenance

After code changes, update the affected docs and `context-map.json`, then run
`python3 .agents/skills/repo-context/scripts/context.py validate --repo .`. Process:
[update-context.md](../.agents/skills/repo-context/prompts/update-context.md).

## Testing

The validator checks that every source file under the source roots is mapped and every doc is listed. Run
`pnpm lint` too (Biome ignores `.ai`).

## Quality Metrics

Docs cite real paths and mark unimplemented features as not implemented. Known drift: ADR 0001 names tsup
while the build uses esbuild (ADRs are not rewritten after acceptance).

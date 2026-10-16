# Integrate the Full Maintenance Prompt

Read [../prompts/update-context.md](../prompts/update-context.md) completely and
execute its applicable requirements. This adapter adds diff selection, source
mapping, and portability; it does not replace the original maintenance prompt.

## Select changes and context

Record the task's starting commit and pre-existing edits. Read the target's
`.ai/agents.md`, source map, and relevant context. In a shared working tree,
select explicit task-owned paths so unrelated work is preserved.

```sh
python3 .agents/skills/repo-context/scripts/context.py impact --repo . --base <commit>
python3 .agents/skills/repo-context/scripts/context.py impact --repo . --changed src/example.py
```

These are alternative commands. Base mode includes committed changes since the
base plus staged, unstaged, and untracked work. Explicit-path mode works without
Git too; include deleted/moved paths and their replacements.

Inspect direct and related candidates for semantic impact, following contracts,
APIs, events, shared state, dependencies, and schemas as the original requires.
Read-only tasks report drift without triggering unrequested writes.

## Preserve detailed context

Follow the original prompt's module, pattern, feature, architecture, index, ADR,
and verification sections. Also read the full Step 3 prompt for new modules, full
Step 0 for new patterns, applicable full Step 1.5 prompt(s) for features, Step 2 for
architectural changes, and Step 4 when rebuilding cross-references. Preserve
detailed explanations and update their facts rather than replacing them with
short diff summaries.

Apply the original "Don't Update For" rules only if no documented fact changes.
File/symbol renames still need path/reference maintenance. Preserve unrelated
authored material and explain task changes judged to have no context impact.

## Reconcile paths and verify

Use [bootstrap.md](bootstrap.md) to resolve old filenames and target architecture
aliases. Adapt the ADR path and `/decision` example to the established repository
process. When framing tasks read the full task-prompt-guide and task-prompt; when
working across declared services also read the full cross-service prompt. Their
example tasks and WMS paths do not authorize work in unrelated repositories.

Update source globs and related links for new, moved, or retired context and
preserve generation progress. Run:

```sh
python3 .agents/skills/repo-context/scripts/context.py validate --repo .
```

Complete the original update prompt's full verification checklist separately.
Report updated documents, semantic impacts, helper results, and remaining unknowns.

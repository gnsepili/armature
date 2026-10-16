---
name: repo-context
description: Generate and maintain a repository's .ai context layer. Use to set up AI context in a new or existing project, resume context generation, audit context freshness, or update mapped architecture, feature, module, and pattern context while changing code in a repository that has adopted this skill.
---

# Repository Context

Turn the repository into navigable, maintained context for coding agents using
the original `.ai/prompts` sequence: **0 → 1 → 1.5 → 2 → 3 → 4**.
Adapt to the repository's actual languages, products, conventions, and boundaries.
Keep automatic skill selection enabled. This skill works alongside implementation,
testing, and debugging skills, including Superpowers.

## Full prompts are the source of instructions

The complete original system is bundled in [prompts/](prompts/), one file per
original prompt, with all templates, worked examples, walkthroughs, depth
requirements, and checklists intact. **Read every applicable prompt in full before
executing it.** Continue truncated reads to EOF. A heading scan, summary, or this
routing table is not a substitute for reading the prompt. Load prompts by phase;
after compaction reread the active prompt if its full requirements are unavailable.

The references handle paths, phase selection, and helper integration. The full
original prompts govern generated content; the references cannot shorten or relax
their content requirements.

## Choose the mode

- **Set up / initialize / adopt:** inspect the repository, install the portable
  project bridge, then execute all generation phases, beginning with Step 0.
- **Resume:** verify recorded phase artifacts and continue incomplete phases.
  Existing directories or section headings alone do not prove completion.
- **Work on code in an adopted repository:** load `.ai/agents.md`, select context
  using `.ai/context-map.json`, and follow the maintenance workflow after edits.
- **Update context:** reconcile affected documents with actual source and tests.
- **Audit / explain:** read and report; do not install or modify context unless
  requested. A stale-context warning is evidence to inspect, not proof of error.

For an ordinary task in a repository that has not adopted this system, do not
initialize a knowledge layer merely because this global skill is available.

## Setup and generation

1. Resolve the intended project root and read existing agent instructions. Inspect
   tracked and untracked project structure, manifests, tests, and entry points.
   Respect existing edits. Do not read secret values, generated media, vendor trees,
   dependency caches, or unrelated repositories. For an empty project, record the
   observed state and revisit discovery when implementation exists.
2. Read [references/bootstrap.md](references/bootstrap.md) for portable routing,
   [prompts/master-context-generator.md](prompts/master-context-generator.md) and
   [prompts/sequence-guide.md](prompts/sequence-guide.md) in full for orchestration,
   then [references/document-contract.md](references/document-contract.md) for
   the supplementary source map. Use the phase table below for actual filenames.
3. Run the bundled helpers using the actual absolute path of this skill (the
   examples below assume it is installed in the target project):

   ```sh
   python3 .agents/skills/repo-context/scripts/context.py inventory --repo .
   ```

   For the first adoption, run `scripts/install.py --repo /absolute/project/root`
   from this skill's current location. It copies the skill into
   `.agents/skills/repo-context/` and appends a bounded rule to `AGENTS.md`.
   Existing instructions are preserved. If the repository uses Claude Code,
   pass `--claude` to add an equivalent rule to `CLAUDE.md`. Inspect conflicts
   instead of replacing existing managed blocks or package files.
4. Read and execute each full phase prompt below to generate `.ai` artifacts.
   For a full setup, chain the master's next-step execution through all applicable
   phases, checkpointing between them. For an explicit single-step request, execute
   only that step and report the next. Never claim completion after installation
   alone or substitute abbreviated outlines for the original detailed templates.
5. Validate links, mapped source coverage, and actual claims. Mark phases complete
   only after their content is verified. Record genuinely inapplicable phases with
   a reason; resume partial work without overwriting valid context.
6. Report the detected structure, generated context, verified coverage, exclusions,
   and unresolved unknowns. The generated project includes its own maintenance
   instructions; it must not depend on a path on the original author's machine.

| Phase | Full prompt to read and execute |
| --- | --- |
| 0 | [step-0-extract-global-context.md](prompts/step-0-extract-global-context.md) |
| 1 | [step-1-discover-modules.md](prompts/step-1-discover-modules.md) |
| 1.5 backend | [step-1.5-discover-features-backend.md](prompts/step-1.5-discover-features-backend.md) |
| 1.5 frontend | [step-1.5-discover-features-frontend.md](prompts/step-1.5-discover-features-frontend.md) |
| 2 | [step-2-map-relationships.md](prompts/step-2-map-relationships.md) |
| 3 | [step-3-generate-module-contexts.md](prompts/step-3-generate-module-contexts.md) |
| 4 | [step-4-cross-referencing.md](prompts/step-4-cross-referencing.md) |

Full-stack repositories execute **both** Step 1.5 prompts and reconcile their
feature mappings before Step 2. For other project types, read the full applicable
prompts and adapt terminology to the observed surface rather than the examples.

## Ongoing changes and task context

Read [prompts/update-context.md](prompts/update-context.md) in full, then
[references/maintenance.md](references/maintenance.md) for helper integration.
Before editing,
capture an appropriate Git base and inspect pre-existing changes. With no Git,
record touched paths directly. Check the map for related modules and patterns,
then read the relevant source to resolve disagreement.

Before completing an implementation, update affected context and cross-references
in the same change. Add newly introduced source areas to the map, retire obsolete
claims, and state why a source change has no context impact when that is the case.
For read-only work, report drift without changing files.

When framing tasks using generated context, read
[prompts/task-prompt-guide.md](prompts/task-prompt-guide.md) and
[prompts/task-prompt.md](prompts/task-prompt.md) in full. For work spanning named
repositories/services, also read
[prompts/cross-service-prompt.md](prompts/cross-service-prompt.md) in full. These
contain illustrative tasks (including Trip Configuration and WMS), not new work
requests. Adapt the template to the user's actual task and authorized repositories.

```sh
python3 .agents/skills/repo-context/scripts/context.py impact --repo . --base <commit>
python3 .agents/skills/repo-context/scripts/context.py validate --repo .
```

`impact` includes committed changes since the base, staged/unstaged edits, and
untracked files. Use `--changed path ...` when only explicit task-owned changes
should be considered. With no base, it checks the working tree against HEAD.
An empty diff is not a whole-repository freshness audit.

## What the automation means

The project bridge tells future agents to use and maintain context as part of
their tasks. The helpers discover files and verify structural coverage; the agent
performs the semantic analysis and writes the explanations. There is no background
LLM service, auto-commit, automatic PR, or hidden upload. Hosts must read the
project's `AGENTS.md`/`CLAUDE.md` or discover the skill for activation to work.
If a host supports neither, explicitly give it this `SKILL.md` as the entry point.
Validate configuration and source changes with the target project's normal checks;
this skill does not replace its tests or bypass its instructions.

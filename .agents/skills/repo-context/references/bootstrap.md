# Run the Complete Original Prompt System

This file is a portability and orchestration adapter. The full originals in
`../prompts/` define discovery, templates, depth, and verification. Read them
completely according to `SKILL.md`. This adapter is not an abbreviated generation
prompt and does not relax the originals' detailed content requirements.

## Order and progress

Read `../prompts/master-context-generator.md` and `../prompts/sequence-guide.md`
in full. The master selects the next phase; the sequence guide describes the full
generation workflow. Execute **0 → 1 → 1.5 → 2 → 3 → 4**. Historical mentions of
five numbered steps do not remove feature discovery. For full-stack projects run
both frontend and backend Step 1.5 prompts, merging their indexes.

For a full setup, chain the master's next-step executions automatically, recording
progress after each. For an explicit single-step request, stop after that step and
report the next. Verify the phase's checklist before marking it complete;
directories or headings alone are not proof. Resume a partial phase by rereading
its entire prompt and checking existing artifacts. Preserve valid authored context.

The source map in [document-contract.md](document-contract.md) supplements the
original workflow. Run structural validation at finalization; early phases may
have intentionally incomplete navigation and maps. Never bypass original semantic
or content-quality verification because the helper passes.

## Resolve historical prompt paths

Original files are preserved byte-for-byte, including old path references.
Resolve these aliases to files under the installed skill's `prompts/` directory:

| Original reference or alias | Bundled filename |
| --- | --- |
| `00-extract-global-context.md`, `.ai/step-0-extract-global-context.md` | `step-0-extract-global-context.md` |
| `01-discover-modules.md`, `.ai/step-1-discover-modules.md` | `step-1-discover-modules.md` |
| `step-1_5-discover-features-backend.md` | `step-1.5-discover-features-backend.md` |
| `step-1_5-discover-features-frontend.md` | `step-1.5-discover-features-frontend.md` |
| `02-map-relationships.md`, `.ai/step-2-map-relationships.md` | `step-2-map-relationships.md` |
| `03-generate-module-contexts.md`, `.ai/step-3-generate-module-contexts.md` | `step-3-generate-module-contexts.md` |
| `04-cross-reference.md`, `.ai/step-4-cross-referencing.md` | `step-4-cross-referencing.md` |
| `SEQUENCE-GUIDE.md` | `sequence-guide.md` |
| `TASK-PROMPT-TEMPLATE.md` | `task-prompt-guide.md` (also read the concrete example in `task-prompt.md`) |
| `cross-service-task-prompt.md` | `cross-service-prompt.md` |

Normalize the same aliases when prefixed by `.ai/`, `.ai/prompts/`, or
`prompts/context-generation/`. Correct filenames resolve directly.
The referenced Android-specific Step 1.5 file was not supplied in the originals.
Do not pretend it exists: read the full frontend prompt for UI capabilities and
the backend prompt for applicable service/API capabilities, adapt to mobile
components, and record that adaptation.

## Inputs and outputs

Installed originals live at `.agents/skills/repo-context/prompts/`. Generated
context belongs in the target's `.ai/`. References to `.ai/agents.md`, modules,
patterns, features, and architecture mean the target's generated documents.

New projects use `architecture/module-interactions.md` and applicable
`architecture/data-model.md`. If existing context uses compatible aliases, reuse
those actual paths consistently. In generated usage guides, replace historical
prompt links with working relative links into the installed skill. For example,
from `.ai/README.md`, link to
`../.agents/skills/repo-context/prompts/update-context.md`. Adjust the relative
prefix for other document depths. Preserve original prompt files themselves.

## Preserve the original depth

Follow all applicable sections, templates, explanations, walkthroughs, code-based
examples, gotchas, and checklists in each full prompt. Preserve their stated depth
and length requirements. Do not turn the detailed outputs into short inventories.
For unsupported items, explicitly record the evidence and reason for
non-applicability rather than fabricating content or silently dropping a section.

Payment, Stripe, ShipStation, WMS paths, Trip Configuration, sample endpoints,
code snippets, and placeholders are illustrative. Discover actual equivalents in
the target; do not implement example features or treat them as project facts.

Do not skip Step 1.5 simply because a project is a library, CLI, worker, or
infrastructure project; inspect its consumer capabilities using the full prompts.
Record a phase skip only when there is no applicable feature surface. Optional
outputs such as a data model may be absent with an explicit reason under
`bootstrap.omitted_artifacts`; that does not skip the architecture phase.
Execute phases 0, 1, 2, 3, and 4 against the actual project even when it is small.

## Verification and scope

Complete the original navigation exercises and content checklists. Perform
hypothetical feature/debugging exercises through inspection or isolated fixtures
unless the user authorized those implementation changes. Adapt existing ADR
checks and the `/decision` example to the target's actual decision-record process.

Run `scripts/context.py validate --repo <target>` for supplementary structural
checks. Report that result separately from semantic and template verification.
The helper cannot prove that the agent read the prompts or met their depth.

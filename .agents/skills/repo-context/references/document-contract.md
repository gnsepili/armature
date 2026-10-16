# `.ai/context-map.json` Contract

`.ai/context-map.json` is the portable manifest for a generated repository context layer. It lets tooling locate context by source evidence, identify potentially affected documentation, validate cross-references, and resume bootstrap. The agent verifies semantic accuracy. Paths are repository-relative and use `/` separators. Requires Python 3.10 or newer for the bundled scripts; they use only the standard library.

```json
{
  "schema_version": 1,
  "documents": [
    {
      "path": ".ai/modules/example.md",
      "sources": ["src/example/**"],
      "related": [".ai/patterns/example-pattern.md", ".ai/architecture/module-interactions.md"]
    }
  ],
  "source_roots": ["src"],
  "ignore": ["node_modules/**", "dist/**"],
  "excluded_sources": [
    {"pattern": "src/generated/**", "reason": "Generated output; document its source definition instead."}
  ],
  "bootstrap": {
    "completed_steps": ["0", "1", "1.5", "2", "3", "4"],
    "skipped_steps": {}
  }
}
```

## Required fields

- `schema_version` must be the number `1`.
- `documents` is an array of generated `.ai/*.md` documents. Each entry has:
  - `path`: a unique repository-relative `.ai/` Markdown path.
  - `sources`: repository-relative glob patterns that supply the document's evidence. Use `[]` only for navigation-only documents such as `.ai/agents.md` or `.ai/README.md`.
  - `related`: repository-relative `.ai/` Markdown paths for explicit cross-references and direct dependency/navigation relationships. Use `[]` when none exist.
- `source_roots` lists the source directories or roots inspected. It may include multiple roots and must reflect the actual repository layout.
- `ignore` is an array of excluded glob patterns, such as dependencies, build artifacts, vendored code, or local state.
- `excluded_sources` is an array of objects with `pattern` and non-empty `reason`; use it to make intentional omissions auditable.

## Optional bootstrap state

`bootstrap` is optional. When present, `completed_steps` is an array drawn from `"0"`, `"1"`, `"1.5"`, `"2"`, `"3"`, and `"4"`. `skipped_steps` permits only phase `"1.5"`, with a specific reason. A phase must not appear in both collections. Record phase 1.5 when feature discovery was performed; skip it only when features are inapplicable. In a new layout Phase 2 produces canonical `module-interactions.md`; in an established layout, a compatible existing alias is acceptable. `data-model.md` is mapped only when it applies.

Optional `omitted_artifacts` records individual outputs that do not apply, without
skipping their entire phase. For example:

```json
"omitted_artifacts": {
  ".ai/architecture/data-model.md": "Stateless CLI; no persistent domain model.",
  ".ai/patterns/": "No recurring implementation patterns in the current small module."
}
```

These omissions still allow phases 0 and 2 to be complete. Do not create invented
patterns or entities to satisfy a directory checklist.

## Mapping rules

- Patterns use POSIX paths. `src` or `src/` includes its descendants; `src/**` covers the subtree; `**/` also matches zero directories. Patterns otherwise use Python `fnmatch` semantics (`*` can span `/`), so use directory prefixes to constrain them. Inventory respects Git ignore rules while including tracked and untracked files. In a non-Git directory it walks files with built-in dependency/build/media/credential exclusions. Those built-in exclusions also apply in Git repositories.

- Map every generated context document, including patterns, features, modules, architecture, `agents.md`, and `README.md`.
- Use the repository's existing context layout and alias filenames if they predate this skill. The canonical new architecture names are `.ai/architecture/module-interactions.md` and, when applicable, `.ai/architecture/data-model.md`.
- Source globs should be narrow enough to identify evidence but broad enough to cover the module/feature. Include configuration, contracts, migrations, or tests when they are material evidence.
- `related` is explicit: list both sides of a meaningful module-pattern, feature-module, or architecture-module relationship where practical. It does not replace Markdown links.
- Do not map ignored or excluded generated/vendor output as primary evidence. Map its maintained source instead, or state why no maintained source is available.
- Keep entries current through moves, splits, and deletions; preserve valid user-authored documents and their entries until deliberately retired.

Installed-project commands refer to `.agents/skills/repo-context/scripts/context.py` relative to the repository root; project context output must not depend on an absolute installation path.

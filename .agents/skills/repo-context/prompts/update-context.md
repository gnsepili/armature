# Update Context Layer

## Objective
Scan codebase for changes and update `.ai/` context to reflect current state.

## Scan & Update Process

### 1. Identify Changes
Compare code to context documentation:
- New files/modules added
- Existing modules modified (new functions, changed behavior)
- Patterns changed or new patterns emerged
- Dependencies added/removed
- API endpoints added/modified
- Features expanded or refactored

### 2. Update Module Files

For each modified module in codebase:
- Read current `.ai/modules/[name].md`
- Scan actual code in that module
- Update sections that changed:
  - Key Components (new classes/functions)
  - API Surface (new endpoints/methods)
  - Dependencies (added/removed imports)
  - Key Behaviors (changed workflows)
  - Gotchas (new edge cases discovered)
  - Features Implemented (if feature scope changed)

### 3. Update Pattern Files

For each pattern:
- Check if usage changed
- Update "Where Used" with new modules
- Add new gotchas discovered in production
- Update code examples if implementation changed

### 4. Update Feature Files

For each feature:
- Check if modules involved changed
- Update "Modules Involved" list
- Update user flows if changed
- Update backend APIs if endpoints changed

### 5. Update Architecture

If system-level changes:
- Update `architecture/module-interactions.md` for new dependencies
- Update `architecture/data-model.md` for schema changes

### 6. Update agents.md

- Add new modules to Module Map
- Add new patterns to Common Patterns
- Add new features to Features Map
- Add new external systems

### 7. Check ADRs

If architectural changes were found (new integration provider, new workflow pattern, changed convention, new infrastructure choice):
- Check `docs/architecture/decisions/README.md` for existing ADRs covering the decision
- If the change represents a new significant decision not already recorded, suggest creating an ADR via `/decision "title"`
- If an existing ADR is affected (e.g., superseded by a new choice), note it for status update

## What to Update

### Code Changes Trigger:
- **New module** → Create `modules/[name].md`, update `agents.md`
- **Modified module** → Update relevant sections in module file
- **New pattern** → Create `patterns/[name].md`, update `agents.md`
- **New feature** → Create `features/[name].md`, update `agents.md`
- **API changes** → Update feature files + module API sections
- **Dependencies** → Update module Dependencies sections
- **Gotchas discovered** → Add to module Gotchas section
- **Architectural decision** → Check `docs/architecture/decisions/`, suggest `/decision` if not recorded

### Don't Update For:
- Minor refactoring (variable renames)
- Code formatting changes
- Comment updates
- Test-only changes (unless testing strategy changed)

## Execution

**Option 1: Full Scan**
```
Scan entire codebase and update all context files that are outdated.
Focus on: [specific area if needed, or "all areas"]
```

**Option 2: Targeted Update**
```
Module [name] was modified. Update its context file.
Changes: [brief description of what changed]
```

**Option 3: New Addition**
```
New module [name] added at [path].
Create context file and update cross-references.
```

## Output

Report what was updated:
- Files modified
- Sections changed
- New cross-references added
- Outdated information removed

## Verification

After updates:
- [ ] All cross-references still valid
- [ ] No broken links
- [ ] Code examples match current implementation
- [ ] Gotchas reflect current issues
- [ ] Module map complete
- [ ] ADRs checked — new architectural decisions recorded or flagged
# Master Context Generator

## Objective
Autonomously generate `.ai/` context layer by detecting state and executing the appropriate step prompt.

---

## Phase 1: Detect Repo Type

Scan for indicators:

**Backend:** `routes.py`, `router.ts`, `app.py`, `src/api/`, `src/controllers/`, database models
**Frontend:** `App.tsx`, `package.json` (React/Vue/Angular), `src/components/`, `src/pages/`
**Android:** `AndroidManifest.xml`, `build.gradle`, `MainActivity.kt`, `app/src/main/`

**Report detected type:** "Detected: [Backend/Frontend/Android]"

---

## Phase 2: Check Progress State

Scan `.ai/` directory to determine completion:

| Check | Indicates |
|-------|-----------|
| `.ai/agents.md` with "Common Patterns" section | Step 0 complete |
| `.ai/agents.md` with "Module Map" section | Step 1 complete |
| `.ai/features/*.md` exist | Step 1.5 complete |
| `.ai/architecture/*.md` exist | Step 2 complete |
| `.ai/modules/*.md` exist | Step 3 complete |
| `.ai/README.md` exists | Step 4 complete |

---

## Phase 3: Execute Next Step

Based on detected state, load and execute the appropriate prompt file:

### If nothing exists → Execute Step 0
Load and follow: `.ai/step-0-extract-global-context.md`

### If Step 0 done, no Module Map → Execute Step 1
Load and follow: `.ai/step-1-discover-modules.md`

### If Step 1 done, no features → Execute Step 1.5
Load based on repo type:
- Backend: `.ai/step-1_5-discover-features-backend.md`
- Frontend: `.ai/step-1_5-discover-features-frontend.md`
- Android: `.ai/step-1_5-discover-features-android.md`

### If Step 1.5 done, no architecture → Execute Step 2
Load and follow: `.ai/step-2-map-relationships.md`

### If Step 2 done, no modules → Execute Step 3
Load and follow: `.ai/step-3-generate-module-contexts.md`

### If Step 3 done, no README → Execute Step 4
Load and follow: `.ai/step-4-cross-referencing.md`

### If all steps complete
Report completion and verification checklist.

---

## Phase 4: Report Progress

After executing step:

```
Repository: [path]
Type: [Backend/Frontend/Android]

Progress:
  ✓ Step 0: Global Context & Patterns
  ✓ Step 1: Module Discovery
  ✗ Step 2: Map Relationships
  ✗ Step 3: Module Contexts
  ✗ Step 4: Cross-Reference

Completed this run: Step 1 (Discover Modules)

Next: Run master-context-generator.md again for Step 2
```

---

## Completion Message

When all steps done:

```
✓ Context generation complete!

Files created:
  .ai/agents.md
  .ai/patterns/*.md
  .ai/features/*.md
  .ai/architecture/*.md
  .ai/modules/*.md
  .ai/README.md

## Verification Checklist

All steps complete when:
- [ ] `.ai/agents.md` has all sections (Context, Patterns, Modules, Features, Architecture)
- [ ] `.ai/patterns/*.md` exist (Step 0)
- [ ] `.ai/features/*.md` exist (Step 1.5)
- [ ] `.ai/architecture/*.md` exist (Step 2)
- [ ] `.ai/modules/*.md` exist (Step 3)
- [ ] `.ai/README.md` exists (Step 4)
- [ ] All cross-references valid
- [ ] No placeholder text

Usage:
  Tasks: Start by reading .ai/agents.md
  Updates: Use update-context.md
  Cross-service: Use cross-service-task-prompt.md
```

---

## Example Execution

**First Run (Fresh Repo):**
```
→ Detected: No .ai/ directory
→ Running: Step 0 (Extract Global Context)
→ Created: .ai/agents.md, .ai/patterns/*.md
→ Next: Run again to continue with Step 1
```

**Second Run:**
```
→ Detected: Step 0 complete
→ Running: Step 1 (Discover Modules)
→ Updated: .ai/agents.md (added Module Map)
→ Next: Run again to continue with Step 1.5
```

**Third Run:**
```
→ Detected: Steps 0-1 complete
→ Running: Step 1.5 (Discover Features - Backend)
→ Created: .ai/features/*.md
→ Updated: .ai/agents.md (added Features Map)
→ Next: Run again to continue with Step 2
```

---

Continue until Step 4 completes.


## Error Recovery

**If step fails midway:**
1. Check what files were created
2. Complete or remove partial files
3. Re-run master prompt (will detect state and resume)

**If cross-references broken:**
1. Run Step 4 again (cross-referencing)
2. Manual fix if needed

**If context outdated:**
1. Use `update-context.md` for targeted updates
2. Or re-run specific step (e.g., Step 3 for module updates)
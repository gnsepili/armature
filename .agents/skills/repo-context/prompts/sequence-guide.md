# Context Generation - Complete Guide

## Overview
These **5 sequential prompts** generate a complete AI context layer for your repository. This enables LLMs to autonomously navigate and understand your codebase.

### Key Features:
- ✅ **Merged Step 0**: Global context + patterns in one step (simpler, more cohesive)
- ✅ **No temp files**: Everything created directly in final location (no cleanup needed)
- ✅ **Verbose templates**: Detailed explanations for LLM comprehension
- ✅ **Progressive updates**: Build files incrementally (clearer workflow)

---

## The 5-Step Sequence

### Step 0: Extract Global Context & Patterns
**File**: `00-extract-global-context.md`

**What it does**:
- Explains the big picture (what we're building and why)
- Documents project overview, tech stack, code conventions
- Extracts ALL recurring patterns from codebase
- Creates initial `agents.md` (root navigation file)

**Creates**:
- `.ai/agents.md` (initial version with context and pattern list)
- `.ai/patterns/*.md` (detailed pattern files - as many as found)

**Why first**: Establishes foundation - both structural context AND patterns that modules will reference later

**Time estimate**: 1-2 hours for medium codebase

---

### Step 1: Discover Modules
**File**: `01-discover-modules.md`

**What it does**:
- Identifies all modules/components/services in the codebase
- Distinguishes core modules from utility modules
- Updates `agents.md` with Module Map

**Updates**:
- `.ai/agents.md` (adds complete Module Map section)

**Why second**: Need to know what modules exist before analyzing relationships

**Time estimate**: 30-45 minutes

---

### Step 2: Map Relationships
**File**: `02-map-relationships.md`

**What it does**:
- Maps dependencies between modules
- Documents communication patterns (sync/async/events)
- Identifies data flows and external integrations
- Creates architecture documentation

**Creates**:
- `.ai/architecture/module-interactions.md` (how modules connect)
- `.ai/architecture/data-model.md` (database schema, if applicable)

**Updates**:
- `.ai/agents.md` (adds Architecture and External Systems sections)

**Why third**: Need module list (Step 1) and patterns (Step 0) to understand interactions properly

**Time estimate**: 45-90 minutes

---

### Step 3: Generate Module Contexts
**File**: `03-generate-module-contexts.md`

**What it does**:
- Creates detailed documentation for each module
- References patterns from Step 0 immediately
- Documents API surface, dependencies, behaviors, gotchas
- Includes code examples and detailed walkthroughs

**Creates**:
- `.ai/modules/*.md` (one file per module - typically 150-200 lines each)

**Why fourth**: Can immediately reference patterns and relationships discovered earlier

**Time estimate**: 2-4 hours (depends on number of modules)

---

### Step 4: Cross-Reference & Finalize
**File**: `04-cross-reference.md`

**What it does**:
- Updates pattern files with module references
- Verifies all cross-references work
- Creates usage guide (README.md)
- Tests the context layer with sample tasks

**Creates**:
- `.ai/README.md` (usage guide for humans and LLMs)

**Updates**:
- `.ai/patterns/*.md` (adds "Where Used" module references)
- `.ai/agents.md` (final verification of all sections)

**Why last**: Completes the web of cross-references and validates everything works together

**Time estimate**: 45-90 minutes

---

## Where Generated Contexts Are Stored

### Final Structure (What LLMs Read):

```
.ai/
├── README.md                       ← Usage guide
├── agents.md                       ← ROOT NAVIGATION (always start here)
├── modules/
│   ├── payment-service.md         ← Module contexts (150-200 lines each)
│   ├── user-service.md
│   ├── order-service.md
│   └── ...
├── patterns/
│   ├── api-design.md              ← Pattern documentation (100+ lines each)
│   ├── error-handling.md
│   ├── logging.md
│   └── ...
└── architecture/
    ├── module-interactions.md     ← System-level docs (200+ lines)
    └── data-model.md              ← (if applicable)
```

### No Temporary Files
Everything is created directly in `.ai/` and updated progressively. No temp directory, no cleanup needed.

---

## Key Improvements

### 1. Merged Global Context + Patterns (Step 0)
**Why**: Both are cross-cutting global concerns - tech stack, conventions, and patterns are all foundation-level knowledge

**Benefit**: One cohesive "foundation" step instead of separate context + patterns steps

### 2. No Temporary Directory
**Why**: Temporary files add complexity without benefit

**Benefit**: Simpler workflow - create files once in final location, update them progressively

### 3. Verbose Templates for LLMs
**Why**: LLMs need detailed explanations with "why" reasoning, not terse bullet points

**Benefit**: Generated context is actually useful - LLMs can understand without reading code

### 4. Progressive File Updates
**Why**: Natural workflow - start with skeleton, flesh it out incrementally

**Benefit**: Always see current state, easier to understand progress

---

## What Gets Created When

### After Step 0:
```
.ai/
├── agents.md                  (initial: overview, tech, patterns list)
└── patterns/
    ├── api-design.md         (full pattern documentation)
    ├── error-handling.md
    ├── logging.md
    └── ...                   (all patterns found)
```

### After Step 1:
```
.ai/
└── agents.md                  (updated: + Module Map section)
```

### After Step 2:
```
.ai/
├── agents.md                  (updated: + Architecture, External Systems)
└── architecture/
    ├── module-interactions.md
    └── data-model.md         (if applicable)
```

### After Step 3:
```
.ai/
└── modules/
    ├── payment-service.md    (detailed module docs)
    ├── user-service.md
    ├── order-service.md
    └── ...                   (all modules)
```

### After Step 4 (FINAL):
```
.ai/
├── README.md                  (NEW - usage guide)
├── agents.md                  (finalized - all sections complete)
├── modules/                   (all with cross-references)
├── patterns/                  (all with module references)
└── architecture/              (all with pattern references)
```

---

## Time Estimates

### For Medium Monolith (10-15 modules):
- **Step 0**: 1-2 hours (extracting patterns takes time)
- **Step 1**: 30-45 minutes
- **Step 2**: 45-90 minutes
- **Step 3**: 2-4 hours (most time-consuming)
- **Step 4**: 45-90 minutes

**Total**: 5-8 hours for initial generation  
**Review**: 2-3 hours for senior engineer refinement

### For Microservices (20+ services):
Multiply by 1.5-2x

### For Small Library (<5 modules):
2-3 hours total

---

## How to Use These Prompts

### Option 1: Sequential LLM Execution
Give your LLM (Claude, GPT, etc.):
```
Follow the prompts in prompts/context-generation/ sequentially:
1. Start with 00-extract-global-context.md
2. After completing each step, proceed to the next
3. Stop after 04-cross-reference.md

Read each prompt file completely before executing.
```

### Option 2: Manual Execution
1. Read each prompt file in order (0 → 1 → 2 → 3 → 4)
2. Follow the instructions step-by-step
3. Create files as specified
4. Verify outputs before proceeding to next step

### Option 3: Hybrid Approach
1. LLM generates initial content
2. Senior engineer reviews and refines
3. Team validates with real usage
4. Iterate based on feedback

---

## Quality Checklist

After completing all steps, verify:

### File Presence
- [ ] `.ai/agents.md` exists and is the root navigation file
- [ ] All modules in agents.md have corresponding files in `modules/`
- [ ] All patterns in agents.md have corresponding files in `patterns/`
- [ ] Architecture files exist in `architecture/`
- [ ] `.ai/README.md` usage guide exists

### Cross-References
- [ ] Module files reference patterns with `../patterns/` paths
- [ ] Pattern files reference modules with `../modules/` paths
- [ ] Module files link to dependencies with relative paths
- [ ] Architecture files link to patterns with `../patterns/` paths
- [ ] No broken links anywhere

### Content Quality
- [ ] No placeholder text like "[TODO]" or "[Fill this in]"
- [ ] Pattern files are 100+ lines with detailed explanations
- [ ] Module files are 150-200+ lines with walkthroughs
- [ ] Gotchas include problem + solution with code
- [ ] "Why" is explained for decisions and patterns
- [ ] Code examples include file paths and line numbers
- [ ] External systems marked with evidence (file locations)

### Verbosity
- [ ] Full paragraphs, not just bullet points
- [ ] Scenarios have step-by-step walkthroughs
- [ ] Rules explain consequences of violation
- [ ] Examples include explanatory prose, not just code

---

## Testing Your Context Layer

### Test 1: Navigation
Give an LLM:
```
Read .ai/agents.md and navigate to the Payment module.
What patterns does it use?
```

Should work seamlessly by following links.

### Test 2: Real Feature
```
Add email verification to user registration.
Start by reading .ai/agents.md.
```

Observe if LLM finds right modules and patterns.

### Test 3: Bug Fix
```
Fix duplicate order confirmation emails.
Start by reading .ai/agents.md.
```

Check if LLM identifies root cause using context.

### Test 4: Pattern Discovery
```
How should I handle database transactions?
Start by reading .ai/agents.md.
```

Verify LLM navigates to correct pattern.

---

## File Locations in Your Repo

Save these prompts:

```
prompts/
└── context-generation/
    ├── 00-extract-global-context.md
    ├── 01-discover-modules.md
    ├── 02-map-relationships.md
    ├── 03-generate-module-contexts.md
    └── 04-cross-reference.md
```

Generated context goes here:

```
.ai/
├── README.md
├── agents.md
├── modules/*.md
├── patterns/*.md
└── architecture/*.md
```

---

## Common Questions

**Q: Can I skip steps?**  
A: No, they must be sequential. Each depends on outputs from previous steps.

**Q: What if I discover new patterns later?**  
A: Add to `patterns/`, update `agents.md`, add module references, re-run Step 4 to verify links.

**Q: What if I have 30+ modules?**  
A: Document ALL modules, but work in organized batches (core → supporting → infrastructure → utilities). Complete coverage is essential - supporting modules often contain critical logic.

**Q: How often should I regenerate?**  
A: For major refactors: regenerate all. For minor changes: update affected files manually.

**Q: Can LLMs actually use this?**  
A: Yes! Just tell them "Read `.ai/agents.md` first" in your task prompts. See `TASK-PROMPT-TEMPLATE.md` for examples.

---

## Maintenance

### When to Update Context:

**Immediately**:
- Adding new modules → Create module file, update agents.md
- Major features → Update affected module files
- New patterns → Create pattern file, update agents.md

**During PR Review**:
- Update context as part of code review
- Verify module docs match actual code

**Weekly**:
- Review gotchas discovered during development
- Add edge cases to relevant module files

**Monthly**:
- Verify cross-references still accurate
- Check for obsolete information

### How to Update:

**Adding Module**:
1. Create `modules/[name].md` using Step 3 template
2. Update `agents.md` Module Map
3. Add cross-references to related modules
4. Run Step 4 checks to verify links

**Adding Pattern**:
1. Create `patterns/[name].md` using Step 0 template
2. Update `agents.md` Common Patterns
3. Update modules that use this pattern
4. Add "Where Used" references

**Updating Module**:
1. Edit `modules/[name].md` with new information
2. Update gotchas, behaviors, dependencies
3. Verify cross-references still correct

---

## Success Indicators

You know the context layer is working when:

✅ **LLMs navigate autonomously** - They follow links without asking for directions  
✅ **Code follows patterns** - New code matches documented patterns  
✅ **Faster feature development** - Less time explaining codebase to LLMs  
✅ **Fewer bugs** - Gotchas are documented and avoided  
✅ **Easier onboarding** - New developers understand system faster  
✅ **Better questions** - LLMs ask about edge cases, not basic structure  

---

## What's Next After Generation?

1. **Test it**: Use on real feature/bug to validate
2. **Refine it**: Update based on what worked/didn't work
3. **Train team**: Show how to read and update context
4. **Integrate workflow**: Add to PR templates, CI checks
5. **Measure impact**: Track productivity gains

---

## Success!

You now have a systematic context layer that enables:
- ✅ LLMs to autonomously navigate your codebase
- ✅ Pattern reuse across modules
- ✅ Clear module boundaries and relationships
- ✅ Discoverable architectural knowledge

Start using it with task prompts (see `TASK-PROMPT-TEMPLATE.md`) and iterate based on real-world usage!
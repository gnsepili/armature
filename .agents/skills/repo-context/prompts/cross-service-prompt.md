# Cross-Service Task: [Feature Name]

## Phase 1: Load All Service Contexts

### Service: WMS/es
Read `WMS/es/.ai/agents.md`

**Relevant modules:**
- [List after reading]

**Patterns to follow:**
- [List after reading]

### Service: WMS/sm
Read `WMS/sm/.ai/agents.md`

**Relevant modules:**
- [List after reading]

**Patterns to follow:**
- [List after reading]

### Shared Resources

**Database (Shared):**
- Location: `WMS/shared-db-schema.md` OR document here
- Tables both services use:
  - [table_name] - Used by: [es for X, sm for Y]
  - [table_name] - Used by: [es for X, sm for Y]

**Potential Conflicts:**
- [Table/column modified by both]
- [Race conditions]
- [Transaction boundaries]

---

## Phase 2: Analysis

### Changes Required Per Service

**WMS/es:**
- Modules: [what changes]
- Files: [paths]
- Database: [what writes]

**WMS/sm:**
- Modules: [what changes]
- Files: [paths]
- Database: [what writes]

### Coordination Points
- [ ] DB transaction safety (both services writing same tables?)
- [ ] Timing/sequencing (does order matter?)
- [ ] Rollback strategy (if one fails, what happens?)

---

## Phase 3: Implementation Plan

### Execution Order
1. [Service X - Step 1]
2. [Service Y - Step 2]
3. [Verification]

### Database Safety
- Transaction boundaries: [define]
- Locking strategy: [if needed]
- Conflict resolution: [how handled]

---

## Phase 4: Implementation

[Implement after approval, per service]

---

## Verification

**WMS/es:**
- [ ] Tests pass
- [ ] Context updated (`modules/[name].md`)

**WMS/sm:**
- [ ] Tests pass
- [ ] Context updated (`modules/[name].md`)

**Cross-service:**
- [ ] DB consistency verified
- [ ] No race conditions
- [ ] Rollback tested
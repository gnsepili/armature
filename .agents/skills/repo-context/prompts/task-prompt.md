# Task: Trip Configuration

---

## Phase 1: Planning (Complete First - Do NOT Implement)

### 1. Read Context
Read `.ai/agents.md` to understand the system.

### 2. Identify Components

**Features Affected:**
- [List features from `.ai/features/` with why relevant]

**Modules Needed:**
- [List modules from `.ai/modules/` with specific changes]

**Patterns to Apply:**
- [List patterns from `.ai/patterns/` with usage]

**Architecture Impact:**
- [Check `.ai/architecture/` for cross-module concerns]

### 3. Technical Approach

**Implementation Plan:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Files to Modify:**
- `path/file.py` - [what changes]
- `path/file.py` - [what changes]

**Testing Strategy:**
- [Tests to add]
- [Verification approach]

**Risks & Gotchas:**
- [From module/pattern docs]
- [Edge cases]

**Acceptance Criteria:**
- [ ] [Deliverable 1]
- [ ] [Deliverable 2]

### 4. Present Plan & Wait for Approval

---

## Phase 2: Implementation (After Approval Only)

### Requirements

#### Functional Requirements
# Backend Requirements: Trip Configuration (Start/End + Rider Pool)
how the behaviour for Trip config be:

## Start = Hub

* **Rider pool = Online** → build/assign routes using only online riders.
* **Rider pool = Online + Offline (fallback)** → use online riders first; if not enough, also allow offline riders.
* Route start point is always the **hub** for everyone.

## Start = Custom location

* **Rider pool = Online** → build/assign routes using only online riders.
* **Rider pool = Online + Offline (fallback)** → use online riders first; if not enough, also allow offline riders.
* Route start point is always the **custom location** for everyone.

## Start = Rider live location

* **Rider pool = Online** → build/assign routes using online riders **who have fresh GPS**; each rider’s route starts from their current location.
* **Rider pool = Online + Offline (fallback)** → **not allowed** (offline riders can’t start from “rider live location”). The system should block this or auto-switch to **Online**.

## Rider pool = Nearby online (strategy = `nearby_online_rider_only`)

* Uses only **online riders with fresh GPS**, sourced via Redis nearby search.
* Nearby is computed from the **first pickup** location (fallback to first task if no pickup).
* Rider list is **sorted by distance**; FIFO will pick in this order. CFR receives the sorted list without priority changes.

---

## End location behavior (applies to all valid start/pool combos)

* **End = Hub** → route must end back at hub.
* **End = Custom** → route must end at that custom location.
* **End not selected** → **free end** (route ends at last stop).

---

## Hub constraints & multi-hub (merge_trips)

* **merge_trips controls multi-hub behavior** for shipment/work assignment and grouping keys.
* Applies to **provisional** and **scheduled** routes; for scheduled routes the flag comes from the **route creation stage config** (rule configuration), not the schedule trip object.
* **merge_trips = true** → do **not** enforce hub filters; grouping keys ignore hub_id.
* **merge_trips = false** → **enforce** hub filters; grouping keys include hub_id.

Instruction
your task is to tell me if this is already been done

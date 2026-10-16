# Task Prompt Template

## How to Use the Generated Context Layer

Once you've generated your context layer using the 5-step sequence, use this template to give LLMs tasks that leverage the context effectively.

---

## Basic Task Prompt Template

```markdown
# Task: [Task Name/Title]

## Initial Instruction
Read `.ai/agents.md` first to understand the codebase, then proceed with the task below.

## Requirements
[Describe what needs to be built/fixed/changed]

### Functional Requirements
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

### Constraints
- [Constraint 1: e.g., Must follow existing error handling patterns]
- [Constraint 2: e.g., Should not modify module X]
- [Constraint 3: e.g., Must maintain backward compatibility]

### Acceptance Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

## Additional Context (Optional)
[Any task-specific context not in the .ai/ layer]

## Deliverables
- [What files/changes are expected]
- [What documentation updates are needed]
- [What tests should be added]
```

---

## Complete Example Tasks

### Example 1: Feature Implementation

```markdown
# Task: Add Gift Card Payment Method

## Initial Instruction
Read `.ai/agents.md` first to understand the codebase, then proceed with the task below.

## Requirements
Add support for gift card payments to the checkout flow.

### Functional Requirements
- Users can apply gift cards during checkout
- Gift card balance is validated before order completion
- Multiple gift cards can be applied to a single order
- Partial gift card redemption is supported (use $20 from $50 card)
- Remaining gift card balance is tracked and can be used later
- Gift card codes are alphanumeric, 16 characters

### Constraints
- Must follow existing payment processing patterns (see `patterns/`)
- Must integrate with existing Payment Module architecture
- Gift card validation handled by external GiftCard API (similar to Stripe integration)
- Must emit payment events for analytics tracking
- Cannot modify Order Module's core flow
- Must support atomic transactions (all or nothing)

### Acceptance Criteria
- [ ] Gift card can be applied to checkout page
- [ ] Balance validation works correctly via GiftCard API
- [ ] Order total is reduced by gift card amount
- [ ] Multiple gift cards can be combined
- [ ] Failed validations show clear error messages
- [ ] Payment events include gift card information
- [ ] Unit tests cover all scenarios (valid, invalid, partial, multiple)
- [ ] Integration tests verify GiftCard API interaction
- [ ] Documentation updated in Payment Module file

## Additional Context
- **GiftCard API endpoint**: `POST /api/v1/giftcards/validate`
- **API Request**: `{"code": "ABCD1234EFGH5678", "amount": 1999}`
- **API Response**: `{"valid": true, "balance": 5000, "code": "ABCD1234EFGH5678"}`
- **Error Response**: `{"valid": false, "error": "INVALID_CODE"}` or `{"valid": false, "error": "INSUFFICIENT_BALANCE"}`

## Deliverables
- Code changes to Payment Module
- Update `.ai/modules/payment-module.md` with gift card logic
- Add tests for gift card payment flow (unit + integration)
- Update API documentation if new endpoints added
```

---

### Example 2: Bug Fix

```markdown
# Task: Fix Duplicate Order Confirmation Emails

## Initial Instruction
Read `.ai/agents.md` first to understand the codebase, then proceed with the task below.

## Requirements
Fix issue where users receive duplicate order confirmation emails.

### Problem Description
- Users report receiving 2-3 identical order confirmation emails
- Happens intermittently, approximately 30% of orders
- Started after recent deployment (2 weeks ago)
- Emails are identical in content, just sent multiple times

### Investigation Starting Points
- Check Notification Module event handling
- Review async job processing
- Check for race conditions in event publishing

### Constraints
- Must preserve existing email templates
- Cannot change notification event schema (other systems depend on it)
- Must follow existing async job patterns
- Cannot disable email notifications during fix

### Acceptance Criteria
- [ ] Root cause identified and documented
- [ ] Fix prevents duplicate emails
- [ ] No regression in email delivery (all users still get at least one email)
- [ ] Solution follows existing patterns (see `patterns/`)
- [ ] Add safeguards to prevent future duplicates
- [ ] Update documentation with new gotcha

## Additional Context
- Users mention it happens more during high traffic periods
- Email sending is handled by Notification Module
- Suspicion: race condition in async job processing or event publishing
- Check if events are being published multiple times
- Check if job queue is processing same job multiple times

## Deliverables
- Root cause analysis document
- Code fix with explanation of what was wrong
- Update `.ai/modules/notification-module.md` with new gotcha about duplicate prevention
- Tests to prevent regression (verify emails sent exactly once)
- Post-deployment monitoring plan
```

---

### Example 3: Refactoring

```markdown
# Task: Extract Caching Logic to Shared Module

## Initial Instruction
Read `.ai/agents.md` first to understand the codebase, then proceed with the task below.

## Requirements
Extract duplicated caching logic from Payment and Order modules into a shared Cache Manager utility.

### Functional Requirements
- Create new Cache Manager in shared/utility modules
- Migrate caching logic from Payment Module
- Migrate caching logic from Order Module
- Maintain existing cache key patterns (don't break existing cache entries)
- No change in cache behavior or TTLs
- Support both Redis and in-memory caching

### Constraints
- Must follow existing caching patterns (see `patterns/caching.md`)
- Zero downtime during migration (deploy gradually)
- Must maintain backward compatibility
- No changes to Redis configuration or connection
- Must handle cache failures gracefully (same as before)

### Acceptance Criteria
- [ ] Cache Manager module created in shared/utilities
- [ ] Payment Module refactored to use Cache Manager
- [ ] Order Module refactored to use Cache Manager
- [ ] All existing tests still pass
- [ ] No performance regression (measure before/after)
- [ ] Documentation updated for all three modules
- [ ] New tests for Cache Manager
- [ ] Migration completed without downtime

## Additional Context
- Current caching is similar but not identical between modules
- Both use Redis with TTL-based expiration
- Payment Module caches payment status (5 min TTL)
- Order Module caches order details (10 min TTL)
- Need to decide on unified interface while supporting different TTLs
- Consider making TTL configurable per cache key

## Deliverables
- New Cache Manager module with comprehensive tests
- Updated Payment Module using Cache Manager
- Updated Order Module using Cache Manager
- Create `.ai/modules/cache-manager.md` (follow Step 3 template)
- Update `.ai/agents.md` Module Map to include Cache Manager
- Update `.ai/modules/payment-module.md` to reference Cache Manager
- Update `.ai/modules/order-module.md` to reference Cache Manager
- Migration plan document (deployment steps, rollback plan)
```

---

### Example 4: Documentation Task

```markdown
# Task: Document ShipStation API Integration

## Initial Instruction
Read `.ai/agents.md` first to understand the codebase, then proceed with the task below.

## Requirements
Document the newly integrated ShipStation API in the context layer.

### Functional Requirements
- Document ShipStation API integration in context layer
- Explain how Shipping Module uses ShipStation
- Document error handling and retry logic
- List all API endpoints used
- Explain data flow from order to shipment
- Document webhook handling

### Constraints
- Follow existing pattern documentation style (see `patterns/`)
- Include code examples from actual implementation
- Mark as "Found" evidence since API is already integrated
- Must be detailed enough for LLMs to understand without reading code

### Acceptance Criteria
- [ ] External system added to `.ai/agents.md` External Systems section
- [ ] `.ai/modules/shipping-module.md` documents ShipStation usage in detail
- [ ] API integration details are clear (endpoints, auth, error handling)
- [ ] Error scenarios documented with examples
- [ ] Webhook handling documented
- [ ] Code examples include file paths and line numbers

## Additional Context
- ShipStation integration was added last month
- Code is in `src/shipping/` directory
- Uses ShipStation REST API v3
- Handles webhooks for shipment tracking updates
- Retry logic already implemented (check if follows error-handling pattern)

## Deliverables
- Update `.ai/agents.md` External Systems section with ShipStation entry
- Update `.ai/modules/shipping-module.md` with complete ShipStation integration details
- If shipping API pattern is reusable, consider creating `patterns/shipping-api.md`
- Document webhook handling process
- Include code examples from actual implementation
```

---

### Example 5: Investigation Task

```markdown
# Task: Investigate Performance Degradation in Order Processing

## Initial Instruction
Read `.ai/agents.md` first to understand the codebase, then proceed with the task below.

## Requirements
Investigate why order processing has slowed from 500ms to 2000ms average latency.

### Problem Description
- Average order processing time increased 4x over past 2 weeks
- No obvious changes to order volume
- Database queries seem slow
- Users complaining about checkout speed

### Investigation Goals
- Identify the bottleneck causing slowdown
- Determine if it's code, database, or external API
- Recommend specific fixes
- Prioritize fixes by impact

### Constraints
- Cannot disable order processing for investigation
- Must investigate in production (staging doesn't replicate issue)
- Cannot add significant logging overhead
- Follow existing monitoring patterns

### Acceptance Criteria
- [ ] Root cause identified with evidence
- [ ] Specific bottleneck pinpointed (code location, query, API call)
- [ ] Impact quantified (how much time this bottleneck adds)
- [ ] Recommended fixes prioritized by impact
- [ ] Quick wins identified (can be deployed immediately)
- [ ] Longer-term optimizations documented

## Additional Context
- Check database query performance (see `patterns/data-access.md`)
- Review external API calls (Stripe, Inventory API)
- Check if caching is working properly
- Review recent deployments for clues
- 95th percentile latency is 5 seconds (unacceptable)

## Deliverables
- Investigation report with findings
- Bottleneck identification with evidence (query plans, API logs, profiling)
- Prioritized list of fixes
- Quick fixes implemented if possible
- Long-term optimization plan
- Update relevant module documentation with performance gotchas
```

---

## How LLMs Use the Context

When you give a task prompt with "Read `.ai/agents.md` first", the LLM will:

1. **Start at root**: Read `agents.md` for system overview, tech stack, module map
2. **Identify relevant modules**: Check Module Map for modules related to task
3. **Read module contexts**: Open relevant `modules/*.md` files for details
4. **Check patterns**: Follow pattern links to understand conventions
5. **Review architecture**: Read `architecture/*.md` if multi-module changes
6. **Understand constraints**: Read gotchas and constraints in module files
7. **Implement**: Write code following discovered patterns
8. **Ask questions**: If unclear, ask specific questions based on context

---

## Tips for Writing Effective Task Prompts

### Do:
✅ **Always start with "Read `.ai/agents.md` first"**  
✅ **Be specific about requirements** - What exactly needs to be done?  
✅ **List constraints explicitly** - Reference patterns by name  
✅ **Include acceptance criteria** - How to know when done?  
✅ **Mention likely modules** - Help LLM navigate faster  
✅ **Provide external API details** - Endpoints, request/response formats  
✅ **Request documentation updates** - Keep context layer current  

### Don't:
❌ **Assume LLM knows your codebase** - Always point to `.ai/`  
❌ **Be vague about requirements** - "Make it better" isn't helpful  
❌ **Skip constraints** - They prevent mistakes  
❌ **Forget deliverables** - What artifacts are expected?  
❌ **Ignore documentation** - Context layer must stay updated  

---

## Task Prompt Patterns

### For Features:
```
Read .ai/agents.md first.
Add [feature] that [does what].
Must follow [pattern] and integrate with [module].
Update [module].md when done.
```

### For Bugs:
```
Read .ai/agents.md first.
Fix [problem] in [module].
Root cause is likely [area].
Must not break [constraint].
Add gotcha to prevent recurrence.
```

### For Refactoring:
```
Read .ai/agents.md first.
Extract [duplicated code] to [new module].
Follow [pattern] for structure.
Zero downtime deployment required.
Update all affected module docs.
```

### For Documentation:
```
Read .ai/agents.md first.
Document [new feature/integration].
Follow existing pattern doc style.
Include code examples with file paths.
Update agents.md with new [module/pattern/system].
```

---

## Task Prompt Storage

Save task-specific prompts for reusability:

```
prompts/
└── tasks/
    ├── add-gift-card-payment.md
    ├── fix-duplicate-emails.md
    ├── extract-caching-module.md
    └── document-shipstation-integration.md
```

This creates a library of tasks that can be:
- Reused for similar features
- Referenced in documentation
- Used as examples for new tasks
- Adapted for different modules

---

## Advanced: Multi-Step Tasks

For complex tasks requiring multiple phases:

```markdown
# Task: Implement Complete User Profile System

## Initial Instruction
Read `.ai/agents.md` first to understand the codebase, then proceed with the task below.

## Overview
This is a multi-phase task. Complete each phase before moving to the next.
Request approval between phases.

## Phase 1: Data Model Design
### Requirements
- Design User Profile schema (fields, relationships)
- Add to `.ai/architecture/data-model.md`
- Consider privacy requirements (GDPR compliance)

### Deliverables
- Schema design document
- Updated data-model.md

**Stop here and get approval before Phase 2**

## Phase 2: Backend Implementation
### Requirements
- Create Profile Module
- Implement CRUD operations
- Follow existing patterns (see `patterns/`)

### Deliverables
- Profile Module code with tests
- Create `.ai/modules/profile-module.md`

**Stop here and get approval before Phase 3**

## Phase 3: API Layer
### Requirements
- Add REST endpoints (see `patterns/api-design.md`)
- Add input validation (see `patterns/validation.md`)
- Follow auth patterns (see `patterns/auth-patterns.md`)

### Deliverables
- API endpoints with tests
- Update profile-module.md with API documentation

**Stop here and get approval before Phase 4**

## Phase 4: Integration & Documentation
### Requirements
- Integrate with User Module
- Add event publishing if needed
- Complete all documentation

### Deliverables
- Integration complete
- Update `.ai/agents.md` Module Map
- Update affected module docs

[Continue with full requirements for each phase...]
```

---

## Testing Your Task Prompts

Before using a task prompt at scale:

1. **Test with simple task**: Start small, well-defined
2. **Observe LLM behavior**: 
   - Does it read the context?
   - Does it follow patterns?
   - Does it ask good questions?
3. **Check output quality**: 
   - Matches existing code style?
   - Follows documented patterns?
   - Includes tests?
4. **Identify gaps**: What context was missing?
5. **Update context**: Add missing information to `.ai/`
6. **Iterate**: Refine both prompt and context

---

## Common Task Prompt Mistakes

### Mistake 1: Not Referencing `.ai/agents.md`
```markdown
# BAD
Task: Add payment feature

# GOOD
Task: Add payment feature

Read `.ai/agents.md` first to understand the codebase.
```

### Mistake 2: Vague Requirements
```markdown
# BAD
Make the checkout better

# GOOD
Add gift card payment method to checkout
- Must validate gift card balance via GiftCard API
- Must support multiple gift cards per order
- Must follow error-handling pattern for API calls
```

### Mistake 3: Missing Constraints
```markdown
# BAD
Add email verification

# GOOD
Add email verification
- Must use existing Notification Module (don't create new one)
- Must follow auth-patterns.md for token generation
- Cannot change User table schema
```

### Mistake 4: Forgetting Documentation Updates
```markdown
# BAD
Deliverables:
- Code changes
- Tests

# GOOD
Deliverables:
- Code changes with tests
- Update .ai/modules/[affected-module].md
- Update .ai/agents.md if adding new module
```

---

## Summary

**Context Layer** (`.ai/`) = The knowledge base  
**Task Prompt** = The specific mission using that knowledge

The magic formula:
```
"Read `.ai/agents.md` first" + Specific Requirements + Clear Constraints = Success
```

This enables:
- **Autonomous navigation** - LLM finds what it needs
- **Pattern compliance** - Code follows conventions
- **Faster development** - Less explaining, more building
- **Better quality** - Gotchas are documented and avoided

Start simple, test often, iterate based on results!
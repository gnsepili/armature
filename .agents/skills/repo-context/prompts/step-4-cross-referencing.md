# Step 4: Cross-Reference & Finalize

## Objective
Complete all cross-references between files, verify the context layer is ready for use, and create usage documentation.

## Prerequisites
- All module files created in Step 3
- All pattern files created in Step 0
- Architecture files created in Step 2

## Benefits of Early Pattern Extraction
Since patterns were extracted in Step 0 and referenced during module generation in Step 3, this step requires **less work** than traditional approaches. Most cross-references should already be in place - this step just verifies and completes them.

---

## Task 1: Update Pattern Files with Module References

For each `.ai/patterns/[name].md`:

### Update "Where Used" Section
Add links to specific module files that use this pattern. Be detailed and specific.

**Current state** (from Step 0):
```markdown
## Where Used
- Payment Service - Stripe API calls
- Notification Service - Email sending
```

**Update to** (add links and details):
```markdown
## Where Used
- [Payment Service](../modules/payment-service.md) - Stripe API call error handling in `src/payments/service.py:66-85`. Network timeouts and 503 errors wrapped in RetryableError for job retry. Card declines (4xx) are not retried.
- [Notification Service](../modules/notification-service.md) - SendGrid API error handling in `src/notifications/email.py:120-145`. Rate limits (429) are retried with backoff. Invalid email addresses (400) are not retried.
- [Order Service](../modules/order-service.md) - External warehouse API calls in `src/orders/fulfillment.py:200-230`. Connection timeouts retry up to 5 times since inventory allocation must succeed.
```

**Key improvements**:
- Link to actual module files using relative paths `../modules/[name].md`
- Include file paths and line numbers from the codebase
- Explain the specific usage context (not just "uses this pattern")
- Note any variations or customizations

### Update "Related Patterns" Section
Link to other patterns that work together:

```markdown
## Related Patterns
- [Logging](logging.md) - Always used together. Each retry attempt is logged with context (attempt number, error details, time since first attempt) for debugging intermittent failures. See the logging pattern for structured log format.

- [Idempotency](idempotency.md) - Essential when retrying operations with side effects. Ensures retries don't duplicate actions (double charges, double emails, etc.). The error handling pattern triggers retries, the idempotency pattern ensures they're safe.

- [Async Jobs](async-jobs.md) - The job processing system that handles RetryableError. When this pattern raises RetryableError, the async jobs pattern manages the retry scheduling and exponential backoff.
```

**Key improvements**:
- Explain the relationship (how patterns work together)
- Link to the actual pattern files
- Be specific about when you need both patterns

---

## Task 2: Verify Module File Cross-References

For each `.ai/modules/[name].md`:

### Check "Dependencies" Section
Verify all module dependencies have working links:

```markdown
## Dependencies

### Internal Modules
- **User Service** → `user-service.md` - Validates user authentication before processing orders
- **Payment Service** → `payment-service.md` - Charges credit card for order total
- **Inventory Service** → `inventory-service.md` - Reserves items before payment
```

**What to check**:
- [ ] Links use relative paths (just filename, not `../modules/`)
- [ ] All referenced modules have corresponding files
- [ ] Descriptions explain why the dependency exists

### Check "Patterns Used" Section
Verify all patterns are linked (should already be done in Step 3):

```markdown
## Patterns Used

- **Error Handling** → `../patterns/error-handling.md`
  - Usage: All external API calls wrapped with RetryableError pattern
  - Example: `src/orders/api_client.py:45-67`
  
- **Logging** → `../patterns/logging.md`
  - Usage: Structured logging with order_id context for all operations
  - Example: All methods in OrderService include log statements

- **Async Jobs** → `../patterns/async-jobs.md`
  - Usage: Failed order operations retried via background jobs
  - Example: `src/orders/jobs.py` contains retry job definitions
```

**What to check**:
- [ ] Links use correct relative path (`../patterns/`)
- [ ] All referenced patterns have corresponding files
- [ ] Usage explanation is specific (not generic)

### Add Missing Cross-References
If you find modules that reference others without links, add them.

**Example - in data flow section**:
```markdown
## Data Flow
After processing the order, the system notifies the User Service of completion.
```

**Update to**:
```markdown
## Data Flow
After processing the order, the system notifies the [User Service](user-service.md) of completion.
```

---

## Task 2.5: Update Feature Files (if Step 1.5 was run)

For each `.ai/features/[name].md`:

### Add "Modules Involved" Links
Ensure all modules are linked:

```markdown
## Modules Involved
- **CheckoutService** → `../modules/checkout-service.md` - Orchestrates checkout flow
- **PaymentService** → `../modules/payment-service.md` - Processes payment
```

### Add "Patterns Used" Links  
Link to relevant patterns:

```markdown
## Patterns Used
- **Error Handling** → `../patterns/error-handling.md` - Payment retry logic
- **Logging** → `../patterns/logging.md` - Checkout step tracking
```

### Update Module Files
For each module referenced in features, add "Features Implemented":

```markdown
## Features Implemented
- **Checkout** → `../features/checkout.md` - Handles checkout orchestration
- **Payment** → `../features/payment.md` - Processes card charges
```

---

## Task 3: Finalize `agents.md`

### Verify All Sections Are Complete

Go through `agents.md` and check:

```markdown
# [Project Name]

✓ System Overview - [Should have 2-3 sentences, not placeholder]
✓ Technology Stack - [Should list actual tech, not "[framework]"]
✓ Directory Structure - [Should show actual structure]
✓ Code Conventions - [Should list real conventions]
✓ Configuration - [Should show actual config locations]
✓ Development Workflow - [Should describe real workflow]
✓ Cross-Cutting Concerns - [Should list actual approaches]
✓ Common Patterns - [Should link to ALL pattern files]
✓ Module Map - [Should list ALL modules]
✓ Architecture - [Should link to architecture files]
✓ External Systems - [Should list ALL external services]
```

### Verify Pattern Links
Ensure ALL pattern files from Step 0 are listed in the Common Patterns section:

```markdown
## Common Patterns

### Design Patterns
- API design → `patterns/api-design.md`
- Error handling → `patterns/error-handling.md`
- Validation → `patterns/validation.md`

### Infrastructure Patterns
- Logging → `patterns/logging.md`
- Caching → `patterns/caching.md`
- Serialization → `patterns/serialization.md`
- Tracing → `patterns/tracing.md`

### Data Patterns
- Data access → `patterns/data-access.md`
- Transactions → `patterns/database-transactions.md`

### Integration Patterns
- Async jobs → `patterns/async-jobs.md`
- Event publishing → `patterns/event-publishing.md`
- Auth → `patterns/auth-patterns.md`

[Include EVERY pattern file created in Step 0]
```

**What to check**:
- [ ] Every `.ai/patterns/*.md` file is linked
- [ ] Links use correct relative path (`patterns/`, not `./patterns/`)
- [ ] Patterns are organized into logical groups
- [ ] No broken links

### Verify Module Links
Ensure ALL modules from Step 1 are listed with correct file paths:

```markdown
## Module Map

### Core Modules
- **Payment Service** → `modules/payment-service.md` - Credit card processing via Stripe
- **User Service** → `modules/user-service.md` - Authentication and profile management
- **Order Service** → `modules/order-service.md` - Order lifecycle and fulfillment
- **Inventory Service** → `modules/inventory-service.md` - Product inventory tracking

### Shared/Utility Modules
- **Logger** → `modules/logger.md` - Centralized structured logging
- **Cache Manager** → `modules/cache-manager.md` - Redis caching layer

[All modules must be listed]
```

**What to check**:
- [ ] Every `.ai/modules/*.md` file is linked
- [ ] Links use correct relative path (`modules/`, not `./modules/`)
- [ ] One-line descriptions are informative
- [ ] Core vs Shared distinction is clear

### Verify Architecture Links

```markdown
## Architecture
- System overview → `architecture/module-interactions.md`
- Data model → `architecture/data-model.md` (if created)
```

**What to check**:
- [ ] Links point to files that exist
- [ ] Paths are correct (`architecture/`, not `./architecture/`)

### Verify External Systems

```markdown
## External Systems
- **Stripe** - Payment processing - Used by: Payment Module
- **SendGrid** - Email delivery - Used by: Notification Module
- **PostgreSQL** - Primary database - Used by: All modules
- **Redis** - Caching and sessions - Used by: Auth Module, Inventory Module

[All external integrations must be listed]
```

**What to check**:
- [ ] All external systems from Step 2 are listed
- [ ] Each system shows which modules use it
- [ ] No placeholder text

---

## Task 4: Update Architecture Files

### `.ai/architecture/module-interactions.md`
Ensure it references pattern files where relevant:

```markdown
## Communication Patterns

### Error Handling
All modules use the standard error handling pattern for external API calls.
See: `../patterns/error-handling.md` for retry logic and error classification.

### Logging
Structured logging with distributed tracing across all modules.
See: `../patterns/logging.md` for log format and `../patterns/tracing.md` for correlation IDs.
```

**What to add**:
- References to relevant pattern files
- Links should use relative paths (`../patterns/`)

### `.ai/architecture/data-model.md`
Link to relevant patterns:

```markdown
## Data Access Patterns
See `../patterns/data-access.md` for how modules query this data model.

## Transaction Management
See `../patterns/database-transactions.md` for transaction boundaries and isolation levels.

## Caching Strategy
See `../patterns/caching.md` for what data is cached and invalidation strategies.
```

---

## Task 5: Create Context Usage Guide

Create `.ai/README.md`:

```markdown
# AI Context Layer

## For LLMs (Claude, GPT, etc.)

**Always start by reading `agents.md`**, then follow cross-references based on your task.

### Navigation Workflow:
1. **Read `agents.md`** - Get system overview, tech stack, module map, common patterns
2. **Identify relevant modules** - Check Module Map for which modules handle your task
3. **Read module files** - Open `modules/[name].md` for detailed module information
4. **Follow pattern links** - Click pattern references to understand implementation details
5. **Check architecture** - Read `architecture/` files for cross-module interactions
6. **Review related modules** - Follow dependency links to understand module relationships

### Example Navigation:
**Task**: "Add gift card payment method"

1. Read `agents.md` → See Payment Module in Module Map
2. Open `modules/payment-service.md` → Learn how payments work
3. Follow link to `patterns/error-handling.md` → Understand retry logic
4. Follow link to `patterns/api-design.md` → Learn API conventions
5. Check `architecture/module-interactions.md` → See how Payment integrates with Order
6. Open `modules/order-service.md` → Understand order flow

This navigation path gives you complete context to implement the feature correctly.

## For Humans

This directory contains AI-friendly documentation that helps LLMs understand our codebase.

### Structure:
```
.ai/
├── README.md (this file)
├── agents.md (START HERE - root navigation)
├── modules/ (deep dives on each module)
│   ├── payment-service.md
│   ├── order-service.md
│   └── ...
├── patterns/ (recurring patterns and conventions)
│   ├── error-handling.md
│   ├── logging.md
│   └── ...
└── architecture/ (system-level design docs)
    ├── module-interactions.md
    └── data-model.md
```

### How to Use:

**For LLMs**: Give them this instruction:
```
Read `.ai/agents.md` first, then explore based on your task.
```

**For Code Review**: 
- Check if new code follows documented patterns
- Verify module boundaries are respected
- Ensure error handling matches pattern

**For Onboarding**: 
- New developers read `agents.md` first
- Then relevant module files for their area
- Then patterns they'll use frequently

**For Feature Planning**:
- Check `architecture/module-interactions.md` to understand impacts
- Review affected module files to understand current behavior
- Identify patterns that should be followed

### Maintenance:

#### When Adding a New Module:
1. Create `modules/[module-name].md` using the template from `prompts/context-generation/03-generate-module-contexts.md`
2. Update `agents.md` Module Map section to include the new module
3. Add cross-references to related modules
4. Reference relevant patterns in the new module file
5. Update `architecture/module-interactions.md` if the new module changes system architecture

#### When Adding a New Pattern:
1. Create `patterns/[pattern-name].md` using the template from `prompts/context-generation/00-extract-global-context.md`
2. Update `agents.md` Common Patterns section
3. Update module files that use this pattern to reference it
4. Add "Where Used" references linking back to modules
5. Link to related patterns

#### When Code Changes:
- **Module behavior changes**: Update the relevant `modules/[name].md` file
- **Pattern changes**: Update `patterns/[name].md` and check which modules reference it
- **New gotchas discovered**: Add to relevant module's Gotchas section
- **New external system**: Add to `agents.md` External Systems and relevant module files
- **Architecture changes**: Update `architecture/module-interactions.md`

#### When to Update:
- **Immediately**: When adding new modules or major features
- **During PR review**: Update context as part of the code review process
- **Weekly**: Review and update gotchas, edge cases discovered during the week
- **Monthly**: Verify all cross-references are still accurate
- **Quarterly**: Consider if any modules should be split or merged based on actual usage

### Regenerating Context:
If the codebase changes significantly (major refactor, architecture change), re-run the generation sequence:

1. `prompts/context-generation/00-extract-global-context.md`
2. `prompts/context-generation/01-discover-modules.md`
3. `prompts/context-generation/02-map-relationships.md`
4. `prompts/context-generation/03-generate-module-contexts.md`
5. `prompts/context-generation/04-cross-reference.md` (this step)

Senior engineers should review and refine generated content before committing.

### Testing the Context:
Before considering the context layer complete, test it with real tasks:

1. **Test navigation**: Give an LLM: "Read `.ai/agents.md` and tell me how the payment system works"
2. **Test task execution**: Give an LLM a real feature: "Add email verification to user registration"
3. **Test debugging**: Give an LLM a bug: "Users report duplicate order confirmation emails"
4. **Note gaps**: What did the LLM ask about that wasn't documented? Add that context.
5. **Iterate**: Update context based on what worked and what didn't

### Context Quality Metrics:

**Good context layer has**:
- ✅ LLM can navigate from `agents.md` to any module via links
- ✅ Patterns are referenced from modules, modules referenced from patterns
- ✅ No broken links anywhere
- ✅ Gotchas include problem + solution with code
- ✅ Real code examples with file paths and line numbers
- ✅ "Why" is explained for design decisions
- ✅ External systems documented with evidence

**Signs context needs improvement**:
- ❌ LLM asks for information that's already documented
- ❌ LLM doesn't follow patterns correctly
- ❌ LLM can't find relevant modules
- ❌ LLM makes assumptions instead of reading context
- ❌ Developers find the documentation unhelpful

### Getting Help:

**Questions about the context layer**:
- See `prompts/context-generation/SEQUENCE-GUIDE.md` for the generation process
- See `prompts/context-generation/TASK-PROMPT-TEMPLATE.md` for how to use the context

**Contributing improvements**:
- Add missing gotchas as you discover them
- Update patterns when code changes
- Add links to make navigation easier
- Clarify confusing sections
```

---

## Task 6: Verify Complete Structure

### Final Directory Structure:
```
.ai/
├── README.md                       ✓ Usage guide
├── agents.md                       ✓ Root navigation (complete)
├── modules/
│   ├── payment-service.md         ✓ With cross-references
│   ├── order-service.md           ✓ With cross-references
│   ├── user-service.md            ✓ With cross-references
│   └── ...                        ✓ All modules documented
├── patterns/
│   ├── api-design.md              ✓ With module references
│   ├── error-handling.md          ✓ With module references
│   ├── logging.md                 ✓ With module references
│   └── ...                        ✓ All patterns documented
└── architecture/
    ├── module-interactions.md     ✓ With pattern references
    └── data-model.md              ✓ (if applicable)

prompts/
└── context-generation/             ✓ All prompt files
    ├── 00-extract-global-context.md
    ├── 01-discover-modules.md
    ├── 02-map-relationships.md
    ├── 03-generate-module-contexts.md
    └── 04-cross-reference.md
```

---

## Task 7: Link Verification

### Automated Check (if possible):
```bash
# Find all .md files
find .ai -name "*.md" -type f

# Check for broken relative links
# Look for patterns like `[text](../path/file.md)` and verify files exist
```

### Manual Check:
Run through the entire context layer to verify navigation:

**Navigation Test Checklist**:
1. [ ] Start at `agents.md`
2. [ ] Click a pattern link → pattern file opens
3. [ ] From pattern, click "Where Used" → module file opens
4. [ ] From module, click a dependency link → related module opens
5. [ ] From module, click a pattern link → pattern file opens
6. [ ] From module, click architecture link → architecture file opens
7. [ ] From architecture, click pattern link → pattern file opens
8. [ ] No broken links encountered anywhere

**Completeness Check**:
- [ ] Every file in `.ai/modules/` is linked from `agents.md` Module Map
- [ ] Every file in `.ai/patterns/` is linked from `agents.md` Common Patterns
- [ ] Every module's dependencies are linked to actual module files
- [ ] Every module's patterns are linked with `../patterns/` prefix
- [ ] Every pattern's "Where Used" references modules with `../modules/` prefix
- [ ] Architecture files are linked from `agents.md`
- [ ] All relative paths are correct (../ where needed)

**Quality Check**:
- [ ] No placeholder text like "[TODO]" or "[Fill this in]"
- [ ] No generic text like "[purpose]" or "[description]"
- [ ] Specific file paths included where helpful (src/payment/service.py:45)
- [ ] "Evidence: Found/Assumed" annotations for external systems
- [ ] Gotchas are specific with problem + solution code
- [ ] Workflows have step-by-step narratives (not just bullet points)
- [ ] "Why" is explained for decisions and patterns

---

## Task 8: Test the Context Layer

### Test 1: LLM Navigation Test
```
Read .ai/agents.md and tell me:
1. What are the core modules in this system?
2. What patterns does [KEY_MODULE] use?
3. How does [MODULE_A] communicate with [MODULE_B]?
```

Replace [KEY_MODULE], [MODULE_A], [MODULE_B] with actual modules from your system.

### Test 2: Real Feature Task
```
[Pick an actual feature you might implement]

Examples:
- Add [new payment method/authentication provider/data source]
- Implement [search/filtering/export] functionality
- Add [notification/report/integration] feature
```

### Test 3: Bug Debugging Task
```
[Use a real bug pattern from your domain]

Examples:
- Users report [duplicate notifications/slow queries/failed transactions]
- [Specific component] not working under [specific condition]
```

### Test 4: Pattern Discovery
```
How should I handle [common technical concern]?

Examples:
- Database transactions
- External API calls
- File uploads
- Caching strategy
- Error handling
```

**Expected result**: LLM should answer all questions by following links in the context layer.

**If it fails**: 
- Missing links → Add them
- Unclear descriptions → Make them more detailed
- Can't find information → Add it to the relevant file

### Test 2: Real Feature Task
Give an LLM a real feature request:
```
Add support for gift card payments to the checkout flow.
Start by reading .ai/agents.md, then implement this feature.
```

**Observe**:
- ✓ Does it read `agents.md` first?
- ✓ Does it identify the correct modules (Payment, Order)?
- ✓ Does it follow pattern links (error handling, API design)?
- ✓ Does it ask clarifying questions based on constraints it discovered?
- ✓ Does it reference existing code locations from the context?

**If it struggles**:
- Add missing context to module files
- Add missing patterns
- Clarify module boundaries
- Add more gotchas/constraints

### Test 3: Bug Debugging Task
Give an LLM:
```
Users report receiving duplicate order confirmation emails.
Start by reading .ai/agents.md to understand the system.
Find the root cause and suggest a fix.
```

**Expected**:
- Reads notification module context
- Checks event publishing pattern
- Reviews async jobs pattern
- Identifies potential race condition
- Suggests fix based on patterns

### Test 4: Pattern Discovery Test
Ask an LLM:
```
How should I handle errors when calling external APIs in this codebase?
Start by reading .ai/agents.md.
```

**Expected**:
- Navigates to error-handling pattern
- Finds examples in modules that call external APIs
- References retry strategies
- Provides specific code examples from the pattern

### Document Test Results
After testing, update context based on gaps:

**If LLM struggled to find information**:
- Was the information missing? → Add it
- Was it hard to find? → Add better cross-references
- Was it unclear? → Rewrite with more detail

**If LLM made incorrect assumptions**:
- Add constraints/gotchas to prevent the assumption
- Add "Never Do This" sections
- Include examples of correct approach

---

## File Creation Checklist

Create this file:
- [ ] `.ai/README.md`

Update these files:
- [ ] `.ai/agents.md` (verify all sections complete)
- [ ] `.ai/modules/*.md` (verify all cross-references)
- [ ] `.ai/patterns/*.md` (add module references to "Where Used")
- [ ] `.ai/architecture/*.md` (verify pattern references)

---

## Success Criteria

The context layer is complete when:

1. **Discoverability**: ✓ An LLM can navigate from `agents.md` to any module or pattern via links
2. **Completeness**: ✓ All modules, patterns, and architecture docs are present and linked
3. **Specificity**: ✓ Gotchas and constraints are concrete with code examples (not generic advice)
4. **Evidence-based**: ✓ External systems marked with evidence of where they were found
5. **Maintainable**: ✓ Clear structure and README explaining how to update
6. **Tested**: ✓ Successfully validated on real feature/bug tasks with LLMs

---

## Next Steps After Completion

### Immediate Actions:
1. **Share with team**: Explain how to read and update context files
2. **Add to onboarding**: Include context layer in new developer documentation
3. **Integrate into workflow**: Reference context in PR templates, require updates
4. **Monitor usage**: Track what LLMs ask for that's missing

### Ongoing Maintenance:
1. **Update incrementally**: Add context when code changes
2. **Review regularly**: Monthly check that context is accurate
3. **Iterate based on usage**: Update based on LLM performance
4. **Expand coverage**: Add more patterns/modules as code evolves

### Measure Success:
1. **Productivity gains**: Are features implemented faster with context?
2. **Fewer clarifications**: Do LLMs ask fewer questions?
3. **Better code quality**: Does code follow patterns more consistently?
4. **Easier onboarding**: Do new developers get up to speed faster?

---

## Context Layer Complete! 🎉

You now have a systematic context infrastructure with:
- **Clear navigation** from `agents.md` to all modules and patterns
- **Pattern reusability** across modules with explicit references
- **Relationship mapping** in architecture docs
- **Discoverable knowledge** for any LLM to explore autonomously

The context layer is ready to accelerate AI-assisted development. Start using it on real tasks and refine based on what works!
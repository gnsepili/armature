# Step 0: Extract Global Context & Patterns

## What We're Building

We are creating a **systematic context layer** for this repository that enables LLMs to autonomously navigate and understand the codebase.

### Key Principles
1. **Layered, composable context** - Not monolithic documentation
2. **Discoverable navigation** - LLM follows cross-references autonomously  
3. **Task-agnostic** - Context serves multiple use cases (features, bugs, refactoring)
4. **Pattern-based** - Extract and reuse common patterns
5. **Evidence-based** - Mark what's found vs. inferred

### The End Result

A structured context layer in `.ai/` that contains:
- **`agents.md`** - Root navigation (LLMs always start here)
- **`modules/*.md`** - Deep dives on each module/component
- **`patterns/*.md`** - Recurring patterns (error handling, logging, API design, etc.)
- **`architecture/*.md`** - System-level design docs

This enables LLMs to autonomously explore the codebase by following cross-references, understand patterns, and implement features/fixes correctly without constant human guidance.

---

## Objective
Establish the foundation by documenting project-wide context and extracting recurring patterns in one step.

---

## Part 1: Project Context

Analyze the repository to understand structural context:

### 1. Project Overview
- What type of project is this? (web app, API, microservices, library, etc.)
- Primary purpose and domain
- Target users/consumers

### 2. Technology Stack
- Programming language(s) and versions
- Primary frameworks and libraries
- Database(s) and ORM
- External tools (Redis, message queues, etc.)

### 3. Directory Structure
- Root-level organization
- Common directory patterns
- Special directories (config, tests, docs, scripts)

### 4. Code Conventions & Style
- Naming conventions (files, functions, classes, variables)
- Import ordering and grouping
- Formatting standards (beyond linting)
- Documentation style (docstrings, comments)

### 5. Configuration Management
- Config file locations and formats
- Environment variable usage
- How environments are distinguished (dev/staging/prod)
- Feature flags or toggles

### 6. Development Environment
- Setup requirements
- Local development workflow
- Testing approach
- Build and deployment basics

### 7. Cross-Cutting Concerns
- Authentication/authorization approach
- Error handling philosophy
- Logging setup
- Monitoring/observability tools

---

## Part 2: Extract Patterns

Discover patterns **inductively** by analyzing the codebase structure and behavior. Do NOT rely on a predefined list - let the codebase guide you. **Only create pattern files for patterns that actually exist.**

### Discovery Strategy

This approach works for ANY language or framework.

---

#### Phase 1: Find Abstractions

**Look for code that WRAPS or ABSTRACTS complexity:**

1. **Wrapper modules/classes**
   - Files/classes that encapsulate external library usage
   - Utilities that provide a simpler interface to complex operations
   - "Helper" or "Client" classes that other code imports

2. **Base classes/interfaces**
   - Classes that others inherit from
   - Interfaces that multiple implementations share
   - Abstract types that define contracts

3. **Shared utilities**
   - Modules imported by many other modules
   - Functions called from multiple places
   - Common code factored into reusable units

**Each significant abstraction = 1 pattern file**

---

#### Phase 2: Find Repeated Structures

**Look for code that follows CONSISTENT STRUCTURE across the codebase:**

1. **Similar control flow**
   - Error handling blocks that follow the same shape
   - Initialization sequences that repeat
   - Cleanup/teardown patterns

2. **Similar data flow**
   - How data is fetched, transformed, returned
   - How inputs are validated
   - How outputs are formatted

3. **Similar integration points**
   - How external services are called
   - How databases are queried
   - How messages are sent/received

**Each distinct repeated structure = 1 pattern file**

---

#### Phase 3: Analyze Cross-Cutting Concerns

**Every codebase must handle these. Find HOW this one does:**

| Concern | What to Look For |
|---------|------------------|
| **Error Handling** | How are errors caught, logged, propagated, returned to callers? |
| **Logging** | What gets logged, in what format, with what context? |
| **External Communication** | How are HTTP calls, API requests, external services invoked? |
| **Data Persistence** | How is data read/written to databases or storage? |
| **Caching** | How is frequently-accessed data cached and invalidated? |
| **Authentication/Authorization** | How are requests authenticated, permissions checked? |
| **Messaging/Events** | How are async messages published and consumed? |
| **Configuration** | How are settings loaded, environment differences handled? |
| **Validation** | How are inputs validated, errors reported? |
| **Concurrency** | How are concurrent operations managed, race conditions prevented? |

**For each concern with a consistent approach = 1 pattern file**

---

#### Phase 4: Dependency-Driven Discovery

**Analyze external dependencies for missing patterns:**

1. List all external dependencies (package manager file)
2. For each dependency used in multiple places:
   - Is there a documented pattern for how to use it?
   - If not, create one

3. For each integration with external systems:
   - Is there a documented pattern for communication?
   - If not, create one

---

#### Phase 5: Validate Completeness

**Before finalizing, verify no patterns are missing:**

1. **The "New Developer" Test**
   If a new developer asked "How do I...":
   - Make an external API call?
   - Handle errors properly?
   - Log something?
   - Query the database?
   - Cache data?

   Each question should have a corresponding pattern file.

2. **The "3+ Occurrences" Rule**
   Any code structure appearing in 3+ places should be:
   - Either documented as a pattern
   - Or refactored into shared code that IS documented

3. **The "Wrapper Audit"**
   Every wrapper/helper/utility module should have:
   - A corresponding pattern OR
   - A module doc explaining its usage

---

### Language-Agnostic Pattern Signals

Use these universal signals to identify patterns (not language-specific libraries):

| Pattern Type | Universal Signal |
|--------------|------------------|
| External API | Code that makes outbound HTTP/network calls to external services |
| Error Handling | Try/catch blocks, error types, error propagation chains |
| Logging | Log statements, log formatters, contextual log data |
| Data Access | Database queries, ORM usage, transaction management |
| Caching | Get/set operations with expiration/invalidation logic |
| Messaging | Publish/subscribe, queue send/receive operations |
| Validation | Input checking, schema validation before processing |
| Authentication | Token/session handling, permission/role checks |
| Configuration | Environment/file-based settings, feature flags |
| State Machine | State definitions, transition rules, state-based behavior |

---

### Output

Create `patterns/*.md` for EVERY pattern discovered through the phases above. The codebase determines which patterns exist - not a predefined checklist.

---

## Verbosity Guidelines

**CRITICAL**: Context must be detailed enough for LLMs to understand without reading code.

### Writing Style Requirements:
1. **Use full paragraphs** - Not bullet points for descriptions
2. **Always explain "why"** - Not just what, but why decisions were made
3. **Include examples with explanations** - Code + prose explaining what it does
4. **Walk through scenarios** - Step-by-step narratives for complex behaviors
5. **Expand gotchas** - Problem + why it happens + solution with code

### Good vs Bad Examples

**BAD (too terse)**:
```markdown
## Purpose
Error handling pattern.
```

**GOOD (verbose and clear)**:
```markdown
## Purpose
This error handling pattern provides a standardized way to handle both expected business errors and unexpected system failures across all modules. It distinguishes between retryable errors (like temporary network issues) and non-retryable errors (like invalid user input), ensuring consistent error responses and appropriate retry logic. The pattern was introduced to solve issues with inconsistent error handling that made debugging difficult and caused unnecessary retries of permanent failures.
```

---

## Outputs to Create

### Output 1: Create `.ai/patterns/[pattern-name].md` for each pattern

Use this VERBOSE template:

```markdown
# [Pattern Name]

## Overview
[Write 2-3 paragraphs explaining what this pattern is and its role in the codebase. Be detailed and narrative.]

Example:
"The error handling pattern in this codebase distinguishes between recoverable and non-recoverable errors. Recoverable errors are those caused by transient issues like network timeouts or temporary service unavailability. These are wrapped in a RetryableError class that signals to our job processing system that the operation should be retried. Non-recoverable errors, like validation failures or business rule violations, are returned immediately to the user without retry attempts.

This pattern emerged because we integrate with several external APIs that occasionally experience temporary outages. Rather than failing user requests immediately, we queue failed operations for retry, which significantly improves the user experience during partial outages."

## Purpose
[Write detailed explanation of WHY this pattern exists - not just what it does. Explain the problem it solves, what was wrong before, what's better now. Minimum 3-4 sentences.]

Example:
"This pattern exists because we need to differentiate between errors that should immediately fail a user request versus errors that indicate a temporary problem that might resolve if we retry. Before implementing this pattern, we had inconsistent retry behavior across modules - some would retry forever, others wouldn't retry at all, leading to both wasted resources and unnecessary failures. This pattern standardizes our approach and makes retry behavior predictable and debuggable."

## Where Used
[For each location, write detailed context with file paths and line numbers. Minimum 2-3 sentences per location.]

Example:
- **Payment Service** (`src/payment/service.py`, lines 45-89) - When charging credit cards via Stripe API. Network timeouts and 503 errors from Stripe are wrapped in RetryableError, allowing the background job system to retry up to 3 times with exponential backoff. Card declines (4xx errors) are not retried as they indicate permanent failures.

- **Notification Service** (`src/notifications/email.py`, lines 120-145) - When sending emails via SendGrid API. Network errors and rate limits (429) are retried, but invalid email addresses (400) are not.

## Implementation Details

### How It Works
[Write 2-3 paragraphs explaining the implementation in narrative form. Explain key components and how they work together.]

Example:
"The pattern is implemented through two main classes: RetryableError and ErrorHandler. RetryableError is a custom exception class that includes metadata about the operation being attempted and the number of retry attempts already made. When raised, it signals to the job processing system that this operation should be queued for retry.

ErrorHandler is a centralized utility that determines whether an error is retryable based on its type and HTTP status code. It follows these rules: network timeouts are always retryable, 5xx server errors are retryable up to 3 times, 429 rate limits are retryable with exponential backoff, and 4xx client errors are never retryable (except 408 Request Timeout)."

### Code Example
```[language]
# Include actual code from the repo with detailed inline comments
# Show a real usage example, not pseudocode

try:
    response = stripe_client.charge_card(
        amount=payment.amount,
        token=payment.stripe_token
    )
    payment.status = 'completed'
    payment.save()
    
except stripe.error.APIConnectionError as e:
    # Network error - temporary issue that should be retried
    logger.warning(f"Stripe connection failed: {e}")
    raise RetryableError(
        operation='charge_card',
        original_error=e,
        context={'payment_id': payment.id}
    )
    
except stripe.error.CardError as e:
    # Card declined - permanent failure, no retry
    payment.status = 'failed'
    payment.failure_reason = e.user_message
    payment.save()
    raise ValidationError(f"Card declined: {e.user_message}")
```

**Explanation of example**:
[Write 2-3 paragraphs explaining what the code does, why it's structured this way, and what the key decisions are]

"The code shows how Payment Service distinguishes between temporary network failures (APIConnectionError) which should be retried, and permanent card failures (CardError) which should fail immediately. When a network error occurs, we wrap it in RetryableError which the job system will catch and retry after a delay.

The RetryableError includes operation context (payment ID) so we can correlate retries with specific payments in logs. Card declines are handled differently - we immediately mark the payment as failed because retrying won't help."

## Common Scenarios

[Include 2-3 detailed scenario walkthroughs]

### Scenario 1: [Scenario Name]
**Situation**: [Describe the triggering situation]

**What happens** (step-by-step):
1. [Detailed step 1 - write full sentences]
2. [Detailed step 2]
3. [Continue with full narrative]

**Why this approach**:
[Explain the reasoning behind this flow - why these steps, what alternatives were considered, what problems does it solve]

Example:
"API timeouts are almost always temporary - the service is overloaded or there's a brief network issue. Retrying after a short delay usually succeeds. We use exponential backoff to avoid overwhelming an already-struggling service."

### Scenario 2: [Another Scenario]
**Situation**: [Different situation]

**What happens**: [Step-by-step walkthrough]

**Why this approach**: [Rationale]

## Rules & Constraints

[Not just "must do X" but "must do X because Y, here's what happens if you don't"]

### Must Always:

**1. [Rule name]**
[Full paragraph explaining the rule, why it exists, and consequences of violating it]

Example:
"**Wrap network errors in RetryableError** - Any error related to network connectivity (timeouts, connection refused, DNS failures) MUST be wrapped so the job system can retry. This prevents temporary network issues from causing permanent failures. Without this, a brief network blip would fail operations that would have succeeded moments later."

**2. [Another rule]**
[Detailed explanation]

### Never:

**1. [Anti-pattern]**
[Full explanation of why not and what happens if you do it anyway]

Example:
"**Never retry validation errors** - Errors caused by invalid input will not be fixed by retrying. Retrying wastes resources and delays proper error messages from reaching users. If data is invalid, the caller needs to fix it - no amount of retrying will change that."

### When X, Then Y:

**When [condition]** - [Full explanation of what to do and why]

Example:
"**When status code is 429 (rate limit)** - Parse the Retry-After header and delay retry by exactly that amount. Don't use standard exponential backoff. The API is explicitly telling you when to retry, use that value to be respectful of their rate limits."

## Common Gotchas

[Full problem/solution format with detailed explanations]

### Gotcha 1: [Gotcha Name]

**The issue**:
[2-3 sentences explaining what goes wrong and why it's non-obvious]

**Example of the problem**:
```[language]
# Show code that demonstrates the issue
# Include comments explaining what's wrong
```

**The solution**:
```[language]
# Show the correct approach
# Explain why this works
```

[Add paragraph explaining the fix]

### Gotcha 2: [Another Gotcha]
**The issue**: [Explanation]
**Example of the problem**: [Code]
**The solution**: [Code + explanation]

## Anti-Patterns

[What NOT to do - show real examples]

### Anti-Pattern 1: [Name]

**Don't do this**:
```[language]
# Show incorrect code
# Comment why it's wrong
```

**Why it's wrong**:
[Full paragraph explaining the problem, consequences, common misconceptions]

**Do this instead**:
```[language]
# Show correct code
# Explain why this is better
```

[Additional paragraph explaining the fix]

### Anti-Pattern 2: [Another Anti-Pattern]
[Same structure]

## Related Patterns

[Link to patterns that work with this one, with explanation of the relationship]

- [Pattern Name](pattern-file.md) - [2-3 sentences explaining how these patterns work together and when you need both]

Example:
"- [Logging Pattern](logging.md) - Always used together. Each retry attempt is logged with context (attempt number, error details) for debugging intermittent failures. Without proper logging, debugging retry issues is nearly impossible."

## Background & History
[Optional but valuable: Explain how this pattern evolved - 2-3 sentences]

Example:
"This pattern was introduced in Q2 2023 after a Stripe outage caused hundreds of payment failures. Investigation revealed most 'failed' payments were just timeouts that would have succeeded if retried. We studied how Sidekiq and Celery handle retries and adopted their approach."
```

Create pattern files only for patterns that are clearly recurring (used in 2+ places).

Common patterns often include:
- `api-design.md`
- `error-handling.md`
- `logging.md`
- `caching.md`
- `serialization.md`
- `tracing.md`
- `data-access.md`
- `auth-patterns.md`
- `async-jobs.md`
- `configuration.md`
- `validation.md`
- `testing-patterns.md`

---

### Output 2: Create `.ai/agents.md` (initial version)

This is the **ROOT NAVIGATION** file - LLMs always start here.

```markdown
# [Project Name]

## System Overview
[Write 2-3 sentences explaining what this system does, who uses it, and its primary purpose]

Example:
"This is an e-commerce platform that handles online orders, payment processing, and order fulfillment. It serves both web and mobile clients through a REST API, processing thousands of orders daily. The system integrates with external payment processors (Stripe), shipping providers (ShipStation), and email services (SendGrid)."

## Technology Stack
- **Language**: [language and version]
- **Framework**: [framework and version]
- **Database**: [database type and version]
- **Key dependencies**: [list top 3-5 critical libraries]

Example:
- **Language**: Python 3.11
- **Framework**: Django 4.2
- **Database**: PostgreSQL 15
- **Key dependencies**: Celery (async jobs), Redis (caching), Stripe SDK (payments)

## Directory Structure
```
/src
  /api        - REST API endpoints
  /core       - Business logic modules
  /jobs       - Background jobs
/tests         - Test suites
/config        - Configuration files
/scripts       - Deployment and maintenance scripts
```

## Code Conventions
- **Files**: snake_case for Python files, PascalCase for classes
- **Functions**: snake_case, descriptive names (e.g., `process_payment`, not `proc_pay`)
- **Classes**: PascalCase (e.g., `PaymentService`, `OrderProcessor`)
- **Imports**: Standard library → Third-party → Local, alphabetically within groups

## Configuration
- **Location**: `/config` directory, separate files per environment
- **Env vars**: Loaded from `.env` file locally, environment in production
- **Environments**: `development`, `staging`, `production` - differ in DB, API keys, debug settings

## Development Workflow
- **Setup**: `./scripts/setup.sh` installs dependencies, creates DB, loads fixtures
- **Testing**: `pytest` for unit tests, `pytest --integration` for integration tests
- **Standards**: All code requires tests, PR review by 2 engineers, passes CI before merge

## Cross-Cutting Concerns
- **Auth**: JWT tokens with 1-hour expiry, refresh token pattern
- **Errors**: Centralized error handling with RetryableError pattern (see patterns/)
- **Logging**: Structured JSON logging to stdout, includes request IDs for tracing
- **Monitoring**: Datadog for metrics, Sentry for error tracking

## Common Patterns
[List all pattern files created - will be populated as you create them]

### Design Patterns
- API design → `patterns/api-design.md`
- Error handling → `patterns/error-handling.md`

### Technical Patterns
- Logging → `patterns/logging.md`
- Caching → `patterns/caching.md`

[Add all patterns discovered]

## Module Map
[Will be populated in Step 1]

## Architecture
[Will be populated in Step 2]

## External Systems
[Will be populated in Step 2]
```

---

## File Creation Checklist

Create these directories:
- [ ] `.ai/`
- [ ] `.ai/patterns/`

Create these files:
- [ ] `.ai/agents.md` (initial version with project context)
- [ ] `.ai/patterns/[pattern-1].md` (use verbose template above)
- [ ] `.ai/patterns/[pattern-2].md` (use verbose template above)
- [ ] `.ai/patterns/[pattern-N].md` (one file per pattern found)

---

## Verification

After creating files, check:
- [ ] agents.md has complete project context (not placeholder text)
- [ ] Each pattern file is 100+ lines (not terse bullet points)
- [ ] Pattern files have real code examples from the repo
- [ ] "Why" is explained for rules and decisions
- [ ] Scenarios include step-by-step walkthroughs
- [ ] Gotchas have problem + solution with code

---

## Next Step
Continue to `01-discover-modules.md` after completion.
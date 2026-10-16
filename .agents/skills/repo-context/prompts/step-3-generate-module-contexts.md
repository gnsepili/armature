# Step 3: Generate Individual Module Context Files

## Objective
Create detailed documentation for each module, referencing patterns discovered in Step 0.

## Prerequisites
- Read `.ai/agents.md` for module list, patterns, and project context
- Read `.ai/architecture/module-interactions.md` for relationships

## Task
For each module listed in `.ai/agents.md` Module Map, create `.ai/modules/[module-name].md`.

**Key benefit**: Since patterns were already extracted in Step 0, you can directly reference them when documenting each module.

---

## Verbosity Requirements

**Critical**: Module files must be comprehensive enough for LLMs to understand the module without reading code.

- **Minimum 150-200 lines per module** (for non-trivial modules)
- **Full paragraphs**, not bullet points for descriptions
- **Detailed walkthroughs** of key behaviors with step-by-step explanations
- **Real code examples** with inline comments and explanations
- **Specific gotchas** with problem + solution code
- **Complete API documentation** for public methods

---

## Template per Module

Create `.ai/modules/[module-name].md`:

```markdown
# [Module Name]

## Purpose & Scope

### What This Module Does
[Write 2-3 paragraphs explaining the module's role in the system. Be narrative and detailed.]

Example:
"The Payment Module is responsible for processing all monetary transactions in the system. It acts as the central orchestrator for payment operations, interfacing with external payment processors (primarily Stripe), maintaining payment records, and ensuring transaction integrity. When a user attempts to purchase something, the Payment Module validates the payment method, communicates with the payment processor to authorize and capture funds, records the transaction result, and emits events that other parts of the system can react to.

This module was designed to abstract away payment processor complexity. Originally, payment logic was scattered across the Order and Checkout modules, making it difficult to switch processors or support multiple payment methods. By centralizing payment logic here, we can add new payment methods (gift cards, PayPal, etc.) without modifying other modules.

The module handles both one-time payments and recurring subscriptions, though subscription logic is primarily in the Subscription Module - Payment Module just processes the actual charges."

### Boundaries
**What's IN scope**:
- [Detailed responsibility 1 with full sentence explanation]
- [Detailed responsibility 2]
- [Detailed responsibility 3]

**What's OUT of scope**:
- [What it doesn't handle] - [Why another module handles this]
- [Another out-of-scope item] - [Rationale]

Example:
**What's IN scope**:
- Processing credit card payments through Stripe API - This module owns all communication with the payment processor, including retry logic and error handling
- Recording payment attempts and results in the database - Maintains complete audit trail of all payment operations for accounting and debugging
- Managing refunds and chargebacks - Handles both customer-initiated refunds and payment processor chargebacks
- Emitting payment events for other modules to react to - Publishes events when payments succeed, fail, or are refunded

**What's OUT of scope**:
- Order creation and management - Handled by Order Module; Payment Module only processes payment for existing orders
- Inventory reservation - Handled by Inventory Module before payment is attempted
- Customer notifications - Handled by Notification Module which subscribes to payment events
- Pricing calculations - Handled by Pricing Module; Payment Module receives final amount to charge

## Key Components

### Entities/Models
[Document each model with full details]

**Payment** - `src/payments/models.py:15-45`
- **Purpose**: Represents a payment attempt and its result
- **Key fields**:
  - `id` (UUID) - Unique payment identifier
  - `order_id` (UUID, foreign key) - Associated order, unique constraint ensures one payment per order
  - `amount` (integer) - Amount in cents (1999 = $19.99) to avoid floating point errors
  - `status` (enum) - One of: pending, completed, failed, refunded
  - `stripe_charge_id` (string) - Stripe's ID for this charge, used for refunds
  - `failure_reason` (string, nullable) - Human-readable error for failed payments
  - `created_at`, `updated_at` (timestamps)
- **Used by**: Order Module (to check payment status), Refund Service (for processing refunds), Reporting Module (for analytics)
- **Relationships**: Belongs to one Order

[Document all models]

### Services/Controllers

**PaymentService** - `src/payments/service.py:20-150`
- **Purpose**: Main business logic for payment processing
- **Key methods**:
  
  `process_payment(order_id: str, payment_token: str) -> Payment`
  - Charges credit card via Stripe for the given order
  - Creates Payment record with result
  - Publishes `payment.processed` event on success
  - Raises PaymentError on card decline
  - Raises RetryableError on network timeout (see `patterns/error-handling.md`)
  - Location: Lines 45-89
  
  `refund_payment(payment_id: str, reason: str) -> Payment`
  - Issues refund through Stripe
  - Updates Payment record status to 'refunded'
  - Publishes `payment.refunded` event
  - Location: Lines 120-145
  
  `get_payment_status(payment_id: str) -> str`
  - Returns current status of a payment
  - Used by Order Module to check payment completion
  - Location: Lines 148-150

- **Dependencies**: Stripe API client, Event Publisher, Payment model
- **Used by**: Order Module (during order processing), Refund API endpoint

[Document all major services]

### Background Jobs (if applicable)

**RetryFailedPaymentsJob** - `src/payments/jobs.py:10-35`
- **Purpose**: Retries payments that failed due to temporary issues
- **Schedule**: Runs every 5 minutes
- **What it does**: Queries for Payment records with status='failed' and failure_reason indicating retry-worthy errors (network timeouts, 503 errors). Re-attempts payment processing. Updates status to 'completed' or 'failed_permanent' based on result.
- **Related pattern**: See `patterns/async-jobs.md` for job processing framework

[Document background jobs]

## API Surface

### Public Functions/Methods

[Document the interface other modules use]

**PaymentService.process_payment()**
```python
def process_payment(
    self,
    order_id: str,
    payment_token: str,
    idempotency_key: Optional[str] = None
) -> Payment:
    """
    Processes a payment for an order.
    
    This is the main entry point for charging a customer's credit card.
    Called by Order Module after order is created and ready for payment.
    
    Args:
        order_id: UUID of the order to charge for
        payment_token: Stripe token from frontend (e.g., 'tok_visa')
        idempotency_key: Optional key for idempotent retries. If not provided,
                        will be generated from order_id
    
    Returns:
        Payment object with status='completed' and Stripe charge ID
    
    Raises:
        PaymentError: If card declined or invalid payment data
        RetryableError: If network timeout or Stripe API error (will be retried)
        OrderNotFoundError: If order_id doesn't exist
        
    Example:
        payment = payment_service.process_payment(
            order_id='ord_12345',
            payment_token='tok_visa',
            idempotency_key='pay-ord_12345-1234567890'
        )
        
    Side effects:
        - Creates Payment record in database
        - Calls Stripe API to create charge
        - Publishes 'payment.processed' event on success
        - Logs payment attempt with correlation ID
        
    Related patterns:
        - See patterns/error-handling.md for retry logic
        - See patterns/idempotency.md for idempotency key usage
    """
```

[Document all public methods with this level of detail]

### REST Endpoints (if applicable)

[If module exposes HTTP endpoints]

**POST /api/payments**
- **Purpose**: Initiate a payment for an order
- **Auth**: Required (JWT token)
- **Request body**:
  ```json
  {
    "order_id": "ord_12345",
    "payment_token": "tok_visa"
  }
  ```
- **Response 200**:
  ```json
  {
    "payment_id": "pay_67890",
    "status": "completed",
    "amount": 1999
  }
  ```
- **Response 400**: Invalid payment token or order not found
- **Response 402**: Card declined
- **Response 500**: Payment processor error
- **See also**: `patterns/api-design.md` for response format standards

[Document all endpoints]

### Events Published

**`payment.processed`**
- **When**: After payment successfully completes
- **Payload**:
  ```json
  {
    "payment_id": "pay_67890",
    "order_id": "ord_12345",
    "amount": 1999,
    "status": "completed",
    "timestamp": "2024-01-15T10:30:00Z"
  }
  ```
- **Consumers**: Order Module (updates order status), Notification Module (sends confirmation email), Analytics Module (records revenue)

[Document all events published]

### Events Consumed

**`order.cancelled`**
- **Handler**: `handle_order_cancelled()` in `src/payments/event_handlers.py:15`
- **Action**: If order had a completed payment, automatically issue refund
- **Why**: Ensures cancelled orders don't leave charged payments

[Document all events consumed]

## Dependencies

### Internal Modules

**Order Module** → See `order-module.md`
- **Used for**: Validating that order exists before processing payment
- **Functions called**: `OrderService.get_order(order_id)` - Fetches order details including total amount
- **Why needed**: Must verify order total matches payment amount to prevent over/under charging

**Notification Module** → See `notification-module.md`
- **Relationship**: Payment Module publishes events, Notification Module subscribes
- **No direct calls**: Decoupled via event system
- **Why decoupled**: Payment shouldn't care how notifications are sent; Notification Module handles all communication channels

[List all internal module dependencies]

### External Services

**Stripe API** - `stripe.com/api`
- **Purpose**: Credit card processing
- **Evidence**: `src/payments/stripe_client.py:1-100`
- **Version**: Stripe API version 2023-10-16
- **Authentication**: API key in environment variable `STRIPE_SECRET_KEY`
- **Related patterns**: See `patterns/error-handling.md` for retry logic

[List all external dependencies]

### Patterns Used

**Reference patterns from Step 0:**

**Error Handling** → `../patterns/error-handling.md`
- **Usage**: All Stripe API calls wrapped in try/catch that distinguishes retryable (network errors) from non-retryable (card declines)
- **Example**: `src/payments/service.py:45-89` - Payment processing wraps Stripe call and raises RetryableError for network timeouts
- **Why**: Prevents losing payments due to temporary Stripe outages

**Logging** → `../patterns/logging.md`
- **Usage**: Structured logging with payment_id and order_id context for all operations
- **Example**: `src/payments/service.py:50` - `logger.info("Processing payment", extra={'payment_id': payment.id, 'order_id': order_id})`
- **Why**: Enables debugging payment issues by correlating all log entries for a single payment

**Async Jobs** → `../patterns/async-jobs.md`
- **Usage**: Failed payments retried via background job system
- **Example**: `src/payments/jobs.py:10-35` - RetryFailedPaymentsJob processes payments that failed with retryable errors
- **Why**: Separates retry logic from main request flow; doesn't block user if payment temporarily fails

[List ALL patterns used by this module]

## Data Flow

### Input → Processing → Output
[Describe in narrative form how data enters, transforms, and exits]

Example:
"Payment processing begins when the Order Module calls PaymentService.process_payment() with an order ID and payment token from the frontend. The service first validates that the order exists and is in 'pending_payment' status by calling OrderService.get_order(). If the order doesn't exist or is already paid, the service raises an error immediately without contacting Stripe.

Next, the service creates a Payment record in the database with status='pending'. This record is created before calling Stripe so we have an audit trail of all payment attempts, successful or not. The record includes the order ID, amount (from the order total), and timestamp.

The service then calls Stripe's API to create a charge, passing the payment token and amount. This is the critical external integration point. If Stripe returns success, we update the Payment record to status='completed' and save the Stripe charge ID for future refunds. If Stripe returns an error, we check if it's retryable (network timeout, 5xx error) or permanent (card declined, invalid token). Retryable errors are wrapped in RetryableError which triggers the job system to retry later. Permanent errors update the payment status to 'failed' and save the error message.

Finally, if the payment completed successfully, we publish a 'payment.processed' event with the payment and order IDs. This event is picked up by the Order Module (to mark order as paid), Notification Module (to send confirmation email), and Analytics Module (to record revenue). The service returns the Payment object to the caller.

Throughout this flow, we use database transactions to ensure atomicity. If any step fails, the transaction rolls back and no partial Payment record is left in the database. We also use idempotency keys when calling Stripe to ensure retries don't create duplicate charges."

### State Management
[If module maintains state]

**Payment Status Tracking**
- **What state**: Payment records track their processing state (pending, completed, failed, refunded)
- **Where stored**: PostgreSQL `payments` table
- **State transitions**: pending → completed (success), pending → failed (error), completed → refunded (refund)
- **Invalidation**: Payment state is append-only; once a payment completes or fails, status doesn't change except for refunds

## Key Behaviors

[Detailed walkthroughs of main workflows]

### Payment Processing Flow

**Overview**:
When a user attempts to pay for an order, this module coordinates multiple steps to safely charge their card while maintaining data integrity and proper error handling.

**Detailed Steps**:

**1. Validation Phase** (`PaymentService.process_payment()`, lines 45-55)
Before contacting any external services, we validate:
- Order exists and is in 'pending_payment' status (not already paid or cancelled)
- Payment amount matches order total exactly (prevents tampering)
- Payment token is present and appears valid (basic format check)
- User owns the order (auth check)

This validation prevents unnecessary Stripe API calls for invalid requests. If any check fails, we raise an error immediately and return to the caller. No database writes happen in this phase.

**2. Create Pending Payment** (lines 56-60)
We create a Payment record with status='pending' BEFORE calling Stripe. This might seem counterintuitive (why create a record if payment might fail?), but it's intentional:
- Creates audit trail of all attempts, not just successes
- Provides idempotency - if we crash after Stripe succeeds, retry can see pending payment exists
- Allows tracking of decline rates and common errors

The record includes: order_id, amount (from order), status='pending', created_at timestamp.

**3. Idempotency Check** (lines 61-65)
Before calling Stripe, check if a payment with this order_id already exists in a terminal state (completed or failed). If it does, return that existing payment instead of creating a duplicate. This handles cases where:
- User double-clicks submit button
- Network timeout causes client to retry
- Our job system retries the operation

Without this check, we might charge the card multiple times for one order.

**4. Call Stripe API** (lines 66-85)
This is the critical external integration:

```python
try:
    idempotency_key = f"pay-{order.id}-{payment.created_at.timestamp()}"
    charge = stripe.Charge.create(
        amount=payment.amount,
        currency='usd',
        source=payment_token,
        idempotency_key=idempotency_key,
        metadata={'order_id': order.id}
    )
except stripe.error.CardError as e:
    # Card declined - permanent failure
    payment.status = 'failed'
    payment.failure_reason = e.user_message
    payment.save()
    raise PaymentError(f"Card declined: {e.user_message}")
except (stripe.error.APIConnectionError, stripe.error.APIError) as e:
    # Network or Stripe error - retryable
    raise RetryableError(f"Stripe error: {e}")
```

The idempotency key ensures Stripe recognizes retries. If we call Stripe with the same key twice, Stripe returns the original charge result instead of creating a new charge.

We distinguish between:
- CardError (card declined, expired, etc.) → Permanent failure, no retry
- APIConnectionError/APIError (network timeout, Stripe 500) → Temporary issue, retry

**5. Update Payment Record** (lines 86-92)
Based on Stripe's response:
- **Success**: Update payment status to 'completed', save Stripe charge ID, update timestamp
- **Failure**: Status is already set to 'failed' with error message in the except block

The Stripe charge ID is critical for future refunds - we can't refund without it.

**6. Publish Event** (lines 93-97)
If payment completed, publish 'payment.processed' event:

```python
event_publisher.publish('payment.processed', {
    'payment_id': payment.id,
    'order_id': order.id,
    'amount': payment.amount,
    'status': payment.status,
    'timestamp': payment.updated_at.isoformat()
})
```

Subscribers:
- Order Module: Updates order status to 'paid', triggers fulfillment
- Notification Module: Sends order confirmation email
- Analytics Module: Records revenue, updates metrics

**7. Return Result** (line 98)
Return the Payment object to the caller (Order Module). The caller can now proceed with order fulfillment knowing payment succeeded.

**Error Scenarios**:

**Scenario A: Network Timeout**
If Stripe doesn't respond within 30 seconds (our timeout):
1. `stripe.error.APIConnectionError` is raised
2. We catch this and raise `RetryableError` with context
3. Job system catches `RetryableError` and schedules retry in 1 minute
4. On retry, idempotency check sees pending payment exists
5. On retry, idempotency key ensures Stripe doesn't double-charge
6. If Stripe eventually responds, payment completes successfully
7. If 3 retries all timeout, payment marked 'failed_permanent'

**Scenario B: Card Declined**
If user's card is declined:
1. Stripe returns 402 with error like "insufficient_funds"
2. We catch `CardError` and update payment to 'failed' with reason
3. Error message saved: "Your card was declined (insufficient funds)"
4. NO retry scheduled - retrying won't fix insufficient funds
5. Error propagates to Order Module
6. Order Module cancels the order
7. User sees friendly error message to try different payment method

**Scenario C: Temporary Stripe Outage**
If Stripe returns 503 Service Unavailable:
1. Caught as `APIError`
2. Raised as `RetryableError`
3. Job system retries with exponential backoff (1m, 2m, 4m)
4. Usually Stripe recovers within a few minutes
5. Payment completes on retry

**Why This Flow**:
This multi-step approach evolved from production incidents:
- Validation upfront reduces unnecessary Stripe API calls (saves money)
- Pending payment record provides audit trail (helps debug "lost" payments)
- Idempotency handling prevents double-charges during retries (critical for user trust)
- Distinguishing retryable vs permanent errors prevents wasted retries (improves reliability)
- Event publishing decouples payment from downstream actions (makes system more resilient)

The retry logic is essential because Stripe experiences brief outages every few weeks. Before implementing retries, these caused dozens of failed orders. After retries, our success rate increased from 97% to 99.8%.

### Refund Processing

[Similar detailed walkthrough]

**Overview**:
[2-3 sentences]

**Detailed Steps**:
[Walk through each step with explanations]

**Error Scenarios**:
[Detail what can go wrong]

**Why This Flow**:
[Explain the reasoning]

## Configuration

### Environment Variables

```
STRIPE_SECRET_KEY - Stripe API key for payment processing - Required: Yes - Default: None
STRIPE_PUBLISHABLE_KEY - Stripe public key for frontend - Required: Yes - Default: None
PAYMENT_TIMEOUT_SECONDS - Timeout for Stripe API calls - Required: No - Default: 30
MAX_PAYMENT_RETRIES - Maximum retry attempts for failed payments - Required: No - Default: 3
```

[Document all environment variables]

### Config Files

**`config/payments.yml`**
```yaml
stripe:
  api_version: "2023-10-16"
  timeout_seconds: 30
  max_retries: 3
  retry_backoff_factor: 2

currencies:
  default: "usd"
  supported: ["usd", "eur", "gbp"]

limits:
  max_payment_amount: 999999  # $9,999.99 in cents
  min_payment_amount: 50      # $0.50 in cents
```

[Document relevant config]

### Feature Flags

**`enable_payment_retry`** - If true, failed payments are retried by background job - Default: true
**`enable_idempotency_check`** - If true, check for duplicate payments before processing - Default: true

[Document feature flags]

## Testing

### Test Files
- Unit tests: `tests/unit/payments/test_payment_service.py`
- Integration tests: `tests/integration/payments/test_stripe_integration.py`
- End-to-end tests: `tests/e2e/test_checkout_flow.py`

### Key Test Scenarios

**Successful payment processing**
- Test: Create order, process payment with valid token, verify payment completed
- Mocks: Stripe API mocked to return success
- Assertions: Payment status='completed', Stripe charge ID saved, event published

**Card declined handling**
- Test: Process payment with token that Stripe declines
- Mocks: Stripe API mocked to return CardError
- Assertions: Payment status='failed', error message saved, no retry scheduled

**Network timeout retry**
- Test: Stripe API times out, verify retry logic triggers
- Mocks: First call raises APIConnectionError, second call succeeds
- Assertions: RetryableError raised, job queued, retry succeeds, payment completed

[Document key test scenarios]

### Mocking Strategy

**Stripe API** - Always mocked in tests using `stripe.test_client`
- Mocking library: `pytest-mock`
- Why: Don't want tests making real API calls, don't want to be charged
- How: Fixture provides mock Stripe client with configurable responses

See `patterns/testing-patterns.md` for more details on test setup.

## Performance Considerations

### Bottlenecks

**Stripe API calls are the slowest part of payment processing**
- Average latency: 500-800ms
- 95th percentile: 1.5 seconds
- Mitigation: Use async job for retries so user doesn't wait for retries

**Database writes during payment processing**
- 3 INSERT/UPDATE queries per payment
- Wrapped in transaction for atomicity
- Average latency: 50ms
- Not a bottleneck currently, but watch as traffic grows

### Optimization Strategies

**Caching** - See `patterns/caching.md`
- Payment status cached in Redis for 5 minutes after completion
- Cache key: `payment:{payment_id}:status`
- Reduces database queries when Order Module checks payment status
- Invalidated on refund

**Database Query Optimization** - See `patterns/data-access.md`
- Index on `payments.order_id` for fast lookup
- Index on `payments.status` for retry job queries
- Connection pooling to reduce connection overhead

### Monitoring

**Metrics tracked**:
- `payment.attempts` (counter) - Total payment attempts
- `payment.success_rate` (gauge) - Percentage of successful payments
- `payment.stripe_latency` (histogram) - Stripe API call duration
- `payment.retries` (counter) - Number of retry attempts

**Alerts**:
- Alert if success rate drops below 95% for 5 minutes
- Alert if Stripe latency p95 exceeds 3 seconds for 10 minutes
- Alert if retry queue depth exceeds 100

See cross-cutting concerns in `../agents.md` for observability setup.

## Gotchas & Constraints

### "Never Do This"

**Never assume a payment succeeded without checking the database**
- **Why**: Even if Stripe API returns success, the database write might fail or timeout
- **Instead**: Always query payment status from database as source of truth
- **Example**:
```python
# WRONG
payment = payment_service.process_payment(order_id, token)
order.status = 'paid'  # Assuming payment worked!

# RIGHT  
payment = payment_service.process_payment(order_id, token)
# Re-query to ensure database write succeeded
payment = Payment.objects.get(id=payment.id)
if payment.status == 'completed':
    order.status = 'paid'
```

**Never retry card declines**
- **Why**: Card declines are permanent failures - the card has insufficient funds, is expired, or blocked
- **Instead**: Only retry network errors and 5xx responses from Stripe
- **What happens if violated**: Wastes API calls, delays error feedback to user, might hit rate limits

**Never process refunds without checking payment status**
- **Why**: Can only refund completed payments, not failed or pending ones
- **Instead**: Always verify payment.status=='completed' before calling Stripe refund API
- **Example**:
```python
# WRONG
stripe.Refund.create(charge=payment.stripe_charge_id)

# RIGHT
if payment.status != 'completed':
    raise CannotRefundError("Can only refund completed payments")
if not payment.stripe_charge_id:
    raise CannotRefundError("Missing Stripe charge ID")
stripe.Refund.create(charge=payment.stripe_charge_id)
```

### "Always Do This"

**Always use idempotency keys when calling Stripe**
- **Why**: Prevents double-charging if request times out and retries
- **Example**:
```python
idempotency_key = f"pay-{order_id}-{timestamp}"
stripe.Charge.create(
    amount=amount,
    idempotency_key=idempotency_key
)
```

**Always log payment attempts with correlation IDs**
- **Why**: Debugging payment issues requires correlating multiple log entries
- **Example**:
```python
logger.info(
    "Processing payment",
    extra={'payment_id': payment.id, 'order_id': order_id}
)
```

### Common Mistakes

**Mistake: Not handling Stripe webhook events**
- **Impact**: Lose track of chargebacks, dispute notifications from Stripe
- **Fix**: Implement webhook handler for Stripe events (currently missing, should be added)

**Mistake: Storing full credit card numbers**
- **Impact**: PCI compliance violation, security risk
- **Fix**: Only store last 4 digits and card brand. Stripe stores the actual card data securely.

**Mistake: Not validating payment amount matches order total**
- **Impact**: User could be charged wrong amount if frontend is compromised
- **Fix**: Always recalculate order total on backend, don't trust frontend amount

### Edge Cases

**User clicks submit button multiple times**
- Handled by: Idempotency check in step 3 of payment processing
- Result: Second click returns existing payment, no duplicate charge

**Stripe charge succeeds but our database write fails**
- Handled by: Retry logic sees pending payment exists, idempotency key prevents double charge
- Result: Retry completes database write, payment marked completed

**Payment succeeds but event publishing fails**
- Issue: Order never gets marked as paid, no confirmation email sent
- Current handling: Manual intervention required (this is a known gap)
- Future fix: Implement outbox pattern for reliable event delivery

### Business Rules

**Payments cannot exceed $9,999.99**
- Why: Fraud prevention, regulatory compliance
- Enforced: In `PaymentService` validation before calling Stripe

**Refunds must be requested within 90 days**
- Why: Stripe policy, chargebacks become more likely after 90 days
- Enforced: In `RefundService`, checks payment.created_at before allowing refund

**Failed payments are retried maximum 3 times**
- Why: Balance between recovering from transient issues and failing fast on persistent problems
- Enforced: In retry job using pattern from `patterns/async-jobs.md`

## Security Considerations

### Sensitive Data Handling

**Credit card data**:
- Never stored: Full card numbers never touch our database
- Tokens only: Frontend uses Stripe.js to create token, we only see token
- Last 4 digits: We store last 4 digits and brand for display purposes only

**Stripe API keys**:
- Environment variables: Never hardcoded
- Secret key: Backend only, never exposed to frontend
- Publishable key: Safe to expose in frontend

### Authentication & Authorization

**Payment processing requires authentication**:
- User must be logged in (JWT token required)
- User must own the order they're paying for
- Enforced in API layer before calling PaymentService

See `patterns/auth-patterns.md` for authentication details.

### Input Validation

**All inputs validated before processing**:
- Order ID: Must be valid UUID format
- Payment token: Must match Stripe token format (`tok_*`)
- Amount: Must be positive integer, within limits

See `patterns/validation.md` for validation approach.

## Features Implemented
[Only include this section if Step 1.5 was run and `.ai/features/` directory exists]

- **[Feature Name]** → `../features/[feature-name].md` - [What this module does for the feature]

Example:
- **Checkout** → `../features/checkout.md` - Orchestrates checkout flow, validates cart
- **Payment Processing** → `../features/payment-processing.md` - Charges cards via Stripe

[Skip this section entirely if no features directory exists]

## Related Documentation
- Architecture: `../architecture/module-interactions.md` (how Payment integrates with other modules)
- Patterns: `../patterns/error-handling.md`, `../patterns/async-jobs.md`, `../patterns/logging.md`
- Other modules: `order-module.md` (primary caller), `notification-module.md` (event subscriber)
```

---

## Execution Strategy

### For All Codebases
Generate a complete module file for EVERY module listed in `agents.md`, regardless of size or perceived importance.

### For Large Codebases (20+ modules)
To maintain quality while handling scale, work in organized batches:

**Batch 1: Core Business Modules** (Payment, Order, User, etc.)
- Generate complete documentation for all core business logic modules
- These typically have the most complex behaviors and dependencies

**Batch 2: Supporting Modules** (bin_packing, rule_engine, services, etc.)
- Generate complete documentation for all domain-specific supporting modules
- These often contain critical algorithms and business logic
- Don't skip these - they're as important as core modules

**Batch 3: Infrastructure Modules** (config, common, monitoring, etc.)
- Generate complete documentation for all infrastructure and cross-cutting modules
- Include error handling, logging, caching, etc.

**Batch 4: Utility Modules** (helpers, utils, etc.)
- Generate complete documentation for all utility and helper modules
- Even small utilities need documentation

**Critical**: Continue until ALL modules from `agents.md` have corresponding files in `modules/`. A complete context layer documents the entire codebase, not just the "important" parts. Supporting modules like `bin_packing` or `rule_engine` often contain critical business logic and must be documented thoroughly.

### Quality Over Speed
Better to take longer and document everything than to skip modules. Incomplete documentation means LLMs can't fully understand the codebase.

---

## File Creation Checklist

Create this directory:
- [ ] `.ai/modules/`

Create these files (one per module from agents.md):
- [ ] `.ai/modules/[module-1].md`
- [ ] `.ai/modules/[module-2].md`
- [ ] `.ai/modules/[module-N].md`

---

## Verification Checklist

For each module file, verify:
- [ ] File is 150-200+ lines (not terse)
- [ ] All patterns used are referenced with links
- [ ] Dependencies link to other module files
- [ ] Cross-references use correct relative paths (`../patterns/`, not `/patterns/`)
- [ ] Code examples include file paths and line numbers
- [ ] Gotchas have problem + solution with code
- [ ] Key behaviors have step-by-step walkthroughs
- [ ] "Why" is explained for design decisions
- [ ] No placeholder text like "[TODO]"

---

## Next Step
Continue to `04-cross-reference.md` after all modules are documented.
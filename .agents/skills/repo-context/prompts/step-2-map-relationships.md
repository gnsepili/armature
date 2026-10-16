# Step 2: Map Module Relationships

## Objective
Understand how modules connect, communicate, and create architecture documentation.

## Prerequisites
- Read `.ai/agents.md` for module list and patterns

## Task
Analyze module interactions:
1. Map dependencies between modules
2. Identify data flows
3. Determine communication patterns (sync/async/events)
4. Spot circular dependencies or unclear boundaries
5. Document external system integrations

## Questions to Answer
- Which modules call each other directly?
- What events or messages flow between modules?
- Are there shared databases or state?
- What external systems are integrated?
- Are there any circular dependencies?
- Which modules are tightly coupled vs loosely coupled?

## Analysis Techniques

### Tracing Dependencies
- Follow import statements across module boundaries
- Look for function calls like `UserService.get_user()` from other modules
- Check for shared models or DTOs

### Identifying Data Flows
- Trace a user request from entry point through modules
- Example: API → Order Module → Payment Module → Notification Module
- Look for data transformations between modules

### Communication Patterns
- **Synchronous**: Direct function calls, HTTP requests
- **Asynchronous**: Message queues, event publishing/subscribing
- **Shared State**: Shared database tables, cache keys

### External Integrations
- API calls to third-party services (Stripe, SendGrid, etc.)
- Database connections
- Message queue systems
- File storage (S3, local filesystem)

---

## Outputs to Create

### Output 1: Create `.ai/architecture/module-interactions.md`

Use this verbose template:

```markdown
# Module Interactions

## System Architecture

### Overview
[Write 3-4 paragraphs explaining how the entire system works. Include high-level flow, key design decisions, and architectural philosophy.]

Example:
"This system follows a modular monolith architecture where distinct business domains are separated into modules, but all run in a single application process. The modules communicate through a combination of direct function calls for synchronous operations and an event bus for asynchronous operations. This architecture evolved from an earlier design where everything was in one large module, making it difficult to understand boundaries and leading to tight coupling.

The request flow starts at the API layer, which receives HTTP requests and routes them to the appropriate module. Modules contain their business logic and can call other modules' public APIs when needed. For example, when processing an order, the Order Module calls the Inventory Module to reserve items, then calls the Payment Module to charge the card. These are synchronous calls because we need the results immediately to decide whether to complete the order.

For operations that don't need immediate results, modules publish events. After a payment succeeds, the Payment Module publishes a 'payment.processed' event. The Order Module subscribes to this and starts fulfillment, the Notification Module subscribes to send confirmation emails, and the Analytics Module subscribes to track metrics. This event-driven approach decouples modules - Payment Module doesn't need to know what happens after a payment succeeds.

State is primarily stored in a PostgreSQL database with tables organized by module. Some modules share tables (User table is accessed by Auth, Profile, and Order modules), but shared access is carefully controlled through clear ownership rules. Redis is used for caching and session storage, with namespaced keys to prevent modules from accidentally overwriting each other's data."

### Architecture Diagram (Optional)
[If helpful, include ASCII diagram]
```
┌─────────────┐
│   API Layer │
└──────┬──────┘
       │
   ┌───┴────┬─────────┬──────────┐
   ▼        ▼         ▼          ▼
[Order] [Payment] [Inventory] [User]
   │        │         │          │
   └────────┴─────────┴──────────┘
              ▼
         [PostgreSQL]
              ▼
          [Redis Cache]
```

## Data Flow

[Document 2-3 key flows through the system with detailed step-by-step explanations]

### Flow 1: Order Processing
**Trigger**: User clicks "Place Order" button on frontend

**Step-by-step walkthrough**:

**1. API Layer receives request** (`POST /api/orders`)
The API endpoint validates the auth token to ensure the request is from a logged-in user. It extracts the user_id from the JWT token and validates the request payload contains required fields (cart_id, shipping_address, payment_method). If validation passes, it calls Order Service to create the order.

**2. Order Module creates order** (`OrderService.create_order()`)
The Order Service validates the cart contents by checking that all items still exist and are in stock. It calculates the total price including taxes and shipping. It creates an Order record in the database with status='pending_payment' and generates a unique order_id. The order is not yet committed - we're still in a transaction that will rollback if payment fails.

**3. Order Module calls Inventory Module** (`InventoryService.reserve_items()`)
This is a synchronous call to check and reserve inventory. The Inventory Module locks the rows for the requested items and checks if quantities are available. If any item is out of stock, it raises OutOfStockError which causes the whole transaction to rollback. If all items are available, they're marked as 'reserved' with a 10-minute TTL. The reservation prevents other orders from claiming the same inventory while we process payment.

**4. Order Module calls Payment Module** (`PaymentService.process_payment()`)
Another synchronous call to charge the user's credit card. Payment Module calls Stripe API to create a charge. If the card is declined or there's an error, it raises PaymentError which rolls back the transaction (order deleted, inventory unreserved). If payment succeeds, a Payment record is created with status='completed' and the Stripe charge ID is saved for future reference like refunds.

**5. Order Module commits transaction**
With both inventory reserved and payment successful, the Order Module commits the transaction. Order status is updated to 'paid', inventory reservations are converted to permanent allocations, and the payment record is finalized. At this point, the operation is durable - even if the server crashes, the order is saved.

**6. API Layer returns success**
HTTP 200 response with order details sent back to frontend. From the user's perspective, the order is complete. All the steps above happen synchronously before the response is returned, ensuring the user knows their payment went through.

**Asynchronous continuation** (happens after response sent):

**7. Order Module publishes event** (`order.paid`)
An event is published to the message queue with payload: `{order_id, user_id, total, items}`. This event is picked up by subscribers who handle post-order actions that don't need to block the user's response.

**8. Notification Module receives event**
Subscribes to 'order.paid' event and sends order confirmation email to the user. Uses SendGrid API. If sending fails, it's retried by the job queue (see `patterns/error-handling.md`).

**9. Fulfillment Module receives event**
Subscribes to 'order.paid' event and creates a fulfillment task for the warehouse. Updates order status to 'fulfilling' and notifies warehouse system via API.

**10. Analytics Module receives event**
Subscribes to 'order.paid' event and records the sale in the analytics database for reporting.

**Why this flow**:
The synchronous portion (steps 1-6) ensures critical operations (inventory check, payment) happen before responding to the user. This prevents overselling and ensures payment succeeded before confirming the order. The asynchronous portion (steps 7-10) handles non-critical operations like emails and analytics without blocking the user. If email sending is slow, it doesn't delay order confirmation. If the analytics system is down, the order still completes successfully.

The transaction boundary (steps 2-5) ensures atomicity - either the whole order completes or nothing is saved. This prevents partial orders where payment succeeded but inventory wasn't reserved, or vice versa.

### Flow 2: [Another Key Flow]
[Similar detailed walkthrough]

## Communication Patterns

### Synchronous Communication (Direct Calls)

[Explain which modules call each other directly and why synchronous is needed]

**Order Module → Payment Module**
- **Method**: Direct function call to `PaymentService.process_payment()`
- **Why synchronous**: Need immediate result to know if payment succeeded before completing order
- **What's passed**: Payment amount, user token, order ID
- **What's returned**: Payment ID and status or raises PaymentError

**Order Module → Inventory Module**
- **Method**: Direct function call to `InventoryService.reserve_items()`
- **Why synchronous**: Need to know immediately if items are in stock before charging customer
- **What's passed**: List of items with quantities
- **What's returned**: Reservation ID or raises OutOfStockError

[List all synchronous module interactions]

### Asynchronous Communication (Events/Messages)

[Explain event-driven interactions]

**Event: `payment.processed`**
- **Publisher**: Payment Module (after successful Stripe charge)
- **Payload**: `{payment_id, order_id, amount, status, timestamp}`
- **Subscribers**: 
  - Order Module - Updates order status to 'paid'
  - Notification Module - Sends payment confirmation email
  - Analytics Module - Records revenue
- **Why async**: These actions don't need to complete before returning response to user. If email sending is slow, it shouldn't delay payment confirmation.

**Event: `user.created`**
- **Publisher**: User Module (after new user registration)
- **Payload**: `{user_id, email, signup_date}`
- **Subscribers**:
  - Notification Module - Sends welcome email
  - Analytics Module - Tracks new signup
  - CRM Module - Creates CRM contact
- **Why async**: Welcome email and CRM sync aren't critical to user registration. User should be able to log in immediately even if CRM is down.

[List all async communication patterns]

### Shared State

[Document shared databases, caches, file systems]

**Database Tables**
- **`users` table**: 
  - **Owner**: User Module (writes)
  - **Readers**: Auth Module, Order Module, Profile Module
  - **Why shared**: User data is fundamental to many operations. Rather than duplicate user info, modules read from the canonical source.
  - **Constraints**: Only User Module can UPDATE users. Other modules can only SELECT.

- **`sessions` table**:
  - **Owner**: Auth Module (writes)
  - **Readers**: All modules that need to verify authentication
  - **Why shared**: Session validation happens on every authenticated request across all modules.

**Redis Cache**
- **Namespace `session:*`**: 
  - **Owner**: Auth Module
  - **Used by**: All modules for session lookup
  - **TTL**: 1 hour
  - **Why shared**: Fast session validation across all modules without DB queries

- **Namespace `cache:inventory:*`**:
  - **Owner**: Inventory Module
  - **Used by**: Only Inventory Module
  - **TTL**: 5 minutes
  - **Why isolated**: Prevents other modules from accidentally invalidating inventory cache

[List all shared state]

## Cross-Module Contracts

[Document the APIs/interfaces between modules]

### Public Interfaces

**PaymentService (Payment Module)**
```python
def process_payment(amount: Decimal, payment_token: str, order_id: str) -> Payment:
    """
    Charges a credit card via Stripe.
    
    Args:
        amount: Payment amount in USD
        payment_token: Stripe token from frontend
        order_id: Associated order ID for idempotency
        
    Returns:
        Payment object with Stripe charge ID
        
    Raises:
        PaymentError: If card declined or Stripe error
        RetryableError: If network timeout (will be retried)
    """
```

[Document key public methods that other modules use]

### Event Schemas

**`order.paid` event**
```json
{
  "order_id": "ord_12345",
  "user_id": "usr_789",
  "total": 99.99,
  "items": [
    {"product_id": "prod_abc", "quantity": 2, "price": 49.99}
  ],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

[Document all event payloads]

### Shared Models

**User Model** (`/src/users/models.py`)
- **Defined by**: User Module
- **Used by**: Auth Module, Order Module, Profile Module, Notification Module
- **Fields**: id, email, username, created_at, last_login
- **Immutability**: Modules must not modify User objects directly. Use User Module's public API.

[Document shared data models]

## External Dependencies

[List all external services integrated with the system]

### Stripe (Payment Processing)
- **Purpose**: Credit card charging and refunds
- **Used by**: Payment Module (`src/payment/stripe_client.py`)
- **Communication**: REST API over HTTPS (synchronous)
- **Auth**: API key in environment variable `STRIPE_API_KEY`
- **Evidence**: Found in Payment Module imports and config
- **Related Patterns**: See `patterns/error-handling.md` for retry logic on Stripe API failures

### SendGrid (Email Delivery)
- **Purpose**: Transactional emails (order confirmations, password resets)
- **Used by**: Notification Module (`src/notifications/email_service.py`)
- **Communication**: REST API over HTTPS (asynchronous via job queue)
- **Auth**: API key in environment variable `SENDGRID_API_KEY`
- **Evidence**: Found in Notification Module configuration
- **Related Patterns**: See `patterns/async-jobs.md` for email job processing

### PostgreSQL (Primary Database)
- **Purpose**: Persistent data storage for all modules
- **Used by**: All modules
- **Communication**: Direct database connection
- **Version**: PostgreSQL 15
- **Evidence**: Database config in `/config/database.yml`

### Redis (Cache & Sessions)
- **Purpose**: Session storage and caching
- **Used by**: Auth Module (sessions), Inventory Module (product cache), various others
- **Communication**: Direct Redis connection
- **Version**: Redis 7.0
- **Evidence**: Redis config in `/config/redis.yml`

[List all external systems]

## Known Constraints

[Document system-wide invariants and rules]

### System-Wide Rules

**Never allow inventory to go negative**
- Inventory Module enforces this with database constraints and optimistic locking
- If two orders try to buy the last item simultaneously, one will fail gracefully
- Related pattern: See `patterns/data-access.md` for transaction handling

**All prices in USD cents (integers)**
- Prevents floating point rounding errors
- $19.99 stored as 1999, not 19.99
- Pattern enforced across Payment, Order, and Inventory modules

**Authentication required for all non-public endpoints**
- API layer enforces this with auth middleware
- Exceptions: `/api/health`, `/api/public/*`
- See `patterns/auth-patterns.md`

### Performance Constraints

**Database queries must complete within 100ms**
- Enforced by monitoring alerts
- Queries exceeding this are logged and investigated
- See `patterns/data-access.md` for query optimization patterns

**Maximum API response time: 3 seconds**
- Includes all synchronous operations
- Async operations (emails, analytics) don't count toward this limit
- If exceeded, operation should be moved to async/background job

### Security Constraints

**Never log sensitive data**
- Credit card numbers, passwords, API keys must not appear in logs
- Payment Module masks card numbers: `****1234`
- See `patterns/logging.md` for data sanitization

**All external API calls must use TLS**
- HTTP connections to external services are blocked
- Certificate validation is enabled (no self-signed certs in production)

## Circular Dependencies

[If any found, document them]

**Order Module ↔ Payment Module**
- **Issue**: Order Module calls Payment Module to process payments, but Payment Module calls Order Module to update order status after payment
- **Impact**: Makes modules tightly coupled, hard to test independently
- **Recommendation**: Payment Module should publish events instead of calling Order Module directly. Order Module subscribes to payment events and updates itself.

[List any circular dependencies]

## Unclear Boundaries

[If any found, document them]

**Checkout Module vs Order Module**
- **Issue**: Both handle aspects of order creation. Checkout Module validates cart and calculates totals, Order Module creates order records. Unclear which owns the "create order" responsibility.
- **Impact**: Developers confused about where to add new order-related features
- **Current approach**: Treating Checkout as a UI helper, Order as the source of truth
- **Recommendation**: Merge Checkout logic into Order Module or clarify interface between them

[List any unclear boundaries]
```

---

### Output 2: Create `.ai/architecture/data-model.md`

**Only if applicable** (skip for stateless services, simple APIs):

```markdown
# Data Model

## Overview
[2-3 paragraphs explaining the data model philosophy, key entities, and relationships]

Example:
"The data model is organized around core business entities: Users, Products, Orders, and Payments. Each entity is owned by a specific module but may be read by other modules. The database schema enforces referential integrity through foreign keys, and most relationships use the standard relational model rather than document-oriented patterns.

State machines are used for entities that go through multiple states (Orders: pending → paid → fulfilled → delivered). These state transitions are enforced at the application level with explicit transition methods that validate legal state changes. This prevents invalid state combinations like a 'delivered' order that hasn't been 'paid'."

## Core Entities

### User
- **Owner Module**: User Module
- **Primary Key**: `id` (UUID)
- **Key Attributes**:
  - `email` (unique, indexed)
  - `username` (unique, indexed)
  - `password_hash` (never logged or returned in API)
  - `created_at`, `last_login`
- **Purpose**: Represents a customer or admin user of the system

### Order
- **Owner Module**: Order Module
- **Primary Key**: `id` (UUID)
- **Key Attributes**:
  - `user_id` (foreign key to User)
  - `status` (enum: pending, paid, fulfilled, delivered, cancelled)
  - `total` (integer, cents)
  - `created_at`, `updated_at`
- **Purpose**: Represents a customer's purchase

### Payment
- **Owner Module**: Payment Module
- **Primary Key**: `id` (UUID)
- **Key Attributes**:
  - `order_id` (foreign key to Order, unique)
  - `amount` (integer, cents)
  - `status` (enum: pending, completed, failed, refunded)
  - `stripe_charge_id` (for refunds)
  - `created_at`
- **Purpose**: Tracks payment attempts and results

[Document all core entities]

## Relationships

[Explain how entities relate to each other]

```
[User] 1──────* [Order]
       │
       └──────* [Payment]
       
[Order] 1─────* [OrderLine]
        │
        └─────1 [Payment]
        
[OrderLine] *─────1 [Product]
```

### User → Orders (One-to-Many)
- **Type**: One user has many orders
- **Enforced by**: Foreign key `orders.user_id` → `users.id`
- **Cascade behavior**: ON DELETE RESTRICT (cannot delete user with orders)
- **Why**: Users accumulate order history over time. Deleting a user shouldn't delete their order records for accounting purposes.

### Order → Payment (One-to-One)
- **Type**: Each order has exactly one payment
- **Enforced by**: Unique constraint on `payments.order_id`
- **Cascade behavior**: ON DELETE CASCADE (deleting order deletes payment)
- **Why**: Payments are specific to orders. If an order is deleted (e.g., administrative action), its payment should be deleted too.

[Document all relationships]

## Status Flows

[Document state machines for entities that have status/state]

### Order Status Flow

```
[pending_payment] → [paid] → [fulfilling] → [shipped] → [delivered]
                      ↓
                  [cancelled]
```

**Valid Transitions**:
- `pending_payment` → `paid`: When Payment Module successfully charges card
- `paid` → `fulfilling`: When Fulfillment Module starts processing
- `fulfilling` → `shipped`: When warehouse confirms shipment
- `shipped` → `delivered`: When carrier confirms delivery
- `pending_payment` → `cancelled`: User cancels before payment
- `paid` → `cancelled`: Admin cancels paid order (triggers refund)

**Invalid Transitions** (will raise error):
- `pending_payment` → `fulfilling`: Cannot fulfill unpaid order
- `delivered` → `cancelled`: Cannot cancel delivered order
- `shipped` → `pending_payment`: Cannot revert shipped order

**Code Enforcement**:
```python
def transition_to(self, new_status):
    valid_transitions = {
        'pending_payment': ['paid', 'cancelled'],
        'paid': ['fulfilling', 'cancelled'],
        'fulfilling': ['shipped'],
        'shipped': ['delivered'],
        'delivered': [],  # Terminal state
        'cancelled': []   # Terminal state
    }
    
    if new_status not in valid_transitions[self.status]:
        raise InvalidTransitionError(
            f"Cannot transition from {self.status} to {new_status}"
        )
    
    self.status = new_status
    self.save()
```

### Payment Status Flow

[Similar documentation for Payment status]

## Data Integrity

### Constraints

**Unique Constraints**:
- `users.email` - Email addresses must be unique
- `users.username` - Usernames must be unique  
- `payments.order_id` - Each order has at most one payment

**Foreign Key Constraints**:
- `orders.user_id` → `users.id` (required)
- `payments.order_id` → `orders.id` (required)
- `order_lines.order_id` → `orders.id` (required)
- `order_lines.product_id` → `products.id` (required)

**Check Constraints**:
- `orders.total >= 0` - Order total cannot be negative
- `payments.amount >= 0` - Payment amount cannot be negative
- `products.price >= 0` - Product price cannot be negative

### Validation Rules

**On User Create**:
- Email must be valid format (regex validation)
- Username must be 3-20 characters, alphanumeric
- Password must be at least 8 characters

**On Order Create**:
- Must have at least one order line
- Order total must match sum of order line totals
- User must exist

**On Payment Create**:
- Order must exist and be in 'pending_payment' status
- Payment amount must match order total
- Must have valid payment token from Stripe

### Indexes

[Document key indexes for performance]

- `idx_orders_user_id` on `orders.user_id` - For user order history queries
- `idx_orders_status` on `orders.status` - For order status filtering
- `idx_payments_order_id` on `payments.order_id` - For payment lookup by order
- `idx_users_email` on `users.email` (unique) - For login queries

## Data Access Patterns

[Explain common query patterns]

**Most Common Queries**:

1. **Get user's orders**: `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`
   - Uses index `idx_orders_user_id`
   - Pattern: See `patterns/data-access.md`

2. **Get order with payment**: `SELECT * FROM orders JOIN payments ON orders.id = payments.order_id WHERE orders.id = ?`
   - Uses primary keys
   - Always needed to show order details

3. **Check product inventory**: `SELECT quantity FROM products WHERE id = ? FOR UPDATE`
   - Uses row-level lock to prevent race conditions
   - Pattern: See `patterns/data-access.md` for transaction handling

[Document key query patterns]

## Performance Considerations

**Write Operations**:
- Order creation involves 3-5 INSERT statements (order, order lines, payment)
- Wrapped in transaction for atomicity
- Expected latency: 50-100ms

**Read Operations**:
- User order history is most frequent read (10x more reads than writes)
- Cached in Redis for 5 minutes
- Cache key: `user:{user_id}:orders`

**Scaling Considerations**:
- Orders table will grow indefinitely (never deleted)
- Consider partitioning by date after 10M+ orders
- Current size: ~500K orders, performs well

[Document performance characteristics]
```

Only create this file if the codebase has a non-trivial data model.

---

### Output 3: Update `.ai/agents.md`

Add these sections (replace placeholders):

```markdown
## Architecture
- System overview → `architecture/module-interactions.md`
- Data model → `architecture/data-model.md` (if applicable)

## External Systems
- **Stripe** - Payment processing - Used by: Payment Module
- **SendGrid** - Email delivery - Used by: Notification Module
- **PostgreSQL** - Primary database - Used by: All modules
- **Redis** - Caching and sessions - Used by: Auth Module, Inventory Module

[List all external systems discovered]
```

---

## File Creation Checklist

Create this directory:
- [ ] `.ai/architecture/`

Create these files:
- [ ] `.ai/architecture/module-interactions.md` (always create)
- [ ] `.ai/architecture/data-model.md` (only if applicable)

Update this file:
- [ ] `.ai/agents.md` (add Architecture and External Systems sections)

---

## Verification

After creating these files:
- [ ] module-interactions.md is 200+ lines with detailed explanations
- [ ] All module relationships are documented
- [ ] Data flows include step-by-step walkthroughs
- [ ] External systems are listed with evidence (file paths)
- [ ] Pattern references are included
- [ ] agents.md links to architecture files correctly

---

## Next Step
Continue to `03-generate-module-contexts.md` after completion.
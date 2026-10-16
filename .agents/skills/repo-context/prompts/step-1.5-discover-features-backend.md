# Step 1.5: Discover Features (Backend)

## Objective
Identify user-facing features by grouping API endpoints, creating the bridge between product capabilities and code implementation.

## Prerequisites
- Read `.ai/agents.md` for module list
- Backend service with REST/GraphQL/gRPC APIs

## Discovery Method: API Endpoint Grouping

Group API endpoints by domain/capability to identify features.

### Analysis Steps

1. **List all API endpoints** (REST paths, GraphQL queries, gRPC methods)
2. **Group by prefix/domain** (auth, checkout, products, etc.)
3. **Identify user capabilities** (what can users actually do?)
4. **Map to modules** (which modules handle these endpoints)

---

## Example Analysis

### Endpoints Found:
```
POST   /auth/login
POST   /auth/register
GET    /auth/me

GET    /products
GET    /products/:id
POST   /products (admin)

POST   /checkout/start
POST   /checkout/apply-discount
POST   /checkout/complete

GET    /orders
GET    /orders/:id
```

### Features Identified:
- **User Authentication** - /auth/*
- **Product Catalog** - /products/*
- **Checkout** - /checkout/*
- **Order Management** - /orders/*

---

## Output: Create `.ai/features/[feature-name].md` for each feature

Use this template:

```markdown
# [Feature Name]

## What Users Can Do
[1-2 sentences describing the user-facing capability]

Example:
"Users can browse products, view details, and search/filter the catalog. Admins can add, edit, and remove products."

## API Endpoints

### [Endpoint 1]
- **Method & Path**: `POST /checkout/start`
- **Purpose**: Initiate checkout session for a cart
- **Auth**: Required (JWT)
- **Handler**: CheckoutService.startCheckout() in `modules/checkout-service.md`

### [Endpoint 2]
- **Method & Path**: `POST /checkout/apply-discount`
- **Purpose**: Apply discount code to active checkout
- **Auth**: Required
- **Handler**: DiscountService.applyCode() in `modules/discount-service.md`

[List all endpoints for this feature]

## Modules Involved
- **[Module Name]** → `modules/[name].md` - [What this module does for the feature]

Example:
- **CheckoutService** → `modules/checkout-service.md` - Orchestrates checkout flow
- **DiscountService** → `modules/discount-service.md` - Validates and applies discount codes
- **PaymentService** → `modules/payment-service.md` - Processes payment

## Database Tables
- [table_name] - [Purpose for this feature]

Example:
- checkouts - Stores active checkout sessions
- discount_codes - Validates discount codes
- orders - Created upon checkout completion

## Business Rules
- [Key rule 1]
- [Key rule 2]

Example:
- Discounts cannot exceed 50% of order total
- Checkout sessions expire after 30 minutes
- Payment must succeed before order is created

## User Flow
[Step-by-step flow from user perspective]

Example:
1. User initiates checkout (POST /checkout/start)
2. User applies discount code (POST /checkout/apply-discount)
3. User completes payment (POST /checkout/complete)
4. Order created and confirmation returned

## Related Features
- [Feature Name] - [How they relate]

Example:
- Order Management - Created after successful checkout
- Discounts - Can be applied during checkout
- Payments - Required to complete checkout

## Dependencies
**Internal**: [Other features this depends on]
**External**: [External services/APIs]

Example:
**Internal**: Product Catalog (must have products to checkout)
**External**: Stripe API (payment processing)

## Error Scenarios
- [Scenario] → [What happens]

Example:
- Invalid discount code → 400 error, user notified
- Payment fails → Checkout remains active, user can retry
- Checkout expired → 410 error, user must restart

## Patterns Used
- [Pattern Name] → `../patterns/[name].md` - [How it's used]

Example:
- Error Handling → `../patterns/error-handling.md` - Payment failures are retried
- Logging → `../patterns/logging.md` - All checkout steps logged with checkout_id
```

---

## Discovery Process

### Step 1: Extract All Endpoints

Scan:
- Route definitions (`routes.py`, `router.ts`, etc.)
- Controller files
- API documentation (Swagger/OpenAPI)
- GraphQL schema files
- gRPC proto files

### Step 2: Group by Domain

Look for natural groupings:
```
/auth/*        → Authentication feature
/users/*       → User Management
/products/*    → Product Catalog
/cart/*        → Shopping Cart
/checkout/*    → Checkout
/orders/*      → Order Management
/payments/*    → Payment Processing
/reviews/*     → Product Reviews
/admin/*       → Admin Tools
```

### Step 3: Identify User Capabilities

For each group, ask: "What can users DO with these endpoints?"

Example:
- /checkout/* → "Complete a purchase"
- /products/* → "Browse and search products"
- /reviews/* → "Read and write product reviews"

### Step 4: Map to Modules

For each endpoint, identify which module handles it:
```
POST /checkout/start → CheckoutService
POST /checkout/complete → CheckoutService + PaymentService
```

---

## Output Structure

Create features directory and files:

```
.ai/
├── features/                    ← NEW
│   ├── user-authentication.md
│   ├── product-catalog.md
│   ├── checkout.md
│   ├── order-management.md
│   └── ...
```

---

## Update `.ai/agents.md`

Add Features Map section (before Module Map):

```markdown
## Features Map

User-facing capabilities and their implementation.

### Core Features
- **Checkout** → `features/checkout.md` - Complete purchase flow
- **Product Catalog** → `features/product-catalog.md` - Browse and search products
- **User Authentication** → `features/user-authentication.md` - Login and registration
- **Order Management** → `features/order-management.md` - View order history

### Admin Features
- **Product Management** → `features/product-management.md` - Add/edit products

[List all features]

## Module Map
[Existing module map...]
```

---

## Cross-Referencing

### In Feature Files
Link to modules that implement the feature.

### In Module Files
Add "Features Implemented" section:

```markdown
## Features Implemented
- [Checkout](../features/checkout.md) - Handles checkout flow orchestration
- [Discounts](../features/discounts.md) - Validates discount codes
```

---

## Verification

- [ ] All API endpoint groups identified
- [ ] Each feature has a file in `features/`
- [ ] Feature files link to implementing modules
- [ ] Module files link back to features
- [ ] `agents.md` has complete Features Map
- [ ] No broken links

---

## Example: Checkout Feature (Backend)

```markdown
# Checkout Feature

## What Users Can Do
Users can complete a purchase by creating a checkout session, applying discounts, and processing payment. The feature handles cart-to-order conversion.

## API Endpoints

### POST /checkout/start
- **Purpose**: Create checkout session from cart
- **Auth**: Required (JWT)
- **Handler**: CheckoutService.start() in `modules/checkout-service.md`
- **Request**: `{"cart_id": "cart_123"}`
- **Response**: `{"checkout_id": "chk_456", "total": 9999}`

### POST /checkout/apply-discount
- **Purpose**: Apply discount code to checkout
- **Auth**: Required
- **Handler**: DiscountService.apply() in `modules/discount-service.md`
- **Request**: `{"checkout_id": "chk_456", "code": "SAVE20"}`
- **Response**: `{"discount_amount": 1999, "new_total": 8000}`

### POST /checkout/complete
- **Purpose**: Process payment and create order
- **Auth**: Required
- **Handler**: CheckoutService.complete() in `modules/checkout-service.md`
- **Request**: `{"checkout_id": "chk_456", "payment_token": "tok_visa"}`
- **Response**: `{"order_id": "ord_789", "status": "completed"}`

## Modules Involved
- **CheckoutService** → `modules/checkout-service.md` - Orchestrates entire checkout flow
- **DiscountService** → `modules/discount-service.md` - Validates and applies discount codes
- **PaymentService** → `modules/payment-service.md` - Processes payment via Stripe
- **OrderService** → `modules/order-service.md` - Creates order from checkout

## Database Tables
- checkouts - Active checkout sessions (30min TTL)
- discount_codes - Valid discount codes
- orders - Created after successful payment

## Business Rules
- Checkout sessions expire after 30 minutes
- Discounts max 50% of subtotal
- Payment must succeed before order created
- Cart items reserved during checkout

## User Flow
1. User clicks "Proceed to Checkout" → POST /checkout/start
2. Backend creates checkout session, reserves cart items
3. User enters discount code → POST /checkout/apply-discount
4. Backend validates code, recalculates total
5. User submits payment → POST /checkout/complete
6. Backend charges card, creates order, releases reservation
7. User receives order confirmation

## Related Features
- Shopping Cart - Source of checkout items
- Order Management - Created after successful checkout
- Discounts - Applied during checkout
- Payments - Required to complete

## Dependencies
**Internal**: Product Catalog, Shopping Cart, Inventory
**External**: Stripe API (payment processing)

## Error Scenarios
- Invalid discount code → 400 error, user can retry
- Payment declined → 402 error, checkout remains active
- Checkout expired → 410 error, must create new checkout
- Insufficient inventory → 409 error, items unavailable

## Patterns Used
- Error Handling → `../patterns/error-handling.md` - Payment failures retried
- Async Jobs → `../patterns/async-jobs.md` - Cleanup expired checkouts
- Logging → `../patterns/logging.md` - All steps logged with checkout_id
```

---

## Next Step
Continue to `02-map-relationships.md` after completing feature documentation.
# Step 1: Discover Repository Modules

## Objective
Identify all distinct modules, services, or components and update `agents.md` with the Module Map.

## Prerequisites
- Read `.ai/agents.md` for project structure context

## Task
Explore the codebase and:
1. Scan directory structure for natural boundaries
2. Analyze import/dependency patterns
3. Look for domain separation (user, payment, order, etc.)
4. Identify shared libraries or utilities

## Questions to Answer
- What does each module own?
- How do you distinguish modules from each other?
- Are there overlapping responsibilities?
- Which are core modules vs utilities?

---

## Analysis Techniques

### Directory Structure
- Look for subdirectories that represent distinct domains
- Example: `/src/payment`, `/src/user`, `/src/orders`
- Check for `__init__.py` (Python) or `index.ts` (TypeScript) that indicate module boundaries

### Import/Dependency Patterns
- Trace import statements to see which code depends on what
- Modules typically import from other modules but not vice versa
- Look for circular imports (these indicate unclear boundaries)

### Domain Separation
- Business domains: user management, payments, orders, inventory, notifications
- Technical domains: authentication, caching, logging, jobs
- Look for models/entities that belong together

### Naming Patterns
- Service classes: `PaymentService`, `UserService`
- Controllers: `OrderController`, `CheckoutController`
- Repositories: `ProductRepository`, `InventoryRepository`

---

## Output: Update `.ai/agents.md`

Find the "Module Map" section in `agents.md` (currently says "[Will be populated in Step 1]") and replace it with:

```markdown
## Module Map

### Core Modules
- **[Module Name]** → `modules/[module-name].md` - [One-line purpose]
- **[Module Name]** → `modules/[module-name].md` - [One-line purpose]
- **[Module Name]** → `modules/[module-name].md` - [One-line purpose]

### Shared/Utility Modules
- **[Module Name]** → `modules/[module-name].md` - [One-line purpose]
- **[Module Name]** → `modules/[module-name].md` - [One-line purpose]

## Notes on Module Organization
[Optional: Any observations about module boundaries, overlaps, or unclear separations]
```

### Naming Convention
**Important**: Use kebab-case for module file names:
- Payment Service → `payment-service.md`
- User Authentication → `user-auth.md`
- Cache Manager → `cache-manager.md`

### Core vs Shared Distinction
**Core modules**: Implement primary business logic (orders, payments, users)
**Shared/Utility modules**: Provide common functionality used by core modules (logging, caching, API client)

---

## Example Module Map

```markdown
## Module Map

### Core Modules
- **Payment Service** → `modules/payment-service.md` - Credit card processing via Stripe
- **User Service** → `modules/user-service.md` - User authentication and profile management  
- **Order Service** → `modules/order-service.md` - Order lifecycle and fulfillment
- **Inventory Service** → `modules/inventory-service.md` - Product inventory tracking
- **Notification Service** → `modules/notification-service.md` - Email and SMS notifications

### Shared/Utility Modules
- **Logger** → `modules/logger.md` - Centralized structured logging
- **Cache Manager** → `modules/cache-manager.md` - Redis caching layer
- **API Client** → `modules/api-client.md` - Base HTTP client for external APIs
- **Job Queue** → `modules/job-queue.md` - Async job processing with Celery

## Notes on Module Organization
The Payment, Order, and Inventory modules have some overlap in handling order state transitions. Order Service is the source of truth for order status, but Payment and Inventory update it after their operations complete. This creates tight coupling that should be addressed with events in future refactoring.
```

---

## How to Identify Modules

### Look for these indicators:

**1. Separate Directories**
```
/src/payment/       ← Payment Module
/src/orders/        ← Order Module
/src/users/         ← User Module
```

**2. Service Classes**
```python
# If you see these, they're likely separate modules
class PaymentService:
class OrderService:
class UserService:
```

**3. Database Models/Entities**
```python
# Models that work together often form a module
class Order:
class OrderLine:
class OrderStatus:
# → These form the Order Module
```

**4. API Endpoint Groupings**
```python
# Endpoints grouped by domain
@api.route('/payments/*')     ← Payment Module
@api.route('/orders/*')       ← Order Module
@api.route('/users/*')        ← User Module
```

### Module Identification Tips

**Too granular**: Don't create separate modules for every file
- Bad: "models.py module", "utils.py module"
- Good: "Payment module" (which contains payment models, services, utils)

**Too broad**: Don't lump everything together
- Bad: One "Business Logic" module for payments, orders, users
- Good: Separate Payment, Order, and User modules

**Good module size**: 
- Contains 3-15 related files
- Has a clear purpose (verb + noun: "Process payments", "Manage users")
- Could be explained to a new developer in 2-3 sentences

---

## Handling Edge Cases

### If modules are unclear:
Note it in "Notes on Module Organization":
```markdown
## Notes on Module Organization
Module boundaries are not well-defined in this codebase. Payment logic is split between `/src/checkout` and `/src/billing` with unclear separation. For this documentation, we're treating them as separate modules (Checkout Module and Billing Module) but they should likely be merged.
```

### If there are no clear modules:
If the codebase is a single monolithic module, document it:
```markdown
## Module Map

### Core Modules  
- **Main Application** → `modules/main-app.md` - Handles all business logic (payments, orders, users) in a single module

## Notes on Module Organization
This is a monolithic application without clear module boundaries. All business logic resides in `/src` with mixed concerns. Future refactoring should separate into domain-specific modules.
```

### For Large Codebases (20+ modules):
Document ALL modules but organize them clearly by type:

```markdown
## Module Map

### Core Modules (Primary Business Logic)
- [List all core business modules]
- [Payment, Orders, Users, etc.]

### Supporting Modules (Domain-Specific Support)
- [List all supporting modules like bin_packing, rule_engine, services]
- [These back the core domains]

### Infrastructure Modules (Cross-Cutting)
- [List all infrastructure like config, common, monitoring]

### Utility Modules (Helpers)
- [List all utility modules]

## Notes on Module Organization
This codebase has [X] modules organized by responsibility. All modules are documented below - supporting modules (e.g., bin_packing, rule_engine) back the core domains, while infrastructure modules (config, common) provide cross-cutting functionality.
```

**Important**: Document EVERY module, no matter how small. Supporting and utility modules are just as important as core modules - they're often where critical logic lives. Don't skip anything based on perceived importance.

---

## File Updates

Update this file:
- [ ] `.ai/agents.md` (replace Module Map section with discovered modules)

---

## Verification

After updating `agents.md`:
- [ ] All discovered modules are listed
- [ ] Module names are descriptive and clear
- [ ] File path references use kebab-case
- [ ] Core vs Shared distinction makes sense
- [ ] One-line purposes are informative
- [ ] Any unclear boundaries are noted

---

## Next Step
Continue to `02-map-relationships.md` after completion.
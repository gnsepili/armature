# Step 1.5: Discover Features (Frontend)

## Objective
Identify user-facing features by grouping routes/screens and mapping them to backend API calls.

## Prerequisites
- Read `.ai/agents.md` for module/component list
- Frontend app (React, Vue, Angular, etc.)

## Discovery Method: Route/Screen + API Mapping

Group routes/screens by user capability and document backend APIs they call.

---

## Analysis Steps

1. **List all routes** (URL paths or route definitions)
2. **Identify screens/components** for each route
3. **Group by user capability** (what can users accomplish?)
4. **Map backend API calls** (which endpoints are used?)

---

## Example Analysis

### Routes Found:
```
/login, /register          → Authentication screens
/products, /product/:id    → Product browsing
/cart, /checkout           → Shopping & checkout
/orders, /order/:id        → Order history
/profile, /profile/edit    → User profile
```

### Features Identified:
- **User Authentication** - Login/register flows
- **Product Browsing** - Catalog and detail views
- **Shopping & Checkout** - Cart and purchase
- **Order Management** - View order history
- **User Profile** - View/edit profile

---

## Output: Create `.ai/features/[feature-name].md` for each feature

Use this template:

```markdown
# [Feature Name]

## What Users Can Do
[1-2 sentences describing the user-facing capability]

Example:
"Users can browse the product catalog, view product details, search, and filter by category. They can add products to wishlist and compare similar items."

## Screens/Routes

### [Screen/Route 1]
- **Route**: `/products`
- **Component**: `ProductListScreen`
- **Purpose**: Browse product catalog
- **Location**: `src/screens/ProductListScreen.tsx`

### [Screen/Route 2]
- **Route**: `/product/:id`
- **Component**: `ProductDetailScreen`
- **Purpose**: View single product details
- **Location**: `src/screens/ProductDetailScreen.tsx`

[List all screens/routes for this feature]

## Backend APIs Called

### GET /products
- **Called from**: ProductListScreen
- **Purpose**: Fetch product catalog
- **Response**: Array of products with basic info
- **Error handling**: Shows empty state if fails

### GET /products/:id
- **Called from**: ProductDetailScreen
- **Purpose**: Fetch product details
- **Response**: Full product data including images, specs
- **Error handling**: Shows 404 page if product not found

### POST /cart/add
- **Called from**: ProductDetailScreen (Add to Cart button)
- **Purpose**: Add product to shopping cart
- **Payload**: `{product_id, quantity}`
- **Error handling**: Toast notification on failure

[List all backend APIs this feature calls]

## Components/Modules Involved
- **[Component Name]** - `src/components/[name].tsx` - [What it does]

Example:
- **ProductCard** - `src/components/ProductCard.tsx` - Displays product summary
- **ProductGallery** - `src/components/ProductGallery.tsx` - Image carousel
- **AddToCartButton** - `src/components/AddToCartButton.tsx` - Add to cart action

## State Management
- **Global state**: [What's stored in Redux/Context/Zustand]
- **Local state**: [Component-level state]

Example:
- **Global**: products array, filters, search query (Redux)
- **Local**: selected image index, quantity selector (component state)

## Business Rules
- [Key rule 1]
- [Key rule 2]

Example:
- Products out of stock show "Notify Me" instead of "Add to Cart"
- Guest users can browse but must login to add to cart
- Product images lazy load on scroll

## User Flow
[Step-by-step flow from user perspective]

Example:
1. User lands on /products (ProductListScreen)
2. Screen calls GET /products, displays grid
3. User clicks product → navigates to /product/:id
4. ProductDetailScreen calls GET /products/:id
5. User clicks "Add to Cart" → POST /cart/add
6. Success toast shown, cart badge updates

## Navigation Flow
```
[Screen A] → [Screen B] → [Screen C]
```

Example:
```
ProductListScreen → ProductDetailScreen → CartScreen → CheckoutScreen
```

## Related Features
- [Feature Name] - [How they relate]

Example:
- Shopping Cart - Products added from this feature
- Wishlist - Users can save products for later
- Product Reviews - Displayed on product detail

## Dependencies
**Internal**: [Other features/screens]
**Backend**: [Backend APIs required]
**External**: [Third-party services]

Example:
**Internal**: Shopping Cart, User Authentication
**Backend**: Product Catalog API, Cart API
**External**: Google Analytics (track views)

## Error Scenarios
- [Scenario] → [What users see]

Example:
- API timeout → Loading skeleton shown indefinitely, retry button after 10s
- Product not found → 404 page with link back to catalog
- No internet → Offline banner, cached products shown if available

## Performance Considerations
- [Optimization used]

Example:
- Product images lazy loaded
- List virtualized (react-window) for 1000+ products
- Search debounced (300ms delay)
- Results cached for 5 minutes

## Patterns Used
- [Pattern Name] → `../patterns/[name].md` - [How it's used]

Example:
- API Client → `../patterns/api-client.md` - All requests use base client
- Error Handling → `../patterns/error-handling.md` - Network errors show retry
- Loading States → `../patterns/loading-states.md` - Skeleton screens while loading
```

---

## Discovery Process

### Step 1: Extract All Routes

Scan:
- Route configuration (`routes.tsx`, `router.js`, `app-routing.module.ts`)
- Navigation components
- Screen/page files in `/src/screens` or `/src/pages`

### Step 2: Group by User Capability

```
/login, /register           → User Authentication
/products, /product/:id     → Product Browsing
/cart, /checkout            → Shopping & Checkout
/orders, /order/:id         → Order History
/profile, /settings         → User Profile
```

### Step 3: Map Backend APIs

For each screen, find API calls:
- Check `useEffect` hooks (React)
- Find `fetch` or `axios` calls
- Check service/API files
- Review state management actions

Example:
```typescript
// ProductListScreen.tsx
useEffect(() => {
  fetch('/api/products')  // ← Backend API call
    .then(res => res.json())
    .then(setProducts);
}, []);
```

### Step 4: Document Components

List major components per feature:
- Screens/Pages (top-level)
- Shared components used
- State management involved

---

## Output Structure

```
.ai/
├── features/                    ← NEW
│   ├── user-authentication.md
│   ├── product-browsing.md
│   ├── shopping-checkout.md
│   └── ...
```

---

## Update `.ai/agents.md`

Add Features Map section:

```markdown
## Features Map

### User-Facing Features
- **Product Browsing** → `features/product-browsing.md` - Catalog and product details
- **Shopping & Checkout** → `features/shopping-checkout.md` - Cart and purchase flow
- **User Authentication** → `features/user-authentication.md` - Login and registration
- **Order History** → `features/order-history.md` - View past orders

[List all features]
```

---

## Cross-Referencing

### In Feature Files
Link to:
- Components involved
- Backend APIs (reference backend feature docs if available)
- Patterns used

### In Component/Module Files
Add "Features Implemented" section:

```markdown
## Features Implemented
- [Product Browsing](../features/product-browsing.md) - Displays product list
- [Shopping Cart](../features/shopping-checkout.md) - Add to cart functionality
```

---

## Verification

- [ ] All routes/screens identified
- [ ] Backend API calls documented
- [ ] Components mapped to features
- [ ] State management documented
- [ ] User flows described
- [ ] `agents.md` updated with Features Map

---

## Example: Product Browsing Feature (Frontend)

```markdown
# Product Browsing Feature

## What Users Can Do
Users can browse the product catalog, view product details, search by keyword, and filter by category, price range, and brand. They can add products to cart or wishlist directly from the catalog.

## Screens/Routes

### Product List Screen
- **Route**: `/products`
- **Component**: `ProductListScreen`
- **Purpose**: Browse product catalog with search/filters
- **Location**: `src/screens/ProductListScreen.tsx`

### Product Detail Screen
- **Route**: `/product/:id`
- **Component**: `ProductDetailScreen`
- **Purpose**: View single product with full details, images, reviews
- **Location**: `src/screens/ProductDetailScreen.tsx`

## Backend APIs Called

### GET /products
- **Called from**: ProductListScreen
- **Purpose**: Fetch paginated product list
- **Query params**: `?page=1&limit=20&category=electronics&search=laptop`
- **Response**: `{products: [...], total: 150, page: 1}`
- **Error handling**: Shows empty state with retry button

### GET /products/:id
- **Called from**: ProductDetailScreen
- **Purpose**: Fetch full product details
- **Response**: `{id, name, price, images, description, specs, reviews}`
- **Error handling**: 404 page if product not found

### POST /cart/add
- **Called from**: ProductDetailScreen, ProductCard component
- **Purpose**: Add product to cart
- **Payload**: `{product_id: "prod_123", quantity: 2}`
- **Response**: `{cart_id: "cart_456", item_count: 5}`
- **Error handling**: Toast notification "Failed to add to cart"

### POST /wishlist/add
- **Called from**: ProductDetailScreen
- **Purpose**: Save product to wishlist
- **Payload**: `{product_id: "prod_123"}`
- **Response**: `{success: true}`
- **Error handling**: Requires login, shows login modal if not authenticated

## Components/Modules Involved

### Core Components
- **ProductListScreen** - `src/screens/ProductListScreen.tsx` - Main catalog view
- **ProductDetailScreen** - `src/screens/ProductDetailScreen.tsx` - Product detail view
- **ProductCard** - `src/components/ProductCard.tsx` - Product summary card (used in list)
- **ProductGallery** - `src/components/ProductGallery.tsx` - Image carousel with zoom
- **FilterSidebar** - `src/components/FilterSidebar.tsx` - Category/price filters
- **SearchBar** - `src/components/SearchBar.tsx` - Product search input
- **AddToCartButton** - `src/components/AddToCartButton.tsx` - Reusable add to cart

### Services
- **ProductService** - `src/services/ProductService.ts` - API calls for products
- **CartService** - `src/services/CartService.ts` - Add to cart API

## State Management

### Global State (Redux)
- `products` - Array of products (from GET /products)
- `filters` - Active filters {category, priceRange, brand}
- `searchQuery` - Current search string
- `cart` - Cart state {items, count}

### Local State (Component)
- ProductDetailScreen: `selectedImageIndex`, `quantity`
- ProductCard: `isHovering`
- FilterSidebar: `tempFilters` (before applying)

## Business Rules
- Products out of stock show "Notify Me" instead of "Add to Cart"
- Guest users can browse but must login to add to cart or wishlist
- Search is debounced (300ms) to reduce API calls
- Filters applied on client-side for better UX, refetch on pagination
- Product images lazy load on viewport entry
- Maximum 10 items can be added to cart per product

## User Flow

### Browse Flow
1. User navigates to /products
2. ProductListScreen mounts → calls GET /products
3. Loading skeleton shown while fetching
4. Products rendered in grid (ProductCard components)
5. User applies filters → updates Redux state → filters list client-side
6. User clicks product → navigates to /product/:id

### Product Detail Flow
1. ProductDetailScreen mounts → calls GET /products/:id
2. Loading spinner shown
3. Product details rendered (gallery, specs, reviews)
4. User selects quantity, clicks "Add to Cart"
5. Calls POST /cart/add
6. Success toast shown, cart badge updates (+1)
7. User can continue shopping or go to cart

## Navigation Flow
```
ProductListScreen → ProductDetailScreen → CartScreen → CheckoutScreen
                  ↓
               WishlistScreen
```

## Related Features
- Shopping Cart - Products added from this feature
- Wishlist - Save for later functionality
- Product Reviews - Displayed on detail screen
- User Authentication - Required for cart/wishlist

## Dependencies
**Internal**: Shopping Cart, Wishlist, User Auth
**Backend**: Product API (`/products/*`), Cart API (`/cart/*`), Wishlist API
**External**: Google Analytics (track product views), Cloudinary (image optimization)

## Error Scenarios
- **API timeout** → Loading skeleton shown, retry button appears after 10s
- **Product not found** → 404 page with "Back to Catalog" link
- **No internet** → Offline banner, cached products shown if available
- **Add to cart fails** → Toast: "Failed to add to cart. Try again."
- **Not logged in** → Login modal shown when adding to cart/wishlist

## Performance Considerations
- Product images lazy loaded (react-lazy-load-image-component)
- List virtualized for 1000+ products (react-window)
- Search debounced (300ms) using lodash.debounce
- API results cached in Redux for 5 minutes
- Filters applied client-side (no refetch until page change)
- Images served via CDN with responsive sizes
- Infinite scroll for pagination (better mobile UX)

## Patterns Used
- **API Client** → `../patterns/api-client.md` - All requests use base axios instance
- **Error Handling** → `../patterns/error-handling.md` - Network errors show retry UI
- **Loading States** → `../patterns/loading-states.md` - Skeleton screens during fetch
- **Image Optimization** → `../patterns/image-optimization.md` - Lazy load + CDN
```

---

## Next Step
Continue to `02-map-relationships.md` after completing feature documentation.
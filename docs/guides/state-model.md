# State Model: Types, Collections, and Caching

> How Verity manages truth-state with deterministic caching and staleness tracking

This guide explains Verity's state model—the internal structure that keeps truth-state cached, fresh, and synchronized.

---

## The Big Picture

Verity's state model is built on a simple philosophy:

**Truth-state lives in the cache. The cache is populated by fetches and kept fresh by directives.**

```
┌─────────────────────────────────────┐
│          Verity Registry            │
│                                     │
│  ┌─────────────┐  ┌──────────────┐ │
│  │ Collections │  │    Types     │ │
│  │  (lists)    │  │ (individual) │ │
│  └─────────────┘  └──────────────┘ │
│                                     │
│  Populated by: fetch()              │
│  Kept fresh by: directives          │
└─────────────────────────────────────┘
```

---

## Types: Individual Records

**Types** represent individual entities—a single user, a single invoice, a single product.

### Basic Type Registration

```html
<head>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
</head>

<script>
DL.init()

DL.createType('user', {
  fetch: async ({ id }) => {
    const response = await fetch(`/api/users/${id}`)
    return response.json()
  }
})
</script>
```

**What this does:**
- Defines how to fetch a single user by ID
- Verity will cache the result keyed by `user:${id}`
- Subsequent requests for the same ID return cached data (if fresh)

### Using Types in Your UI

```html
<div x-data="{ user: $verity.item('user', 123) }">
  <template x-if="user.meta.loading">
    <p>Loading user...</p>
  </template>
  
  <template x-if="user.data">
    <div>
      <h2 x-text="user.data.name"></h2>
      <p x-text="user.data.email"></p>
    </div>
  </template>
</div>
```

**Key concepts:**
- `user.meta.loading` - Is this item currently fetching?
- `user.meta.error` - Did the fetch fail?
- `user.data` - The actual data (null if not loaded yet)
- `user.meta.lastFetched` - Timestamp of last successful fetch

### Staleness Tracking

Cached data goes stale after a configured time:

```javascript
DL.createType('user', {
  fetch: async ({ id }) => {
    const response = await fetch(`/api/users/${id}`)
    return response.json()
  },
  stalenessMs: 5 * 60 * 1000  // 5 minutes
})
```

**How it works:**
1. First request fetches from server
2. Subsequent requests within 5 minutes use cached data
3. After 5 minutes, next request triggers refetch
4. Old data still shown until new data arrives (no flicker)

---

## Collections: Lists of Records

**Collections** represent lists—all users, active invoices, recent orders.

### Basic Collection Registration

```javascript
DL.createCollection('users', {
  fetch: async () => {
    const response = await fetch('/api/users')
    return response.json()  // Should return { items: [...], meta: {...} }
  }
})
```

**Expected response format:**

```json
{
  "items": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ],
  "meta": {
    "total": 2,
    "page": 1
  }
}
```

### Using Collections in Your UI

```html
<div x-data="{ users: $verity.collection('users') }">
  <template x-if="users.state.loading">
    <p>Loading users...</p>
  </template>
  
  <ul>
    <template x-for="user in users.state.items" :key="user.id">
      <li x-text="user.name"></li>
    </template>
  </ul>
  
  <p>Total: <span x-text="users.state.meta.total"></span></p>
</div>
```

**Key concepts:**
- `users.state.loading` - Is this collection currently fetching?
- `users.state.error` - Did the fetch fail?
- `users.state.items` - Array of items
- `users.state.meta` - Metadata from server (pagination, totals, etc.)

### Parameterized Collections

The killer feature: cache multiple "slices" of the same collection.

```javascript
DL.createCollection('users', {
  fetch: async (params = {}) => {
    const url = new URL('/api/users', location.origin)
    
    if (params.role) {
      url.searchParams.set('role', params.role)
    }
    if (params.status) {
      url.searchParams.set('status', params.status)
    }
    
    const response = await fetch(url)
    return response.json()
  },
  
  stalenessMs: 60 * 1000  // 1 minute
})
```

**Using different parameter combinations:**

```html
<div x-data="{
  adminUsers: $verity.collection('users', { role: 'admin' }),
  activeUsers: $verity.collection('users', { status: 'active' }),
  allUsers: $verity.collection('users')
}">
  <!-- Each is cached separately! -->
</div>
```

**Cache keys:**
- `users:{}` - All users
- `users:{"role":"admin"}` - Just admins
- `users:{"status":"active"}` - Just active users

Each combination is cached independently with its own staleness timer.

---

## The Reference Model

When you access truth-state, Verity returns a **reference** (ref):

```javascript
const userRef = DL.fetchItem('user', 123)

// Reference structure
{
  data: { id: 123, name: "Alice", email: "alice@example.com" },
  meta: {
    loading: false,
    error: null,
    lastFetched: 1234567890,
    activeQueryId: null
  }
}
```

**Why references?**
- Stable objects that update in place
- Frameworks can observe them for reactivity
- Separates data from metadata

### Collection References

```javascript
const usersRef = DL.fetchCollection('users')

// Collection reference structure
{
  state: {
    items: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
    meta: { total: 2, page: 1 },
    loading: false,
    error: null
  }
}
```

---

## Cache Behavior

### First Access: Triggers Fetch

```javascript
// No cache, triggers fetch
const user = DL.fetchItem('user', 123)
// user.meta.loading === true
// user.data === null

// ... fetch completes ...
// user.meta.loading === false
// user.data === { id: 123, name: "Alice", ... }
```

### Second Access: Uses Cache (if fresh)

```javascript
// Within stalenessMs, uses cache
const user = DL.fetchItem('user', 123)
// user.meta.loading === false  ← No fetch!
// user.data === { id: 123, name: "Alice", ... }
```

### After Staleness: Refetches

```javascript
// After stalenessMs expires
const user = DL.fetchItem('user', 123)
// user.meta.loading === true  ← Refetch triggered
// user.data === { id: 123, name: "Alice", ... }  ← Old data still visible

// ... fetch completes ...
// user.data === { id: 123, name: "Alice (Updated)", ... }  ← New data
```

**No flicker:** Old data stays visible during refetch.

---

## Directives: Server-Driven Invalidation

Instead of guessing when to refetch, the **server tells us** via directives.

### Directive Flow

```
1. User updates something
2. Frontend sends mutation to server
3. Server updates database
4. Server returns directives
5. Frontend applies directives
6. Verity invalidates + refetches affected caches
7. UI updates automatically
```

### Example: Update User

```javascript
async function updateUser(id, data) {
  const response = await fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 
      'Content-Type': 'application/json',
      'X-Client-ID': registry.clientId 
    },
    body: JSON.stringify(data)
  })
  
  const payload = await response.json()
  
  // Server returned:
  // {
  //   "user": { ... },
  //   "directives": [
  //     { "op": "refresh_item", "name": "user", "id": 123 },
  //     { "op": "refresh_collection", "name": "users" }
  //   ]
  // }
  
  DL.applyDirectives(payload.directives)
}
```

**What happens:**
1. `refresh_item` directive invalidates `user:123` cache
2. Any components displaying that user refetch automatically
3. `refresh_collection` directive invalidates all `users` collections
4. Any user lists refetch automatically
5. UI updates when new data arrives

[Learn more about Directives →](../concepts/directives.md)

---

## Levels: Detail Granularity

Sometimes you need different amounts of detail for the same entity.

```javascript
DL.createType('user', {
  // Default level: minimal data
  fetch: async ({ id }) => {
    const response = await fetch(`/api/users/${id}`)
    return response.json()
  },
  
  levels: {
    // Detailed level: includes more fields
    detailed: {
      fetch: async ({ id }) => {
        const response = await fetch(`/api/users/${id}?level=detailed`)
        return response.json()
      },
      checkIfExists: (obj) => 'bio' in obj && 'preferences' in obj
    }
  }
})
```

**Usage:**

```html
<!-- List view: default level (id, name, email) -->
<div x-data="{ user: $verity.item('user', 123) }">
  <span x-text="user.data.name"></span>
</div>

<!-- Detail view: detailed level (adds bio, preferences, history) -->
<div x-data="{ user: $verity.item('user', 123, 'detailed') }">
  <h2 x-text="user.data.name"></h2>
  <p x-text="user.data.bio"></p>
  <!-- ... more details ... -->
</div>
```

**Cache behavior:**
- `user:123:default` cached separately from `user:123:detailed`
- Fetching `detailed` doesn't refetch `default`
- Conversion graphs can derive one from another

[Learn more about Levels & Conversions →](../concepts/levels-and-conversions.md)

---

## Memory Management

Long-lived apps can accumulate cached data. Verity includes automatic cleanup.

### Default Behavior

```javascript
DL.init()
// Defaults:
// - Sweep every 60 seconds
// - Keep max 512 items per type
// - Keep max 12 parameter combos per collection
// - Expire items after 10 minutes of inactivity
```

### Custom Configuration

```javascript
DL.init({
  memory: {
    enabled: true,
    sweepIntervalMs: 120_000,         // Sweep every 2 minutes
    maxItemsPerType: 1000,            // Keep up to 1000 users
    maxCollectionsPerName: 20,        // Keep up to 20 param combos
    itemTtlMs: 15 * 60 * 1000,        // Expire after 15 min
    collectionTtlMs: 10 * 60 * 1000   // Expire after 10 min
  }
})
```

**How sweeping works:**
1. Sweeper runs periodically
2. Removes least-recently-used items beyond max limits
3. Removes items not accessed within TTL
4. Never removes items with active fetches

[Learn more about Concurrency & Memory →](../concepts/concurrency-model.md)

---

## Devtools

Inspect Verity's internal state in real-time:

```html
<head>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.css">
</head>
```

**Devtools panels:**
- **Truth:** Current cache contents (types and collections)
- **Fetches:** Active and recent fetch operations
- **Directives:** Directive history and processing
- **SSE:** Connection status and sequence tracking
- **Memory:** Cache size and sweeper activity

Press `Ctrl/Cmd + Shift + D` or append `?devtools=1` to URL.

---

## Best Practices

### 1. Appropriate Staleness Windows

```javascript
// Frequently changing data: short staleness
DL.createCollection('realtime_prices', {
  fetch: () => fetch('/api/prices').then(r => r.json()),
  stalenessMs: 5_000  // 5 seconds
})

// Rarely changing data: long staleness
DL.createType('user_profile', {
  fetch: ({ id }) => fetch(`/api/users/${id}`).then(r => r.json()),
  stalenessMs: 10 * 60 * 1000  // 10 minutes
})
```

### 2. Return Rich Metadata from Collections

```javascript
// ✅ GOOD: Include pagination, totals, filters
{
  "items": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "perPage": 20,
    "hasMore": true
  }
}

// ❌ BAD: Just an array
[{ id: 1 }, { id: 2 }]
```

### 3. Use Directives Liberally

```python
# After ANY mutation, return directives
@app.put('/api/users/<int:user_id>')
def update_user(user_id):
    # ... update database ...
    
    return {
        'user': user.to_dict(),
        'directives': [
            { 'op': 'refresh_item', 'name': 'user', 'id': user_id },
            { 'op': 'refresh_collection', 'name': 'users' }
        ]
    }
```

### 4. Separate Truth-State from View-State

```html
<!-- ✅ GOOD: Clear separation -->
<div x-data="{
  users: $verity.collection('users'),  <!-- Truth-state -->
  sortBy: 'name',                       <!-- View-state -->
  sortOrder: 'asc',                     <!-- View-state -->
  selectedId: null                      <!-- View-state -->
}">

<!-- ❌ BAD: Mixed state -->
<div x-data="{
  users: [],           <!-- Truth-state but managed by Alpine? -->
  sortBy: 'name'       <!-- View-state -->
}">
```

---

## Common Patterns

### Pattern: Optimistic UI Prevention

```javascript
// ❌ DON'T do this (optimistic update)
async function toggleUserActive(id) {
  // Optimistically toggle
  user.data.active = !user.data.active  // ← LYING TO USER
  
  await fetch(`/api/users/${id}/toggle`, { method: 'PUT' })
}

// ✅ DO this (honest loading state)
async function toggleUserActive(id) {
  isToggling = true  // Show spinner
  
  const res = await fetch(`/api/users/${id}/toggle`, { method: 'PUT' })
  const { directives } = await res.json()
  
  DL.applyDirectives(directives)  // Server tells us new state
  isToggling = false
}
```

### Pattern: Parameterized Filtering

```javascript
// Register once with parameter support
DL.createCollection('products', {
  fetch: async (params = {}) => {
    const url = new URL('/api/products', location.origin)
    if (params.category) url.searchParams.set('category', params.category)
    if (params.inStock !== undefined) url.searchParams.set('inStock', params.inStock)
    return fetch(url).then(r => r.json())
  }
})

// Use with different filters
<div x-data="{
  allProducts: $verity.collection('products'),
  electronicsInStock: $verity.collection('products', { category: 'electronics', inStock: true }),
  booksAll: $verity.collection('products', { category: 'books' })
}">
```

### Pattern: Master-Detail

```html
<!-- Master: List with default level -->
<ul>
  <template x-for="id in userIds">
    <li x-data="{ user: $verity.item('user', id) }">
      <button @click="selectedUserId = id">
        <span x-text="user.data?.name"></span>
      </button>
    </li>
  </template>
</ul>

<!-- Detail: Full data with detailed level -->
<div x-show="selectedUserId" x-data="{ user: $verity.item('user', selectedUserId, 'detailed') }">
  <h2 x-text="user.data?.name"></h2>
  <p x-text="user.data?.bio"></p>
  <!-- More details... -->
</div>
```

---

## Summary

**Verity's state model:**
- **Types** cache individual records by ID
- **Collections** cache lists (with parameter support)
- **References** provide stable, observable objects
- **Staleness** tracking prevents unnecessary refetches
- **Directives** from the server invalidate caches
- **Levels** enable detail granularity
- **Memory management** keeps cache bounded

**The result:** Deterministic, predictable caching where truth-state always reflects server reality.

---

## Next Steps

1. Understand [Directives](../concepts/directives.md) for server-driven invalidation
2. Learn [Levels & Conversions](../concepts/levels-and-conversions.md) for efficient fetching
3. Study [Concurrency Model](../concepts/concurrency-model.md) for correctness guarantees
4. Review [API Reference](../reference/core.md) for complete configuration options

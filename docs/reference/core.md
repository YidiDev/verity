# Reference: Core Registry

> Complete API reference for Verity's core data layer

The Verity core is the **backend of your frontend**—a composable data layer that sits between your server's truth-state and your UI's view-state. It handles fetching, caching, staleness, coalescing, and directive-driven invalidation.

!!! info "Installation"
    ```html
    <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
    <script>
      const registry = Verity.createRegistry()
    </script>
    ```

---

## Philosophy Recap

Before diving into the API, remember Verity's core separation:

- **Truth-state** (server-owned): Domain data, business logic, authoritative state
- **View-state** (client-owned): UI concerns like open menus, focus, local filters
- **Verity** (the mediator): Fetches truth-state, tracks staleness, applies directives

Verity **never** lets you lie to the user. No optimistic updates, no temporary states. The UI reflects what the **server confirms**.

See [Philosophy](../philosophy.md) for the full picture.

---

## `createRegistry(options)`

Creates a registry instance—the central coordinator for all truth-state.

### Signature

```typescript
function createRegistry(options?: RegistryOptions): Registry
```

### Options

#### Bulk/Coalescing

```typescript
{
  bulk?: {
    delayMs?: number  // Throttle window before batch refetches (default: 50ms)
  }
}
```

**Why this matters:**
When multiple directives arrive rapidly (e.g., SSE burst), Verity coalesces them into a single batch refetch. `delayMs` controls the window.

**Example:**
```javascript
const registry = Verity.createRegistry({
  bulk: {
    delayMs: 100  // Wait 100ms to collect directives before refetching
  }
})
```

#### Memory Cache

```typescript
{
  memory?: {
    enabled?: boolean              // Enable in-memory caching (default: true)
    maxItemsPerType?: number       // Per-type cache size limit (default: 512)
    stalenessMs?: number           // Global staleness TTL (default: 60000 = 1 minute)
  }
}
```

**Staleness model:**
- Items are **fresh** for `stalenessMs` after fetch
- After that, they're **stale** but still usable
- Verity refetches stale items when accessed or invalidated
- Set to `0` to always refetch

**Example:**
```javascript
const registry = Verity.createRegistry({
  memory: {
    enabled: true,
    maxItemsPerType: 1000,      // Keep up to 1000 items per type
    stalenessMs: 30000          // 30 seconds freshness
  }
})
```

#### SSE (Server-Sent Events)

```typescript
{
  sse?: {
    url?: string                   // SSE endpoint (default: "/api/events")
    audience?: string              // Audience subscription (default: "global")
    withCredentials?: boolean      // Include cookies (default: false)
    enabled?: boolean              // Enable SSE connection (default: true)
    initialRetryMs?: number        // Initial reconnect delay (default: 1000)
    maxRetryMs?: number            // Max reconnect delay (default: 30000)
    retryBackoffFactor?: number    // Exponential backoff multiplier (default: 1.5)
  }
}
```

**Audience-based routing:**
```javascript
// Global events (all clients)
const registry = Verity.createRegistry({
  sse: { audience: 'global' }
})

// User-specific events
const registry = Verity.createRegistry({
  sse: { audience: `user-${currentUserId}` }
})

// Team-specific events
const registry = Verity.createRegistry({
  sse: { audience: `team-${teamId}` }
})
```

**Reconnection behavior:**
- SSE disconnects trigger exponential backoff reconnection
- On reconnect, Verity checks for missed sequence numbers
- If gap detected, triggers resync (force-refresh active collections)

**Disable SSE:**
```javascript
const registry = Verity.createRegistry({
  sse: { enabled: false }  // No SSE connection
})
```

#### Logging

```typescript
{
  logging?: {
    level?: "debug" | "info" | "warn" | "error"  // Log level (default: "warn")
    prefix?: string                                // Log prefix (default: "[Verity]")
  }
}
```

### Returns: Registry Object

```typescript
interface Registry {
  // Type registration
  registerType(name: string, config: TypeConfig): void
  registerCollection(name: string, config: CollectionConfig): void
  
  // Data access
  item(name: string, params: any): ItemHandle
  collection(name: string, params?: any): CollectionHandle
  
  // Directives
  applyDirective(directive: Directive): Promise<void>
  applyDirectives(directives: Directive[]): Promise<void>
  resync(): Promise<void>
  
  // Lifecycle
  emit(event: string, detail?: any): void
  onChange(callback: (event: ChangeEvent) => void): () => void
  
  // Metadata
  clientId: string                    // Unique client identifier
  
  // SSE control
  sseConnect(): void
  sseDisconnect(): void
  sseReconnect(): void
}
```

### Example

```javascript
const registry = Verity.createRegistry({
  bulk: { delayMs: 100 },
  memory: {
    enabled: true,
    maxItemsPerType: 1000,
    stalenessMs: 60000  // 1 minute
  },
  sse: {
    url: '/api/events',
    audience: 'global',
    withCredentials: true,
    initialRetryMs: 1000,
    maxRetryMs: 30000
  },
  logging: {
    level: 'info'
  }
})
```

---

## `registerType(name, config)`

Registers a single-item type (e.g., "current user", "settings", "dashboard summary").

### Signature

```typescript
function registerType(name: string, config: TypeConfig): void

interface TypeConfig {
  fetch: (params: any) => Promise<any>        // Fetch function
  check?: (payload: any) => boolean           // Directive gate
  stalenessMs?: number                         // Per-type staleness override
}
```

### Parameters

#### `fetch` (required)

Async function that fetches the item. Must return the data or throw an error.

```javascript
registry.registerType('current_user', {
  fetch: async () => {
    const res = await fetch('/api/me')
    if (!res.ok) throw new Error('Failed to fetch user')
    return res.json()
  }
})
```

#### `check` (optional)

Gate function for directives. Return `false` to ignore directives for this type.

```javascript
registry.registerType('admin_panel', {
  fetch: async () => { /* ... */ },
  check: (directive) => {
    // Only apply directives if user is admin
    return currentUser.isAdmin
  }
})
```

**Use cases:**
- Permission-based invalidation
- Conditional refresh (e.g., only if tab is visible)
- Rate limiting

#### `stalenessMs` (optional)

Per-type staleness override. Overrides global `memory.stalenessMs`.

```javascript
// Dashboard should refetch every 5 seconds
registry.registerType('dashboard', {
  fetch: async () => { /* ... */ },
  stalenessMs: 5000  // 5 seconds
})

// User profile can be cached for 5 minutes
registry.registerType('current_user', {
  fetch: async () => { /* ... */ },
  stalenessMs: 300000  // 5 minutes
})
```

### Example

```javascript
registry.registerType('app_settings', {
  fetch: async () => {
    const res = await fetch('/api/settings')
    return res.json()
  },
  stalenessMs: 120000  // 2 minutes
})

// Access the item
const settingsHandle = registry.item('app_settings', {})
console.log(settingsHandle.state.value)  // { theme: 'dark', ... }
```

---

## `registerCollection(name, config)`

Registers a parameterized collection (e.g., "todos", "users", "orders").

### Signature

```typescript
function registerCollection(name: string, config: CollectionConfig): void

interface CollectionConfig {
  fetch: (params: any) => Promise<CollectionResult>  // Fetch function
  key?: (params: any) => string                       // Param serializer
  check?: (payload: any) => boolean                   // Directive gate
  stalenessMs?: number                                 // Per-collection staleness
}

interface CollectionResult {
  items: any[]                                         // Array of records
  meta?: any                                           // Optional metadata
}
```

### Parameters

#### `fetch` (required)

Async function that fetches the collection. Must return `{ items, meta? }`.

```javascript
registry.registerCollection('todos', {
  fetch: async (params) => {
    const url = new URL('/api/todos', window.location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    if (params.limit) url.searchParams.set('limit', params.limit)
    
    const res = await fetch(url)
    const data = await res.json()
    
    return {
      items: data.todos,
      meta: {
        total: data.total,
        page: data.page
      }
    }
  }
})
```

#### `key` (optional)

Function that serializes params into a cache key. Defaults to `JSON.stringify`.

```javascript
registry.registerCollection('todos', {
  fetch: async (params) => { /* ... */ },
  key: (params) => {
    // Custom key generation
    const status = params.status || 'all'
    const page = params.page || 1
    return `todos:${status}:${page}`
  }
})
```

**Why custom keys?**
- Normalize parameter order (`{a: 1, b: 2}` vs `{b: 2, a: 1}`)
- Handle undefined/null values consistently
- Optimize cache hits

#### `check` (optional)

Same as `registerType`. Gate directives conditionally.

```javascript
registry.registerCollection('admin_logs', {
  fetch: async (params) => { /* ... */ },
  check: (directive) => currentUser.isAdmin
})
```

#### `stalenessMs` (optional)

Per-collection staleness override.

```javascript
// Real-time feed: refetch every 3 seconds
registry.registerCollection('activity_feed', {
  fetch: async (params) => { /* ... */ },
  stalenessMs: 3000
})

// Archived data: cache for 10 minutes
registry.registerCollection('archived_orders', {
  fetch: async (params) => { /* ... */ },
  stalenessMs: 600000
})
```

### Example

```javascript
registry.registerCollection('todos', {
  fetch: async (params) => {
    const url = new URL('/api/todos', window.location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    
    const res = await fetch(url)
    const data = await res.json()
    
    return {
      items: data.todos,
      meta: { total: data.total }
    }
  },
  stalenessMs: 30000  // 30 seconds
})

// Access the collection
const todosHandle = registry.collection('todos', { status: 'active' })
console.log(todosHandle.state.items)  // [{ id: 1, ... }, ...]
```

---

## `item(name, params)`

Returns a reactive handle for a single item.

### Signature

```typescript
function item(name: string, params: any): ItemHandle

interface ItemHandle {
  state: {
    loading: boolean
    error: Error | null
    value: any | null
  }
  refresh(): Promise<void>
  remove(): void
}
```

### Parameters

- **`name`**: Type name (registered via `registerType`)
- **`params`**: Parameters for the fetch function

### Returns: ItemHandle

```typescript
interface ItemHandle {
  state: {
    loading: boolean    // true while fetching
    error: Error | null // Last error, if any
    value: any | null   // Fetched data
  }
  refresh(): Promise<void>  // Manual refetch
  remove(): void            // Remove from cache
}
```

### Example

```javascript
// Register type
registry.registerType('user', {
  fetch: async ({ userId }) => {
    const res = await fetch(`/api/users/${userId}`)
    return res.json()
  }
})

// Get item handle
const userHandle = registry.item('user', { userId: 123 })

// Access state
if (userHandle.state.loading) {
  console.log('Loading...')
} else if (userHandle.state.error) {
  console.error('Error:', userHandle.state.error)
} else {
  console.log('User:', userHandle.state.value)
}

// Manual refresh
await userHandle.refresh()

// Remove from cache
userHandle.remove()
```

### Reactivity

The `state` object is reactive. In framework adapters, it triggers re-renders:

```javascript
// React
const { state } = useVerityItem('user', { userId: 123 })

// Alpine
<div x-data="{ user: $verity.item('user', { userId: 123 }) }">
  <span x-text="user.state.value?.name"></span>
</div>

// Vue
const user = useVerityItem('user', { userId: 123 })
```

---

## `collection(name, params?)`

Returns a reactive handle for a collection.

### Signature

```typescript
function collection(name: string, params?: any): CollectionHandle

interface CollectionHandle {
  state: {
    loading: boolean
    error: Error | null
    items: any[]
    meta: any | null
  }
  refresh(): Promise<void>
  remove(): void
  setParams(params: any): void
}
```

### Parameters

- **`name`**: Collection name (registered via `registerCollection`)
- **`params`** (optional): Query parameters

### Returns: CollectionHandle

```typescript
interface CollectionHandle {
  state: {
    loading: boolean       // true while fetching
    error: Error | null    // Last error, if any
    items: any[]           // Fetched items
    meta: any | null       // Optional metadata
  }
  refresh(): Promise<void>      // Manual refetch
  remove(): void                // Remove from cache
  setParams(params: any): void  // Update params & refetch
}
```

### Example

```javascript
// Register collection
registry.registerCollection('todos', {
  fetch: async (params) => {
    const url = new URL('/api/todos', window.location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    
    const res = await fetch(url)
    const data = await res.json()
    return { items: data.todos, meta: { total: data.total } }
  }
})

// Get collection handle
const todosHandle = registry.collection('todos', { status: 'active' })

// Access state
console.log(todosHandle.state.items)      // [{ id: 1, ... }, ...]
console.log(todosHandle.state.meta.total) // 42

// Manual refresh
await todosHandle.refresh()

// Update params (triggers refetch)
todosHandle.setParams({ status: 'completed' })

// Remove from cache
todosHandle.remove()
```

### Parameter Changes

```javascript
const handle = registry.collection('todos', { status: 'active' })

// Later: change params
handle.setParams({ status: 'completed' })
// This triggers a new fetch for todos with status=completed
```

---

## `applyDirective(directive)`

Applies a single directive to the cache.

### Signature

```typescript
function applyDirective(directive: Directive): Promise<void>
```

### Parameters

```typescript
type Directive = 
  | RefreshCollectionDirective
  | RefreshItemDirective
  | InvalidateDirective

interface RefreshCollectionDirective {
  op: "refresh_collection"
  name: string
  params?: any
  params_mode?: "exact" | "contains"
  // ... metadata fields
}

interface RefreshItemDirective {
  op: "refresh_item"
  name: string
  id: string | number
  level?: string
  // ... metadata fields
}

interface InvalidateDirective {
  op: "invalidate"
  targets: Directive[]
  // ... metadata fields
}
```

### Behavior

1. Validates the directive
2. Identifies affected cache entries
3. Marks them as stale
4. Triggers refetch (coalesced with other pending invalidations)
5. Respects `check` gates
6. Deduplicates via `idempotency_key`

### Example

```javascript
// After a mutation
const response = await fetch('/api/todos/42', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'New title' })
})

const payload = await response.json()

// Apply directive
if (payload.directive) {
  await registry.applyDirective(payload.directive)
}
```

---

## `applyDirectives(directives)`

Applies multiple directives in a batch.

### Signature

```typescript
function applyDirectives(directives: Directive[]): Promise<void>
```

### Behavior

- Coalesces directives into a single invalidation batch
- Waits for `bulk.delayMs` to collect more directives
- Deduplicates directives (same type + params)
- Respects idempotency keys

### Example

```javascript
const response = await fetch('/api/todos/42', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'New title' })
})

const payload = await response.json()

// Apply all directives
if (payload.directives) {
  await registry.applyDirectives(payload.directives)
}
```

**Common pattern:**
```javascript
async function mutateTodo(id, data) {
  const res = await fetch(`/api/todos/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Verity-Client-ID': registry.clientId  // Tag with client ID
    },
    body: JSON.stringify(data)
  })
  
  const payload = await res.json()
  
  // Apply directives
  if (payload.directives) {
    await registry.applyDirectives(payload.directives)
  }
  
  return payload
}
```

---

## `resync()`

Forces refetch of all active collections. Used when SSE sequence gap detected.

### Signature

```typescript
function resync(): Promise<void>
```

### Behavior

- Marks all active collections as stale
- Triggers immediate refetch
- Used internally when SSE reconnects and detects missed messages

### Example

```javascript
// Manual resync (rare)
await registry.resync()
```

---

## `emit(event, detail)`

Emits lifecycle events. Useful for debugging and devtools integration.

### Signature

```typescript
function emit(event: string, detail?: any): void
```

### Events

| Event | Detail | When |
|-------|--------|------|
| `fetch:start` | `{ name, params }` | Before fetch |
| `fetch:success` | `{ name, params, data }` | After successful fetch |
| `fetch:error` | `{ name, params, error }` | After fetch error |
| `directive:apply` | `{ directive }` | When directive applied |
| `cache:set` | `{ name, params, data }` | When cache updated |
| `cache:invalidate` | `{ name, params }` | When cache invalidated |
| `sse:connect` | `{ url, audience }` | SSE connection opened |
| `sse:disconnect` | `{ reason }` | SSE connection closed |
| `sse:message` | `{ data }` | SSE message received |

### Example

```javascript
registry.onChange((event) => {
  console.log('Registry event:', event)
})

// Custom event
registry.emit('custom:event', { foo: 'bar' })
```

---

## `onChange(callback)`

Subscribe to registry changes. Returns unsubscribe function.

### Signature

```typescript
function onChange(callback: (event: ChangeEvent) => void): () => void

interface ChangeEvent {
  type: string
  detail?: any
  timestamp: number
}
```

### Example

```javascript
// Subscribe to all events
const unsubscribe = registry.onChange((event) => {
  if (event.type === 'directive:apply') {
    console.log('Directive applied:', event.detail.directive)
  }
})

// Later: unsubscribe
unsubscribe()
```

---

## `clientId`

Unique identifier for this client instance. Auto-generated on registry creation.

### Usage

```javascript
console.log(registry.clientId)  // "client-abc123xyz"

// Include in mutation requests
fetch('/api/todos', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Verity-Client-ID': registry.clientId  // ← Server echoes this
  },
  body: JSON.stringify({ title: 'New todo' })
})
```

**Why?**
- Prevents double-application of directives
- Client ignores SSE directives with matching `source`
- Ensures local mutations feel instant

---

## SSE Control Methods

### `sseConnect()`

Manually connect to SSE endpoint (if auto-connect disabled).

```javascript
const registry = Verity.createRegistry({
  sse: { enabled: false }
})

// Later: connect manually
registry.sseConnect()
```

### `sseDisconnect()`

Disconnect from SSE endpoint.

```javascript
registry.sseDisconnect()
```

### `sseReconnect()`

Force reconnect (closes existing connection and opens new one).

```javascript
registry.sseReconnect()
```

---

## Complete Example

```javascript
// Create registry
const registry = Verity.createRegistry({
  bulk: { delayMs: 100 },
  memory: {
    stalenessMs: 60000  // 1 minute
  },
  sse: {
    url: '/api/events',
    audience: 'global',
    withCredentials: true
  }
})

// Register types
registry.registerType('current_user', {
  fetch: async () => {
    const res = await fetch('/api/me')
    return res.json()
  },
  stalenessMs: 300000  // 5 minutes
})

registry.registerCollection('todos', {
  fetch: async (params) => {
    const url = new URL('/api/todos', window.location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    
    const res = await fetch(url)
    const data = await res.json()
    return { items: data.todos, meta: { total: data.total } }
  },
  stalenessMs: 30000  // 30 seconds
})

// Access data
const userHandle = registry.item('current_user', {})
const todosHandle = registry.collection('todos', { status: 'active' })

// Subscribe to changes
registry.onChange((event) => {
  console.log('Event:', event.type, event.detail)
})

// Mutation helper
async function updateTodo(id, data) {
  const res = await fetch(`/api/todos/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Verity-Client-ID': registry.clientId
    },
    body: JSON.stringify(data)
  })
  
  const payload = await res.json()
  
  if (payload.directives) {
    await registry.applyDirectives(payload.directives)
  }
  
  return payload
}

// Use it
await updateTodo(42, { title: 'Updated title' })
```

---

## Summary

**Core Methods:**

| Method | Purpose |
|--------|---------|
| `createRegistry()` | Create registry instance |
| `registerType()` | Register single-item type |
| `registerCollection()` | Register collection type |
| `item()` | Get item handle |
| `collection()` | Get collection handle |
| `applyDirective()` | Apply directive |
| `applyDirectives()` | Apply multiple directives |
| `resync()` | Force refetch all collections |

**Configuration:**

| Option | Default | Purpose |
|--------|---------|---------|
| `bulk.delayMs` | `50` | Coalescing window |
| `memory.stalenessMs` | `60000` | Global staleness TTL |
| `sse.url` | `/api/events` | SSE endpoint |
| `sse.audience` | `global` | Audience subscription |

**Key Concepts:**

- **Staleness:** Items are fresh for `stalenessMs`, then stale but usable
- **Coalescing:** Directives batched within `bulk.delayMs` window
- **Deduplication:** Idempotency keys prevent duplicate processing
- **Sequence tracking:** Detects missed SSE messages, triggers resync

---

## Next Steps

- **Directives:** [Directive API reference](directives.md)
- **Adapters:** [Framework adapters](adapters.md)
- **Concepts:** [Truth vs View State](../concepts/truth-vs-view-state.md)
- **Architecture:** [Backend of Frontend](../architecture.md)

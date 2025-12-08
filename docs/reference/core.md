# Reference: Core API

> Complete API reference for Verity's core data layer

The Verity core is the **backend of your frontend**—a composable data layer that sits between your server's truth-state and your UI's view-state. It handles fetching, caching, staleness, coalescing, and directive-driven invalidation.

!!! info "Installation"
    ```html
    <!-- Load core library -->
    <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
    <!-- Load adapter (Alpine, React, Vue, or Svelte) -->
    <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/alpine.min.js"></script>
    <script>
      // Initialize with options
      DL.init({
        sse: { url: '/api/events' }
      })
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

## `init(options)`

Initializes Verity's core data layer with configuration options. This is called once at application startup.

### Signature

```typescript
function init(options?: InitOptions): void
```

### Options

#### SSE (Server-Sent Events)

```typescript
{
  sse?: {
    enabled?: boolean              // Enable SSE connection (default: true)
    url?: string                   // SSE endpoint (default: "/api/events")
    audience?: string              // Audience subscription (default: "global")
    clientIdParam?: string         // Query param for client ID (default: "client_id")
    audienceParam?: string         // Query param for audience (default: "audience")
    withCredentials?: boolean      // Include cookies (default: false)
    connectOnInit?: boolean        // Auto-connect on init (default: true)
    initialRetryMs?: number        // Initial reconnect delay (default: 2000)
    maxRetryMs?: number            // Max reconnect delay (default: 30000)
    backoffMultiplier?: number     // Exponential backoff multiplier (default: 2)
    resyncOnGap?: boolean          // Resync on sequence gap (default: true)
    resyncJitterMinMs?: number     // Min resync jitter (default: 1500)
    resyncJitterMaxMs?: number     // Max resync jitter (default: 3500)
  }
}
```

**Audience-based routing:**
```javascript
// Global events (all clients)
DL.init({
  sse: { audience: 'global' }
})

// User-specific events
DL.init({
  sse: { audience: `user-${currentUserId}` }
})

// Team-specific events
DL.init({
  sse: { audience: `team-${teamId}` }
})
```

**Reconnection behavior:**
- SSE disconnects trigger exponential backoff reconnection
- On reconnect, Verity checks for missed sequence numbers
- If gap detected, triggers resync (force-refresh active collections)

**Disable SSE:**
```javascript
DL.init({
  sse: { enabled: false }  // No SSE connection
})
```

#### Memory Cache

```typescript
{
  memory?: {
    enabled?: boolean                      // Enable in-memory caching (default: true)
    maxItemsPerType?: number               // Per-type cache size limit (default: 512)
    itemEntryTtlMs?: number                // Item cache TTL (default: 15 minutes)
    maxCollectionRefsPerCollection?: number // Per-collection cache size (default: 12)
    collectionEntryTtlMs?: number          // Collection cache TTL (default: 10 minutes)
    pruneIntervalMs?: number               // Cache pruning interval (default: 60000)
  }
}
```

**Example:**
```javascript
DL.init({
  memory: {
    enabled: true,
    maxItemsPerType: 1000,
    itemEntryTtlMs: 900000  // 15 minutes
  }
})
```

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
DL.init({
  bulk: {
    delayMs: 100  // Wait 100ms to collect directives before refetching
  }
})
```

### Complete Example

```javascript
DL.init({
  sse: {
    enabled: true,
    url: '/api/events',
    audience: 'global',
    withCredentials: true,
    initialRetryMs: 2000,
    maxRetryMs: 30000,
    backoffMultiplier: 2
  },
  memory: {
    enabled: true,
    maxItemsPerType: 1000,
    itemEntryTtlMs: 900000
  },
  bulk: {
    delayMs: 100
  }
})
```

---

## `createType(name, config)`

Registers an item type with fetch logic, optional levels, and staleness configuration.

### Signature

```typescript
function createType(name: string, config: TypeConfig): void

interface TypeConfig {
  fetch: (id: string | number) => Promise<any>  // Fetch single item by ID
  bulkFetch?: (ids: (string | number)[], level?: string) => Promise<any[]>  // Optional bulk fetch
  stalenessMs?: number                            // Per-type staleness (default: 15000)
  levelConversionMap?: { [level: string]: string[] }  // Level conversion rules
  levels?: {
    [levelName: string]: {
      fetch: (id: string | number) => Promise<any>
      checkIfExists?: (data: any) => boolean
      stalenessMs?: number
      bulkFetch?: (ids: (string | number)[], level?: string) => Promise<any[]>
      levelConversionMap?: { [level: string]: string[] }
    }
  }
}
```

### Parameters

#### `fetch` (required)

Async function that fetches a single item by ID. Must return the data or throw an error.

```javascript
DL.createType('user', {
  fetch: async (id) => {
    const res = await fetch(`/api/users/${id}`)
    if (!res.ok) throw new Error('Failed to fetch user')
    return res.json()
  }
})
```

#### `bulkFetch` (optional)

Async function that fetches multiple items at once. Verity uses this for efficient batching.

```javascript
DL.createType('invoice', {
  fetch: async (id) => {
    const res = await fetch(`/api/invoices/${id}`)
    return res.json()
  },
  bulkFetch: async (ids, level = 'default') => {
    const res = await fetch('/api/invoices/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, level })
    })
    return res.json()  // Returns array of items
  }
})
```

#### `stalenessMs` (optional)

Per-type staleness in milliseconds. Default is 15000 (15 seconds).

```javascript
// Dashboard should refetch every 5 seconds
DL.createType('dashboard', {
  fetch: async () => { /* ... */ },
  stalenessMs: 5000
})

// User profile can be cached for 5 minutes
DL.createType('current_user', {
  fetch: async () => { /* ... */ },
  stalenessMs: 300000
})
```

#### `levels` (optional)

Define multiple data levels for progressive loading (e.g., "simplified", "expanded", "full").

```javascript
DL.createType('invoice', {
  fetch: async (id) => {
    // Default level fetch
    const res = await fetch(`/api/invoices/${id}`)
    return res.json()
  },
  stalenessMs: 60000,
  levels: {
    simplified: {
      fetch: async (id) => {
        const res = await fetch(`/api/invoices/${id}?level=simplified`)
        return res.json()
      },
      checkIfExists: (data) => data && data.title != null,
      levelConversionMap: {
        expanded: ['simplified'],  // Expanded contains simplified data
        default: ['simplified']
      }
    },
    expanded: {
      fetch: async (id) => {
        const res = await fetch(`/api/invoices/${id}?level=expanded`)
        return res.json()
      },
      checkIfExists: (data) => data && data.description != null
    }
  }
})
```

#### `levelConversionMap` (optional)

Defines which levels can be derived from other levels. Prevents redundant fetches.

```javascript
DL.createType('article', {
  fetch: async (id) => { /* ... */ },
  levelConversionMap: {
    full: ['summary', 'default']  // Full level includes summary and default data
  },
  levels: {
    summary: { /* ... */ },
    full: { /* ... */ }
  }
})
```

### Example

```javascript
DL.createType('invoice', {
  fetch: async (id) => {
    const res = await fetch(`/api/invoices/${id}`)
    return res.json()
  },
  bulkFetch: async (ids) => {
    const res = await fetch('/api/invoices/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    })
    return res.json()
  },
  stalenessMs: 60000,
  levels: {
    simplified: {
      fetch: async (id) => {
        const res = await fetch(`/api/invoices/${id}?level=simplified`)
        return res.json()
      }
    }
  }
})
```

---

## `createCollection(name, config)`

Registers a parameterized collection (e.g., "invoices", "users", "orders").

### Signature

```typescript
function createCollection(name: string, config: CollectionConfig): void

interface CollectionConfig {
  fetch: (params?: any) => Promise<{ ids: any[], count?: number }>  // Fetch function
  stalenessMs?: number  // Per-collection staleness (default: 15000)
}
```

### Parameters

#### `fetch` (required)

Async function that fetches the collection. Must return an object with `ids` (array of IDs) and optionally `count`.

```javascript
DL.createCollection('invoices', {
  fetch: async (params = {}) => {
    const url = new URL('/api/invoices', window.location.origin)
    if (params.status && params.status !== 'all') {
      url.searchParams.set('status', params.status)
    }
    if (params.q) {
      url.searchParams.set('q', params.q)
    }
    
    const res = await fetch(url)
    const data = await res.json()
    
    return {
      ids: data.ids,      // Array of invoice IDs
      count: data.count   // Total count
    }
  }
})
```

**Important:** Collections return **IDs only**, not full items. Use `fetchItem()` or framework adapters to fetch the actual items.

#### `stalenessMs` (optional)

Per-collection staleness in milliseconds. Default is 15000 (15 seconds).

```javascript
// Real-time feed: refetch every 3 seconds
DL.createCollection('activity_feed', {
  fetch: async (params) => { /* ... */ },
  stalenessMs: 3000
})

// Archived data: cache for 10 minutes
DL.createCollection('archived_orders', {
  fetch: async (params) => { /* ... */ },
  stalenessMs: 600000
})
```

### Example

```javascript
DL.createCollection('invoices', {
  fetch: async (params = {}) => {
    const url = new URL('/api/invoices', window.location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    if (params.sort) url.searchParams.set('sort', params.sort)
    if (params.direction) url.searchParams.set('direction', params.direction)
    
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch invoices')
    
    return res.json()  // { ids: [1, 2, 3], count: 42 }
  },
  stalenessMs: 60000  // 1 minute
})
```

---

## `fetchItem(typeName, id, level, options)`

Fetches a single item and returns a reactive reference with data and metadata.

### Signature

```typescript
function fetchItem(
  typeName: string,
  id: string | number,
  level?: string | null,
  options?: FetchItemOptions
): ItemReference

interface FetchItemOptions {
  force?: boolean   // Force refetch even if cached (default: false)
  silent?: boolean  // Silent fetch (no loading state) (default: false)
}

interface ItemReference {
  data: any | null
  meta: {
    isLoading: boolean
    lastFetched: string | null  // ISO timestamp
    error: Error | null
    activeQueryId: string | null
    lastUsedAt: string | null
  }
}
```

### Parameters

- **`typeName`**: Type name (registered via `createType`)
- **`id`**: Item ID
- **`level`** (optional): Data level (e.g., "simplified", "expanded")
- **`options`** (optional):
  - `force`: Force refetch even if fresh
  - `silent`: Fetch without showing loading state

### Returns: ItemReference

```typescript
interface ItemReference {
  data: any | null              // The fetched item data
  meta: {
    isLoading: boolean          // true while fetching
    lastFetched: string | null  // ISO timestamp of last fetch
    error: Error | null         // Last error, if any
    activeQueryId: string       // Unique query ID
    lastUsedAt: string          // ISO timestamp of last access
  }
}
```

### Example

```javascript
// Register type first
DL.createType('user', {
  fetch: async (id) => {
    const res = await fetch(`/api/users/${id}`)
    return res.json()
  }
})

// Fetch item
const userRef = DL.fetchItem('user', 123)

// Access data
if (userRef.meta.isLoading) {
  console.log('Loading...')
} else if (userRef.meta.error) {
  console.error('Error:', userRef.meta.error)
} else {
  console.log('User:', userRef.data)
}

// Force refetch
const freshUserRef = DL.fetchItem('user', 123, null, { force: true })

// Silent background fetch
const bgUserRef = DL.fetchItem('user', 123, null, { silent: true })
```

### Reactivity

The returned reference is reactive. In framework adapters, it automatically triggers re-renders:

```javascript
// React
const userRef = useItem('user', 123)
return <div>{userRef.data?.name}</div>

// Alpine
Alpine.store('lib').it('user', 123)

// Vue
const userRef = dl.it('user', 123)
```

---

## `fetchCollection(name, options)`

Fetches a collection and returns a reactive reference with IDs and metadata.

### Signature

```typescript
function fetchCollection(
  name: string,
  options?: FetchCollectionOptions
): CollectionReference

interface FetchCollectionOptions {
  params?: any      // Query parameters
  force?: boolean   // Force refetch even if cached (default: false)
}

interface CollectionReference {
  data: {
    ids: any[]       // Array of item IDs
    count: number    // Total count
  }
  meta: {
    isLoading: boolean
    lastFetched: string | null  // ISO timestamp
    error: Error | null
    activeQueryId: string | null
    paramsSnapshot: any         // Params used for this fetch
    paramsKey: string           // Cache key for params
    lastUsedAt: string | null
  }
}
```

### Parameters

- **`name`**: Collection name (registered via `createCollection`)
- **`options`** (optional):
  - `params`: Query parameters (filters, sorting, etc.)
  - `force`: Force refetch even if fresh

### Returns: CollectionReference

```typescript
interface CollectionReference {
  data: {
    ids: any[]      // Array of item IDs (not full items!)
    count: number   // Total count
  }
  meta: {
    isLoading: boolean          // true while fetching
    lastFetched: string | null  // ISO timestamp of last fetch
    error: Error | null         // Last error, if any
    activeQueryId: string       // Unique query ID
    paramsSnapshot: any         // Params used for this fetch
    paramsKey: string           // Cache key for params
    lastUsedAt: string          // ISO timestamp of last access
  }
}
```

### Example

```javascript
// Register collection first
DL.createCollection('invoices', {
  fetch: async (params = {}) => {
    const url = new URL('/api/invoices', window.location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    
    const res = await fetch(url)
    return res.json()  // { ids: [1, 2, 3], count: 42 }
  }
})

// Fetch collection
const colRef = DL.fetchCollection('invoices', {
  params: { status: 'active' }
})

// Access data
console.log(colRef.data.ids)    // [1, 2, 3, ...]
console.log(colRef.data.count)  // 42

// Force refetch
const freshColRef = DL.fetchCollection('invoices', {
  params: { status: 'active' },
  force: true
})

// Different params = different cache entry
const completedRef = DL.fetchCollection('invoices', {
  params: { status: 'completed' }
})
```

### Parameter Caching

Each unique set of parameters creates a separate cache entry:

```javascript
const activeRef = DL.fetchCollection('invoices', { params: { status: 'active' } })
const pausedRef = DL.fetchCollection('invoices', { params: { status: 'paused' } })

// These are two separate cache entries
// activeRef.data.ids !== pausedRef.data.ids
```

---

## `applyDirectives(directives)`

Applies server-sent directives to invalidate and refetch cached data.

### Signature

```typescript
function applyDirectives(directives: Directive[]): void
```

### Parameters

```typescript
interface Directive {
  op: "refresh" | "invalidate"
  kind?: "collection" | "item"
  name?: string           // Collection or type name
  id?: string | number    // Item ID (for items)
  level?: string          // Item level (for items)
  key?: string            // Directive deduplication key
  params?: any            // Collection params
  idempotency_key?: string
  source?: string         // Client ID that triggered this (to prevent echo)
  seq?: number            // Sequence number
  audience?: string       // Target audience
}
```

### Directive Types

#### Refresh Collection

```javascript
{
  op: "refresh",
  kind: "collection",
  name: "invoices",
  params: { status: "active" }  // Optional: specific params
}
```

#### Refresh Item

```javascript
{
  op: "refresh",
  kind: "item",
  name: "invoice",
  id: 42,
  level: "expanded"  // Optional: specific level
}
```

#### Invalidate (Legacy)

```javascript
{
  op: "invalidate",
  kind: "collection",
  name: "invoices"
}
```

### Behavior

1. Validates directives
2. Identifies affected cache entries
3. Marks them as stale
4. Triggers refetch (coalesced with other pending invalidations)
5. Deduplicates via `idempotency_key` or `key`
6. Ignores directives with `source` matching current client ID

### Example

```javascript
// After a mutation, server returns directives
const response = await fetch('/api/invoices/42', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'X-Verity-Directive-Request': 'send me directives'
  },
  body: JSON.stringify({ status: 'paid' })
})

// Server responds with directives in header or body
const directives = JSON.parse(response.headers.get('X-Verity-Directives'))

// Apply directives
DL.applyDirectives(directives)
```

**Common pattern with helper:**
```javascript
const directiveHeaders = (extra = {}) => ({
  'X-Verity-Directive-Request': 'send me directives',
  ...extra
})

async function updateInvoice(id, data) {
  const res = await fetch(`/api/invoices/${id}`, {
    method: 'PUT',
    headers: directiveHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data)
  })
  
  const payload = await res.json()
  
  // Directives are returned in payload or headers
  if (payload.directives) {
    DL.applyDirectives(payload.directives)
  }
  
  return payload
}
```

---

## `onChange(callback)`

Subscribe to Verity state changes. Returns unsubscribe function.

### Signature

```typescript
function onChange(callback: () => void): () => void
```

### Example

```javascript
// Subscribe to all state changes
const unsubscribe = DL.onChange(() => {
  console.log('State changed!')
  console.log('Current state:', DL.state())
})

// Later: unsubscribe
unsubscribe()
```

**Note:** This is a low-level API. Framework adapters handle reactivity automatically.

---

## `onLifecycle(eventName, callback)`

Subscribe to lifecycle events for debugging and monitoring.

### Signature

```typescript
function onLifecycle(
  eventName: string | "*",
  callback: (event: { event: string, detail: any }) => void
): () => void
```

### Events

| Event | Detail | When |
|-------|--------|------|
| `collection:fetch:intent` | `{ name, params, force, qid }` | Before collection fetch |
| `collection:fetch:success` | `{ name, params, qid }` | After successful collection fetch |
| `collection:fetch:complete` | `{ name, params, qid }` | Collection fetch finished |
| `collection:fetch:skip` | `{ name, params, reason }` | Collection fetch skipped (cache hit) |
| `collection:cache-hit` | `{ name, params, reason }` | Collection served from cache |
| `item:fetch:intent` | `{ type, id, level, qid }` | Before item fetch |
| `item:fetch:success` | `{ type, id, level, qid, strategy }` | After successful item fetch |
| `item:fetch:complete` | `{ type, id, level, qid }` | Item fetch finished |
| `item:fetch:skip` | `{ type, id, level, reason }` | Item fetch skipped (cache hit) |
| `item:cache-hit` | `{ type, id, level, reason }` | Item served from cache |
| `directive:received` | `{ directives, audience, source }` | Directives received |
| `directive:processed` | `{ directive }` | Single directive processed |
| `sse:open` | `{ audience, url }` | SSE connection opened |
| `sse:error` | `{ retryInMs }` | SSE connection error |
| `sse:resync-dispatch` | `{ context }` | Resync triggered |
| `sse:gap` | `{ audience, lastSeq, incomingSeq }` | Sequence gap detected |

### Example

```javascript
// Listen to all events
DL.onLifecycle('*', ({ event, detail }) => {
  console.log(`Event: ${event}`, detail)
})

// Listen to specific event
const unsubscribe = DL.onLifecycle('item:fetch:success', ({ event, detail }) => {
  console.log('Item fetched:', detail.type, detail.id)
})

// Later: unsubscribe
unsubscribe()
```

---

## `clientId()`

Returns the unique identifier for this client instance.

### Signature

```typescript
function clientId(): string
```

### Usage

```javascript
const id = DL.clientId()
console.log(id)  // "client-abc123xyz" or UUID

// Include in mutation requests to prevent directive echo
fetch('/api/invoices', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Verity-Client-ID': DL.clientId()  // ← Server echoes this in directives
  },
  body: JSON.stringify({ title: 'New invoice' })
})
```

**Why?**
- Server includes client ID in directive `source` field
- Client ignores directives with matching `source`
- Prevents double-application of local mutations

---

## `state()`

Returns a snapshot of the entire Verity state (for debugging).

### Signature

```typescript
function state(): VerityState

interface VerityState {
  types: { [name: string]: TypeInfo }
  collections: { [name: string]: CollectionInfo }
  sse: SSEInfo
  bulk: BulkInfo
  memory: MemoryInfo
}
```

### Example

```javascript
const snapshot = DL.state()
console.log('Registered types:', Object.keys(snapshot.types))
console.log('Registered collections:', Object.keys(snapshot.collections))
console.log('SSE connected:', snapshot.sse.connected)
```

---

## SSE Control Methods

### `connectSse(options)`

Manually connect to SSE endpoint.

```javascript
DL.connectSse({ audience: 'global' })
```

### `disconnectSse()`

Disconnect from SSE endpoint.

```javascript
DL.disconnectSse()
```

### `configureSse(config)`

Update SSE configuration.

```javascript
DL.configureSse({
  url: '/api/events',
  audience: `user-${userId}`,
  enabled: true
})
```

---

## Complete Example

```javascript
// Initialize Verity
DL.init({
  sse: {
    enabled: true,
    url: '/api/events',
    audience: 'global',
    withCredentials: true
  },
  memory: {
    enabled: true,
    maxItemsPerType: 1000
  },
  bulk: {
    delayMs: 100
  }
})

// Register an item type
DL.createType('invoice', {
  fetch: async (id) => {
    const res = await fetch(`/api/invoices/${id}`)
    return res.json()
  },
  bulkFetch: async (ids, level = 'default') => {
    const res = await fetch('/api/invoices/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, level })
    })
    return res.json()
  },
  stalenessMs: 60000,  // 1 minute
  levels: {
    simplified: {
      fetch: async (id) => {
        const res = await fetch(`/api/invoices/${id}?level=simplified`)
        return res.json()
      },
      checkIfExists: (data) => data && data.title != null
    }
  }
})

// Register a collection
DL.createCollection('invoices', {
  fetch: async (params = {}) => {
    const url = new URL('/api/invoices', window.location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    if (params.q) url.searchParams.set('q', params.q)
    
    const res = await fetch(url)
    return res.json()  // { ids: [1, 2, 3], count: 42 }
  },
  stalenessMs: 30000  // 30 seconds
})

// Fetch data
const colRef = DL.fetchCollection('invoices', {
  params: { status: 'active' }
})
console.log('Invoice IDs:', colRef.data.ids)

const itemRef = DL.fetchItem('invoice', 42, 'simplified')
console.log('Invoice data:', itemRef.data)

// Subscribe to lifecycle events
DL.onLifecycle('*', ({ event, detail }) => {
  console.log('Event:', event, detail)
})

// Mutation helper
const directiveHeaders = (extra = {}) => ({
  'X-Verity-Directive-Request': 'send me directives',
  ...extra
})

async function updateInvoice(id, data) {
  const res = await fetch(`/api/invoices/${id}`, {
    method: 'PUT',
    headers: directiveHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data)
  })
  
  const payload = await res.json()
  
  // Apply server directives
  if (payload.directives) {
    DL.applyDirectives(payload.directives)
  }
  
  return payload
}

// Use it
await updateInvoice(42, { status: 'paid' })
```

---

## Summary

**Core Methods:**

| Method | Purpose |
|--------|---------|
| `init()` | Initialize Verity with configuration |
| `createType()` | Register item type with fetch logic |
| `createCollection()` | Register collection type |
| `fetchItem()` | Fetch single item and get reactive reference |
| `fetchCollection()` | Fetch collection IDs and get reactive reference |
| `applyDirectives()` | Apply server directives to invalidate cache |
| `onChange()` | Subscribe to state changes |
| `onLifecycle()` | Subscribe to lifecycle events |
| `clientId()` | Get unique client identifier |
| `state()` | Get state snapshot (debugging) |

**Configuration:**

| Option | Default | Purpose |
|--------|---------|---------|
| `bulk.delayMs` | `50` | Directive coalescing window (ms) |
| `memory.maxItemsPerType` | `512` | Max cached items per type |
| `memory.itemEntryTtlMs` | `900000` | Item cache TTL (15 min) |
| `sse.url` | `/api/events` | SSE endpoint |
| `sse.audience` | `global` | Audience subscription |
| `sse.initialRetryMs` | `2000` | Initial retry delay |
| `sse.maxRetryMs` | `30000` | Max retry delay |

**Key Concepts:**

- **Staleness:** Items are fresh for `stalenessMs`, then stale but usable
- **Coalescing:** Directives batched within `bulk.delayMs` window
- **Deduplication:** Directives deduplicated by `idempotency_key` or `key`
- **Sequence tracking:** Detects missed SSE messages, triggers resync
- **Levels:** Progressive data loading (e.g., simplified → expanded)

---

## Next Steps

- **Directives:** [Directive API reference](directives.md)
- **Adapters:** [Framework adapters](adapters.md)
- **Concepts:** [Truth vs View State](../concepts/truth-vs-view-state.md)
- **Architecture:** [Backend of Frontend](../architecture.md)

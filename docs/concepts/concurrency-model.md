# Concurrency Model: Latest-Wins, Coalescing, and Consistency

> How Verity ensures correctness when requests happen out of order

Modern web apps fire off multiple concurrent requests. Verity guarantees that **stale responses never clobber newer state**, **identical requests are deduplicated**, and **the UI always reflects the latest truth**.

---

## The Concurrency Problem

### Race Condition Example

```javascript
// User rapidly switches filters
filterByStatus('active')   // Request A starts
filterByStatus('completed') // Request B starts
filterByStatus('active')   // Request C starts

// Responses arrive out of order:
// C completes first → shows active todos
// A completes second → shows active todos (redundant)
// B completes last → shows completed todos (WRONG!)

// User expects active, but sees completed 😞
```

### Duplicate Request Example

```javascript
// Three components all need the same data
<TodoList />   // Requests todos
<TodoCount />  // Requests todos
<TodoChart />  // Requests todos

// Without deduplication: 3 identical fetches
// With deduplication: 1 fetch, shared promise
```

---

## Verity's Guarantees

### 1. Latest-Wins

**Guarantee:** Stale responses cannot overwrite newer state.

**How it works:**
- Every fetch gets a unique `queryId`
- When a fetch starts, Verity stores `activeQueryId`
- When response arrives, Verity checks if `queryId === activeQueryId`
- If not, response is discarded (newer request already happened)

**Code:**

```javascript
// Simplified internals
function fetchCollection(name, params) {
  const ref = getCollectionRef(name, params)
  const queryId = generateId()
  
  ref.meta.activeQueryId = queryId  // ← Mark this as active
  ref.meta.isLoading = true
  
  const promise = collectionConfig.fetch(params)
  
  promise.then(data => {
    // Only apply if we're still the active query
    if (ref.meta.activeQueryId === queryId) {
      ref.data = data
      ref.meta.isLoading = false
      ref.meta.lastFetched = Date.now()
    }
    // else: discard (newer request superseded us)
  })
  
  return ref
}
```

**Example:**

```javascript
// User rapidly clicks filters
const ref = registry.collection('todos', { status: 'active' })    // queryId: 1
const ref = registry.collection('todos', { status: 'completed' }) // queryId: 2
const ref = registry.collection('todos', { status: 'active' })    // queryId: 3

// Response order: 3, 1, 2
// Response 3 arrives → applied (activeQueryId === 3) ✓
// Response 1 arrives → discarded (activeQueryId === 3, not 1) ✗
// Response 2 arrives → discarded (activeQueryId === 3, not 2) ✗

// UI shows active todos (correct!)
```

---

### 2. In-Flight Coalescing

**Guarantee:** Identical in-flight requests reuse the same promise.

**How it works:**
- Verity tracks in-flight promises per (type, id, level) or (collection, params)
- If a fetch is already running, return the existing promise
- All callers wait for the same fetch

**Code:**

```javascript
// Simplified internals
const inFlightPromises = new Map()

function fetchItem(type, id, level) {
  const key = `${type}:${id}:${level}`
  
  // Check if already fetching
  if (inFlightPromises.has(key)) {
    return inFlightPromises.get(key)  // ← Reuse existing promise
  }
  
  // Start new fetch
  const promise = typeConfig.fetch({ id, level })
  inFlightPromises.set(key, promise)
  
  promise.finally(() => {
    inFlightPromises.delete(key)  // Clean up when done
  })
  
  return promise
}
```

**Example:**

```javascript
// Three components request same item
const item1 = registry.item('todo', 42, 'detailed')  // Starts fetch
const item2 = registry.item('todo', 42, 'detailed')  // Reuses same fetch
const item3 = registry.item('todo', 42, 'detailed')  // Reuses same fetch

// Only 1 network request!
// All three get the same data when it resolves
```

---

### 3. Collection Serialization

**Guarantee:** Collection fetches for the same parameters are serialized (one at a time).

**Why:** Collections can't coalesce the same way items do—each fetch might return different data. Instead, Verity serializes them.

**Code:**

```javascript
// Simplified internals
function fetchCollection(name, params) {
  const key = getCollectionKey(name, params)
  const ref = collections.get(key)
  
  if (ref.meta.isLoading) {
    // Already fetching this collection
    // Queue this request to run after current one completes
    return ref.meta.activePromise.then(() => fetchCollection(name, params))
  }
  
  // Start fetch
  ref.meta.isLoading = true
  const promise = collectionConfig.fetch(params)
  ref.meta.activePromise = promise
  
  promise.then(data => {
    ref.data = data
    ref.meta.isLoading = false
  })
  
  return ref
}
```

**Example:**

```javascript
// User triggers refetch while fetch is in progress
registry.collection('todos').refresh()  // Fetch 1 starts
registry.collection('todos').refresh()  // Queued until fetch 1 completes
// Fetch 1 completes
// Fetch 2 starts automatically
```

---

## Silent vs Loud Fetches

Verity distinguishes between **background hydration** and **user-visible refreshes**.

### Silent Fetches

**When:** Background hydration, directive-triggered refetch of already-displayed data

**Behavior:**
- No overlay/spinner on the affected component
- Loading state is set, but UI shows stale data
- Updates once new data arrives

**Use case:** List view loading item details

```html
<head>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/alpine.min.js"></script>
</head>

<script>
const registry = Verity.createRegistry()
VerityAlpine.install(window.Alpine, { registry })
</script>

<template x-for="id in todoIds">
  <div>
    <!-- Silent fetch: no spinner, shows skeleton if no data -->
    <template x-if="!$verity.item('todo', id, 'summary', { silent: true }).data">
      <div class="skeleton"></div>
    </template>
    <template x-if="$verity.item('todo', id, 'summary', { silent: true }).data">
      <span x-text="$verity.item('todo', id, 'summary', { silent: true }).data.title"></span>
    </template>
  </div>
</template>
```

### Loud Fetches

**When:** User explicitly requests data (clicks detail view), directive-triggered refresh with overlay

**Behavior:**
- Shows overlay/spinner on affected component
- Blocks interaction during fetch
- Honest loading state

**Use case:** Opening detail panel

```html
<div x-data="{ todo: $verity.item('todo', 42, 'detailed') }">
  <!-- Loud fetch: shows spinner -->
  <template x-if="todo.meta.isLoading">
    <div class="spinner">Loading...</div>
  </template>
  <template x-if="!todo.meta.isLoading">
    <div x-text="todo.data.description"></div>
  </template>
</div>
```

---

## Bulk Fetching (Advanced)

For collections that load many items, Verity supports **bulk item fetching** to reduce request count.

### Without Bulk Fetching

```javascript
// Collection returns 100 IDs
const todos = registry.collection('todos')
// → ['id-1', 'id-2', ..., 'id-100']

// Rendering 100 rows triggers 100 item fetches
todos.items.forEach(id => {
  registry.item('todo', id, 'summary')  // 100 requests!
})
```

### With Bulk Fetching

```javascript
registry.registerType('todo', {
  fetch: ({ id }) => fetch(`/api/todos/${id}`).then(r => r.json()),
  
  // Add bulk fetcher
  bulkFetch: async (ids, level) => {
    const response = await fetch(`/api/todos/bulk`, {
      method: 'POST',
      body: JSON.stringify({ ids, level })
    })
    return response.json()  // Returns { [id]: data }
  }
})

// Now:
// Collection returns 100 IDs
// → Verity queues 100 individual item requests
// → After short delay (50ms), batches them into ONE bulkFetch
// → 1 request instead of 100!
```

**How it works:**
1. First `item()` call starts a batch timer (default: 50ms)
2. Subsequent `item()` calls for same (type, level) add to batch
3. Timer expires → call `bulkFetch(ids, level)`
4. Distribute results to all waiting items

---

## Memory Management

Long-lived dashboards can accumulate cached data. Verity includes a background sweeper.

### Configuration

```html
<head>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
</head>

<script>
const registry = Verity.createRegistry({
  memory: {
    enabled: true,
    sweepIntervalMs: 60_000,           // Run every 60 seconds
    collectionTtlMs: 15 * 60 * 1000,  // Expire collections after 15 min
    itemTtlMs: 10 * 60 * 1000,         // Expire items after 10 min
    maxCollectionsPerName: 12,         // Keep at most 12 param combos per collection
    maxItemsPerType: 512               // Keep at most 512 items per type
  }
})
</script>
```

### How Sweeping Works

1. **Sweeper runs periodically** (default: every 60s)
2. **For each collection:** Remove oldest entries beyond `maxCollectionsPerName`
3. **For each item type:** Remove oldest items beyond `maxItemsPerType`
4. **TTL check:** Remove entries not accessed in `collectionTtlMs` / `itemTtlMs`
5. **In-flight protection:** Never remove items with `activeQueryId` set

**LRU tracking:**

```javascript
// Every access updates lastUsedAt
registry.collection('todos', { status: 'active' })
// → collections.get('todos:status=active').lastUsedAt = Date.now()

registry.item('todo', 42, 'detailed')
// → types.get('todo').items.get(42).levels.get('detailed').lastUsedAt = Date.now()
```

---

## SSE and Multi-Client Convergence

### Client IDs

Every client generates a unique ID on load:

```javascript
const registry = createRegistry()
console.log(registry.clientId)  // "client-abc-123-def"
```

**Usage:** Tag mutations with client ID so SSE can skip echoing back.

```javascript
async function updateTodo(id, data) {
  const res = await fetch(`/api/todos/${id}`, {
    method: 'PUT',
    headers: {
      'X-Client-ID': registry.clientId  // ← Tag request
    },
    body: JSON.stringify(data)
  })
  
  const { directives } = await res.json()
  await registry.applyDirectives(directives)
}
```

**Server:**

```python
@app.put('/api/todos/<int:id>')
def update_todo(id):
    # ... update ...
    
    source = request.headers.get('X-Client-ID')
    emit_directives(directives, source=source)  # ← Include source
    
    return { 'directives': directives }
```

**SSE broadcast:**

```javascript
// SSE payload
{
  type: 'directives',
  source: 'client-abc-123-def',  // ← Originating client
  directives: [...]
}

// Client-side:
// if (payload.source === registry.clientId) {
//   return  // Skip own directives
// }
```

---

### Sequence Numbers and Gap Detection

**Problem:** SSE is best-effort. What if a client misses a directive?

**Solution:** Sequence numbers + gap detection.

**SSE payloads include `seq`:**

```javascript
{
  type: 'directives',
  seq: 42,
  audience: 'global',
  source: 'client-abc',
  directives: [...]
}
```

**Client tracks last sequence:**

```javascript
// Per audience
lastSeq = {
  'global': 41,
  'user-123': 99
}

// New payload arrives with seq=44
// Expected: 42
// Gap detected! (missed seq 42 and 43)
```

**Gap handling:**

1. Client detects gap: `incomingSeq > lastSeq + 1`
2. Client schedules resync with jitter (avoid thundering herd)
3. Resync: force-refresh all collections used recently
4. Update `lastSeq` to `incomingSeq`

**Configuration:**

```javascript
const registry = createRegistry({
  sse: {
    url: '/api/events',
    resyncOnGap: true,                // Default: true
    resyncJitterMinMs: 500,           // Min delay before resync
    resyncJitterMaxMs: 2000,          // Max delay before resync
    resyncWindowMs: 5 * 60 * 1000     // Resync items used in last 5 min
  }
})
```

---

## Concurrency Guarantees Summary

| Scenario | Guarantee | Mechanism |
|----------|-----------|-----------|
| Rapid filter changes | Latest-wins | `activeQueryId` check |
| Multiple components request same item | Single fetch | In-flight promise coalescing |
| Concurrent collection refreshes | Serialized | Promise chaining |
| User opens detail while list loads | Correct level fetched | Level tracking + coalescing |
| Bulk item loading | Batched requests | Bulk fetch timer + queue |
| Directive arrives during fetch | Correct ordering | Latest-wins after fetch completes |
| Memory growth | Bounded cache | LRU sweeper + TTL |
| Missed SSE directive | Eventually consistent | Sequence number + resync |

---

## Testing Concurrency

### Test: Latest-Wins

```javascript
test('stale response does not overwrite newer state', async () => {
  let resolveFirst, resolveSecond
  
  // Mock fetch with controllable promises
  const firstPromise = new Promise(r => resolveFirst = r)
  const secondPromise = new Promise(r => resolveSecond = r)
  
  let callCount = 0
  vi.spyOn(window, 'fetch').mockImplementation(() => {
    return callCount++ === 0 ? firstPromise : secondPromise
  })
  
  // Start first request
  registry.collection('todos', { status: 'active' })
  
  // Start second request (supersedes first)
  registry.collection('todos', { status: 'completed' })
  
  // Resolve in reverse order
  resolveSecond({ items: ['completed-1'] })
  await nextTick()
  
  resolveFirst({ items: ['active-1'] })  // Stale response
  await nextTick()
  
  // Should show 'completed', not 'active'
  const ref = registry.collection('todos')
  expect(ref.data.items).toEqual(['completed-1'])
})
```

### Test: Coalescing

```javascript
test('identical concurrent requests share promise', async () => {
  const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue({
    json: () => Promise.resolve({ id: 42, title: 'Test' })
  })
  
  // Fire 3 requests simultaneously
  registry.item('todo', 42, 'detailed')
  registry.item('todo', 42, 'detailed')
  registry.item('todo', 42, 'detailed')
  
  await nextTick()
  
  // Only 1 fetch
  expect(fetchSpy).toHaveBeenCalledTimes(1)
})
```

### Test: Gap Detection

```javascript
test('missing SSE sequence triggers resync', async () => {
  const resyncSpy = vi.fn()
  
  const registry = createRegistry({
    sse: {
      onResync: resyncSpy
    }
  })
  
  // Simulate SSE connection
  registry.ingestDirectiveEnvelope({
    type: 'directives',
    seq: 42,
    directives: []
  })
  
  // Simulate gap (next should be 43, but we get 45)
  registry.ingestDirectiveEnvelope({
    type: 'directives',
    seq: 45,  // ← Gap!
    directives: []
  })
  
  // Wait for jittered resync
  await new Promise(r => setTimeout(r, 2100))
  
  expect(resyncSpy).toHaveBeenCalled()
})
```

---

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Check if fetch needed | O(1) | Hash map lookup |
| Coalesce check | O(1) | In-flight map lookup |
| Latest-wins check | O(1) | Compare two integers |
| Sweeper pass | O(n) | n = cached items, runs periodically |

### Space Complexity

| Data Structure | Growth | Bounded By |
|----------------|--------|------------|
| Collection cache | O(params × collections) | `maxCollectionsPerName` |
| Item cache | O(items × types) | `maxItemsPerType` |
| In-flight promises | O(concurrent requests) | Network concurrency |
| SSE sequence map | O(audiences) | Number of audiences |

---

## Best Practices

### 1. Use Silent Fetches for Background Hydration

```javascript
// ✅ GOOD: Silent for list items
<template x-for="id in ids">
  <div x-data="{ item: $verity.item('todo', id, 'summary', { silent: true }) }">
</template>

// ❌ BAD: Loud for list items (too many spinners)
<template x-for="id in ids">
  <div x-data="{ item: $verity.item('todo', id, 'summary') }">
</template>
```

### 2. Tag Mutations with Client ID

```javascript
// ✅ GOOD
headers: { 'X-Client-ID': registry.clientId }

// ❌ BAD (will see own updates twice)
// headers: {}
```

### 3. Enable Bulk Fetching for Large Lists

```javascript
// ✅ GOOD for 100+ item lists
bulkFetch: (ids, level) => fetch('/api/todos/bulk', { ... })

// ❌ BAD for large lists (too many requests)
// No bulkFetch → N individual requests
```

### 4. Tune Memory Settings for Your Use Case

```javascript
// High-traffic dashboard with many users
memory: {
  maxItemsPerType: 1000,      // More cache
  itemTtlMs: 5 * 60 * 1000    // Shorter TTL
}

// Simple CRUD app
memory: {
  maxItemsPerType: 256,       // Less cache
  itemTtlMs: 15 * 60 * 1000   // Longer TTL
}
```

---

## Summary

**Verity's concurrency model ensures:**
- **Latest-wins:** Stale responses are discarded
- **Coalescing:** Identical requests share promises
- **Serialization:** Collection fetches don't race
- **Silent/Loud:** Appropriate loading feedback
- **Bulk fetching:** Efficient large list loading
- **Memory bounds:** LRU + TTL sweeping
- **Multi-client sync:** Client IDs + sequence numbers

**The result:** Predictable, correct behavior even under heavy concurrent load.

---

## Next Steps

1. Review [Directives](directives.md) to see how concurrency interacts with invalidation
2. Study [Levels & Conversions](levels-and-conversions.md) for fetch planning details
3. Read [Architecture](../architecture.md) for the full data flow
4. Check [API Reference](../reference/core.md) for configuration options

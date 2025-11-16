# Architecture: The Backend of the Frontend

Verity positions itself as **the backend of your frontend**—a dedicated data layer that sits between your server and view layer. This document explains the three-layer architecture, data flow, and where different kinds of logic live.

---

## The Three Layers

```
┌─────────────────────────────────────────┐
│             Server Layer                │
│  (Domain Logic, Persistence, Authority) │
└──────────────┬──────────────────────────┘
               │
               │ HTTP/GraphQL/gRPC
               │ Directives via SSE
               │
┌──────────────▼──────────────────────────┐
│         Verity Data Layer               │
│  (Caching, Staleness, Fan-out, Fetch)   │
│        "Backend of Frontend"            │
└──────────────┬──────────────────────────┘
               │
               │ Stable Refs { data, meta }
               │ Subscribe API
               │
┌──────────────▼──────────────────────────┐
│           View Layer                    │
│  (Rendering, View-State, User Events)   │
└─────────────────────────────────────────┘
```

### Layer 1: Server
**Responsibilities:**
- Domain logic and business rules
- Data persistence and integrity
- Authorization and authentication
- Emitting directives after mutations

**What it does NOT do:**
- Know which components are mounted
- Track client-side UI state
- Send HTML or DOM patches

### Layer 2: Verity (Backend of Frontend)
**Responsibilities:**
- Fetch orchestration (pull)
- Directive processing (push)
- Cache management and staleness tracking
- Concurrency control (latest-wins, coalescing)
- Multi-client convergence
- Level planning and conversion graphs

**What it does NOT do:**
- Render UI
- Manage view-state (menus, focus, modals)
- Perform optimistic updates

### Layer 3: View
**Responsibilities:**
- Render truth-state from Verity refs
- Manage local view-state
- Capture user events and trigger mutations
- Display loading affordances (skeletons, spinners)

**What it does NOT do:**
- Fetch data directly
- Manage truth-state cache
- Coordinate invalidation

---

## Separation of Concerns

### Truth-State Lives in Verity
**Truth-state** is server-owned data that multiple clients must agree on:
- User records
- Order status
- Inventory counts
- Permissions

Verity owns the cache, staleness rules, and synchronization protocol. Views consume stable references.

### View-State Lives in the View Layer
**View-state** is local, ephemeral UI concerns:
- Which menu is open
- Which row is expanded
- Form draft values
- Current tab index

This state never leaves the client and never triggers server invalidation.

**Example:**
```javascript
// ✅ GOOD: Truth-state in Verity, view-state in Alpine
<div x-data="{ 
  get invoices() { return $store.verity.collection('invoices') }, // truth-state
  expandedRow: null // view-state
}">
  <template x-for="invoice in invoices.items">
    <tr @click="expandedRow = invoice.id">
      <!-- render truth-state -->
    </tr>
  </template>
</div>

// ❌ BAD: Mixing truth-state and view-state in one store
const store = {
  invoices: [], // truth-state
  expandedRow: null, // view-state
  selectedFilter: 'all', // view-state
  // This becomes a bug factory
}
```

---

## Data Flow

### Pull Path (Fetching)

1. **View requests data** via framework adapter
   ```javascript
   const invoices = useCollection('invoices', { status: 'open' })
   ```

2. **Verity checks cache**
   - If fresh, return immediately
   - If stale or missing, trigger fetch
   - If in-flight, coalesce request

3. **Verity calls registered fetcher**
   ```javascript
   registry.registerCollection('invoices', {
     fetch: (params) => fetch(`/api/invoices?status=${params.status}`)
   })
   ```

4. **Server returns data**
   ```json
   { "items": [...], "meta": {...} }
   ```

5. **Verity updates cache** and notifies subscribers

6. **View re-renders** with new data

### Push Path (Directives)

1. **User triggers mutation** (button click)
   ```javascript
   await fetch('/api/invoices/123', { 
     method: 'PUT', 
     body: JSON.stringify({ status: 'paid' })
   })
   ```

2. **Server processes mutation** and returns directives
   ```json
   {
     "directives": [
       { "op": "refresh_item", "name": "invoice", "id": 123 },
       { "op": "refresh_collection", "name": "invoices" }
     ]
   }
   ```

3. **View forwards directives** to Verity
   ```javascript
   await applyDirectives(response.directives)
   ```

4. **Verity processes each directive**
   - `refresh_item`: Invalidate + refetch levels in use
   - `refresh_collection`: Invalidate + refetch matching params

5. **Verity emits directive over SSE** to other clients
   ```
   data: {"type": "directives", "directives": [...], "source": "client-abc"}
   ```

6. **Other clients apply directives** (skipping source client)

7. **All views converge** to same truth

---

## Request/Response Lifecycle

### Mutation Flow with Directives

```
┌─────────┐                ┌─────────┐                ┌─────────┐
│  View   │                │ Verity  │                │ Server  │
└────┬────┘                └────┬────┘                └────┬────┘
     │                          │                          │
     │  onClick="updateStatus"  │                          │
     ├─────────────────────────►│                          │
     │                          │                          │
     │ button shows spinner     │   POST /api/invoice/123  │
     │ (honest loading)         ├─────────────────────────►│
     │                          │                          │
     │                          │                    UPDATE invoice
     │                          │                    EMIT directive
     │                          │                          │
     │                          │   200 + directives       │
     │                          ◄─────────────────────────┤
     │                          │                          │
     │  button stops spinner    │  process directives      │
     ◄─────────────────────────┤  (invalidate + refetch)  │
     │                          │                          │
     │                          │   SSE: directives        │
     │                          │  (fan-out to others)     │
     │                          ├─────────────────────────►│
     │                          │                          │
     │  re-render with new data │                          │
     ◄─────────────────────────┤                          │
     │                          │                          │
```

### Key Points

1. **Button spinner starts immediately** (honest: work is happening)
2. **No optimistic update** (no speculation about server response)
3. **Server returns directives** in mutation response
4. **Button spinner stops** when server responds
5. **Directives trigger refetch** (overlays appear for loud fetches)
6. **SSE fan-out** keeps other clients in sync
7. **All clients converge** to same truth without coordination

---

## Multi-Client Convergence

### Problem: How do multiple clients stay in sync?

Traditional approaches:
- **Polling**: wasteful, delayed
- **Manual WebSocket**: complex, error-prone
- **Optimistic updates**: flicker, mismatch

### Verity's Approach: Directive Fan-Out

1. **Client A** performs mutation
2. **Server** processes mutation
3. **Server returns directives** to Client A (immediate feedback)
4. **Server emits same directives** over SSE to all clients
5. **Clients ignore own directives** (via client IDs)
6. **All clients apply directives** independently
7. **Convergence achieved** without coordination

### Sequence Numbers & Gap Handling

```javascript
// SSE payload structure
{
  type: 'directives',
  seq: 42,                    // monotonic sequence number
  audience: 'global',         // scope of directive
  source: 'client-abc',       // originating client
  directives: [...]           // actual directives
}
```

**Gap detection:**
- Each client tracks `lastSeq` per audience
- If `seq > lastSeq + 1`, gap detected
- Client schedules jittered resync (force-refresh collections)
- Missing directives delay freshness, don't corrupt state

---

## Where Logic Lives

### ❌ Anti-Pattern: Logic in View Layer
```javascript
// BAD: View layer doing data orchestration
async function updateStatus(id, newStatus) {
  // View is managing cache invalidation
  const response = await fetch(`/api/invoices/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: newStatus })
  })
  
  // View decides what to refetch
  await refetchInvoices()
  await refetchInvoice(id)
  
  // View coordinates multi-client sync
  broadcastToOtherTabs({ type: 'invoice-updated', id })
}
```

### ✅ Good Pattern: Logic in Server + Verity
```javascript
// GOOD: Server decides invalidation
// Backend (Python/Node/etc)
@app.put('/api/invoices/:id')
def update_invoice(id):
    invoice = update_status(id, request.json['status'])
    
    # Server authors the invalidation contract
    emit_directives([
        { 'op': 'refresh_item', 'name': 'invoice', 'id': id },
        { 'op': 'refresh_collection', 'name': 'invoices' }
    ])
    
    return { 'directives': [...] }

// Frontend (View Layer)
async function updateStatus(id, newStatus) {
    const res = await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
    })
    const payload = await res.json()
    
    // Just forward directives to Verity
    await applyDirectives(payload.directives)
}
```

**Why this is better:**
- Server decides what changed (domain knowledge)
- Verity handles orchestration (data layer responsibility)
- View just renders (presentation responsibility)
- Multi-client sync is automatic (SSE fan-out)

---

## Architecture Decision Records

### Why Not Server-Side Rendering (SSR)?
**Problem**: Needs to push DOM/HTML  
**Trade-off**: Tight coupling between server and view structure  
**Verity's choice**: Push data intent (directives), not DOM

### Why Not Optimistic Updates?
**Problem**: Flicker, rollback complexity, user distrust  
**Trade-off**: Slightly higher perceived latency  
**Verity's choice**: Honest loading states, fast server responses

### Why Directives Instead of Full Sync?
**Problem**: Full state sync is expensive  
**Trade-off**: Must trust directive delivery (SSE best-effort)  
**Verity's choice**: Loss-tolerant directives + gap handling

### Why Levels Instead of Field-Level Normalization?
**Problem**: Field normalization is complex and leaky  
**Trade-off**: Coarser granularity than GraphQL fragments  
**Verity's choice**: Named levels + conversion graphs (simpler, explicit)

---

## Transport Options

### SSE (Default)
**Pros:**
- Simple HTTP
- Auto-reconnect built-in
- Works through most proxies

**Cons:**
- Unidirectional (server → client)
- Best-effort delivery

### WebSocket (Custom Adapter)
**Pros:**
- Bidirectional
- Lower latency

**Cons:**
- More complex
- Proxy issues

### GraphQL Subscriptions (Custom Adapter)
**Pros:**
- Leverages existing GraphQL infra
- Type-safe subscriptions

**Cons:**
- Requires GraphQL server

**How to implement:**
```javascript
registry.configureDirectiveSource({
  type: 'graphql-subscription',
  connect: ({ applyDirectives, clientId }) => {
    const subscription = gqlClient.subscribe({
      query: DIRECTIVES_SUBSCRIPTION,
      variables: { clientId }
    })
    
    subscription.on('data', ({ directives, source }) => {
      if (source !== clientId) {
        applyDirectives(directives)
      }
    })
    
    return () => subscription.unsubscribe()
  }
})
```

---

## Summary

Verity is **the backend of your frontend** because it:

1. **Sits between server and view** (architectural layer)
2. **Manages truth-state** (not view-state)
3. **Enforces separation of concerns** (no mixing)
4. **Provides a contract** (directives, not ad-hoc)
5. **Handles complexity** (caching, staleness, concurrency, fan-out)
6. **Stays protocol-agnostic** (REST, GraphQL, gRPC—doesn't matter)
7. **Stays framework-agnostic** (thin adapters for Alpine, React, Vue, Svelte)

By extracting truth-state management into a dedicated layer, Verity lets servers focus on domain logic and views focus on rendering—each layer doing what it does best.

---

## Next Steps

1. Master [Truth-State vs View-State](concepts/truth-vs-view-state.md) distinction
2. Learn the [Directive Contract](concepts/directives.md)
3. Understand [Levels & Conversions](concepts/levels-and-conversions.md)
4. Study [Concurrency Model](concepts/concurrency-model.md)
5. Follow [Getting Started](guides/getting-started.md) to implement this architecture

# Glossary

> Comprehensive reference of Verity terminology and concepts

This glossary defines key terms used throughout Verity's documentation. Terms are organized alphabetically within conceptual categories.

---

## Core Concepts

### Truth-State

**Server-owned authoritative state** that multiple clients must agree on. Originates from the server, fetched by Verity, and never modified locally.

**Examples:** User profiles, todo items, order status, inventory counts, permissions

**Opposite:** View-state

**See:** [Truth-State vs View-State](concepts/truth-vs-view-state.md)

---

### View-State

**Client-owned ephemeral UI state** that is local to one client and never persists server-side. Managed by the view layer (React state, Alpine data, etc.).

**Examples:** Which menu is open, selected tab, form input values (before submission), scroll position

**Opposite:** Truth-state

**See:** [Truth-State vs View-State](concepts/truth-vs-view-state.md)

---

### Registry

The **core Verity instance** that manages all truth-state caching, fetching, and directive processing. Created via `createRegistry()`.

**Responsibilities:**
- Cache management
- Request coalescing
- Directive application
- SSE connection management
- Type/collection registration

**See:** [Core API Reference](reference/core.md)

---

### Directive

A **semantic message from the server** that describes what truth-state changed and needs to be refreshed. Directives decouple the server from view structure.

**Types:**
- `refresh_collection` - Invalidate and refetch a collection
- `refresh_item` - Invalidate and refetch an item
- `invalidate` - Group multiple directives

**Example:**
```json
{
  "op": "refresh_item",
  "name": "todo",
  "id": 42
}
```

**See:** [Directives Concept](concepts/directives.md) | [Directive API Reference](reference/directives.md)

---

## Data Types

### Collection

A **parameterized list of items** from the server. Collections support filtering via params and return `{ items: [], meta: {} }`.

**Examples:** 
- `todos` with params `{ status: "active" }`
- `users` with params `{ page: 1, role: "admin" }`

**Registration:**
```javascript
registry.registerCollection('todos', {
  fetch: async (params) => { /* ... */ }
})
```

**See:** [Core API Reference](reference/core.md#registercollection)

---

### Item / Type

A **single record** identified by parameters (usually an ID). Items are registered as "types" and accessed via `item()`.

**Examples:**
- `user` with params `{ userId: 123 }`
- `app_settings` with params `{}`

**Registration:**
```javascript
registry.registerType('user', {
  fetch: async ({ userId }) => { /* ... */ }
})
```

**See:** [Core API Reference](reference/core.md#registertype)

---

### Level

A **detail level** for an item, representing different amounts of data fetched from the server.

**Examples:**
- `simplified` - ID, title, status
- `expanded` - + description, assignee
- `full` - + comments, attachments, history

**Use case:** List views fetch `simplified`, detail views fetch `full`

**See:** [Levels & Conversions](concepts/levels-and-conversions.md)

---

### Level Conversion

A **transformation function** that derives one level from another without a network call.

**Example:**
```javascript
registry.registerConversion('todo', 'full', 'expanded', (full) => {
  const { comments, attachments, ...expanded } = full
  return expanded
})
```

**Benefit:** Client holds `full`, needs `expanded` → no fetch, just conversion

**See:** [Levels & Conversions](concepts/levels-and-conversions.md)

---

## Cache & Staleness

### Staleness

The **age-based freshness** of cached data. Items are **fresh** within `stalenessMs`, then become **stale** (but still usable).

**Fresh:** Recently fetched, within staleness window  
**Stale:** Older than `stalenessMs`, eligible for refetch

**Configuration:**
```javascript
registry.registerCollection('todos', {
  fetch: /* ... */,
  stalenessMs: 30000  // 30 seconds
})
```

**See:** [State Model](guides/state-model.md)

---

### Cache Key

A **unique identifier** for a cached collection/item, combining name and serialized params.

**Examples:**
- `todos:{"status":"active"}`
- `user:{"userId":123}`

**Custom keys:**
```javascript
registry.registerCollection('todos', {
  key: (params) => `todos:${params.status || 'all'}`
})
```

---

### Coalescing

**Batching multiple identical requests** into a single network call. If multiple components request the same data simultaneously, Verity makes one fetch and shares the result.

**Configuration:**
```javascript
registry.createRegistry({
  bulk: { delayMs: 50 }  // Wait 50ms to collect requests
})
```

**See:** [Core API Reference](reference/core.md#createregistry)

---

## Directives & Invalidation

### Directive Source

The **client ID** that originated a mutation, used to prevent double-application of directives.

**Flow:**
1. Client A mutates data
2. Server returns directives with `source: "client-a"`
3. Server emits same directives over SSE
4. Client A ignores SSE (source matches)
5. Client B applies SSE (source doesn't match)

**Header:** `X-Verity-Client-ID: client-abc123`

---

### Idempotency Key

A **unique identifier** for a directive to prevent duplicate processing. Verity tracks recent keys and ignores duplicates.

**Example:**
```json
{
  "op": "refresh_collection",
  "name": "todos",
  "idempotency_key": "bulk-complete-abc123"
}
```

**Use case:** Bulk operations, unreliable transports

**See:** [Directive API Reference](reference/directives.md#idempotency_key)

---

### Audience

A **scoping mechanism** for SSE messages, routing directives to specific users, teams, or contexts.

**Examples:**
- `"global"` - All clients
- `"user-123"` - Specific user
- `"team-abc"` - Specific team

**Server:**
```python
emit_directives(directives, audience='user-123')
```

**Client:**
```javascript
const registry = createRegistry({
  sse: { audience: 'user-123' }
})
```

**See:** [Directive API Reference](reference/directives.md#audience)

---

### Sequence Number (seq)

An **incrementing counter** for SSE messages to detect gaps (missed messages).

**Behavior:**
- Server increments sequence per audience
- Client tracks expected next sequence
- If gap detected (expected 42, got 44), client triggers resync

**See:** [Directive API Reference](reference/directives.md#seq) | [Devtools SSE Panel](reference/devtools.md#sse-panel)

---

### Resync

A **forced refetch** of all active collections, triggered when SSE sequence gap detected or manually invoked.

**Trigger:**
```javascript
await registry.resync()
```

**Use case:** Recovery from missed SSE messages

---

## Transport & Communication

### SSE (Server-Sent Events)

A **unidirectional push protocol** from server to client for real-time directive delivery.

**Endpoint:** `/api/events` (default)

**Configuration:**
```javascript
const registry = createRegistry({
  sse: {
    url: '/api/events',
    audience: 'global',
    withCredentials: true
  }
})
```

**See:** [Core API Reference](reference/core.md#sse-server-sent-events) | [Devtools SSE Panel](reference/devtools.md#sse-panel)

---

### Pull Path

**Directives returned directly** in a mutation response for immediate local updates.

**Example:**
```javascript
const res = await fetch('/api/todos/42', { method: 'PUT', ... })
const { directives } = await res.json()
await registry.applyDirectives(directives)
```

**See:** [Directive Transport](reference/directives.md#pull-path-mutation-response)

---

### Push Path

**Directives emitted over SSE** for fan-out to other clients/tabs/devices.

**Server:**
```python
emit_directives(directives, audience='global')
```

**Client:** Automatically applies directives (if source doesn't match)

**See:** [Directive Transport](reference/directives.md#push-path-sse)

---

## Framework Integration

### Adapter

A **thin bridge** between Verity's core registry and a UI framework (Alpine, React, Vue, Svelte). Adapters expose framework-idiomatic APIs.

**Available Adapters:**
- Alpine.js: `$verity` magic
- React: `useVerityCollection()`, `useVerityItem()`
- Vue 3: `useVerityCollection()`, `useVerityItem()`
- Svelte: `collectionStore()`, `itemStore()`

**See:** [Framework Adapters Reference](reference/adapters.md)

---

### Handle

A **reactive reference** to cached data with state, methods, and metadata.

**Collection Handle:**
```typescript
{
  state: {
    loading: boolean
    error: Error | null
    items: any[]
    meta: any
  }
  refresh(): Promise<void>
  setParams(params: any): void
  remove(): void
}
```

**Item Handle:**
```typescript
{
  state: {
    loading: boolean
    error: Error | null
    value: any | null
  }
  refresh(): Promise<void>
  remove(): void
}
```

---

## UX Patterns

### Skeleton

A **placeholder UI** shown when data doesn't exist yet (first load, before any fetch completes).

**Usage:**
```html
<template x-if="!state.items">
  <div class="skeleton"></div>
</template>
```

**Philosophy:** Honest indicator that data isn't available yet

**See:** [UX Patterns](guides/ux-patterns.md)

---

### Spinner

An **activity indicator** shown while a fetch is in progress.

**Usage:**
```html
<template x-if="state.loading">
  <div class="spinner"></div>
</template>
```

**Philosophy:** Honest indicator that work is happening

**See:** [UX Patterns](guides/ux-patterns.md)

---

### Optimistic Update

A **local speculation** about server response before confirmation. **Verity explicitly avoids this pattern** in favor of server-truth.

**Why avoid:**
- Creates temporary lies
- Can mismatch server reality
- Causes flicker on rollback
- Breaks trust

**Alternative:** Build fast endpoints that return truth quickly

**See:** [Philosophy](philosophy.md#honest-by-design)

---

## Development & Debugging

### Devtools

A **visual debugging overlay** that shows live truth-state, events, directives, and SSE status.

**Installation:**
```html
<link rel="stylesheet" href=".../devtools.css">
<script src=".../devtools.js"></script>
```

**Toggle:** `Ctrl+Shift+D` (or `Cmd+Shift+D` on Mac)

**Panels:**
- **Truth:** Live cache snapshot
- **Events:** Timeline of fetch/directive/SSE events
- **SSE:** Connection status and messages
- **Config:** Registry settings

**See:** [Devtools Reference](reference/devtools.md)

---

### Client ID

A **unique identifier** for a Verity registry instance, used for directive source tracking.

**Access:**
```javascript
console.log(registry.clientId)  // "client-abc123xyz"
```

**Usage:** Include in mutation headers to tag directives

---

## Architecture Terms

### Backend of the Frontend

Verity's **positioning** as the data layer that sits between the server (backend) and the view layer (frontend). It handles concerns traditionally split between them.

**Responsibilities:**
- Fetching (traditionally view layer concern)
- Caching (traditionally backend concern)
- Invalidation (traditionally app-defined glue)
- Real-time sync (traditionally complex infrastructure)

**See:** [Architecture](architecture.md)

---

### Latest-Wins

A **concurrency guarantee** that prevents stale network responses from clobbering newer state.

**Example:**
1. Request A starts for `todo:42`
2. Request B starts for `todo:42` (newer)
3. Request B completes → cache updated
4. Request A completes (stale) → cache NOT updated

**See:** [Concurrency Model](concepts/concurrency-model.md)

---

### Protocol-Agnostic

Verity's **design principle** of not being tied to any specific transport (REST, GraphQL, gRPC, WebSocket, etc.).

**Fetchers:** Any async function that returns data  
**Directives:** Transport via SSE, WebSocket, GraphQL subscriptions, polling, etc.

**See:** [Philosophy](philosophy.md#protocol-agnostic-framework-agnostic)

---

### Framework-Agnostic

Verity's **design principle** of not being tied to any specific UI framework.

**Core:** Pure JavaScript, no framework dependencies  
**Adapters:** Thin bridges to Alpine, React, Vue, Svelte

**See:** [Philosophy](philosophy.md#protocol-agnostic-framework-agnostic)

---

## Terms by Category

### State Management
- Truth-State
- View-State
- Collection
- Item / Type
- Level
- Staleness
- Cache Key

### Directives
- Directive
- Directive Source
- Idempotency Key
- Audience
- Sequence Number
- Pull Path
- Push Path

### Architecture
- Registry
- Backend of the Frontend
- Latest-Wins
- Protocol-Agnostic
- Framework-Agnostic
- Coalescing

### Framework Integration
- Adapter
- Handle

### UX
- Skeleton
- Spinner
- Optimistic Update (anti-pattern)

### Development
- Devtools
- Client ID
- Resync

---

## Quick Reference

| If you want to... | Look for... |
|-------------------|-------------|
| Understand core philosophy | Truth-State, View-State, Backend of the Frontend |
| Set up data fetching | Registry, Collection, Item/Type |
| Handle server updates | Directive, Pull Path, Push Path |
| Optimize performance | Coalescing, Level, Level Conversion, Staleness |
| Debug issues | Devtools, Resync, Client ID |
| Build UI | Adapter, Handle, Skeleton, Spinner |
| Scale to many clients | SSE, Audience, Sequence Number |

---

## See Also

- [Philosophy](philosophy.md) - Core beliefs and trade-offs
- [Architecture](architecture.md) - How the three layers interact
- [Truth-State vs View-State](concepts/truth-vs-view-state.md) - The key distinction
- [Complete API Reference](reference/core.md) - All methods and options

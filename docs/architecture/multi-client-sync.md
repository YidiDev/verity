# Multi-Client Convergence

How multiple clients stay in sync without coordination.

---

## The Problem

Traditional approaches:
- **Polling**: wasteful, delayed
- **Manual WebSocket**: complex, error-prone
- **Optimistic updates**: flicker, mismatch

---

## Verity's Approach: Directive Fan-Out

1. **Client A** performs mutation
2. **Server** processes mutation
3. **Server returns directives** to Client A (immediate feedback)
4. **Server emits same directives** over SSE to all clients
5. **Clients ignore own directives** (via client IDs)
6. **All clients apply directives** independently
7. **Convergence achieved** without coordination

---

## Sequence Numbers & Gap Handling

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

# Where Logic Lives

Understanding where different kinds of logic should live is crucial to maintaining a clean architecture.

---

## ❌ Anti-Pattern: Logic in View Layer

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

---

## ✅ Good Pattern: Logic in Server + Verity

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

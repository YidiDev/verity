# Data Flow

Understanding how data moves through Verity's three layers is crucial to building reliable applications.

---

## Pull Path (Fetching)

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

---

## Push Path (Directives)

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

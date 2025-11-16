# Reference: Directive Contract

> Complete API reference for the server-authored invalidation protocol

Directives are the **contract** between your server and Verity clients. They are small, semantic JSON messages that tell clients what truth-state changed and needs to be refreshed.

!!! info "Conceptual Overview"
    This is the **API reference**. For conceptual understanding, see [Directives concept](../concepts/directives.md).

---

## Philosophy

Directives embody Verity's core separation of concerns:

- **Server** owns domain knowledge (what changed, what's affected)
- **Verity** orchestrates data synchronization (when to fetch, how to coalesce)
- **View** renders the result (how it looks)

The server never dictates DOM structure or component behavior. It simply declares: "This piece of truth-state changed."

---

## Directive Types

### `refresh_collection`

Invalidates and refetches a collection identified by name and optional parameters.

#### Schema

```typescript
{
  op: "refresh_collection"
  name: string                    // Collection type name
  params?: Record<string, any>    // Optional filter/query parameters
  params_mode?: "exact" | "contains"  // Parameter matching mode (default: "exact")
  
  // Optional metadata
  idempotency_key?: string        // Deduplication key
  timestamp?: number              // When the change occurred (ms since epoch)
  audience?: string               // Target audience (e.g., "user-123", "team-abc")
  source?: string                 // Client ID that originated this change
  seq?: number                    // Sequence number for ordering
  result?: any                    // Optional: include the updated data
}
```

#### Behavior

**Without `params`:**
```javascript
{ "op": "refresh_collection", "name": "todos" }
```
- Invalidates **all** cached instances of `todos` collection regardless of parameters
- Each client refetches every cached `(name, params)` combination they hold

**With `params` (exact mode):**
```javascript
{
  "op": "refresh_collection",
  "name": "todos",
  "params": { "status": "active" }
}
```
- Invalidates only the collection cached with **exactly** `{ status: "active" }`
- Collections with `{ status: "completed" }` or `{}` are unaffected

**With `params` (contains mode):**
```javascript
{
  "op": "refresh_collection",
  "name": "todos",
  "params": { "status": "active" },
  "params_mode": "contains"
}
```
- Invalidates any collection whose params **contain** `{ status: "active" }`
- Matches `{ status: "active" }`, `{ status: "active", project: 5 }`, etc.

#### Use Cases

| Scenario | Directive |
|----------|-----------|
| Created a new item | `{ op: "refresh_collection", name: "todos" }` |
| Deleted an item | `{ op: "refresh_collection", name: "todos" }` |
| Updated item affecting sort/filter | `{ op: "refresh_collection", name: "todos", params: {...} }` |
| Bulk operation | `{ op: "refresh_collection", name: "todos", idempotency_key: "bulk-xyz" }` |
| Status-specific change | `{ op: "refresh_collection", name: "todos", params: { status: "active" } }` |

#### Server Example

```python
@app.post('/api/todos')
def create_todo():
    todo = Todo(title=request.json['title'], status='active')
    db.session.add(todo)
    db.session.commit()
    
    directives = [
        # Invalidate all todo collections
        { 'op': 'refresh_collection', 'name': 'todos' }
    ]
    
    emit_directives(directives)  # SSE fan-out
    
    return {
        'todo': todo.to_dict(),
        'directives': directives  # Immediate response
    }
```

---

### `refresh_item`

Invalidates and refetches a specific item identified by type and ID.

#### Schema

```typescript
{
  op: "refresh_item"
  name: string                    // Item type name
  id: string | number             // Item identifier
  level?: string                  // Specific level to refresh
  
  // Optional metadata
  idempotency_key?: string
  timestamp?: number
  audience?: string
  source?: string
  seq?: number
  result?: any                    // Optional: include the updated data
}
```

#### Behavior

**Without `level`:**
```javascript
{ "op": "refresh_item", "name": "todo", "id": 42 }
```
- Client checks which levels it currently holds for `todo:42`
- Refetches those levels
- Uses level conversion graphs to minimize fetches

**With `level`:**
```javascript
{ "op": "refresh_item", "name": "todo", "id": 42, "level": "expanded" }
```
- Ensures the `expanded` level is fetched and fresh
- If client holds `simplified`, it fetches `expanded`
- If client already has `expanded`, it refetches to ensure freshness

#### Level Conversion Example

Suppose you have these level relationships:
```
simplified → expanded → full
```

**Scenario 1:** Client holds `simplified`
```javascript
// Directive: refresh todo:42
{ "op": "refresh_item", "name": "todo", "id": 42 }
```
- Client refetches `simplified` level only

**Scenario 2:** Client holds `expanded`
```javascript
// Directive: refresh todo:42 at expanded level
{ "op": "refresh_item", "name": "todo", "id": 42, "level": "expanded" }
```
- Client refetches `expanded` level
- `simplified` can be derived from `expanded` (if conversion defined)
- Net: 1 fetch

**Scenario 3:** Client holds `simplified`, needs `full`
```javascript
// Directive: ensure full level
{ "op": "refresh_item", "name": "todo", "id": 42, "level": "full" }
```
- Client fetches `full` level
- Both `expanded` and `simplified` can be derived from `full`
- Net: 1 fetch

#### Use Cases

| Scenario | Directive |
|----------|-----------|
| Updated an item | `{ op: "refresh_item", name: "todo", id: 42 }` |
| Server processing changed item | `{ op: "refresh_item", name: "todo", id: 42 }` |
| Need specific detail level | `{ op: "refresh_item", name: "todo", id: 42, level: "full" }` |
| Optimistic with payload | `{ op: "refresh_item", name: "todo", id: 42, result: {...} }` |

#### Server Example

```python
@app.put('/api/todos/<int:todo_id>')
def update_todo(todo_id):
    todo = Todo.query.get_or_404(todo_id)
    todo.title = request.json['title']
    todo.completed = request.json['completed']
    db.session.commit()
    
    directives = [
        # Refresh the item
        { 'op': 'refresh_item', 'name': 'todo', 'id': todo_id },
        # Also refresh collections (item might affect order/filters)
        { 'op': 'refresh_collection', 'name': 'todos' }
    ]
    
    emit_directives(directives)
    
    return {
        'todo': todo.to_dict(),
        'directives': directives
    }
```

---

### `invalidate`

Wrapper directive that groups multiple directives. Rarely needed—most endpoints just return an array of directives.

#### Schema

```typescript
{
  op: "invalidate"
  targets: Directive[]            // Array of directives to apply
  
  // Optional metadata
  idempotency_key?: string
  timestamp?: number
  audience?: string
  source?: string
  seq?: number
}
```

#### Behavior

```javascript
{
  "op": "invalidate",
  "targets": [
    { "op": "refresh_item", "name": "todo", "id": 42 },
    { "op": "refresh_collection", "name": "todos" }
  ]
}
```

Equivalent to:
```javascript
[
  { "op": "refresh_item", "name": "todo", "id": 42 },
  { "op": "refresh_collection", "name": "todos" }
]
```

#### Use Cases

- **Explicit grouping:** When you want to emphasize that directives are related
- **Conditional application:** Client-side logic can check conditions before applying targets
- **Metadata sharing:** Apply same `idempotency_key` or `audience` to multiple directives

!!! tip "When to use"
    In most cases, just return an array of directives. Use `invalidate` only when you need explicit grouping semantics or shared metadata.

---

## Metadata Fields

All directive types support these optional metadata fields:

### `idempotency_key`

Prevents duplicate processing of the same logical operation.

```javascript
{
  "op": "refresh_collection",
  "name": "todos",
  "idempotency_key": "bulk-complete-abc123"
}
```

**Behavior:**
- Verity tracks recent idempotency keys (default: last 1000, 5-minute window)
- If same key seen twice, second instance is ignored
- Useful for bulk operations or unreliable transports

**Example:**
```python
import uuid

@app.post('/api/todos/bulk-complete')
def bulk_complete():
    operation_id = str(uuid.uuid4())
    
    # ... perform bulk update ...
    
    return {
        'directives': [{
            'op': 'refresh_collection',
            'name': 'todos',
            'idempotency_key': f'bulk-complete-{operation_id}'
        }]
    }
```

---

### `timestamp`

Records when the server-side change occurred (milliseconds since epoch).

```javascript
{
  "op": "refresh_item",
  "name": "todo",
  "id": 42,
  "timestamp": 1735500000000
}
```

**Behavior:**
- Informational only (Verity doesn't use it for ordering)
- Useful for debugging and audit logs
- Can be used by custom directive handlers

---

### `audience`

Scopes the directive to specific users, teams, or tenant contexts.

```javascript
{
  "op": "refresh_collection",
  "name": "private_docs",
  "audience": "user-123"
}
```

**Behavior:**
- SSE clients subscribe to specific audiences
- Directives only delivered to clients with matching audience
- Default audience: `"global"`

**Server Example:**
```python
@app.put('/api/users/<int:user_id>/settings')
def update_user_settings(user_id):
    # ... update settings ...
    
    directives = [{
        'op': 'refresh_item',
        'name': 'user_settings',
        'id': user_id
    }]
    
    # Only send to this specific user
    emit_directives(directives, audience=f'user-{user_id}')
    
    return { 'directives': directives }
```

**Client Setup:**
```javascript
const registry = Verity.createRegistry({
  sse: {
    url: '/api/events',
    audience: `user-${currentUserId}`  // Subscribe to user-specific events
  }
})
```

---

### `source`

Identifies which client originated the change (auto-generated client ID).

```javascript
{
  "op": "refresh_item",
  "name": "todo",
  "id": 42,
  "source": "client-abc123"
}
```

**Behavior:**
- Automatically added by Verity when sending mutations
- Used to prevent double-application (client ignores its own SSE echoes)
- Set via `X-Verity-Client-ID` header

**Flow:**
```
1. Client A: PUT /api/todos/42 (header: X-Verity-Client-ID: client-abc)
2. Server: Returns directives with source: "client-abc"
3. Server: Emits to SSE with source: "client-abc"
4. Client A: Ignores SSE (source matches)
5. Client B: Processes SSE (source doesn't match)
```

---

### `seq`

Sequence number for detecting missed messages in SSE streams.

```javascript
{
  "type": "directives",
  "seq": 42,
  "audience": "global",
  "directives": [
    { "op": "refresh_collection", "name": "todos" }
  ]
}
```

**Behavior:**
- Server increments sequence per audience
- Client tracks expected next sequence
- If gap detected (expected 42, got 44), client triggers resync
- Resync: force-refresh all active collections

**Server Implementation:**
```python
_audience_seq = {}  # audience -> current seq

def emit_directives(directives, audience='global'):
    seq = _next_seq(audience)
    
    payload = {
        'type': 'directives',
        'seq': seq,
        'audience': audience,
        'directives': directives
    }
    
    _broadcast(payload, audience=audience)
```

---

### `result`

Includes the updated data inline, avoiding an immediate refetch.

```javascript
{
  "op": "refresh_item",
  "name": "todo",
  "id": 42,
  "result": {
    "id": 42,
    "title": "Buy milk",
    "completed": true
  }
}
```

**Behavior:**
- Verity immediately applies the `result` to cache
- Marks the item as fresh (resets staleness timer)
- If client needs a different level, it still fetches
- Useful for "hot path" operations where server has the data

**Use Case:**
```python
@app.put('/api/todos/<int:todo_id>/toggle')
def toggle_todo(todo_id):
    todo = Todo.query.get_or_404(todo_id)
    todo.completed = not todo.completed
    db.session.commit()
    
    # Include updated data to avoid refetch
    return {
        'directives': [{
            'op': 'refresh_item',
            'name': 'todo',
            'id': todo_id,
            'result': todo.to_dict()  # ← Client gets data immediately
        }]
    }
```

!!! warning "Level Matching"
    The `result` payload must match the level the client currently holds. If unsure, omit `result` and let Verity refetch.

---

## Directive Transport

### Pull Path: Mutation Response

The most common pattern: return directives directly in your mutation response.

```javascript
// Client makes mutation
const response = await fetch('/api/todos/42', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'X-Verity-Client-ID': registry.clientId  // Tag with client ID
  },
  body: JSON.stringify({ title: 'New title' })
})

const payload = await response.json()

// Apply directives
if (payload.directives) {
  await registry.applyDirectives(payload.directives)
}
```

**Response format:**
```json
{
  "todo": { "id": 42, "title": "New title" },
  "directives": [
    { "op": "refresh_item", "name": "todo", "id": 42 },
    { "op": "refresh_collection", "name": "todos" }
  ]
}
```

---

### Push Path: Server-Sent Events (SSE)

For multi-client synchronization, emit directives over SSE.

#### Server Setup

```python
from verity.shared.sse import emit_directives

@app.put('/api/todos/<int:todo_id>')
def update_todo(todo_id):
    # 1. Perform mutation
    todo = Todo.query.get_or_404(todo_id)
    todo.title = request.json['title']
    db.session.commit()
    
    # 2. Define directives
    directives = [
        { 'op': 'refresh_item', 'name': 'todo', 'id': todo_id },
        { 'op': 'refresh_collection', 'name': 'todos' }
    ]
    
    # 3. Emit to SSE (for other clients)
    emit_directives(
        directives,
        audience='global',
        source=request.headers.get('X-Verity-Client-ID')
    )
    
    # 4. Return to requesting client
    return { 'todo': todo.to_dict(), 'directives': directives }
```

#### Client Setup

```javascript
const registry = Verity.createRegistry({
  sse: {
    url: '/api/events',
    audience: 'global',
    withCredentials: true,      // For auth cookies
    initialRetryMs: 1000,       // Reconnect delay
    maxRetryMs: 30000
  }
})

// Directives from SSE are applied automatically
// (excluding those with source === registry.clientId)
```

#### SSE Message Format

```
event: message
data: {"type":"directives","seq":42,"audience":"global","directives":[{"op":"refresh_collection","name":"todos"}]}
```

---

### Push Path: Custom Transport

You can plug in WebSocket, GraphQL subscriptions, or any other transport.

```javascript
registry.configureDirectiveSource({
  type: 'websocket',
  connect: ({ applyDirectives, clientId }) => {
    const ws = new WebSocket('wss://example.com/directives')
    
    ws.onmessage = (event) => {
      const { directives, source } = JSON.parse(event.data)
      
      // Ignore echoes from this client
      if (source !== clientId) {
        applyDirectives(directives)
      }
    }
    
    // Return cleanup function
    return () => ws.close()
  }
})
```

---

## Common Patterns

### Pattern: Create Item

```python
@app.post('/api/todos')
def create_todo():
    todo = Todo(title=request.json['title'])
    db.session.add(todo)
    db.session.commit()
    
    return {
        'todo': todo.to_dict(),
        'directives': [
            # New item affects collection
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
    }
```

---

### Pattern: Update Item

```python
@app.put('/api/todos/<int:todo_id>')
def update_todo(todo_id):
    todo = Todo.query.get_or_404(todo_id)
    todo.title = request.json['title']
    db.session.commit()
    
    return {
        'todo': todo.to_dict(),
        'directives': [
            # Item changed
            { 'op': 'refresh_item', 'name': 'todo', 'id': todo_id },
            # Collection might be affected (sort order, filters)
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
    }
```

---

### Pattern: Delete Item

```python
@app.delete('/api/todos/<int:todo_id>')
def delete_todo(todo_id):
    todo = Todo.query.get_or_404(todo_id)
    db.session.delete(todo)
    db.session.commit()
    
    return {
        'directives': [
            # Don't refresh item (it's gone!)
            # Just refresh collection (item removed)
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
    }
```

---

### Pattern: Status Change (Conditional Directives)

```python
@app.put('/api/todos/<int:todo_id>')
def update_todo(todo_id):
    todo = Todo.query.get_or_404(todo_id)
    old_status = todo.status
    todo.status = request.json['status']
    db.session.commit()
    
    directives = [
        { 'op': 'refresh_item', 'name': 'todo', 'id': todo_id }
    ]
    
    # If status changed, refresh affected filtered collections
    if old_status != todo.status:
        directives.extend([
            # Refresh old status collection
            {
                'op': 'refresh_collection',
                'name': 'todos',
                'params': { 'status': old_status }
            },
            # Refresh new status collection
            {
                'op': 'refresh_collection',
                'name': 'todos',
                'params': { 'status': todo.status }
            }
        ])
    
    return { 'directives': directives }
```

---

### Pattern: Cascading Updates

```python
@app.put('/api/projects/<int:project_id>/archive')
def archive_project(project_id):
    project = Project.query.get_or_404(project_id)
    project.archived = True
    
    # Archiving cascades to tasks
    affected_task_ids = []
    for task in project.tasks:
        task.archived = True
        affected_task_ids.append(task.id)
    
    db.session.commit()
    
    directives = [
        # Refresh the project
        { 'op': 'refresh_item', 'name': 'project', 'id': project_id },
        { 'op': 'refresh_collection', 'name': 'projects' },
        # Refresh all affected tasks
        *[
            { 'op': 'refresh_item', 'name': 'task', 'id': task_id }
            for task_id in affected_task_ids
        ],
        # Refresh task collections
        { 'op': 'refresh_collection', 'name': 'tasks' }
    ]
    
    return { 'directives': directives }
```

---

### Pattern: Bulk Operations with Idempotency

```python
import uuid

@app.post('/api/todos/bulk-complete')
def bulk_complete():
    operation_id = str(uuid.uuid4())
    todo_ids = request.json['todo_ids']
    
    for todo_id in todo_ids:
        todo = Todo.query.get(todo_id)
        if todo:
            todo.completed = True
    
    db.session.commit()
    
    return {
        'directives': [{
            'op': 'refresh_collection',
            'name': 'todos',
            'idempotency_key': f'bulk-complete-{operation_id}'
        }]
    }
```

---

### Pattern: Optimistic with Payload

```python
@app.put('/api/todos/<int:todo_id>/toggle')
def toggle_todo(todo_id):
    """Hot path: toggle completion status"""
    todo = Todo.query.get_or_404(todo_id)
    todo.completed = not todo.completed
    db.session.commit()
    
    # Include updated data to avoid refetch
    return {
        'directives': [{
            'op': 'refresh_item',
            'name': 'todo',
            'id': todo_id,
            'result': todo.to_dict()  # ← Client gets instant update
        }]
    }
```

---

## Best Practices

### 1. Be Explicit with Parameters

```python
# ❌ Ambiguous
{ 'op': 'refresh_collection', 'name': 'todos' }
# (Refreshes ALL todo collections, including ones client doesn't have)

# ✅ Explicit when possible
{ 'op': 'refresh_collection', 'name': 'todos', 'params': { 'status': 'active' } }
# (Only refreshes the specific filtered collection)
```

### 2. Include Affected Collections

```python
# ❌ Incomplete
@app.put('/api/todos/<int:id>')
def update_todo(id):
    # ...
    return {
        'directives': [
            { 'op': 'refresh_item', 'name': 'todo', 'id': id }
            # Missing: collection refresh!
        ]
    }

# ✅ Complete
return {
    'directives': [
        { 'op': 'refresh_item', 'name': 'todo', 'id': id },
        { 'op': 'refresh_collection', 'name': 'todos' }  # ← Don't forget
    ]
}
```

### 3. Use Idempotency for Critical Operations

```python
# ✅ For important bulk operations
@app.post('/api/todos/bulk-delete')
def bulk_delete():
    operation_id = str(uuid.uuid4())
    # ...
    return {
        'directives': [{
            'op': 'refresh_collection',
            'name': 'todos',
            'idempotency_key': f'bulk-delete-{operation_id}'
        }]
    }
```

### 4. Use Payloads for Hot Paths

```python
# ✅ For frequent operations where server has the data
@app.put('/api/todos/<int:id>/toggle')
def toggle_todo(id):
    todo.completed = not todo.completed
    db.session.commit()
    
    return {
        'directives': [{
            'op': 'refresh_item',
            'name': 'todo',
            'id': id,
            'result': todo.to_dict()  # ← Skip refetch
        }]
    }
```

### 5. Scope with Audiences

```python
# ✅ For user-specific or team-specific data
@app.put('/api/users/<int:user_id>/profile')
def update_profile(user_id):
    # ...
    emit_directives(
        [{ 'op': 'refresh_item', 'name': 'user', 'id': user_id }],
        audience=f'user-{user_id}'  # ← Only this user gets update
    )
```

---

## Testing Directives

### Unit Test: Verify Directive Emission

```python
def test_update_todo_returns_directives():
    response = client.put('/api/todos/1', json={'title': 'New'})
    data = response.json
    
    assert 'directives' in data
    assert len(data['directives']) == 2
    
    # Check item directive
    assert data['directives'][0] == {
        'op': 'refresh_item',
        'name': 'todo',
        'id': 1
    }
    
    # Check collection directive
    assert data['directives'][1] == {
        'op': 'refresh_collection',
        'name': 'todos'
    }
```

### Integration Test: Verify Refetch Triggered

```javascript
// Browser test (Playwright, Cypress, etc.)
test('directive triggers refetch', async ({ page }) => {
  await page.goto('/todos')
  
  // Initial state
  await expect(page.locator('[data-todo-id="1"]')).toHaveText('Buy milk')
  
  // Trigger update (returns directives)
  await page.click('[data-update-todo="1"]')
  
  // Wait for directive-triggered refetch
  await page.waitForResponse(resp => 
    resp.url().includes('/api/todos') && resp.request().method() === 'GET'
  )
  
  // Verify UI updated
  await expect(page.locator('[data-todo-id="1"]')).toHaveText('Buy milk - DONE')
})
```

---

## Summary

**Core Directive Types:**

| Type | Purpose | Required Fields |
|------|---------|----------------|
| `refresh_collection` | Invalidate & refetch collection | `op`, `name` |
| `refresh_item` | Invalidate & refetch item | `op`, `name`, `id` |
| `invalidate` | Group multiple directives | `op`, `targets` |

**Key Metadata:**

| Field | Purpose |
|-------|---------|
| `idempotency_key` | Prevent duplicate processing |
| `timestamp` | Record when change occurred |
| `audience` | Scope to specific users/teams |
| `source` | Identify originating client |
| `seq` | Detect missed messages |
| `result` | Include updated data inline |

**Transport Paths:**

1. **Pull (mutation response):** Return directives in response body
2. **Push (SSE):** Emit directives to SSE stream for fan-out
3. **Custom:** Plug in WebSocket, GraphQL subscriptions, etc.

---

## Next Steps

- **Concepts:** [Directives concept guide](../concepts/directives.md)
- **Levels:** [Levels & Conversions](../concepts/levels-and-conversions.md) for understanding `refresh_item` with levels
- **Architecture:** [Backend of Frontend](../architecture.md) for full data flow
- **Core API:** [Registry reference](core.md) for `applyDirectives()` and SSE configuration

# Directives: The Server-Authored Invalidation Contract

> Directives are how the server tells clients what changed—without dictating how to render it

Directives are the **core contract** in Verity. They're small, semantic messages from the server that describe what truth-state needs to be refreshed. This is fundamentally different from other approaches.

---

## What Are Directives?

A directive is a JSON message that says: **"This piece of truth-state changed. Refresh it."**

```javascript
// Simple directive
{
  "op": "refresh_collection",
  "name": "todos"
}

// Directive with parameters
{
  "op": "refresh_item",
  "name": "todo",
  "id": 42
}
```

That's it. No DOM patches, no field-level diffs, no component instructions. Just: "This thing changed."

---

## Why Directives?

### The Problem with Alternatives

**Approach 1: Server pushes HTML/DOM**
```html
<!-- Server sends: -->
<div id="todo-42">
  <input type="checkbox" checked>
  <span>Buy milk</span>
</div>
```

Problems:
- Couples server to view structure
- Breaks with client-side routing
- Can't support multiple frameworks
- Loses client view-state

**Approach 2: Client polls for everything**
```javascript
// Client does:
setInterval(() => {
  fetchTodos()
  fetchUser()
  fetchNotifications()
}, 5000)
```

Problems:
- Wasteful (fetches when nothing changed)
- Delayed (5 second lag)
- Doesn't scale

**Approach 3: No invalidation contract**
```javascript
// Client guesses:
await updateTodo(id)
// Um... should I refetch todos? Or just this todo?
// What about the count? What about filters?
// 🤷
```

Problems:
- Every developer reinvents the wheel
- Bugs from missed invalidations
- No consistency

### Verity's Approach: Semantic Directives

```javascript
// Server mutation endpoint
@app.put('/api/todos/:id')
def update_todo(id):
    todo = update_todo_in_db(id, request.json)
    
    // Server decides what changed
    return {
        'todo': todo,
        'directives': [
            { 'op': 'refresh_item', 'name': 'todo', 'id': id },
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
    }
```

Benefits:
- **Decoupled**: Server doesn't know about components
- **Explicit**: Clear contract, no guessing
- **Composable**: Directives fan out to all clients
- **Framework-agnostic**: Same directives work for Alpine, React, Vue

---

## Directive Types

### `refresh_collection`

Invalidates and refetches a collection.

```javascript
{
  "op": "refresh_collection",
  "name": "todos",
  "params": { "status": "active" }  // optional: specific params
}
```

**When to use:**
- After creating a new item
- After deleting an item
- After updating an item that affects collection membership
- After bulk operations

**Examples:**

```javascript
// Refresh all cached parameter combinations
{ "op": "refresh_collection", "name": "todos" }

// Refresh only the "active" todos
{ "op": "refresh_collection", "name": "todos", "params": { "status": "active" } }

// Refresh using partial match (contains mode)
{ 
  "op": "refresh_collection", 
  "name": "todos",
  "params": { "status": "active" },
  "params_mode": "contains"  // matches any cached params containing status=active
}
```

### `refresh_item`

Invalidates and refetches a specific item.

```javascript
{
  "op": "refresh_item",
  "name": "todo",
  "id": 42,
  "level": "expanded"  // optional: specific level
}
```

**When to use:**
- After updating an item
- After server-side processing changes an item
- When you want to refresh a detail view

**How it works:**
1. Client checks which levels it currently holds for this item
2. Client refetches those levels
3. If `level` specified, ensures that level is fresh
4. Level conversion graphs minimize redundant fetches

**Examples:**

```javascript
// Refresh whatever levels the client has
{ "op": "refresh_item", "name": "todo", "id": 42 }

// Ensure the "expanded" level is fresh
{ "op": "refresh_item", "name": "todo", "id": 42, "level": "expanded" }
```

### `invalidate`

Wrapper for multiple directives (rare, mostly for consistency).

```javascript
{
  "op": "invalidate",
  "targets": [
    { "op": "refresh_collection", "name": "todos" },
    { "op": "refresh_item", "name": "user", "id": 123 }
  ]
}
```

**When to use:**
- Rarely needed (just send multiple directives)
- For explicit grouping
- For conditional invalidation on client

### `force_reload_page`

Forces a complete page reload, discarding all client-side state.

```javascript
{
  "op": "force_reload_page",
  "hard": true  // optional: force hard reload (bypasses cache)
}
```

**When to use:**
- After critical system configuration changes that affect the entire application
- After user role/permission changes requiring complete UI reset
- After server-side schema migrations that change data structure
- When client state may be corrupted and needs emergency reset
- As an "escape hatch" for synchronization issues that can't be resolved with refresh directives

**How it works:**
- Triggers `window.location.reload()` immediately
- If `hard: true`, attempts to bypass browser cache (browser support varies)
- Respects idempotency keys to prevent reload loops
- Works in both pull (mutation response) and push (SSE) paths
- ALL clients reload, including the one that originated the directive

**Important:** This is a **highly disruptive operation** that:
- ⚠️ Loses all unsaved client-side state (form inputs, UI state, etc.)
- ⚠️ Interrupts any in-flight operations
- ⚠️ Resets all cached data
- ⚠️ May interrupt user workflows mid-task
- ⚠️ Creates a jarring user experience

**Examples:**

```javascript
// Soft reload (respects cache)
{ "op": "force_reload_page" }

// Hard reload (bypasses cache, useful after deployments)
{ "op": "force_reload_page", "hard": true }

// Scoped to specific user (via audience)
{
  "op": "force_reload_page",
  "audience": "user-123",
  "idempotency_key": "role-change-abc"
}

// System-wide update with idempotency protection
{
  "op": "force_reload_page",
  "hard": true,
  "idempotency_key": "deployment-2024-12-08-v2.1.0"
}
```

**Best practices:**
1. ✅ Always use idempotency keys to prevent reload loops
2. ✅ Use `audience` to target specific users when possible
3. ✅ Consider showing a warning message before sending (client-side)
4. ✅ Use only as a last resort when refresh directives are insufficient
5. ❌ Avoid using in response to routine CRUD operations
6. ❌ Don't use during active user workflows (e.g., form filling)

---

## Directive Flow

### Pull Path (Mutation Response)

```
┌──────┐                  ┌────────┐                  ┌────────┐
│Client│                  │ Server │                  │ Verity │
└──┬───┘                  └───┬────┘                  └───┬────┘
   │                          │                           │
   │  PUT /api/todos/42       │                           │
   ├─────────────────────────►│                           │
   │                          │                           │
   │                      UPDATE todo                     │
   │                      in database                     │
   │                          │                           │
   │  200 + directives        │                           │
   │◄─────────────────────────┤                           │
   │                          │                           │
   │  applyDirectives([...])  │                           │
   ├──────────────────────────┼──────────────────────────►│
   │                          │                           │
   │                          │                   Process directives
   │                          │                   Invalidate caches
   │                          │                   Trigger refetches
   │                          │                           │
   │  Re-render with new data │                           │
   │◄──────────────────────────────────────────────────────┤
```

### Push Path (SSE Fan-out)

```
┌────────┐     ┌────────┐     ┌────────┐
│Client A│     │ Server │     │Client B│
└───┬────┘     └───┬────┘     └───┬────┘
    │              │              │
    │ PUT /api/    │              │
    │ todos/42     │              │
    ├─────────────►│              │
    │              │              │
    │  200 + dirs  │              │
    │◄─────────────┤              │
    │              │              │
    │              │ SSE: dirs    │
    │              ├─────────────►│
    │              │  (source=A)  │
    │              │              │
    │  apply       │              │  apply
    │  (skip:      │              │  (process)
    │   source=A)  │              │
    │              │              │
    │  updated     │              │  updated
```

**Key points:**
1. Client A gets directives immediately in response
2. Server emits same directives over SSE
3. Client A ignores SSE (source matches)
4. Client B applies SSE directives
5. Both clients converge to same truth

---

## Server Implementation

### Basic Pattern

```python
# Python/Flask example
from verity.sse import emit_directives

@app.put('/api/todos/<int:todo_id>')
def update_todo(todo_id):
    # 1. Perform business logic
    todo = Todo.query.get_or_404(todo_id)
    todo.title = request.json['title']
    todo.completed = request.json['completed']
    db.session.commit()
    
    # 2. Define directives
    directives = [
        { 'op': 'refresh_item', 'name': 'todo', 'id': todo_id },
        { 'op': 'refresh_collection', 'name': 'todos' }
    ]
    
    # 3. Emit to SSE stream (for other clients)
    emit_directives(directives, source=request.headers.get('X-Client-ID'))
    
    # 4. Return to requesting client
    return {
        'todo': todo.to_dict(),
        'directives': directives
    }
```

### Advanced: Conditional Directives

```python
@app.put('/api/todos/<int:todo_id>')
def update_todo(todo_id):
    old_status = todo.status
    todo.status = request.json['status']
    db.session.commit()
    
    directives = [
        { 'op': 'refresh_item', 'name': 'todo', 'id': todo_id }
    ]
    
    # If status changed, affected collections need refresh
    if old_status != todo.status:
        directives.append({
            'op': 'refresh_collection',
            'name': 'todos',
            'params': { 'status': old_status }
        })
        directives.append({
            'op': 'refresh_collection',
            'name': 'todos',
            'params': { 'status': todo.status }
        })
    
    emit_directives(directives)
    return { 'directives': directives }
```

### Advanced: Directive Payloads

Instead of forcing a refetch, include the updated data:

```python
@app.put('/api/todos/<int:todo_id>')
def update_todo(todo_id):
    todo.completed = request.json['completed']
    db.session.commit()
    
    directives = [{
        'op': 'refresh_item',
        'name': 'todo',
        'id': todo_id,
        'result': todo.to_dict()  # ← Include updated data
    }]
    
    emit_directives(directives)
    return { 'directives': directives }
```

**How this works:**
- Verity applies the `result` payload immediately
- If client needs additional levels, it refetches only those
- Reduces network calls when server already has the data

---

## Client Implementation

### Basic: Apply Directives After Mutation

```html
<head>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
</head>

<script>
DL.init()

// Helper for mutations
async function updateTodo(id, data) {
  const res = await fetch(`/api/todos/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-ID': registry.clientId  // Tag with client ID
    },
    body: JSON.stringify(data)
  })
  
  const payload = await res.json()
  
  // Apply directives
  if (payload.directives) {
    DL.applyDirectives(payload.directives)
  }
  
  return payload
}
</script>
```

### Advanced: SSE Connection

SSE connection is automatic by default:

```javascript
DL.init({
  sse: {
    url: '/api/events',          // SSE endpoint
    audience: 'global',           // or user-specific
    withCredentials: true,        // for auth cookies
    initialRetryMs: 1000,
    maxRetryMs: 30000
  }
})

// Directives from SSE are applied automatically
// (skipping those with source === registry.clientId)
```

### Advanced: Custom Directive Source

```javascript
// Use WebSocket instead of SSE
registry.configureDirectiveSource({
  type: 'websocket',
  connect: ({ applyDirectives, clientId }) => {
    const ws = new WebSocket('wss://example.com/directives')
    
    ws.onmessage = (event) => {
      const { directives, source } = JSON.parse(event.data)
      if (source !== clientId) {
        applyDirectives(directives)
      }
    }
    
    return () => ws.close()
  }
})
```

---

## Directive Metadata

Directives can include additional metadata:

```javascript
{
  "op": "refresh_item",
  "name": "todo",
  "id": 42,
  
  // Optional metadata:
  "idempotency_key": "todo-42-update-abc123",  // Deduplication
  "timestamp": 1234567890,                     // When it happened
  "audience": "team-123",                      // Who should see it
  "source": "client-abc",                      // Who triggered it
  "seq": 42                                    // Sequence number
}
```

### Idempotency Keys

Prevents processing the same directive twice:

```javascript
// Even if this directive arrives multiple times,
// Verity processes it only once per idempotency key
{
  "op": "refresh_collection",
  "name": "todos",
  "idempotency_key": "todos-bulk-update-xyz"
}
```

### Sequence Numbers

Detects gaps in SSE stream:

```javascript
// SSE payloads include sequence numbers
{
  "type": "directives",
  "seq": 42,
  "audience": "global",
  "directives": [...]
}

// If client expects seq 42 but receives 44,
// it knows it missed directive 43
// → Triggers resync (force-refresh collections)
```

### Audiences

Scope directives to specific users/teams:

```python
# Only send to specific user
emit_directives(
    [{ 'op': 'refresh_collection', 'name': 'private_docs' }],
    audience=f'user-{user_id}'
)

# Client subscribes to their audience
registry = createRegistry({
  sse: { audience: 'user-123' }
})
```

---

## Common Patterns

### Pattern 1: Create Item

```python
@app.post('/api/todos')
def create_todo():
    todo = Todo(title=request.json['title'])
    db.session.add(todo)
    db.session.commit()
    
    return {
        'todo': todo.to_dict(),
        'directives': [
            # Refresh collection (new item added)
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
    }
```

### Pattern 2: Update Item

```python
@app.put('/api/todos/<int:todo_id>')
def update_todo(todo_id):
    todo = Todo.query.get_or_404(todo_id)
    todo.title = request.json['title']
    db.session.commit()
    
    return {
        'todo': todo.to_dict(),
        'directives': [
            # Refresh the item
            { 'op': 'refresh_item', 'name': 'todo', 'id': todo_id },
            # Refresh collection (title might affect sort order)
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
    }
```

### Pattern 3: Delete Item

```python
@app.delete('/api/todos/<int:todo_id>')
def delete_todo(todo_id):
    todo = Todo.query.get_or_404(todo_id)
    db.session.delete(todo)
    db.session.commit()
    
    return {
        'directives': [
            # Don't refresh item (it's gone!)
            # Just refresh collections
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
    }
```

### Pattern 4: Cascading Updates

```python
@app.put('/api/projects/<int:project_id>/archive')
def archive_project(project_id):
    project = Project.query.get_or_404(project_id)
    project.archived = True
    
    # Archiving affects tasks too
    for task in project.tasks:
        task.archived = True
    
    db.session.commit()
    
    directives = [
        { 'op': 'refresh_item', 'name': 'project', 'id': project_id },
        { 'op': 'refresh_collection', 'name': 'projects' }
    ]
    
    # Refresh all affected tasks
    for task in project.tasks:
        directives.append({
            'op': 'refresh_item',
            'name': 'task',
            'id': task.id
        })
    
    # And task collections
    directives.append({ 'op': 'refresh_collection', 'name': 'tasks' })
    
    return { 'directives': directives }
```

---

## Best Practices

### 1. Be Explicit

```python
# ❌ Vague
{ 'op': 'refresh_collection', 'name': 'todos' }
# (All todos? Active todos? My todos?)

# ✅ Explicit
{ 'op': 'refresh_collection', 'name': 'todos', 'params': { 'status': 'active' } }
```

### 2. Include Affected Collections

```python
# ❌ Forgot to refresh collection
@app.put('/api/todos/<int:id>')
def update_todo(id):
    # ... update todo ...
    return {
        'directives': [
            { 'op': 'refresh_item', 'name': 'todo', 'id': id }
            # Missing: refresh_collection!
        ]
    }

# ✅ Refresh both item and collection
return {
    'directives': [
        { 'op': 'refresh_item', 'name': 'todo', 'id': id },
        { 'op': 'refresh_collection', 'name': 'todos' }
    ]
}
```

### 3. Use Idempotency Keys for Important Operations

```python
import uuid

@app.post('/api/todos/bulk-complete')
def bulk_complete():
    operation_id = str(uuid.uuid4())
    # ... bulk update ...
    
    return {
        'directives': [{
            'op': 'refresh_collection',
            'name': 'todos',
            'idempotency_key': f'bulk-complete-{operation_id}'
        }]
    }
```

### 4. Consider Directive Payloads for Hot Paths

```python
# Hot path: frequent updates, want immediate feedback
@app.put('/api/todos/<int:id>/toggle')
def toggle_todo(id):
    todo.completed = not todo.completed
    db.session.commit()
    
    return {
        'directives': [{
            'op': 'refresh_item',
            'name': 'todo',
            'id': id,
            'result': todo.to_dict()  # ← Immediate update, no refetch
        }]
    }
```

---

## Testing Directives

### Unit Test: Server Emits Correct Directives

```python
def test_update_todo_emits_directives():
    response = client.put('/api/todos/1', json={'title': 'New title'})
    data = response.json
    
    assert 'directives' in data
    assert len(data['directives']) == 2
    assert data['directives'][0] == {
        'op': 'refresh_item',
        'name': 'todo',
        'id': 1
    }
    assert data['directives'][1] == {
        'op': 'refresh_collection',
        'name': 'todos'
    }
```

### Integration Test: Directives Trigger Refetch

```javascript
// In browser test (Playwright, Cypress, etc)
test('updating todo refetches collection', async ({ page }) => {
  await page.goto('/todos')
  
  // Initial state
  await expect(page.locator('[data-todo-id="1"]')).toHaveText('Buy milk')
  
  // Trigger update
  await page.click('[data-update-todo="1"]')
  
  // Directive should trigger refetch
  await expect(page.locator('[data-todo-id="1"]')).toHaveText('Buy milk - DONE')
})
```

---

## Summary

**Directives are:**
- Semantic messages from server to client
- Framework-agnostic (data intent, not DOM)
- Composable (work in responses and SSE)
- Loss-tolerant (missing directive delays, doesn't corrupt)

**Key directive types:**
- `refresh_collection` - invalidate and refetch a collection
- `refresh_item` - invalidate and refetch an item
- `invalidate` - wrapper for multiple directives

**The directive contract:**
- Server decides what changed (domain knowledge)
- Verity orchestrates refetching (data layer responsibility)
- View renders the result (presentation responsibility)

---

## Next Steps

1. Study [Levels & Conversions](levels-and-conversions.md) to understand how `refresh_item` minimizes fetches
2. Review [Concurrency Model](concurrency-model.md) to see how directives interact with in-flight requests
3. Read [Architecture](../architecture.md) for the full data flow with directives
4. Check [API Reference](../reference/directives.md) for complete directive schemas

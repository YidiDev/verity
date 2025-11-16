# Getting Started

This guide shows you how to integrate Verity into your application. We'll start with the mental model, then move to practical implementation.

---

## Understanding the Mental Model

!!! abstract "Start Here"
    Before writing code, understand these three foundational concepts.

### 1. Truth-State vs View-State

!!! tip "The Most Important Distinction"
    This is the key mental model that makes everything else make sense.

=== "Truth-State"
    **Verity Manages This**
    
    - Comes from the server
    - Multiple clients must agree on it
    - Examples: user profiles, order status, inventory
    - Cached, tracked, synchronized

=== "View-State"
    **Your Framework Manages This**
    
    - Local to one client
    - Examples: which menu is open, current tab, form drafts
    - Never leaves the browser

!!! warning "The Golden Rule"
    If it's on the server, it's truth-state. If it's only in the UI, it's view-state. **Never mix them.**

[Read the full guide →](../concepts/truth-vs-view-state.md){ .md-button }

### 2. The Three Layers

```mermaid
graph LR
    A[Server] -->|Directives| B[Verity]
    B -->|Refs| C[View]
    C -->|Mutations| A
    style A fill:#e1f5ff
    style B fill:#fff4e1
    style C fill:#f0e1ff
```

| Layer | Responsibility | What It Does |
|-------|---------------|--------------|
| **Server** | Domain logic | Owns truth-state, emits directives |
| **Verity** | Data layer | Fetches, caches, applies directives |
| **View** | Presentation | Renders, manages view-state |

[Understand the Architecture →](../architecture.md){ .md-button }

### 3. Directives Drive Updates

!!! info "Server-Authored Invalidation Contract"
    The server tells Verity what changed—not how to render it.

**A directive looks like this:**

```json hl_lines="2-4"
{
  "op": "refresh_item",  // (1)!
  "name": "todo",        // (2)!
  "id": 42               // (3)!
}
```

1. What operation: `refresh_item`, `refresh_collection`, or `invalidate`
2. Which type or collection
3. Which specific item (for `refresh_item`)

!!! success "Why Directives?"
    - Not DOM patches
    - Not field-level diffs
    - Just: "This thing changed, refetch it"
    - Decouples server from view structure

[Learn about Directives →](../concepts/directives.md){ .md-button }

---

## Installation

### Option 1: CDN (Recommended - No Build Tools)

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Alpine.js -->
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  
  <!-- Verity core -->
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.js"></script>
  
  <!-- Verity Alpine adapter -->
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/alpine.js"></script>
</head>
<body>

<div id="app">
  <!-- Your app here -->
</div>

<script>
  // Setup (see below)
  // Access via window.Verity and window.VerityAlpine
</script>

</body>
</html>
```

**For production, use minified versions:**

```html
<script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/alpine.min.js"></script>
```

### Option 2: npm (For Build Pipelines)

```bash
npm install verity-dl
```

```javascript
import { createRegistry } from 'verity-dl'
import { installAlpine } from 'verity-dl/adapters/alpine'
```

---

## Debugging with Devtools

!!! tip "Essential for Development"
    Install the devtools **before** you write any code. They're invaluable for understanding what Verity is doing.

**Add to your HTML (CDN):**

```html
<!-- Devtools CSS -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.css">

<!-- Devtools JS (load last, after Verity core) -->
<script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.js"></script>
```

**Or npm:**

```javascript
import 'verity-dl/devtools/devtools.css'
import 'verity-dl/devtools/devtools.js'
```

**Usage:**
- **`Ctrl+Shift+D`** (or `Cmd+Shift+D` on Mac) to toggle devtools
- View live truth-state in the **Truth panel**
- Watch directive/fetch events in the **Events panel**
- Monitor SSE connection in the **SSE panel**

[Complete Devtools Guide →](../reference/devtools.md){ .md-button }

!!! warning "Development Only"
    Remove devtools from production builds. Use conditional loading based on `NODE_ENV` or hostname.

---

## Step 1: Create Registry

The registry is Verity's core. It manages caching, fetching, and directives.

```html
<script>
const registry = Verity.createRegistry({
  // Optional configuration
  sse: {
    url: '/api/events',      // SSE endpoint for directives
    audience: 'global'        // or user-specific: `user-${userId}`
  },
  memory: {
    maxItemsPerType: 512,
    collectionTtlMs: 15 * 60 * 1000  // 15 minutes
  }
})
</script>
```

---

## Step 2: Register Collections (Truth-State)

Collections are lists of items from the server.

```javascript
registry.registerCollection('todos', {
  fetch: async (params = {}) => {
    const url = new URL('/api/todos', location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    
    const response = await fetch(url)
    return response.json()  // Should return { items: [...], meta: {...} }
  },
  
  stalenessMs: 60_000  // Cache for 60 seconds
})
```

**Key points:**
- `fetch` is YOUR function - call your API however you want
- Parameters enable filtering (e.g., `{ status: 'active' }`)
- Verity caches each parameter combination separately

---

## Step 3: Register Types (Individual Items)

Types define how to fetch individual records.

```javascript
registry.registerType('todo', {
  // Default level
  fetch: async ({ id }) => {
    const response = await fetch(`/api/todos/${id}`)
    return response.json()
  },
  
  // Optional: Additional detail levels
  levels: {
    detailed: {
      fetch: async ({ id }) => {
        const response = await fetch(`/api/todos/${id}?level=detailed`)
        return response.json()
      },
      checkIfExists: (obj) => 'description' in obj && 'assignee' in obj
    }
  },
  
  stalenessMs: 5 * 60 * 1000  // Cache for 5 minutes
})
```

**About levels:**
- Use levels for different detail amounts (list vs detail view)
- Conversion graphs minimize refetching
- [Learn more about Levels →](../concepts/levels-and-conversions.md)

---

## Step 4: Connect to Your Framework

### Alpine.js

```html
<head>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/alpine.min.js"></script>
</head>

<script>
const registry = Verity.createRegistry()
// ... register collections and types ...

VerityAlpine.install(window.Alpine, { registry })
</script>

<!-- Now use in templates -->
<div x-data="verity.collection('todos')">
  <template x-if="state.loading">
    <p>Loading...</p>
  </template>
  
  <template x-for="todo in state.items" :key="todo.id">
    <div x-text="todo.title"></div>
  </template>
</div>
```

### React

```javascript
import { createRegistry } from 'verity-dl'
import { useCollection, useItem } from 'verity-dl/adapters/react'

// Setup registry (do this once, at app root)
const registry = createRegistry()
// ... register collections and types ...

// In components
function TodoList() {
  const todos = useCollection('todos')
  
  if (todos.state.loading) return <p>Loading...</p>
  
  return (
    <ul>
      {todos.state.items.map(todo => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  )
}
```

### Vue

```javascript
import { createRegistry } from 'verity-dl'
import { useCollection, useItem } from 'verity-dl/adapters/vue'

// Setup registry (in main.js)
const registry = createRegistry()
// ... register collections and types ...

// In components
export default {
  setup() {
    const todos = useCollection('todos')
    
    return { todos }
  }
}
```

---

## Step 5: Handle Mutations

### Frontend: Trigger Mutation + Apply Directives

```html
<script>
async function completeTodo(id) {
  // Show honest loading state
  isCompleting = true
  
  const response = await fetch(`/api/todos/${id}/complete`, {
    method: 'PUT',
    headers: {
      'X-Client-ID': registry.clientId  // Tag with client ID
    }
  })
  
  const payload = await response.json()
  
  // Apply directives from server
  if (payload.directives) {
    await registry.applyDirectives(payload.directives)
  }
  
  isCompleting = false
}
</script>
```

### Backend: Return Directives

```python
# Python/Flask example
@app.put('/api/todos/<int:todo_id>/complete')
def complete_todo(todo_id):
    # 1. Update database
    todo = Todo.query.get_or_404(todo_id)
    todo.completed = True
    db.session.commit()
    
    # 2. Define directives
    directives = [
        {
            'op': 'refresh_item',
            'name': 'todo',
            'id': todo_id
        },
        {
            'op': 'refresh_collection',
            'name': 'todos'
        }
    ]
    
    # 3. Emit to SSE (for other clients)
    emit_directives(directives, source=request.headers.get('X-Client-ID'))
    
    # 4. Return to requesting client
    return {
        'todo': todo.to_dict(),
        'directives': directives
    }
```

**Key points:**
- Server decides what changed (it has the domain knowledge)
- Verity orchestrates refetching (it knows what's cached)
- SSE broadcasts keep other clients in sync automatically

---

## Complete Example: Todo App

### HTML

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Alpine.js -->
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  
  <!-- Verity -->
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/alpine.min.js"></script>
</head>
<body>

<!-- TRUTH-STATE: Managed by Verity -->
<div x-data="{
  todos: $verity.collection('todos'),
  
  // VIEW-STATE: Managed by Alpine
  filter: 'all',
  isAdding: false,
  newTodoText: ''
}">
  
  <!-- Filter tabs (view-state) -->
  <div>
    <button @click="filter = 'all'" :class="{ active: filter === 'all' }">All</button>
    <button @click="filter = 'active'" :class="{ active: filter === 'active' }">Active</button>
    <button @click="filter = 'completed'" :class="{ active: filter === 'completed' }">Done</button>
  </div>
  
  <!-- Todo list (truth-state) -->
  <template x-if="todos.state.loading">
    <p>Loading...</p>
  </template>
  
  <ul>
    <template x-for="todo in todos.state.items" :key="todo.id">
      <li>
        <input type="checkbox" :checked="todo.completed" @change="toggleTodo(todo.id)">
        <span x-text="todo.title"></span>
      </li>
    </template>
  </ul>
</div>

<script>
const registry = Verity.createRegistry()

registry.registerCollection('todos', {
  fetch: () => fetch('/api/todos').then(r => r.json())
})

registry.registerType('todo', {
  fetch: ({ id }) => fetch(`/api/todos/${id}`).then(r => r.json())
})

VerityAlpine.install(window.Alpine, { registry })

// Mutation helper
window.toggleTodo = async function(id) {
  const res = await fetch(`/api/todos/${id}/toggle`, {
    method: 'PUT',
    headers: { 'X-Client-ID': registry.clientId }
  })
  
  const { directives } = await res.json()
  await registry.applyDirectives(directives)
}
</script>

</body>
</html>
```

---

## Common Patterns

### Pattern 1: Parameterized Collections

```javascript
// Register with parameter support
registry.registerCollection('todos', {
  fetch: async (params = {}) => {
    const url = new URL('/api/todos', location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    return fetch(url).then(r => r.json())
  }
})

// Use with parameters
<div x-data="{
  activeTodos: $verity.collection('todos', { status: 'active' }),
  completedTodos: $verity.collection('todos', { status: 'completed' })
}">
```

### Pattern 2: Silent Fetches for Lists

```html
<!-- Silent: no spinner, shows skeleton if no data -->
<template x-for="id in todoIds">
  <div x-data="{ todo: $verity.item('todo', id, null, { silent: true }) }">
    <template x-if="!todo.data">
      <div class="skeleton"></div>
    </template>
    <template x-if="todo.data">
      <span x-text="todo.data.title"></span>
    </template>
  </div>
</template>
```

### Pattern 3: Detail Levels

```javascript
// List view: default level (id, title, status)
const todo = registry.item('todo', 42)

// Detail view: detailed level (adds description, assignee, comments)
const todo = registry.item('todo', 42, 'detailed')
```

---

## Next Steps

**Core Concepts:**
- [Truth-State vs View-State](../concepts/truth-vs-view-state.md) - Master the key distinction
- [Directives](../concepts/directives.md) - Understand the invalidation contract
- [Levels & Conversions](../concepts/levels-and-conversions.md) - Optimize fetching

**Guides:**
- [State Model](state-model.md) - Deep dive on caching
- [UX Patterns](ux-patterns.md) - Honest loading states

**Examples:**
- [Browse Examples](../examples.md) - Full applications to study

**API Reference:**
- [Core API](../reference/core.md) - Complete API surface
- [Framework Adapters](../reference/adapters.md) - Alpine, React, Vue, Svelte
- [Devtools](../reference/devtools.md) - Visual debugging and inspection

# Migrating from TanStack Query

> Step-by-step guide to migrating from TanStack Query (React Query) to Verity

This guide helps you transition from TanStack Query to Verity while understanding the philosophical differences.

---

## Why Migrate?

!!! question "When Does Migration Make Sense?"
    Consider Verity if you're experiencing:
    
    - 🔄 Optimistic update rollback complexity
    - 🐛 Manual invalidation bugs
    - 📱 Need to support multiple clients (web + mobile)
    - 🔁 Real-time sync challenges
    - 🤔 Confusion about what data is "real"

=== "What You'll Gain"
    - ✅ No optimistic updates (honest loading states)
    - ✅ Server-authored invalidation contract
    - ✅ Multi-client sync via SSE
    - ✅ Level conversion planning
    - ✅ Explicit truth-state boundary

=== "What You'll Miss"
    - ❌ Optimistic UI (by design)
    - ❌ Infinite queries helper
    - ❌ Mature DevTools (Verity's are simpler)
    - ❌ Large community size

---

## Conceptual Mapping

### Queries → Collections & Types

=== "TanStack Query"
    ```javascript
    // List query
    const { data, isLoading } = useQuery({
      queryKey: ['todos'],
      queryFn: () => fetch('/api/todos').then(r => r.json())
    })
    
    // Detail query
    const { data, isLoading } = useQuery({
      queryKey: ['todo', id],
      queryFn: () => fetch(`/api/todos/${id}`).then(r => r.json())
    })
    ```

=== "Verity"
    ```javascript
    // Register once (at app root)
    DL.createCollection('todos', {
      fetch: () => fetch('/api/todos').then(r => r.json())
    })
    
    DL.createType('todo', {
      fetch: ({ id }) => fetch(`/api/todos/${id}`).then(r => r.json())
    })
    
    // Use in components
    const todos = useCollection('todos')
    const todo = useItem('todo', id)
    ```

!!! tip "Key Difference"
    Verity: Define fetchers **once**, use everywhere. TanStack Query: Define per-use.

### Mutations → Directives

=== "TanStack Query"
    ```javascript
    const mutation = useMutation({
      mutationFn: (data) => fetch('/api/todos', {
        method: 'POST',
        body: JSON.stringify(data)
      }),
      onSuccess: () => {
        // Manual invalidation (you decide)
        queryClient.invalidateQueries(['todos'])
        queryClient.invalidateQueries(['stats'])
        // Did I miss any? 🤷
      }
    })
    ```

=== "Verity"
    ```javascript
    async function createTodo(data) {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Client-ID': registry.clientId 
        },
        body: JSON.stringify(data)
      })
      
      const payload = await res.json()
      // Server decides what changed
      // payload.directives = [
      //   { op: 'refresh_collection', name: 'todos' },
      //   { op: 'refresh_collection', name: 'stats' }
      // ]
      
      DL.applyDirectives(payload.directives)
    }
    ```

!!! success "Key Difference"
    Verity: Server decides invalidation. TanStack Query: You decide.

### Optimistic Updates → Honest Loading

=== "TanStack Query Pattern"
    ```javascript
    const mutation = useMutation({
      mutationFn: updateTodo,
      onMutate: async (newTodo) => {
        // Cancel outgoing refetches
        await queryClient.cancelQueries(['todos'])
        
        // Snapshot previous value
        const previous = queryClient.getQueryData(['todos'])
        
        // Optimistically update
        queryClient.setQueryData(['todos'], old => 
          old.map(t => t.id === newTodo.id ? newTodo : t)
        )
        
        return { previous }
      },
      onError: (err, newTodo, context) => {
        // Rollback on error
        queryClient.setQueryData(['todos'], context.previous)
      },
      onSettled: () => {
        queryClient.invalidateQueries(['todos'])
      }
    })
    ```
    
    **Problems:**
    
    - Complex rollback logic
    - Flicker on error
    - Race conditions
    - Cache manipulation

=== "Verity Pattern"
    ```javascript
    async function updateTodo(id, data) {
      // Show honest loading state
      isUpdating = true
      
      try {
        const res = await fetch(`/api/todos/${id}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'X-Client-ID': registry.clientId
          },
          body: JSON.stringify(data)
        })
        
        const { directives } = await res.json()
        DL.applyDirectives(directives)
      } finally {
        isUpdating = false
      }
    }
    ```
    
    **Benefits:**
    
    - No rollback needed
    - No flicker
    - Server confirms truth
    - Simple logic

!!! warning "Philosophy Shift"
    Verity: Show loading states honestly. TanStack Query: Speculate and rollback.

---

## Step-by-Step Migration

### Step 1: Install Verity

=== "Alongside TanStack Query"
    ```bash
    # Keep both during migration
    npm install verity-dl
    ```
    
    ```html
    <head>
      <!-- Verity -->
      <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/react.min.js"></script>
    </head>
    ```

=== "Replace TanStack Query"
    ```bash
    npm uninstall @tanstack/react-query
    npm install verity-dl
    ```

### Step 2: Set Up Registry

Create `src/verity.js`:

```javascript
import { init, createType, createCollection } from 'verity-dl'

export DL.init({
  sse: {
    url: '/api/events',
    audience: 'global'
  },
  memory: {
    maxItemsPerType: 1000,
    itemTtlMs: 15 * 60 * 1000
  }
})

// Register all your types and collections here
```

### Step 3: Register Collections

=== "Before (TanStack Query)"
    ```javascript
    // Defined per-component
    function TodoList() {
      const { data: todos } = useQuery({
        queryKey: ['todos'],
        queryFn: fetchTodos
      })
    }
    
    function OtherComponent() {
      const { data: todos } = useQuery({
        queryKey: ['todos'],  // Same key, repeated definition
        queryFn: fetchTodos
      })
    }
    ```

=== "After (Verity)"
    ```javascript
    // In src/verity.js (once)
    DL.createCollection('todos', {
      fetch: () => fetch('/api/todos').then(r => r.json()),
      stalenessMs: 60_000
    })
    
    // In components (use anywhere)
    function TodoList() {
      const todos = useCollection('todos')
    }
    
    function OtherComponent() {
      const todos = useCollection('todos')  // Same instance
    }
    ```

### Step 4: Register Types

=== "Before (TanStack Query)"
    ```javascript
    const { data: todo } = useQuery({
      queryKey: ['todo', id],
      queryFn: () => fetch(`/api/todos/${id}`).then(r => r.json())
    })
    ```

=== "After (Verity)"
    ```javascript
    // In src/verity.js
    DL.createType('todo', {
      fetch: ({ id }) => fetch(`/api/todos/${id}`).then(r => r.json()),
      stalenessMs: 5 * 60 * 1000
    })
    
    // In component
    const todo = useItem('todo', id)
    ```

### Step 5: Convert Parameterized Queries

=== "Before (TanStack Query)"
    ```javascript
    const { data } = useQuery({
      queryKey: ['todos', { status: 'active' }],
      queryFn: () => fetch(`/api/todos?status=active`).then(r => r.json())
    })
    ```

=== "After (Verity)"
    ```javascript
    // In src/verity.js
    DL.createCollection('todos', {
      fetch: async (params = {}) => {
        const url = new URL('/api/todos', location.origin)
        if (params.status) url.searchParams.set('status', params.status)
        return fetch(url).then(r => r.json())
      }
    })
    
    // In component
    const todos = useCollection('todos', { status: 'active' })
    ```

### Step 6: Update Mutations

=== "Before (TanStack Query)"
    ```javascript
    const createMutation = useMutation({
      mutationFn: (data) => fetch('/api/todos', {
        method: 'POST',
        body: JSON.stringify(data)
      }),
      onSuccess: () => {
        queryClient.invalidateQueries(['todos'])
      }
    })
    
    const handleCreate = () => {
      createMutation.mutate({ title: 'New todo' })
    }
    ```

=== "After (Verity)"
    ```javascript
    const [isCreating, setIsCreating] = useState(false)
    
    const handleCreate = async () => {
      setIsCreating(true)
      
      try {
        const res = await fetch('/api/todos', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-ID': registry.clientId
          },
          body: JSON.stringify({ title: 'New todo' })
        })
        
        const { directives } = await res.json()
        DL.applyDirectives(directives)
      } finally {
        setIsCreating(false)
      }
    }
    ```

### Step 7: Update Backend to Return Directives

=== "Before"
    ```python
    @app.post('/api/todos')
    def create_todo():
        todo = Todo(title=request.json['title'])
        db.session.add(todo)
        db.session.commit()
        
        return { 'todo': todo.to_dict() }
    ```

=== "After"
    ```python
    @app.post('/api/todos')
    def create_todo():
        todo = Todo(title=request.json['title'])
        db.session.add(todo)
        db.session.commit()
        
        directives = [
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
        
        emit_directives(directives, source=request.headers.get('X-Client-ID'))
        
        return {
            'todo': todo.to_dict(),
            'directives': directives
        }
    ```

### Step 8: Set Up SSE Endpoint

```python
from flask import Response
import json
import time

subscribers = []

def emit_directives(directives, source=None):
    """Emit directives to all SSE subscribers"""
    payload = {
        'type': 'directives',
        'directives': directives,
        'source': source,
        'seq': get_next_sequence()
    }
    
    for subscriber in subscribers:
        subscriber.put(json.dumps(payload))

@app.get('/api/events')
def sse_stream():
    """SSE endpoint for real-time directive broadcast"""
    def generate():
        import queue
        q = queue.Queue()
        subscribers.append(q)
        
        try:
            # Send keepalive every 30s
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield f"data: {msg}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            subscribers.remove(q)
    
    return Response(generate(), mimetype='text/event-stream')
```

---

## Common Patterns

### Pattern: Dependent Queries

=== "TanStack Query"
    ```javascript
    const { data: user } = useQuery({
      queryKey: ['user', userId],
      queryFn: () => fetchUser(userId)
    })
    
    const { data: posts } = useQuery({
      queryKey: ['posts', user?.id],
      queryFn: () => fetchUserPosts(user.id),
      enabled: !!user
    })
    ```

=== "Verity"
    ```javascript
    const user = useItem('user', userId)
    
    // Conditional fetch
    const posts = useCollection('posts', 
      user.data ? { userId: user.data.id } : null
    )
    
    // Or use levels
    const userWithPosts = useItem('user', userId, 'withPosts')
    ```

### Pattern: Infinite Queries

=== "TanStack Query"
    ```javascript
    const {
      data,
      fetchNextPage,
      hasNextPage
    } = useInfiniteQuery({
      queryKey: ['todos'],
      queryFn: ({ pageParam = 1 }) => fetchTodos(pageParam),
      getNextPageParam: (lastPage) => lastPage.nextPage
    })
    ```

=== "Verity"
    ```javascript
    // Use parameterized collections
    const [page, setPage] = useState(1)
    const [allItems, setAllItems] = useState([])
    
    const todos = useCollection('todos', { page })
    
    useEffect(() => {
      if (todos.state.items.length) {
        setAllItems(prev => [...prev, ...todos.state.items])
      }
    }, [todos.state.items])
    
    const loadMore = () => {
      if (todos.state.meta.hasMore) setPage(p => p + 1)
    }
    ```

!!! tip "Alternative"
    For true infinite scroll, consider loading all data at once or using cursor-based pagination.

### Pattern: Prefetching

=== "TanStack Query"
    ```javascript
    const queryClient = useQueryClient()
    
    const prefetch = () => {
      queryClient.prefetchQuery({
        queryKey: ['todo', id],
        queryFn: () => fetchTodo(id)
      })
    }
    
    <Link onMouseEnter={prefetch} />
    ```

=== "Verity"
    ```javascript
    const prefetch = () => {
      DL.fetchItem('todo', id)  // Silent fetch starts
    }
    
    <Link onMouseEnter={prefetch} />
    ```

---

## Troubleshooting

!!! warning "Common Migration Issues"

### Issue: Flicker During Migration

**Problem:** Both libraries refetching simultaneously

**Solution:** Migrate route-by-route or component-by-component

```javascript
// Wrap in feature flag
const USE_VERITY = true

function TodoList() {
  if (USE_VERITY) {
    const todos = useCollection('todos')
    // Verity rendering
  } else {
    const { data: todos } = useQuery(['todos'], fetchTodos)
    // TanStack Query rendering
  }
}
```

### Issue: Missing Invalidations

**Problem:** Forgot to add directives to backend

**Solution:** Audit all mutations

```python
# Add to all mutations
return {
  'data': result,
  'directives': [...]  # ← Don't forget!
}
```

### Issue: Optimistic UI Feels Slow

**Problem:** Adjustment period from instant → honest

**Solution:** 

1. Make servers respond faster
2. Use good skeletons
3. Show subtle spinners
4. Trust builds over time

---

## Complete Example

=== "Before (TanStack Query)"
    ```javascript
    import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
    
    function TodoApp() {
      const queryClient = useQueryClient()
      
      const { data: todos, isLoading } = useQuery({
        queryKey: ['todos'],
        queryFn: () => fetch('/api/todos').then(r => r.json())
      })
      
      const createMutation = useMutation({
        mutationFn: (data) => fetch('/api/todos', {
          method: 'POST',
          body: JSON.stringify(data)
        }),
        onMutate: async (newTodo) => {
          await queryClient.cancelQueries(['todos'])
          const previous = queryClient.getQueryData(['todos'])
          queryClient.setQueryData(['todos'], old => [...old, newTodo])
          return { previous }
        },
        onError: (err, newTodo, context) => {
          queryClient.setQueryData(['todos'], context.previous)
        },
        onSettled: () => {
          queryClient.invalidateQueries(['todos'])
        }
      })
      
      return (
        <div>
          {isLoading ? <p>Loading...</p> : (
            <ul>
              {todos.map(todo => <li key={todo.id}>{todo.title}</li>)}
            </ul>
          )}
          <button onClick={() => createMutation.mutate({ title: 'New' })}>
            Add Todo
          </button>
        </div>
      )
    }
    ```

=== "After (Verity)"
    ```javascript
    import { useCollection } from 'verity-dl/adapters/react'
    import { registry } from './verity'
    
    function TodoApp() {
      const todos = useCollection('todos')
      const [isCreating, setIsCreating] = useState(false)
      
      const createTodo = async () => {
        setIsCreating(true)
        
        try {
          const res = await fetch('/api/todos', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Client-ID': registry.clientId
            },
            body: JSON.stringify({ title: 'New' })
          })
          
          const { directives } = await res.json()
          DL.applyDirectives(directives)
        } finally {
          setIsCreating(false)
        }
      }
      
      return (
        <div>
          {todos.state.loading ? <p>Loading...</p> : (
            <ul>
              {todos.state.items.map(todo => <li key={todo.id}>{todo.title}</li>)}
            </ul>
          )}
          <button onClick={createTodo} disabled={isCreating}>
            {isCreating ? 'Adding...' : 'Add Todo'}
          </button>
        </div>
      )
    }
    ```

---

## Checklist

!!! success "Migration Checklist"
    
    - [ ] Install Verity
    - [ ] Create registry setup file
    - [ ] Register all collections
    - [ ] Register all types
    - [ ] Convert queries to useCollection/useItem
    - [ ] Convert mutations to directive-based
    - [ ] Update backend to return directives
    - [ ] Set up SSE endpoint
    - [ ] Remove optimistic updates
    - [ ] Test multi-client sync
    - [ ] Remove TanStack Query

---

## Next Steps

<div class="grid" markdown>

[Philosophy Deep Dive :material-book:](../philosophy.md){ .md-button }
[Directives Guide :material-arrow-right-bold:](../concepts/directives.md){ .md-button }
[Examples :material-code-braces:](../examples.md){ .md-button }

</div>

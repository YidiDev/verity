# Migrating from Apollo Client

> Step-by-step guide to migrating from Apollo Client to Verity

This guide helps you transition from Apollo Client to Verity while optionally keeping your GraphQL backend.

---

## Why Migrate?

!!! question "When Does Migration Make Sense?"
    Consider Verity if you're experiencing:
    
    - 🔄 GraphQL subscription complexity
    - 🐛 Cache normalization bugs
    - 📱 Need simpler multi-client sync
    - 🤔 Optimistic update rollback issues
    - 💰 Apollo Client bundle size concerns

=== "What You'll Gain"
    - ✅ Simpler mental model (no normalized cache)
    - ✅ Server-authored invalidation
    - ✅ Built-in SSE for real-time (simpler than subscriptions)
    - ✅ Smaller bundle size
    - ✅ Framework flexibility
    - ✅ No optimistic updates (honest UX)

=== "What You'll Miss"
    - ❌ Normalized cache (by design)
    - ❌ Fragment composition
    - ❌ Apollo DevTools
    - ❌ Automatic cache updates from mutations
    - ❌ Large Apollo ecosystem

=== "GraphQL Note"
    !!! info "You Can Keep GraphQL!"
        Verity works with **any** backend transport. Your fetchers can call GraphQL queries. You just won't use Apollo's cache—Verity's cache works differently.

---

## Conceptual Mapping

### Queries → Collections & Types

=== "Apollo Client"
    ```javascript
    import { useQuery, gql } from '@apollo/client'
    
    const GET_TODOS = gql`
      query GetTodos {
        todos {
          id
          title
          completed
        }
      }
    `
    
    function TodoList() {
      const { data, loading } = useQuery(GET_TODOS)
      
      return (
        <ul>
          {data?.todos.map(todo => <li key={todo.id}>{todo.title}</li>)}
        </ul>
      )
    }
    ```

=== "Verity (with GraphQL)"
    ```javascript
    import { useCollection } from 'verity-dl/adapters/react'
    
    // In registry setup
    DL.createCollection('todos', {
      fetch: async () => {
        const res = await fetch('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `
              query GetTodos {
                todos {
                  id
                  title
                  completed
                }
              }
            `
          })
        })
        const { data } = await res.json()
        return { items: data.todos }
      }
    })
    
    // In component
    function TodoList() {
      const todos = useCollection('todos')
      
      return (
        <ul>
          {todos.state.items.map(todo => <li key={todo.id}>{todo.title}</li>)}
        </ul>
      )
    }
    ```

=== "Verity (REST)"
    ```javascript
    // Or switch to REST (simpler)
    DL.createCollection('todos', {
      fetch: () => fetch('/api/todos').then(r => r.json())
    })
    ```

!!! tip "GraphQL is Optional"
    Migration is a good time to evaluate if you still need GraphQL. If you're not using fragments, unions, or complex nested queries, REST might be simpler.

### Fragments → Levels

=== "Apollo Client"
    ```javascript
    const TODO_SUMMARY = gql`
      fragment TodoSummary on Todo {
        id
        title
        completed
      }
    `
    
    const TODO_DETAIL = gql`
      fragment TodoDetail on Todo {
        ...TodoSummary
        description
        assignee {
          name
          avatar
        }
        comments {
          text
          author
        }
      }
    `
    ```

=== "Verity Levels"
    ```javascript
    DL.createType('todo', {
      // Default level (summary)
      fetch: async ({ id }) => {
        const res = await fetch(`/api/todos/${id}`)
        return res.json()
      },
      
      levels: {
        detailed: {
          fetch: async ({ id }) => {
            const res = await fetch(`/api/todos/${id}?detailed=true`)
            return res.json()
          },
          checkIfExists: (obj) => 
            'description' in obj && 'assignee' in obj && 'comments' in obj,
          levelConversionMap: {
            null: true  // detailed includes summary
          }
        }
      }
    })
    ```

!!! success "Simpler Model"
    Verity: Explicit levels. Apollo: Fragment composition + normalized cache.

### Mutations → Directives

=== "Apollo Client"
    ```javascript
    const [updateTodo] = useMutation(gql`
      mutation UpdateTodo($id: ID!, $completed: Boolean!) {
        updateTodo(id: $id, completed: $completed) {
          id
          completed
        }
      }
    `, {
      // Option 1: Optimistic response
      optimisticResponse: {
        updateTodo: {
          __typename: 'Todo',
          id: todoId,
          completed: !todo.completed
        }
      },
      // Option 2: Update cache manually
      update(cache, { data: { updateTodo } }) {
        cache.modify({
          id: cache.identify(updateTodo),
          fields: {
            completed() { return updateTodo.completed }
          }
        })
      },
      // Option 3: Refetch queries
      refetchQueries: [{ query: GET_TODOS }]
    })
    ```
    
    **Problems:**
    
    - Three different cache update strategies
    - Optimistic updates require rollback logic
    - Manual cache updates are error-prone
    - Refetching is inefficient

=== "Verity"
    ```javascript
    async function updateTodo(id, completed) {
      const res = await fetch(`/api/todos/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-ID': registry.clientId
        },
        body: JSON.stringify({ completed })
      })
      
      const { directives } = await res.json()
      // Server returned:
      // [
      //   { op: 'refresh_item', name: 'todo', id: 42 },
      //   { op: 'refresh_collection', name: 'todos' }
      // ]
      
      DL.applyDirectives(directives)
    }
    ```
    
    **Benefits:**
    
    - One strategy: server decides
    - No optimistic updates
    - No manual cache manipulation
    - Minimal refetching (only what changed)

### Subscriptions → SSE

=== "Apollo Client"
    ```javascript
    const { data } = useSubscription(gql`
      subscription OnTodoUpdated {
        todoUpdated {
          id
          title
          completed
        }
      }
    `)
    
    // Requires:
    // - WebSocket transport
    // - Subscription server setup
    // - Complex reconnection logic
    // - Manual cache updates
    ```

=== "Verity SSE"
    ```javascript
    // Setup (once)
    DL.init({
      sse: {
        url: '/api/events',
        audience: 'global'
      }
    })
    
    // Server-side (Python/Flask example)
    @app.put('/api/todos/<int:id>')
    def update_todo(id):
        # ... update database ...
        
        directives = [
            { 'op': 'refresh_item', 'name': 'todo', 'id': id },
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
        
        emit_directives(directives)
        return { 'directives': directives }
    
    # SSE endpoint
    @app.get('/api/events')
    def sse_stream():
        # Stream directives to all clients
        # (Much simpler than WebSocket subscriptions)
    ```
    
    **Benefits:**
    
    - Simpler protocol (HTTP)
    - Auto-reconnection built-in
    - Works through most proxies
    - Directives are transport-agnostic

---

## Step-by-Step Migration

### Step 1: Audit Your Apollo Usage

!!! info "Understand What You're Using"
    Before migrating, audit your Apollo features:

**Check if you're using:**

- [ ] Normalized cache
- [ ] Fragment composition
- [ ] Optimistic updates
- [ ] Subscriptions
- [ ] Local state management
- [ ] Cache policies
- [ ] Type policies

=== "Heavy Apollo Usage"
    If you're using many of these features, migration will be more work. Consider:
    
    - Gradual migration (page by page)
    - Keeping Apollo for complex queries
    - Simplifying data patterns first

=== "Light Apollo Usage"
    If you're mostly doing simple queries/mutations, migration is straightforward:
    
    - Most queries → `registerCollection` or `registerType`
    - Most mutations → directive-based
    - Subscriptions → SSE

### Step 2: Install Verity

```bash
# Keep both during migration
npm install verity-dl

# Or via CDN
```

```html
<head>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/react.min.js"></script>
</head>
```

### Step 3: Create Registry

```javascript
// src/verity.js
import { init, createType, createCollection } from 'verity-dl'

export DL.init({
  sse: {
    url: '/api/events',
    audience: 'global'
  }
})
```

### Step 4: Convert Queries

=== "Simple List Query"
    **Before (Apollo):**
    ```javascript
    const GET_TODOS = gql`
      query GetTodos {
        todos {
          id
          title
          completed
        }
      }
    `
    
    const { data, loading } = useQuery(GET_TODOS)
    ```
    
    **After (Verity + GraphQL):**
    ```javascript
    // Registry setup
    DL.createCollection('todos', {
      fetch: async () => {
        const res = await fetch('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query GetTodos { todos { id title completed } }`
          })
        })
        const { data } = await res.json()
        return { items: data.todos }
      }
    })
    
    // Component
    const todos = useCollection('todos')
    ```
    
    **Or switch to REST:**
    ```javascript
    DL.createCollection('todos', {
      fetch: () => fetch('/api/todos').then(r => r.json())
    })
    ```

=== "Parameterized Query"
    **Before (Apollo):**
    ```javascript
    const GET_TODOS = gql`
      query GetTodos($status: String) {
        todos(status: $status) {
          id
          title
        }
      }
    `
    
    const { data } = useQuery(GET_TODOS, {
      variables: { status: 'active' }
    })
    ```
    
    **After (Verity):**
    ```javascript
    DL.createCollection('todos', {
      fetch: async (params = {}) => {
        const url = new URL('/api/todos', location.origin)
        if (params.status) url.searchParams.set('status', params.status)
        return fetch(url).then(r => r.json())
      }
    })
    
    const todos = useCollection('todos', { status: 'active' })
    ```

=== "Detail Query"
    **Before (Apollo):**
    ```javascript
    const GET_TODO = gql`
      query GetTodo($id: ID!) {
        todo(id: $id) {
          id
          title
          description
          assignee { name }
        }
      }
    `
    
    const { data } = useQuery(GET_TODO, {
      variables: { id: todoId }
    })
    ```
    
    **After (Verity):**
    ```javascript
    DL.createType('todo', {
      fetch: ({ id }) => fetch(`/api/todos/${id}`).then(r => r.json())
    })
    
    const todo = useItem('todo', todoId)
    ```

### Step 5: Convert Mutations

=== "Before (Apollo)"
    ```javascript
    const [updateTodo, { loading }] = useMutation(gql`
      mutation UpdateTodo($id: ID!, $data: TodoInput!) {
        updateTodo(id: $id, data: $data) {
          id
          title
          completed
        }
      }
    `, {
      optimisticResponse: {
        updateTodo: {
          __typename: 'Todo',
          id: todoId,
          ...data
        }
      },
      update(cache, { data: { updateTodo } }) {
        cache.modify({
          fields: {
            todos(existing = []) {
              return existing.map(todo =>
                todo.id === updateTodo.id ? updateTodo : todo
              )
            }
          }
        })
      }
    })
    
    const handleUpdate = () => {
      updateTodo({
        variables: {
          id: todoId,
          data: { completed: true }
        }
      })
    }
    ```

=== "After (Verity)"
    ```javascript
    const [isUpdating, setIsUpdating] = useState(false)
    
    const handleUpdate = async () => {
      setIsUpdating(true)
      
      try {
        const res = await fetch(`/api/todos/${todoId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-ID': registry.clientId
          },
          body: JSON.stringify({ completed: true })
        })
        
        const { directives } = await res.json()
        DL.applyDirectives(directives)
      } finally {
        setIsUpdating(false)
      }
    }
    ```

### Step 6: Replace Subscriptions with SSE

=== "Before (Apollo Subscriptions)"
    **Client:**
    ```javascript
    import { useSubscription } from '@apollo/client'
    
    const TODO_UPDATED = gql`
      subscription OnTodoUpdated {
        todoUpdated {
          id
          title
          completed
        }
      }
    `
    
    function TodoList() {
      const { data: subscriptionData } = useSubscription(TODO_UPDATED)
      
      // Manually update cache when subscription fires
      useEffect(() => {
        if (subscriptionData) {
          // Complex cache update logic
        }
      }, [subscriptionData])
    }
    ```
    
    **Server (requires WebSocket server):**
    ```javascript
    const { PubSub } = require('graphql-subscriptions')
    const pubsub = new PubSub()
    
    const resolvers = {
      Mutation: {
        updateTodo: async (_, { id, data }) => {
          const todo = await updateTodoInDb(id, data)
          pubsub.publish('TODO_UPDATED', { todoUpdated: todo })
          return todo
        }
      },
      Subscription: {
        todoUpdated: {
          subscribe: () => pubsub.asyncIterator(['TODO_UPDATED'])
        }
      }
    }
    ```

=== "After (Verity SSE)"
    **Client (auto-configured):**
    ```javascript
    // Just configure once in registry
    DL.init({
      sse: { url: '/api/events' }
    })
    
    // That's it! SSE handles all updates automatically
    ```
    
    **Server (much simpler):**
    ```python
    from flask import Response
    import json
    
    subscribers = []
    
    def emit_directives(directives):
        payload = json.dumps({
            'type': 'directives',
            'directives': directives
        })
        for subscriber in subscribers:
            subscriber.put(payload)
    
    @app.get('/api/events')
    def sse_stream():
        import queue
        q = queue.Queue()
        subscribers.append(q)
        
        def generate():
            try:
                while True:
                    msg = q.get(timeout=30)
                    yield f"data: {msg}\n\n"
            except queue.Empty:
                yield ": keepalive\n\n"
            finally:
                subscribers.remove(q)
        
        return Response(generate(), mimetype='text/event-stream')
    
    @app.put('/api/todos/<int:id>')
    def update_todo(id):
        # Update database
        todo = update_in_db(id, request.json)
        
        # Emit directives
        directives = [
            { 'op': 'refresh_item', 'name': 'todo', 'id': id },
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
        emit_directives(directives)
        
        return { 'todo': todo.to_dict(), 'directives': directives }
    ```

!!! success "Simplicity Win"
    No WebSocket server, no subscription resolvers, no manual cache updates. Just emit directives.

### Step 7: Remove Normalized Cache Dependencies

Apollo's normalized cache is powerful but complex. Verity uses a simpler model.

=== "Apollo Pattern"
    ```javascript
    // Reading from cache
    const todo = client.readFragment({
      id: cache.identify({ __typename: 'Todo', id: todoId }),
      fragment: TODO_FRAGMENT
    })
    
    // Writing to cache
    client.writeFragment({
      id: cache.identify({ __typename: 'Todo', id: todoId }),
      fragment: TODO_FRAGMENT,
      data: { ...todo, completed: true }
    })
    
    // Cache policies
    const cache = new InMemoryCache({
      typePolicies: {
        Todo: {
          keyFields: ['id'],
          fields: {
            title: {
              merge(existing, incoming) {
                return incoming
              }
            }
          }
        }
      }
    })
    ```

=== "Verity Pattern"
    ```javascript
    // Just use the API
    const todo = DL.fetchItem('todo', todoId)
    
    // No manual cache writes
    // Server directives handle updates
    
    // No type policies needed
    // Collections and types are explicitly registered
    ```

!!! tip "Trade-Off"
    Apollo: Automatic cache normalization, complex. Verity: Explicit cache management, simple.

---

## Common Patterns

### Pattern: Polling

=== "Apollo"
    ```javascript
    const { data } = useQuery(GET_TODOS, {
      pollInterval: 5000  // Poll every 5 seconds
    })
    ```

=== "Verity"
    ```javascript
    // Use SSE instead of polling
    DL.init({
      sse: { url: '/api/events' }
    })
    
    // Or if you must poll
    useEffect(() => {
      const interval = setInterval(() => {
        todos.refresh()
      }, 5000)
      return () => clearInterval(interval)
    }, [])
    ```

!!! tip "Better Approach"
    SSE is more efficient than polling. Only send updates when something changes.

### Pattern: Cache-First vs Network-First

=== "Apollo"
    ```javascript
    const { data } = useQuery(GET_TODOS, {
      fetchPolicy: 'cache-first'  // or 'network-only'
    })
    ```

=== "Verity"
    ```javascript
    // Always cache-first by default
    const todos = useCollection('todos')
    
    // Force refetch
    const todos = useCollection('todos', {}, { force: true })
    
    // Or refresh manually
    todos.refresh()
    ```

### Pattern: Local State

=== "Apollo"
    ```javascript
    const cache = new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            isLoggedIn: {
              read() {
                return localStorage.getItem('token') !== null
              }
            }
          }
        }
      }
    })
    
    const { data } = useQuery(gql`
      query GetAuthState {
        isLoggedIn @client
      }
    `)
    ```

=== "Verity"
    ```javascript
    // Use React state for local UI state
    const [isLoggedIn, setIsLoggedIn] = useState(
      localStorage.getItem('token') !== null
    )
    
    // Verity is for server truth-state only
    // Local view-state stays in your framework
    ```

!!! success "Clearer Separation"
    Verity enforces truth-state (server) vs view-state (client) boundary.

---

## Bundle Size Comparison

| Library | Minified + Gzipped |
|---------|-------------------|
| Apollo Client + deps | ~32 KB |
| Verity core | ~8 KB |
| Verity + Alpine adapter | ~10 KB |
| Verity + React adapter | ~12 KB |

!!! success "70% Smaller"
    Verity is significantly smaller than Apollo Client.

---

## Checklist

!!! success "Migration Checklist"
    
    **Preparation:**
    - [ ] Audit Apollo features in use
    - [ ] Identify queries, mutations, subscriptions
    - [ ] Document fragments and cache policies
    
    **Setup:**
    - [ ] Install Verity
    - [ ] Create registry
    - [ ] Set up SSE endpoint (if using real-time)
    
    **Migration:**
    - [ ] Convert queries to collections/types
    - [ ] Remove optimistic updates
    - [ ] Convert mutations to directive-based
    - [ ] Replace subscriptions with SSE
    - [ ] Remove cache manipulation code
    
    **Backend:**
    - [ ] Add directive returns to mutations
    - [ ] Implement SSE broadcasting
    - [ ] (Optional) Simplify from GraphQL to REST
    
    **Cleanup:**
    - [ ] Remove Apollo Client
    - [ ] Remove GraphQL subscriptions (if using SSE)
    - [ ] Update tests

---

## Next Steps

<div class="grid" markdown>

[Directives Guide :material-arrow-right-bold:](../concepts/directives.md){ .md-button .md-button--primary }
[UX Patterns :material-palette:](../guides/ux-patterns.md){ .md-button }
[Examples :material-code-braces:](../examples.md){ .md-button }

</div>

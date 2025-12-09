# Frequently Asked Questions

> Common questions about Verity's philosophy, usage, and comparisons

---

## Philosophy & Concepts

### Why no optimistic updates?

!!! question "Question"
    Every other data library supports optimistic updates. Why does Verity reject them?

**Answer:**

Optimistic updates are **temporary lies**. They show users a state that might not be true, then "correct" it when the server responds. This creates:

- **Flicker:** UI updates optimistically, then changes again when truth arrives
- **Mismatch:** Optimistic state diverges from server reality
- **Broken trust:** Users learn not to trust what they see

**Verity's position:** The UI should reflect what the **server confirms**, not what we **hope** will happen.

**Alternative approaches:**

=== "Fast Endpoints"
    Build endpoints that return quickly:
    ```python
    @app.put('/api/todos/<int:id>/toggle')
    def toggle_todo(id):
        todo.completed = not todo.completed  # Fast DB write
        db.session.commit()
        return { 'directives': [...], 'result': todo.to_dict() }
    # Response time: ~50-100ms
    ```

=== "Inline Results"
    Include updated data in directives:
    ```python
    return {
        'directives': [{
            'op': 'refresh_item',
            'name': 'todo',
            'id': id,
            'result': todo.to_dict()  # ← No refetch needed
        }]
    }
    ```

=== "Honest UX"
    Show spinners during work:
    ```html
    <button 
      @click="toggleTodo(todo)"
      :disabled="isTogglingtodo.id"
    >
      <span x-show="!isToggling">Toggle</span>
      <span x-show="isToggling" class="spinner"></span>
    </button>
    ```

**See:** [Philosophy](philosophy.md#honest-by-design)

---

### What's the difference between truth-state and view-state?

!!! question "Question"
    I keep mixing these up. How do I know which is which?

**Answer:**

Use the **smell tests:**

| Smell Test | Truth-State | View-State |
|------------|-------------|------------|
| **Reload test** | Persists after reload | Resets after reload |
| **Multi-client test** | Other clients must see it | Local to one client |
| **Server test** | Originates from server | Never leaves browser |
| **Tab test** | Shared across tabs | Independent per tab |

**Examples:**

=== "Truth-State"
    ✅ Todo items  
    ✅ User profile  
    ✅ Order status  
    ✅ Inventory count  
    ✅ Permissions  

=== "View-State"
    ✅ Which menu is open  
    ✅ Selected tab  
    ✅ Form draft (before submit)  
    ✅ Scroll position  
    ✅ Filter UI state  

**Rule of thumb:** If a coworker on another device needs to see it, it's truth-state.

**See:** [Truth-State vs View-State](concepts/truth-vs-view-state.md)

---

### Why does the server author directives?

!!! question "Question"
    Can't the client just figure out what to invalidate after a mutation?

**Answer:**

The **server has domain knowledge** the client doesn't:

**Example: Archive a project**

```python
@app.put('/api/projects/<int:id>/archive')
def archive_project(id):
    project = Project.query.get(id)
    project.archived = True
    
    # Server knows cascading effects:
    affected_tasks = []
    for task in project.tasks:
        task.archived = True
        affected_tasks.append(task.id)
    
    # Server tells client exactly what changed:
    return {
        'directives': [
            { 'op': 'refresh_item', 'name': 'project', 'id': id },
            { 'op': 'refresh_collection', 'name': 'projects' },
            *[{ 'op': 'refresh_item', 'name': 'task', 'id': tid } 
              for tid in affected_tasks],
            { 'op': 'refresh_collection', 'name': 'tasks' }
        ]
    }
```

**If the client guessed:**
- It wouldn't know about cascading task updates
- It might forget to refresh affected collections
- Logic would be duplicated in every client

**Server-authored directives:**
- ✅ Centralize invalidation logic
- ✅ Ensure all clients stay consistent
- ✅ Handle complex domain relationships
- ✅ Allow server-side changes without client updates

**See:** [Directives Concept](concepts/directives.md)

---

## Comparison to Alternatives

### How is Verity different from TanStack Query?

!!! question "Question"
    TanStack Query has caching, refetching, and invalidation. What does Verity add?

**Key Differences:**

| Aspect | TanStack Query | Verity |
|--------|----------------|--------|
| **Invalidation** | Client-defined (manual `invalidateQueries`) | Server-authored (directives) |
| **Philosophy** | Optimistic updates encouraged | Server truth only |
| **Multi-client sync** | Not built-in (need external solution) | Built-in (SSE fan-out) |
| **Levels** | Not supported | First-class (with conversions) |
| **Push updates** | Not built-in | Built-in (SSE directives) |

**Example: Delete a todo**

=== "TanStack Query"
    ```javascript
    const mutation = useMutation({
      mutationFn: (id) => fetch(`/api/todos/${id}`, { method: 'DELETE' }),
      onSuccess: (data, id) => {
        // Client must know what to invalidate:
        queryClient.invalidateQueries({ queryKey: ['todos'] })
        queryClient.invalidateQueries({ queryKey: ['todo', id] })
        queryClient.invalidateQueries({ queryKey: ['todoCount'] })
        // What if we forget one? 🤷
      }
    })
    ```

=== "Verity"
    ```javascript
    async function deleteTodo(id) {
      const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' })
      const { directives } = await res.json()
      // Server tells us exactly what changed:
      DL.applyDirectives(directives)
    }
    ```
    
    Server returns:
    ```json
    {
      "directives": [
        { "op": "refresh_collection", "name": "todos" },
        { "op": "refresh_collection", "name": "todoCount" }
      ]
    }
    ```

**When to use TanStack Query:**
- Optimistic updates are critical to your UX
- You prefer client-side invalidation control
- No multi-client sync needed

**When to use Verity:**
- Server truth is paramount
- Multi-client/multi-tab sync needed
- Prefer server-authored invalidation contract

**See:** [Why Verity?](why-verity.md#vs-tanstack-query--rtk-query--apollo)

---

### How is Verity different from htmx?

!!! question "Question"
    htmx also keeps the server as the source of truth. How is Verity different?

**Key Differences:**

| Aspect | htmx | Verity |
|--------|------|--------|
| **Transport** | Server sends HTML | Server sends data |
| **View coupling** | Server dictates DOM structure | Server sends semantic directives |
| **Framework support** | Mostly vanilla HTML | Alpine, React, Vue, Svelte |
| **Client state** | Mostly server-driven | Clear truth/view separation |
| **Caching** | Browser HTTP cache | Smart in-memory cache |

**Example: Update a todo**

=== "htmx"
    ```html
    <!-- Server returns HTML fragment -->
    <div hx-put="/api/todos/42" 
         hx-target="#todo-42"
         hx-swap="outerHTML">
      <input type="checkbox" checked>
      <span>Buy milk</span>
    </div>
    ```
    
    Server must return:
    ```html
    <div id="todo-42">
      <input type="checkbox" checked>
      <span>Buy milk - DONE</span>
    </div>
    ```

=== "Verity"
    ```javascript
    // Server returns directive
    await fetch('/api/todos/42', { method: 'PUT', ... })
    // → { directives: [{ op: "refresh_item", name: "todo", id: 42 }] }
    
    // Client renders however it wants:
    <div x-data="{ todo: $verity.item('todo', 42) }">
      <input type="checkbox" :checked="todo.state.value.completed">
      <span x-text="todo.state.value.title"></span>
    </div>
    ```

**htmx strengths:**
- Perfect for server-rendered apps
- Minimal JavaScript
- Progressive enhancement

**Verity strengths:**
- Decouples server from view structure
- Supports rich client-side frameworks
- Multi-client sync built-in

**See:** [Migration from htmx](migration/from-htmx.md) | [Why Verity?](why-verity.md#vs-htmx--liveview--turbo-streams)

---

### Can I use Verity with GraphQL?

!!! question "Question"
    I'm using GraphQL. Does Verity work with it?

**Answer:** Yes! Verity is protocol-agnostic.

**Implementation:**

```javascript
DL.createCollection('todos', {
  fetch: async (params) => {
    const query = `
      query GetTodos($status: String) {
        todos(status: $status) {
          id
          title
          completed
        }
      }
    `
    
    const res = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { status: params.status }
      })
    })
    
    const data = await res.json()
    return { items: data.data.todos }
  }
})
```

**Directives over GraphQL subscriptions:**

```javascript
registry.configureDirectiveSource({
  type: 'graphql-subscription',
  connect: ({ applyDirectives, clientId }) => {
    const subscription = graphqlClient.subscribe({
      query: `
        subscription {
          directives {
            op
            name
            id
            params
            source
          }
        }
      `
    })
    
    subscription.subscribe({
      next: ({ data }) => {
        const directives = data.directives
        if (directives.source !== clientId) {
          applyDirectives([directives])
        }
      }
    })
    
    return () => subscription.unsubscribe()
  }
})
```

---

## Usage & Patterns

### How do I handle pagination?

!!! question "Question"
    Should each page be a separate collection, or one collection with page params?

**Answer:** Use **params for pagination**:

```javascript
DL.createCollection('todos', {
  fetch: async (params = {}) => {
    const url = new URL('/api/todos', window.location.origin)
    url.searchParams.set('page', params.page || 1)
    url.searchParams.set('limit', params.limit || 20)
    
    const res = await fetch(url)
    const data = await res.json()
    
    return {
      items: data.todos,
      meta: {
        page: data.page,
        totalPages: data.totalPages,
        total: data.total
      }
    }
  }
})

// Usage
const page1 = DL.fetchCollection('todos', { page: 1 })
const page2 = DL.fetchCollection('todos', { page: 2 })
```

**Each page is cached separately.** When directives arrive:

```json
{
  "op": "refresh_collection",
  "name": "todos"
  // No params → refreshes ALL pages
}
```

Or target specific page:

```json
{
  "op": "refresh_collection",
  "name": "todos",
  "params": { "page": 1 }
  // Only refreshes page 1
}
```

---

### How do I handle infinite scroll / load more?

!!! question "Question"
    Should I append to the existing collection or create new ones?

**Answer:** Two approaches:

=== "Append Strategy (Client-side)"
    ```javascript
    const todos = ref([])
    const currentPage = ref(1)
    
    async function loadMore() {
      const handle = DL.fetchCollection('todos', { 
        page: currentPage.value 
      })
      
      await handle.state.loading
      todos.value.push(...handle.state.items)
      currentPage.value++
    }
    ```
    
    **Caveat:** Directives won't update appended items. Need manual refresh logic.

=== "Server-side Cursor"
    ```javascript
    DL.createCollection('todos', {
      fetch: async (params = {}) => {
        const url = new URL('/api/todos', window.location.origin)
        if (params.cursor) url.searchParams.set('cursor', params.cursor)
        
        const res = await fetch(url)
        const data = await res.json()
        
        return {
          items: data.todos,
          meta: {
            nextCursor: data.nextCursor,
            hasMore: data.hasMore
          }
        }
      }
    })
    
    // Each cursor is a separate collection
    const batch1 = DL.fetchCollection('todos', { cursor: null })
    const batch2 = DL.fetchCollection('todos', { cursor: 'abc123' })
    ```

**Recommendation:** Use **cursor-based** approach for proper directive handling.

---

### Should I use one registry or multiple?

!!! question "Question"
    Can I create multiple registries? When would I do that?

**Answer:** **One registry per app** is typical.

**Multiple registries only if:**
- Different SSE audiences (e.g., admin panel vs user dashboard)
- Isolated module boundaries (micro-frontends)
- Different staleness/caching policies

**Example: Multi-tenant app**

```javascript
// User-specific registry
DL.init({
  sse: { audience: `user-${userId}` }
})

// Admin-specific registry
// Configure separate instances as needed
DL.init({
  sse: { audience: 'admin' },
  memory: { stalenessMs: 5000 }  // More aggressive for admin
})
```

**Most apps:** One shared registry is simpler and sufficient.

---

### How do I handle authentication?

!!! question "Question"
    Where do I include auth tokens?

**Answer:** In your **fetch functions**:

=== "Cookies (Recommended)"
    ```javascript
    DL.createCollection('todos', {
      fetch: async (params) => {
        const res = await fetch('/api/todos', {
          credentials: 'include'  // ← Send cookies
        })
        return res.json()
      }
    })
    
    // SSE with credentials
    DL.init({
      sse: {
        url: '/api/events',
        withCredentials: true  // ← Send cookies
      }
    })
    ```

=== "Bearer Token"
    ```javascript
    const getAuthToken = () => localStorage.getItem('auth_token')
    
    DL.createCollection('todos', {
      fetch: async (params) => {
        const res = await fetch('/api/todos', {
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`
          }
        })
        return res.json()
      }
    })
    ```

=== "Custom Header"
    ```javascript
    DL.createCollection('todos', {
      fetch: async (params) => {
        const res = await fetch('/api/todos', {
          headers: {
            'X-API-Key': window.API_KEY,
            'X-User-ID': window.currentUserId
          }
        })
        return res.json()
      }
    })
    ```

**Verity doesn't manage auth**—it's just a data layer. Use your existing auth strategy.

---

## Debugging & Troubleshooting

### My directives aren't being applied. Why?

!!! question "Question"
    I'm emitting directives from the server but the client isn't updating.

**Debug checklist:**

1. **Check directive format:**
   ```json
   {
     "op": "refresh_collection",  // ✅ Correct
     "name": "todos"
   }
   ```
   
   Not:
   ```json
   {
     "type": "refresh",  // ❌ Wrong field name
     "collection": "todos"
   }
   ```

2. **Check if directive is returned:**
   ```javascript
   const res = await fetch('/api/todos', { method: 'POST', ... })
   const payload = await res.json()
   console.log(payload.directives)  // Should be an array
   ```

3. **Check if directive is applied:**
   ```javascript
   DL.applyDirectives(payload.directives)
   // Did you forget to call this?
   ```

4. **Check SSE connection (for push path):**
   - Open devtools: `Ctrl+Shift+V`
   - Go to **SSE panel**
   - Check connection status (should be green ✓)
   - Check if messages are arriving

5. **Check `source` field:**
   - Directives with `source` matching `clientId` are ignored
   - This prevents double-application
   - Make sure server includes `X-Verity-Client-ID` header in SSE

6. **Check `check` function:**
   ```javascript
   DL.createCollection('todos', {
     fetch: /* ... */,
     check: (directive) => {
       console.log('Check function called:', directive)
       return true  // Make sure this returns true
     }
   })
   ```

**See:** [Devtools Debugging](reference/devtools.md#common-debugging-scenarios)

---

### Data looks stale. How do I force refresh?

!!! question "Question"
    The cache shows old data. How do I refresh it?

**Manual refresh:**

```javascript
// Refresh a collection
const todos = DL.fetchCollection('todos', { status: 'active' })
// Refetch with force flag
DL.fetchCollection('todos', { params: { status: 'active' }, force: true })

// Refresh an item
const user = DL.fetchItem('user', { userId: 123 })
// Refetch with force flag
DL.fetchItem('user', 123, null, { force: true })
```

**Check staleness settings:**

```javascript
// Make data refresh more aggressively
DL.createCollection('todos', {
  fetch: /* ... */,
  stalenessMs: 10000  // 10 seconds instead of default 60 seconds
})
```

**Force resync (all collections):**

```javascript
await registry.resync()
```

**Use devtools to inspect:**
- Open devtools: `Ctrl+Shift+V`
- Go to **Truth panel**
- Check **stale** indicator (yellow dot = stale)

**See:** [State Model](guides/state-model.md)

---

### How do I debug SSE connection issues?

!!! question "Question"
    SSE isn't connecting or keeps disconnecting.

**Debug steps:**

1. **Check SSE endpoint:**
   ```javascript
   fetch('/api/events')  // Should return text/event-stream
   ```

2. **Check CORS (if cross-origin):**
   ```python
   # Server must allow SSE
   @app.route('/api/events')
   def events():
       def generate():
           while True:
               yield f"data: {json.dumps({...})}\n\n"
       
       response = Response(generate(), mimetype='text/event-stream')
       response.headers['Access-Control-Allow-Origin'] = 'https://example.com'
       response.headers['Access-Control-Allow-Credentials'] = 'true'
       return response
   ```

3. **Check authentication:**
   ```javascript
   createRegistry({
     sse: {
       url: '/api/events',
       withCredentials: true  // ← Include cookies
     }
   })
   ```

4. **Use devtools:**
   - Open devtools: `Ctrl+Shift+V`
   - Go to **SSE panel**
   - Check connection status
   - Check error messages
   - Check reconnection attempts

5. **Check browser console:**
   Look for SSE-related errors

**See:** [Devtools SSE Panel](reference/devtools.md#sse-panel)

---

## Performance & Optimization

### How do I reduce unnecessary fetches?

!!! question "Question"
    Verity is making too many requests. How do I optimize?

**Strategies:**

=== "Increase Staleness"
    ```javascript
    DL.createCollection('todos', {
      fetch: /* ... */,
      stalenessMs: 300000  // 5 minutes instead of 1 minute
    })
    ```

=== "Use Level Conversions"
    ```javascript
    // Fetch full level once, derive others
    // Level conversions are defined in createType('todo', 'full', 'expanded', (full) => {
      const { comments, ...expanded } = full
      return expanded
    })
    
    // Level conversions are defined in createType('todo', 'expanded', 'simplified', (expanded) => {
      const { description, assignee, ...simplified } = expanded
      return simplified
    })
    ```

=== "Include Results in Directives"
    ```python
    # Server includes updated data
    return {
        'directives': [{
            'op': 'refresh_item',
            'name': 'todo',
            'id': 42,
            'result': todo.to_dict()  # ← Skip refetch
        }]
    }
    ```

=== "Increase Coalescing Window"
    ```javascript
    DL.init({
      bulk: { delayMs: 200 }  // Wait 200ms to batch requests
    })
    ```

=== "Use Specific Directive Params"
    ```python
    # Instead of:
    { 'op': 'refresh_collection', 'name': 'todos' }
    # (refreshes ALL todo collections)
    
    # Use:
    { 'op': 'refresh_collection', 'name': 'todos', 'params': { 'status': 'active' } }
    # (only refreshes that specific collection)
    ```

**See:** [Levels & Conversions](concepts/levels-and-conversions.md)

---

### Does Verity work with large datasets?

!!! question "Question"
    I have thousands of records. Will Verity handle it?

**Answer:** Yes, with proper pagination and cache limits.

**Best practices:**

1. **Use pagination:**
   ```javascript
   DL.createCollection('todos', {
     fetch: async (params = {}) => {
       const limit = params.limit || 50  // Fetch in chunks
       const page = params.page || 1
       // ... fetch only one page
     }
   })
   ```

2. **Set cache limits:**
   ```javascript
   createRegistry({
     memory: {
       maxItemsPerType: 1000  // Limit cached items
     }
   })
   ```

3. **Use virtual scrolling** in UI

4. **Consider server-side search/filtering**

**Verity doesn't load everything into memory**—only what you explicitly fetch and cache.

---

## Production & Deployment

### Should I remove devtools in production?

!!! question "Question"
    Are devtools safe to leave in production?

**Answer:** **No, remove them.**

**Reasons:**
- Adds ~50KB to bundle
- Exposes internal state
- No benefit to end users

**How to remove:**

=== "Environment Variable"
    ```javascript
    if (process.env.NODE_ENV === 'development') {
      import('verity-dl/devtools/devtools.css')
      import('verity-dl/devtools/devtools.js')
    }
    ```

=== "Hostname Check"
    ```javascript
    if (window.location.hostname === 'localhost') {
      // Load devtools
    }
    ```

=== "Build-Time Exclusion"
    ```javascript
    // vite.config.js
    export default {
      define: {
        __DEV__: JSON.stringify(process.env.NODE_ENV === 'development')
      }
    }
    
    // app.js
    if (__DEV__) {
      // Load devtools
    }
    ```

**See:** [Devtools Production Usage](reference/devtools.md#production-usage)

---

### What's the browser support?

!!! question "Question"
    Which browsers does Verity support?

**Answer:** Modern evergreen browsers.

**Core requirements:**
- `fetch` API
- `Promise` / `async`/`await`
- `EventSource` (for SSE)
- ES2018+ features

**Supported:**
- ✅ Chrome 63+
- ✅ Firefox 58+
- ✅ Safari 12+
- ✅ Edge 79+

**Not supported:**
- ❌ IE11 (no native `Promise`, `fetch`, or `EventSource`)

**Polyfills:**
If you need older browser support, include polyfills for `fetch`, `Promise`, and `EventSource`.

---

## Contributing & Community

### How can I contribute?

!!! question "Question"
    I want to contribute. Where do I start?

**Answer:** Check out [CONTRIBUTING.md](contributing.md)!

**Areas to contribute:**
- 📚 Documentation improvements
- 🐛 Bug fixes
- ✨ Feature requests
- 🧪 Test coverage
- 📝 Example applications
- 🌍 Translations

**Process:**
1. Open an issue to discuss
2. Fork and create a branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

---

### Where can I get help?

!!! question "Question"
    I'm stuck. Where can I ask questions?

**Resources:**
- 📖 [Documentation](https://verity.yidi.sh)
- 💬 [GitHub Discussions](https://github.com/YidiDev/verity/discussions)
- 🐛 [GitHub Issues](https://github.com/YidiDev/verity/issues)
- 📧 Email: yididev@gmail.com

---

## Still Have Questions?

If your question isn't answered here, please:

1. Check the [complete documentation](https://verity.yidi.sh)
2. Search [GitHub Issues](https://github.com/YidiDev/verity/issues)
3. Ask in [GitHub Discussions](https://github.com/YidiDev/verity/discussions)
4. Open a new issue if you found a bug

We're here to help! 🙌

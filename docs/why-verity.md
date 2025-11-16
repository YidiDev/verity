# Why Verity?

---

## The Landscape

!!! question "The Core Problem"
    How do you keep frontend state synchronized with the server without creating a mess?

Every team faces this challenge. Most reach for one of these solutions:

=== "Server-Rendered"
    **Examples:** htmx, LiveView, Turbo Streams, Server Components
    
    **Approach:** Server pushes HTML/DOM updates

=== "Client Cache"
    **Examples:** TanStack Query, RTK Query, Apollo, SWR
    
    **Approach:** Client manages cache with manual invalidation

=== "Roll Your Own"
    **Examples:** Fetch + useState, EventSource + Redux
    
    **Approach:** Custom solution for each project

=== "Verity"
    **Approach:** Server-authored directives + deterministic cache
    
    **Philosophy:** Backend of the frontend

---

## Detailed Comparisons

### vs Server-Rendered (htmx, LiveView, Turbo)

=== "What They Get Right"
    !!! success "Strong Points"
        - ✅ Server is the source of truth
        - ✅ No client-side cache complexity
        - ✅ Simple mental model
        - ✅ Works without JavaScript

=== "What's Limiting"
    !!! failure "Pain Points"
        - ❌ Server dictates DOM structure
        - ❌ Tight coupling between backend and view
        - ❌ Hard to support multiple clients (web + mobile)
        - ❌ View-state mixed with truth-state
        - ❌ Limited framework choice (locked to server's templating)

=== "Real-World Impact"
    **Scenario:** You want to add a mobile app
    
    **htmx/LiveView:**
    ```
    1. Server returns HTML for web
    2. Mobile app can't use it
    3. Build separate REST API for mobile
    4. Now maintaining two backends
    5. Synchronization headaches
    ```
    
    **Verity:**
    ```
    1. Server returns JSON + directives
    2. Web uses Alpine adapter
    3. Mobile uses React Native adapter
    4. Same backend, same data layer
    5. Directives keep both in sync
    ```

=== "Verity's Approach"
    !!! tip "Data Intent, Not DOM"
        **Server sends:**
        ```json
        {
          "op": "refresh_item",
          "name": "todo",
          "id": 42
        }
        ```
        
        **Not:**
        ```html
        <div id="todo-42">
          <input type="checkbox" checked>
          ...
        </div>
        ```
    
    **Benefits:**
    
    - Server doesn't know about React vs Alpine vs Vue
    - Same backend for web, mobile, desktop
    - View-state stays client-owned
    - Framework flexibility

---

### vs Client Caches (TanStack Query, Apollo, RTK Query)

=== "What They Get Right"
    !!! success "Strong Points"
        - ✅ Mature ecosystems
        - ✅ Good developer tools
        - ✅ Multi-framework support
        - ✅ Flexible query APIs
        - ✅ Active communities

=== "What's Missing"
    !!! failure "Conceptual Gaps"
        
        **1. Optimistic Updates Encouraged**
        
        ```javascript
        // TanStack Query pattern
        const mutation = useMutation({
          mutationFn: updateTodo,
          onMutate: async (newTodo) => {
            // Optimistically update cache
            queryClient.setQueryData(['todos'], old => [...old, newTodo])
          },
          onError: (err, newTodo, context) => {
            // Rollback on error
            queryClient.setQueryData(['todos'], context.previousTodos)
          }
        })
        ```
        
        **Problem:** Lying to users, rollback flicker, complexity
        
        ---
        
        **2. App-Defined Invalidation**
        
        ```javascript
        // Manual invalidation (glue code)
        const mutation = useMutation({
          mutationFn: updateTodo,
          onSuccess: () => {
            // Developer decides what to invalidate
            queryClient.invalidateQueries(['todos'])
            queryClient.invalidateQueries(['todo', todoId])
            queryClient.invalidateQueries(['stats'])
            // Did I miss anything? 🤷
          }
        })
        ```
        
        **Problem:** Every developer reinvents invalidation logic
        
        ---
        
        **3. No Level Conversion Planning**
        
        ```javascript
        // Fetch full detail
        const todo = useQuery(['todo', id, 'full'], fetchFullTodo)
        
        // Later fetch summary
        const summary = useQuery(['todo', id, 'summary'], fetchSummaryTodo)
        // Redundant fetch! Full data already has summary fields
        ```
        
        **Problem:** No way to derive one level from another
        
        ---
        
        **4. No Truth-State Boundary**
        
        ```javascript
        // Query cache used for everything
        const [page, setPage] = useState(1)  // View-state... or?
        const todos = useQuery(['todos', page])  // Truth-state
        const [sortBy, setSortBy] = useState('name')  // View-state?
        ```
        
        **Problem:** No explicit separation between truth and view

=== "Real-World Impact"
    **Scenario:** Update a todo's status
    
    **TanStack Query:**
    ```javascript
    // Option 1: Optimistic update
    queryClient.setQueryData(['todo', id], { ...old, completed: true })
    // → User sees change immediately
    // → If server rejects, rollback (flicker)
    // → Other tabs don't know about change
    
    // Option 2: Wait for response
    await mutate({ id, completed: true })
    // → No optimistic update, feels slow
    await queryClient.invalidateQueries(['todos'])
    // → Refetch entire list (wasteful)
    
    // Option 3: Manual cache update
    queryClient.setQueryData(['todos'], old => 
      old.map(t => t.id === id ? { ...t, completed: true } : t)
    )
    // → Now maintaining cache logic in app code
    ```
    
    **Verity:**
    ```javascript
    const res = await fetch(`/api/todos/${id}`, { 
      method: 'PUT',
      body: JSON.stringify({ completed: true })
    })
    const { directives } = await res.json()
    // Server returned:
    // [
    //   { op: "refresh_item", name: "todo", id: 42 },
    //   { op: "refresh_collection", name: "todos" }
    // ]
    
    await registry.applyDirectives(directives)
    // → Server decides what changed
    // → Verity refetches only what's needed
    // → SSE broadcasts to other tabs automatically
    // → No optimistic updates, no rollbacks
    ```

=== "Verity's Approach"
    !!! tip "Server-Authored Contract"
        
        **1. No Optimistic Updates**
        
        Show honest loading states. Let server confirm truth.
        
        ---
        
        **2. Server Decides Invalidation**
        
        ```python
        @app.put('/api/todos/<int:id>')
        def update_todo(id):
            todo.status = request.json['status']
            db.session.commit()
            
            # Server knows what changed
            return {
                'directives': [
                    { 'op': 'refresh_item', 'name': 'todo', 'id': id },
                    { 'op': 'refresh_collection', 'name': 'todos' }
                ]
            }
        ```
        
        No guessing. Server has domain knowledge.
        
        ---
        
        **3. Level Conversion Planning**
        
        ```javascript
        registry.registerType('todo', {
          levels: {
            full: {
              fetch: ({ id }) => fetch(`/api/todos/${id}?full`),
              checkIfExists: (obj) => 'comments' in obj,
              levelConversionMap: {
                summary: true  // full → summary without refetch
              }
            }
          }
        })
        ```
        
        One fetch satisfies multiple levels.
        
        ---
        
        **4. Explicit Truth-State Boundary**
        
        ```html
        <div x-data="{
          todos: $verity.collection('todos'),  <!-- Truth -->
          sortBy: 'name',                      <!-- View -->
          page: 1                              <!-- View -->
        }">
        ```
        
        Clear separation enforced by API.

---

### vs Roll-Your-Own

=== "Why Teams Build Custom"
    !!! info "Valid Reasons"
        - "Our needs are unique"
        - "We need full control"
        - "Don't want dependencies"
        - "Just a few API calls"

=== "What You End Up Building"
    !!! warning "The Hidden Complexity"
        
        **Phase 1: Weeks 1-2**
        ```javascript
        // Simple start
        const [data, setData] = useState(null)
        const [loading, setLoading] = useState(false)
        
        useEffect(() => {
          setLoading(true)
          fetch('/api/data').then(r => r.json()).then(setData)
            .finally(() => setLoading(false))
        }, [])
        ```
        
        ---
        
        **Phase 2: Weeks 3-4**
        ```javascript
        // Need caching
        const cache = new Map()
        
        function useCachedData(url) {
          if (cache.has(url)) return cache.get(url)
          // ... fetch and cache ...
        }
        ```
        
        ---
        
        **Phase 3: Month 2**
        ```javascript
        // Need invalidation
        function invalidateCache(pattern) {
          for (const key of cache.keys()) {
            if (key.match(pattern)) cache.delete(key)
          }
        }
        
        // Now every mutation needs this
        await updateUser(id, data)
        invalidateCache(/users/)
        invalidateCache(/user-${id}/)
        // Did I get them all? 🤷
        ```
        
        ---
        
        **Phase 4: Month 3**
        ```javascript
        // Need to handle race conditions
        let activeQueryId = 0
        
        function fetchData(url) {
          const queryId = ++activeQueryId
          const res = await fetch(url)
          if (queryId !== activeQueryId) return // Stale
          // ...
        }
        ```
        
        ---
        
        **Phase 5: Month 4**
        ```javascript
        // Need real-time updates
        const eventSource = new EventSource('/api/events')
        eventSource.onmessage = (event) => {
          const { type, data } = JSON.parse(event.data)
          // How do I know what to invalidate?
          // How do I avoid refetching everything?
          // How do I handle disconnects?
          // 🤷🤷🤷
        }
        ```
        
        ---
        
        **Phase 6: Month 6**
        ```javascript
        // Need memory management
        // Need deduplication
        // Need parameterized caching
        // Need SSE reconnection
        // Need sequence numbers
        // Need...
        
        // At this point you've built Verity, badly
        ```

=== "Real Cost"
    !!! danger "Hidden Costs"
        
        **Engineering Time:**
        
        - Initial implementation: 2-4 weeks
        - Debugging race conditions: ongoing
        - Adding features teams expect: months
        - Onboarding new developers: hours each
        
        **Opportunity Cost:**
        
        - Not building features
        - Not fixing bugs
        - Not improving UX
        
        **Maintenance:**
        
        - Every developer learns your custom system
        - No community support
        - No shared knowledge
        - Technical debt accumulates

=== "Verity's Value"
    !!! success "What You Get"
        
        **Immediate:**
        
        - ✅ Caching with staleness tracking
        - ✅ Race condition handling
        - ✅ Deduplication
        - ✅ SSE integration
        - ✅ Memory management
        - ✅ Multi-client sync
        
        **Long-term:**
        
        - ✅ Community knowledge
        - ✅ Shared patterns
        - ✅ Documentation
        - ✅ Examples
        - ✅ Battle-tested code
        - ✅ Framework flexibility

---

## Feature Comparison Matrix

| Feature | htmx/LiveView | TanStack Query | Apollo | Roll-Your-Own | Verity |
|---------|---------------|----------------|--------|---------------|--------|
| **Server as Source of Truth** | ✅ | ⚠️ Optional | ⚠️ Optional | ❌ Up to you | ✅ |
| **No Optimistic Updates** | ✅ | ❌ Encouraged | ❌ Built-in | ❌ Tempting | ✅ |
| **Framework Agnostic** | ❌ | ✅ | ⚠️ Limited | ✅ | ✅ |
| **Server-Authored Invalidation** | N/A | ❌ | ❌ | ❌ | ✅ |
| **Level Conversion Planning** | N/A | ❌ | ❌ | ❌ | ✅ |
| **Multi-Client Sync** | ⚠️ Via polling | ❌ Manual | ⚠️ Subscriptions | ❌ | ✅ |
| **Race Condition Handling** | N/A | ⚠️ Manual | ⚠️ Manual | ❌ | ✅ |
| **Truth/View Separation** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Maintenance Burden** | Low | Medium | Medium | **High** | Low |
| **Learning Curve** | Low | Medium | High | **High** | Medium |

---

## When NOT to Use Verity

=== "Use htmx/LiveView If"
    - Server-rendered UI is your priority
    - You're building a single-client web app
    - You want minimal JavaScript
    - Your team is backend-heavy
    - SEO is critical
    
    **You'll be happy if:** You don't need mobile apps or complex client-side state

=== "Use TanStack Query If"
    - You're comfortable with optimistic updates
    - Your team knows it well already
    - You don't need multi-client sync
    - Invalidation complexity is acceptable
    
    **You'll be happy if:** Your app is mostly read-heavy with simple mutations

=== "Use Apollo If"
    - You're already all-in on GraphQL
    - Your team has GraphQL expertise
    - Subscription complexity is acceptable
    
    **You'll be happy if:** GraphQL's benefits outweigh its complexity for your use case

=== "Roll Your Own If"
    - Your needs are truly unique
    - You have dedicated data layer engineers
    - You're building framework-level infrastructure
    
    **You'll be happy if:** You have resources to maintain custom solutions long-term

---

## When to Use Verity

!!! success "Verity Shines When"

=== "Multi-Client Applications"
    - Web app + mobile app
    - Multiple web interfaces
    - Desktop + web
    - Shared data across clients

=== "Real-Time Collaboration"
    - Multi-user dashboards
    - Operational tools
    - Admin interfaces
    - Any tool where staleness causes problems

=== "Complex State Management"
    - Lots of related entities
    - Different detail levels needed
    - Frequent mutations
    - Need deterministic caching

=== "Trust-Critical UIs"
    - Financial applications
    - Healthcare systems
    - Compliance dashboards
    - Anywhere flicker erodes trust

---

## Migration Paths

Ready to switch? We have detailed migration guides:

<div class="grid cards" markdown>

- :material-arrow-right: [**From TanStack Query**](migration/from-tanstack-query.md)

    Step-by-step guide to migrating from TanStack Query (React Query)

- :material-arrow-right: [**From Apollo Client**](migration/from-apollo.md)

    How to move from Apollo to Verity while keeping GraphQL

- :material-arrow-right: [**From htmx**](migration/from-htmx.md)

    Transitioning from server-rendered to data-driven approach

</div>

---

## Summary

!!! quote "Verity's Philosophy"
    **Truth-state comes from the server. View-state stays in the view. Directives keep them synchronized. Never lie to users.**

**Choose Verity if you value:**

- ✅ Correctness over perceived speed
- ✅ Explicit contracts over implicit behavior
- ✅ Server authority over client speculation
- ✅ Framework flexibility over vendor lock-in
- ✅ Multi-client support over single-platform optimization

**The result:** Calm, trustworthy interfaces that reflect reality.

---

## Next Steps

<div class="grid" markdown>

[Get Started :material-arrow-right:](guides/getting-started.md){ .md-button .md-button--primary }
[Read Philosophy :material-book-open-variant:](philosophy.md){ .md-button }
[See Examples :material-code-braces:](examples.md){ .md-button }

</div>

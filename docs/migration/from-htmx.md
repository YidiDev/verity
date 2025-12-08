# Migrating from htmx

> Transitioning from server-rendered HTML to data-driven architecture

This guide helps you move from htmx's HTML-over-the-wire approach to Verity's data-driven model while preserving server authority.

---

## Why Migrate?

!!! question "When Does Migration Make Sense?"
    Consider Verity if you need:
    
    - 📱 Mobile app alongside web app
    - 🎨 More control over frontend framework
    - 🔄 Complex client-side state management
    - 📊 Rich interactive visualizations
    - 🌐 Multiple client applications

=== "What You'll Gain"
    - ✅ Framework choice (Alpine, React, Vue, Svelte)
    - ✅ Support multiple clients (web + mobile)
    - ✅ Richer client-side interactions
    - ✅ Same server authority philosophy
    - ✅ Clear truth-state vs view-state separation

=== "What You'll Miss"
    - ❌ Simplicity of HTML-over-the-wire
    - ❌ Zero client-side state management
    - ❌ Progressive enhancement without JS
    - ❌ htmx's tiny footprint

=== "Philosophy Alignment"
    !!! success "Shared Values"
        Both htmx and Verity believe in **server authority**. The difference is HOW the server communicates with the client:
        
        - **htmx:** Server sends HTML
        - **Verity:** Server sends data + directives

---

## Conceptual Comparison

### HTML-over-the-Wire vs Data + Directives

=== "htmx Approach"
    **Server returns HTML:**
    
    ```html
    <!-- Button triggers request -->
    <button hx-post="/todos/42/complete" 
            hx-target="#todo-42"
            hx-swap="outerHTML">
      Complete
    </button>
    
    <!-- Server responds with HTML -->
    <div id="todo-42" class="todo completed">
      <input type="checkbox" checked>
      <span>Buy milk</span>
    </div>
    ```
    
    **Problems for complex apps:**
    
    - Server must know DOM structure
    - Hard to support mobile app
    - Client-side state (filters, sorts) awkward
    - Can't easily switch frameworks

=== "Verity Approach"
    **Server returns data + directives:**
    
    ```javascript
    // Button triggers mutation
    async function completeTodo(id) {
      const res = await fetch(`/api/todos/${id}/complete`, {
        method: 'POST',
        headers: { 'X-Client-ID': registry.clientId }
      })
      
      const payload = await res.json()
      // Server returned:
      // {
      //   todo: { id: 42, title: 'Buy milk', completed: true },
      //   directives: [
      //     { op: 'refresh_item', name: 'todo', id: 42 },
      //     { op: 'refresh_collection', name: 'todos' }
      //   ]
      // }
      
      DL.applyDirectives(payload.directives)
    }
    ```
    
    **Benefits:**
    
    - Server doesn't know about DOM
    - Same backend for web + mobile
    - Client chooses how to render
    - Framework flexibility

!!! tip "The Key Insight"
    htmx: Server knows about `<div>` and `<span>`  
    Verity: Server knows about "todo changed"

---

## Migration Strategies

### Strategy 1: Gradual Migration (Recommended)

Migrate page by page while keeping both systems running.

=== "Phase 1: Read-Only Pages"
    Start with pages that only display data (no mutations).
    
    **Before (htmx):**
    ```html
    <div hx-get="/todos" hx-trigger="load">
      Loading...
    </div>
    ```
    
    **After (Verity):**
    ```html
    <div x-data="{ todos: $verity.collection('todos') }">
      <template x-if="todos.state.loading">
        <p>Loading...</p>
      </template>
      <ul>
        <template x-for="todo in todos.state.items">
          <li x-text="todo.title"></li>
        </template>
      </ul>
    </div>
    ```

=== "Phase 2: Simple Forms"
    Add pages with mutations.
    
    **Before (htmx):**
    ```html
    <form hx-post="/todos" hx-target="#todo-list">
      <input name="title" type="text">
      <button type="submit">Add</button>
    </form>
    ```
    
    **After (Verity):**
    ```html
    <div x-data="{ 
      title: '',
      async addTodo() {
        const res = await fetch('/api/todos', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Client-ID': registry.clientId 
          },
          body: JSON.stringify({ title: this.title })
        })
        const { directives } = await res.json()
        DL.applyDirectives(directives)
        this.title = ''
      }
    }">
      <form @submit.prevent="addTodo()">
        <input x-model="title" type="text">
        <button type="submit">Add</button>
      </form>
    </div>
    ```

=== "Phase 3: Complex Interactions"
    Migrate pages with rich client-side state.
    
    **Before (htmx + hidden inputs):**
    ```html
    <div>
      <input type="hidden" name="filter" value="active">
      <input type="hidden" name="sort" value="priority">
      
      <button hx-get="/todos?filter=all&sort=priority"
              hx-target="#todo-list">
        Show All
      </button>
      
      <div id="todo-list" hx-get="/todos?filter=active&sort=priority">
        <!-- Server-rendered list -->
      </div>
    </div>
    ```
    
    **After (Verity + client-side state):**
    ```html
    <div x-data="{
      filter: 'active',
      sortBy: 'priority',
      
      get todos() {
        return $verity.collection('todos', {
          filter: this.filter,
          sortBy: this.sortBy
        })
      }
    }">
      <button @click="filter = 'all'">Show All</button>
      <button @click="filter = 'active'">Show Active</button>
      
      <select x-model="sortBy">
        <option value="priority">Priority</option>
        <option value="dueDate">Due Date</option>
      </select>
      
      <ul>
        <template x-for="todo in todos.state.items">
          <li x-text="todo.title"></li>
        </template>
      </ul>
    </div>
    ```

### Strategy 2: Full Rewrite

For smaller apps or when you want a clean break.

!!! warning "Higher Risk"
    This approach requires more upfront work but gives you a clean architecture.

**Steps:**

1. Design new REST API (or keep existing if it exists)
2. Set up Verity registry
3. Build new frontend with chosen framework
4. Migrate data and users
5. Deploy new version

---

## Step-by-Step Migration

### Step 1: Choose Your Framework

htmx users often value simplicity. Consider:

=== "Alpine.js"
    **Best for htmx users**
    
    - Similar declarative syntax
    - Small footprint (~15KB)
    - Progressive enhancement friendly
    - Easy learning curve
    
    ```html
    <div x-data="{ count: 0 }">
      <button @click="count++">Increment</button>
      <span x-text="count"></span>
    </div>
    ```

=== "React"
    **Best for complex UIs**
    
    - Large ecosystem
    - Component composition
    - More JavaScript-heavy
    
    ```javascript
    function Counter() {
      const [count, setCount] = useState(0)
      return <button onClick={() => setCount(c => c + 1)}>{count}</button>
    }
    ```

=== "Vue"
    **Best middle ground**
    
    - Template syntax similar to htmx
    - Progressive framework
    - Good documentation
    
    ```html
    <div id="app">
      <button @click="count++">{{ count }}</button>
    </div>
    ```

!!! tip "Recommendation for htmx Users"
    Start with **Alpine.js**. It has the lowest learning curve and feels most similar to htmx.

### Step 2: Install Verity + Alpine

```html
<head>
  <!-- Alpine.js -->
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  
  <!-- Verity -->
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/alpine.min.js"></script>
</head>

<script>
DL.init()
VerityAlpine.install(window.Alpine, { registry })
</script>
```

### Step 3: Convert Backend Routes

=== "Before (htmx)"
    ```python
    @app.get('/todos')
    def get_todos():
        todos = Todo.query.all()
        return render_template('todos_list.html', todos=todos)
    
    @app.post('/todos')
    def create_todo():
        todo = Todo(title=request.form['title'])
        db.session.add(todo)
        db.session.commit()
        
        # Return HTML fragment
        return render_template('todo_item.html', todo=todo)
    ```

=== "After (Verity)"
    ```python
    @app.get('/api/todos')
    def get_todos():
        todos = Todo.query.all()
        return {
            'items': [t.to_dict() for t in todos],
            'meta': { 'total': len(todos) }
        }
    
    @app.post('/api/todos')
    def create_todo():
        todo = Todo(title=request.json['title'])
        db.session.add(todo)
        db.session.commit()
        
        # Return data + directives
        directives = [
            { 'op': 'refresh_collection', 'name': 'todos' }
        ]
        
        emit_directives(directives, source=request.headers.get('X-Client-ID'))
        
        return {
            'todo': todo.to_dict(),
            'directives': directives
        }
    ```

!!! info "Key Changes"
    - `/todos` → `/api/todos` (JSON endpoint)
    - Templates → JSON serialization
    - HTML fragments → directives

### Step 4: Convert Templates to Alpine

=== "Before (htmx template)"
    ```html
    <!-- todos_list.html -->
    <div id="todo-list">
      {% for todo in todos %}
        {% include 'todo_item.html' %}
      {% endfor %}
    </div>
    
    <!-- todo_item.html -->
    <div id="todo-{{ todo.id }}" class="todo">
      <input type="checkbox" 
             {% if todo.completed %}checked{% endif %}
             hx-post="/todos/{{ todo.id }}/toggle"
             hx-target="#todo-{{ todo.id }}"
             hx-swap="outerHTML">
      <span>{{ todo.title }}</span>
    </div>
    ```

=== "After (Alpine + Verity)"
    ```html
    <div x-data="{
      todos: $verity.collection('todos'),
      
      async toggleTodo(id) {
        const res = await fetch(`/api/todos/${id}/toggle`, {
          method: 'POST',
          headers: { 'X-Client-ID': registry.clientId }
        })
        const { directives } = await res.json()
        DL.applyDirectives(directives)
      }
    }">
      <template x-if="todos.state.loading">
        <p>Loading...</p>
      </template>
      
      <div id="todo-list">
        <template x-for="todo in todos.state.items" :key="todo.id">
          <div class="todo">
            <input type="checkbox" 
                   :checked="todo.completed"
                   @change="toggleTodo(todo.id)">
            <span x-text="todo.title"></span>
          </div>
        </template>
      </div>
    </div>
    ```

### Step 5: Handle Real-Time Updates

=== "Before (htmx polling)"
    ```html
    <div hx-get="/todos" 
         hx-trigger="every 5s"
         hx-target="#todo-list">
      <!-- Polls server every 5 seconds -->
    </div>
    ```

=== "After (Verity SSE)"
    ```javascript
    // Setup once
    DL.init({
      sse: {
        url: '/api/events',
        audience: 'global'
      }
    })
    
    // All clients automatically sync via SSE
    // No polling needed!
    ```
    
    **Server (Python):**
    ```python
    @app.get('/api/events')
    def sse_stream():
        def generate():
            q = queue.Queue()
            subscribers.append(q)
            try:
                while True:
                    msg = q.get(timeout=30)
                    yield f"data: {msg}\n\n"
            except queue.Empty:
                yield ": keepalive\n\n"
            finally:
                subscribers.remove(q)
        
        return Response(generate(), mimetype='text/event-stream')
    ```

!!! success "More Efficient"
    SSE only sends updates when something changes. No wasteful polling.

---

## Common Patterns

### Pattern: Master-Detail

=== "htmx"
    ```html
    <!-- List -->
    <div id="todo-list">
      {% for todo in todos %}
        <div hx-get="/todos/{{ todo.id }}" 
             hx-target="#todo-detail">
          {{ todo.title }}
        </div>
      {% endfor %}
    </div>
    
    <!-- Detail (loaded on click) -->
    <div id="todo-detail"></div>
    ```

=== "Verity + Alpine"
    ```html
    <div x-data="{
      todos: $verity.collection('todos'),
      selectedId: null,
      
      get selectedTodo() {
        return this.selectedId 
          ? $verity.item('todo', this.selectedId, 'detailed')
          : null
      }
    }">
      <!-- List -->
      <ul>
        <template x-for="todo in todos.state.items">
          <li @click="selectedId = todo.id" x-text="todo.title"></li>
        </template>
      </ul>
      
      <!-- Detail -->
      <div x-show="selectedTodo">
        <template x-if="selectedTodo?.data">
          <div>
            <h2 x-text="selectedTodo.data.title"></h2>
            <p x-text="selectedTodo.data.description"></p>
          </div>
        </template>
      </div>
    </div>
    ```

### Pattern: Inline Editing

=== "htmx"
    ```html
    <div id="todo-{{ todo.id }}">
      <span hx-get="/todos/{{ todo.id }}/edit" 
            hx-target="#todo-{{ todo.id }}">
        {{ todo.title }}
      </span>
    </div>
    
    <!-- Server returns edit form -->
    <form hx-put="/todos/{{ todo.id }}"
          hx-target="#todo-{{ todo.id }}">
      <input name="title" value="{{ todo.title }}">
      <button>Save</button>
    </form>
    ```

=== "Verity + Alpine"
    ```html
    <div x-data="{
      todo: $verity.item('todo', todoId),
      editing: false,
      editTitle: '',
      
      startEdit() {
        this.editing = true
        this.editTitle = this.todo.data.title
      },
      
      async saveEdit() {
        const res = await fetch(`/api/todos/${todoId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-ID': registry.clientId
          },
          body: JSON.stringify({ title: this.editTitle })
        })
        const { directives } = await res.json()
        DL.applyDirectives(directives)
        this.editing = false
      }
    }">
      <div x-show="!editing" @click="startEdit()">
        <span x-text="todo.data?.title"></span>
      </div>
      
      <div x-show="editing">
        <input x-model="editTitle" @keyup.enter="saveEdit()">
        <button @click="saveEdit()">Save</button>
      </div>
    </div>
    ```

### Pattern: Infinite Scroll

=== "htmx"
    ```html
    <div id="todo-list">
      {% for todo in todos %}
        <div>{{ todo.title }}</div>
      {% endfor %}
      
      <div hx-get="/todos?page=2"
           hx-trigger="revealed"
           hx-swap="afterend">
        Loading more...
      </div>
    </div>
    ```

=== "Verity + Alpine"
    ```html
    <div 
      x-data="{
        page: 1,
        allTodos: [],
        
        get todos() {
          return $verity.collection('todos', { page: this.page })
        },
        
        loadMore() {
          if (!this.todos.state.loading && this.todos.state.meta?.hasMore) {
            this.page++
          }
        }
      }"
      x-init="$watch('todos.state.items', items => {
        if (items.length) allTodos = [...allTodos, ...items]
      })"
    >
      <template x-for="todo in allTodos">
        <div x-text="todo.title"></div>
      </template>
      
      <div x-intersect="loadMore()">
        <template x-if="todos.state.loading">
          <p>Loading more...</p>
        </template>
      </div>
    </div>
    ```

---

## Benefits After Migration

!!! success "What You Gain"

=== "Mobile Support"
    ```javascript
    // Same backend, different frontend
    // Web: Alpine + Verity
    // Mobile: React Native + Verity
    // Desktop: Electron + Verity
    ```

=== "Framework Choice"
    ```html
    <!-- Start with Alpine -->
    <div x-data="...">Alpine</div>
    
    <!-- Switch to React later without changing backend -->
    function App() { return <div>React</div> }
    ```

=== "Rich Client-Side State"
    ```html
    <div x-data="{
      // View-state (client-owned)
      filter: 'active',
      sortBy: 'priority',
      viewMode: 'grid',
      selectedIds: [],
      
      // Truth-state (server-owned)
      todos: $verity.collection('todos', {
        filter: this.filter,
        sortBy: this.sortBy
      })
    }">
    ```

=== "Better UX"
    ```html
    <!-- Honest loading states -->
    <template x-if="todos.state.loading">
      <div class="skeleton"></div>
    </template>
    
    <!-- Optimistic-free mutations -->
    <button @click="save()" :disabled="isSaving">
      <span x-show="isSaving">Saving...</span>
      <span x-show="!isSaving">Save</span>
    </button>
    ```

---

## Checklist

!!! success "Migration Checklist"
    
    **Planning:**
    - [ ] Choose frontend framework (Alpine recommended)
    - [ ] Identify pages to migrate
    - [ ] Plan migration order (read-only first)
    
    **Setup:**
    - [ ] Install Verity + framework
    - [ ] Create Verity registry
    - [ ] Set up SSE endpoint (optional)
    
    **Backend:**
    - [ ] Create JSON API endpoints
    - [ ] Add directive returns to mutations
    - [ ] Keep htmx endpoints during migration
    
    **Frontend:**
    - [ ] Convert templates to framework components
    - [ ] Replace hx-get with Verity collections
    - [ ] Replace hx-post/put with directive-based mutations
    - [ ] Add proper loading states
    
    **Testing:**
    - [ ] Test each migrated page
    - [ ] Verify real-time sync (if using SSE)
    - [ ] Check mobile compatibility
    
    **Cleanup:**
    - [ ] Remove htmx
    - [ ] Remove unused templates
    - [ ] Remove old HTML endpoints

---

## When NOT to Migrate

!!! warning "Stay with htmx If"
    
    - Your app is primarily server-rendered content
    - You don't need mobile/desktop apps
    - You value extreme simplicity
    - Your team is backend-heavy
    - Progressive enhancement without JS is critical
    
    **htmx is excellent for many use cases!** Only migrate if you truly need what Verity provides.

---

## Next Steps

<div class="grid" markdown>

[Alpine.js Docs :simple-alpinedotjs:](https://alpinejs.dev){ .md-button .md-button--primary }
[Getting Started :material-rocket-launch:](../guides/getting-started.md){ .md-button }
[UX Patterns :material-palette:](../guides/ux-patterns.md){ .md-button }

</div>

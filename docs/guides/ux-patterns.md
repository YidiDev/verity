# UX Patterns: Honest Loading States

> How to build trustworthy interfaces that never lie to users

Verity's philosophy is simple: **never show users something that isn't true**. This guide shows you how to implement honest, calm UX patterns.

---

## The Honesty Principle

!!! quote "Core Philosophy"
    If a piece of data cannot be proven, Verity keeps it in a loading state. Truth beats speed.

Most UI libraries encourage **optimistic updates**—showing users speculative state before the server confirms it. Verity takes the opposite approach: **show honest loading affordances until the server confirms truth**.

---

## Loading State Hierarchy

=== "Unknown Data"
    **When:** First load, no cached data exists
    
    **Show:** Skeleton or spinner
    
    **Never:** Empty state or placeholder data
    
    ```html
    <template x-if="!user.data">
      <div class="skeleton">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-text"></div>
      </div>
    </template>
    ```

=== "Stale Data"
    **When:** Cached data exists, refetch in progress
    
    **Show:** Current data with subtle indicator
    
    **Never:** Blank screen or spinner
    
    ```html
    <div :class="{ 'opacity-75': user.meta.loading }">
      <h2 x-text="user.data.name"></h2>
      <template x-if="user.meta.loading">
        <span class="text-xs text-gray-500">Updating...</span>
      </template>
    </div>
    ```

=== "Error State"
    **When:** Fetch failed
    
    **Show:** Error message with retry
    
    **Never:** Silent failure or stale data
    
    ```html
    <template x-if="user.meta.error">
      <div class="error">
        <p>Failed to load user data</p>
        <button @click="user.refresh()">Retry</button>
      </div>
    </template>
    ```

---

## Pattern: Skeletons for Unknown Data

!!! tip "Use skeletons, not spinners, for content areas"
    Skeletons maintain layout and feel calmer than spinners.

### List Skeletons

```html
<div x-data="{ users: $verity.collection('users') }">
  <!-- Loading state: Show skeleton rows -->
  <template x-if="users.state.loading && !users.state.items.length">
    <div class="skeleton-list">
      <div class="skeleton-row" x-for="i in 5"></div>
    </div>
  </template>
  
  <!-- Loaded state: Show real data -->
  <template x-if="users.state.items.length">
    <ul>
      <template x-for="user in users.state.items" :key="user.id">
        <li x-text="user.name"></li>
      </template>
    </ul>
  </template>
</div>
```

### Detail View Skeletons

```html
<div x-data="{ user: $verity.item('user', userId) }">
  <template x-if="!user.data">
    <div class="skeleton-profile">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-title"></div>
      <div class="skeleton-text"></div>
      <div class="skeleton-text"></div>
    </div>
  </template>
  
  <template x-if="user.data">
    <div class="profile">
      <img :src="user.data.avatar" />
      <h1 x-text="user.data.name"></h1>
      <p x-text="user.data.bio"></p>
    </div>
  </template>
</div>
```

---

## Pattern: Spinners for Actions

!!! success "Show spinners immediately on user actions"
    Button spinners communicate that work is happening.

### Button States

=== "Idle"
    ```html
    <button @click="saveUser()">
      Save
    </button>
    ```

=== "Loading"
    ```html
    <button disabled>
      <span class="spinner"></span>
      Saving...
    </button>
    ```

=== "Success (brief)"
    ```html
    <button disabled>
      <span class="checkmark">✓</span>
      Saved!
    </button>
    ```

### Complete Implementation

```html
<div x-data="{
  isSaving: false,
  saveSuccess: false,
  
  async save() {
    this.isSaving = true
    this.saveSuccess = false
    
    const res = await fetch('/api/users/123', {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'X-Client-ID': registry.clientId 
      },
      body: JSON.stringify(this.formData)
    })
    
    const { directives } = await res.json()
    DL.applyDirectives(directives)
    
    this.isSaving = false
    this.saveSuccess = true
    
    setTimeout(() => { this.saveSuccess = false }, 2000)
  }
}">
  <button 
    @click="save()" 
    :disabled="isSaving || saveSuccess"
    class="btn"
  >
    <template x-if="isSaving">
      <span class="spinner"></span>
    </template>
    <template x-if="saveSuccess">
      <span>✓</span>
    </template>
    <span x-text="isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save'"></span>
  </button>
</div>
```

!!! warning "Never disable without visual feedback"
    ```html
    <!-- ❌ BAD: User doesn't know why button is disabled -->
    <button :disabled="isSaving">Save</button>
    
    <!-- ✅ GOOD: Clear visual feedback -->
    <button :disabled="isSaving">
      <span x-show="isSaving" class="spinner"></span>
      <span x-text="isSaving ? 'Saving...' : 'Save'"></span>
    </button>
    ```

---

## Pattern: No Optimistic Updates

!!! danger "Never show speculative data"
    Optimistic updates create flicker and erode trust.

### ❌ Anti-Pattern: Optimistic Toggle

```javascript
// DON'T DO THIS
async function toggleComplete(todo) {
  // Optimistically update UI
  todo.completed = !todo.completed  // ← LYING TO USER
  
  try {
    await fetch(`/api/todos/${todo.id}/toggle`, { method: 'PUT' })
  } catch (error) {
    // Oops, rollback
    todo.completed = !todo.completed  // ← FLICKER AND CONFUSION
    alert('Failed to update')
  }
}
```

### ✅ Correct Pattern: Honest Loading State

```html
<div x-data="{
  isToggling: false,
  
  async toggleComplete(id) {
    this.isToggling = true
    
    const res = await fetch(`/api/todos/${id}/toggle`, {
      method: 'PUT',
      headers: { 'X-Client-ID': registry.clientId }
    })
    
    const { directives } = await res.json()
    DL.applyDirectives(directives)
    
    this.isToggling = false
  }
}">
  <div :class="{ 'opacity-50': isToggling }">
    <input 
      type="checkbox" 
      :checked="todo.completed"
      @change="toggleComplete(todo.id)"
      :disabled="isToggling"
    >
    <span x-text="todo.title"></span>
    <template x-if="isToggling">
      <span class="spinner-sm"></span>
    </template>
  </div>
</div>
```

**What users see:**
1. Click checkbox
2. Checkbox shows spinner (honest: work is happening)
3. Server responds
4. Directive refetches todo
5. Checkbox updates to new state (truth from server)

**No flicker. No rollbacks. Just truth.**

---

## Pattern: Silent vs Loud Fetches

Verity distinguishes between background hydration and user-visible refreshes.

### Silent Fetches (Background Hydration)

Use for **list items loading in the background**.

```html
<ul>
  <template x-for="id in todoIds" :key="id">
    <li x-data="{ todo: $verity.item('todo', id, null, { silent: true }) }">
      <!-- No spinner, show skeleton if no data -->
      <template x-if="!todo.data">
        <div class="skeleton-item"></div>
      </template>
      
      <template x-if="todo.data">
        <span x-text="todo.data.title"></span>
      </template>
    </li>
  </template>
</ul>
```

!!! info "Silent fetches"
    - No spinner overlay
    - Show skeleton if no cached data
    - Update seamlessly when data arrives

### Loud Fetches (User-Triggered)

Use for **explicit user actions** like opening a detail view.

```html
<div x-data="{ todo: $verity.item('todo', todoId, 'detailed') }">
  <!-- Show spinner overlay for loud fetch -->
  <template x-if="todo.meta.loading">
    <div class="spinner-overlay">
      <div class="spinner"></div>
      <p>Loading details...</p>
    </div>
  </template>
  
  <template x-if="todo.data">
    <div class="details">
      <h2 x-text="todo.data.title"></h2>
      <p x-text="todo.data.description"></p>
    </div>
  </template>
</div>
```

!!! info "Loud fetches"
    - Show spinner overlay
    - Block interaction during fetch
    - Clear feedback that work is happening

---

## Pattern: Refetch Overlays

When directives trigger refetch, show subtle feedback.

### Subtle Refetch Indicator

```html
<div x-data="{ users: $verity.collection('users') }">
  <div class="relative">
    <!-- Subtle overlay on refetch -->
    <template x-if="users.state.loading && users.state.items.length">
      <div class="absolute top-0 right-0 p-2">
        <span class="text-xs text-gray-500">
          <span class="spinner-xs"></span>
          Updating...
        </span>
      </div>
    </template>
    
    <!-- Main content stays visible -->
    <ul>
      <template x-for="user in users.state.items" :key="user.id">
        <li x-text="user.name"></li>
      </template>
    </ul>
  </div>
</div>
```

### Full Overlay for Critical Updates

```html
<div x-data="{ order: $verity.item('order', orderId) }">
  <div class="relative">
    <!-- Full overlay for order status changes -->
    <template x-if="order.meta.loading">
      <div class="overlay">
        <div class="spinner"></div>
        <p>Refreshing order status...</p>
      </div>
    </template>
    
    <div class="order-details" :class="{ 'blur-sm': order.meta.loading }">
      <h2>Order #<span x-text="order.data?.id"></span></h2>
      <span class="badge" x-text="order.data?.status"></span>
    </div>
  </div>
</div>
```

---

## Pattern: Error Handling

### Display Errors Clearly

```html
<div x-data="{ users: $verity.collection('users') }">
  <!-- Error state -->
  <template x-if="users.state.error">
    <div class="error-message">
      <div class="error-icon">⚠️</div>
      <div>
        <h3>Failed to load users</h3>
        <p x-text="users.state.error.message"></p>
        <button @click="users.refresh()" class="btn-retry">
          Try Again
        </button>
      </div>
    </div>
  </template>
  
  <!-- Success state -->
  <template x-if="!users.state.error">
    <!-- ... render users ... -->
  </template>
</div>
```

### Inline Error with Retry

```html
<div x-data="{ user: $verity.item('user', userId) }">
  <template x-if="user.meta.error">
    <div class="inline-error">
      <span class="text-red-600">Failed to load user</span>
      <button @click="user.refresh()" class="text-blue-600 text-sm ml-2">
        Retry
      </button>
    </div>
  </template>
</div>
```

---

## Pattern: Progressive Disclosure

Load minimal data first, more on demand.

=== "List View"
    ```html
    <ul>
      <template x-for="id in productIds" :key="id">
        <li x-data="{ 
          product: $verity.item('product', id, null, { silent: true }),
          showDetails: false
        }">
          <!-- Minimal data: default level -->
          <div @click="showDetails = !showDetails">
            <h3 x-text="product.data?.name"></h3>
            <span x-text="product.data?.price"></span>
          </div>
          
          <!-- Detailed data: loaded on demand -->
          <template x-if="showDetails">
            <div x-data="{ detailed: $verity.item('product', id, 'detailed') }">
              <template x-if="detailed.meta.loading">
                <div class="spinner-sm"></div>
              </template>
              
              <template x-if="detailed.data">
                <div>
                  <p x-text="detailed.data.description"></p>
                  <ul>
                    <template x-for="review in detailed.data.reviews">
                      <li x-text="review.text"></li>
                    </template>
                  </ul>
                </div>
              </template>
            </div>
          </template>
        </li>
      </template>
    </ul>
    ```

=== "Detail View"
    ```html
    <div x-data="{ 
      product: $verity.item('product', productId, 'summary'),
      loadingReviews: false
    }">
      <!-- Always show summary -->
      <div>
        <h1 x-text="product.data?.name"></h1>
        <p x-text="product.data?.description"></p>
      </div>
      
      <!-- Load reviews on click -->
      <button 
        @click="loadingReviews = true; 
                $verity.item('product', productId, 'withReviews')"
        x-show="!loadingReviews"
      >
        Show Reviews
      </button>
      
      <div 
        x-show="loadingReviews" 
        x-data="{ full: $verity.item('product', productId, 'withReviews') }"
      >
        <template x-if="full.meta.loading">
          <div class="spinner"></div>
        </template>
        
        <template x-if="full.data?.reviews">
          <ul>
            <template x-for="review in full.data.reviews">
              <li x-text="review.text"></li>
            </template>
          </ul>
        </template>
      </div>
    </div>
    ```

---

## Pattern: Empty States

!!! tip "Distinguish empty from loading"
    Empty states are only shown when data is loaded and empty.

```html
<div x-data="{ todos: $verity.collection('todos') }">
  <!-- Loading: show skeleton -->
  <template x-if="todos.state.loading && !todos.state.items.length">
    <div class="skeleton-list"></div>
  </template>
  
  <!-- Empty: show empty state -->
  <template x-if="!todos.state.loading && !todos.state.items.length">
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <h3>No todos yet</h3>
      <p>Create your first todo to get started</p>
      <button @click="showCreateModal = true">
        Create Todo
      </button>
    </div>
  </template>
  
  <!-- Data: show list -->
  <template x-if="todos.state.items.length">
    <ul>
      <template x-for="todo in todos.state.items" :key="todo.id">
        <li x-text="todo.title"></li>
      </template>
    </ul>
  </template>
</div>
```

---

## Pattern: Pagination with Loading States

```html
<div x-data="{
  page: 1,
  get todos() {
    return $verity.collection('todos', { page: this.page })
  }
}">
  <!-- Page content -->
  <div :class="{ 'opacity-50': todos.state.loading }">
    <template x-if="!todos.state.items.length && todos.state.loading">
      <div class="skeleton-list"></div>
    </template>
    
    <ul>
      <template x-for="todo in todos.state.items" :key="todo.id">
        <li x-text="todo.title"></li>
      </template>
    </ul>
  </div>
  
  <!-- Pagination controls -->
  <div class="pagination">
    <button 
      @click="page--" 
      :disabled="page === 1 || todos.state.loading"
    >
      Previous
    </button>
    
    <span>Page <span x-text="page"></span></span>
    
    <button 
      @click="page++" 
      :disabled="!todos.state.meta?.hasMore || todos.state.loading"
    >
      <template x-if="todos.state.loading">
        <span class="spinner-xs"></span>
      </template>
      Next
    </button>
  </div>
</div>
```

---

## Pattern: Infinite Scroll

```html
<div 
  x-data="{
    page: 1,
    allItems: [],
    
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
    // Accumulate items across pages
    if (items.length) {
      allItems = [...allItems, ...items.filter(item => 
        !allItems.some(existing => existing.id === item.id)
      )]
    }
  })"
  x-intersect:enter.full="loadMore()"
>
  <ul>
    <template x-for="todo in allItems" :key="todo.id">
      <li x-text="todo.title"></li>
    </template>
  </ul>
  
  <!-- Loading more indicator -->
  <template x-if="todos.state.loading">
    <div class="loading-more">
      <span class="spinner"></span>
      Loading more...
    </div>
  </template>
  
  <!-- End of list -->
  <template x-if="!todos.state.loading && !todos.state.meta?.hasMore">
    <div class="text-center text-gray-500 py-4">
      No more items
    </div>
  </template>
</div>
```

---

## CSS Examples

### Skeleton Styles

```css
.skeleton {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
}

@keyframes pulse {
  0%, 100% { background-position: 200% 0; }
  50% { background-position: 0 0; }
}

.skeleton-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #e0e0e0;
}

.skeleton-text {
  height: 16px;
  margin: 8px 0;
  border-radius: 4px;
  background: #e0e0e0;
}

.skeleton-row {
  height: 60px;
  margin: 8px 0;
  border-radius: 8px;
  background: #e0e0e0;
}
```

### Spinner Styles

```css
.spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

.spinner-xs {
  width: 12px;
  height: 12px;
  border-width: 2px;
}
```

### Overlay Styles

```css
.overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.spinner-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(2px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
```

---

## Summary

!!! success "Verity UX Principles"
    1. **Skeletons for unknown data** - Maintain layout, feel calm
    2. **Spinners for user actions** - Immediate feedback on clicks
    3. **No optimistic updates** - Wait for server confirmation
    4. **Silent vs loud fetches** - Background vs user-triggered
    5. **Subtle refetch indicators** - Don't hide existing data
    6. **Clear error states** - Always offer retry
    7. **Empty vs loading** - Show empty only when data is loaded
    8. **Progressive disclosure** - Load more detail on demand

**The result:** Users always know what's happening, and they never see incorrect data.

---

## Next Steps

- Study [Concurrency Model](../concepts/concurrency-model.md) for silent/loud fetch details
- Review [State Model](state-model.md) for cache and loading states
- Check [Examples](../examples.md) to see these patterns in action

# Truth-State vs View-State

> The most important distinction in Verity's mental model

This is the foundational concept that drives everything else in Verity. If you understand this distinction, the rest of the library will make intuitive sense.

---

## The Core Problem

Modern frontend development often blurs two fundamentally different kinds of state:

### Truth-State
**Server-owned, authoritative application data**

Examples:
- User profiles and account information
- Order status and transaction history
- Inventory counts and product catalogs
- Permissions and access control lists
- Audit logs and compliance records
- Any data that multiple clients must agree on

### View-State
**Client-owned, ephemeral UI concerns**

Examples:
- Which dropdown menu is open
- Which table row is expanded
- Which tab is currently active
- Form draft values (before submission)
- Sidebar collapse state
- Dark mode preference (unless persisted server-side)

---

## Why This Matters

When these two kinds of state get mixed together in the same store or component, several problems emerge:

### 1. Race Conditions
```javascript
// ❌ BAD: Truth-state and view-state mixed
const store = {
  users: [],           // truth-state
  sortColumn: 'name',  // view-state
  sortOrder: 'asc',    // view-state
  selectedUser: null   // view-state
}

// What happens when server updates users while UI is sorting?
// Which state wins? How do you merge?
```

### 2. Stale Data
```javascript
// ❌ BAD: View optimistically updates truth-state
function deleteUser(id) {
  // Optimistically remove from UI
  store.users = store.users.filter(u => u.id !== id)
  
  // What if the server rejects this?
  // How do you roll back?
  // What if another tab doesn't see this change?
  fetch(`/api/users/${id}`, { method: 'DELETE' })
}
```

### 3. Multi-Client Inconsistency
```javascript
// ❌ BAD: Each client manages its own truth-state
// Tab A shows user status as "active"
// Tab B shows same user status as "suspended"
// Which is correct? No way to know.
```

### 4. Debugging Nightmares
```javascript
// ❌ BAD: Can't tell what came from server vs what was guessed
console.log(store.users[0])
// Did this data come from /api/users?
// Or did we optimistically update it?
// Is it fresh or stale?
// No way to tell from looking at the state
```

---

## Verity's Solution: Hard Separation

Verity enforces a clean boundary:

### Truth-State → Managed by Verity
```javascript
// Verity owns truth-state
DL.init()

DL.createCollection('users', {
  fetch: () => fetch('/api/users').then(r => r.json())
})

DL.createType('user', {
  fetch: ({ id }) => fetch(`/api/users/${id}`).then(r => r.json())
})

// Truth-state is:
// - Fetched from server
// - Updated via directives
// - Cached with staleness tracking
// - Synchronized across clients
```

### View-State → Managed by View Layer
```javascript
// Alpine example
<div x-data="{ 
  users: $verity.collection('users'),  // ← truth-state from Verity
  sortColumn: 'name',                   // ← view-state in Alpine
  sortOrder: 'asc',                     // ← view-state in Alpine
  selectedUserId: null                  // ← view-state in Alpine
}">

// React example
function UserList() {
  const users = useCollection('users')  // ← truth-state from Verity
  const [sortColumn, setSortColumn] = useState('name')  // ← view-state in React
  const [sortOrder, setSortOrder] = useState('asc')     // ← view-state in React
  const [selectedId, setSelectedId] = useState(null)    // ← view-state in React
}
```

---

## The Smell Test

**How do you know if something is truth-state or view-state?**

Ask these questions:

### Question 1: "If I reload the page, should this persist?"
- ✅ Yes → Probably truth-state (fetch it from server)
- ❌ No → Probably view-state (reset to default)

### Question 2: "If a coworker opens this on another device, should they see the same thing?"
- ✅ Yes → Definitely truth-state (server is source of truth)
- ❌ No → Definitely view-state (local to this client)

### Question 3: "If this gets out of sync with the server, is that a bug?"
- ✅ Yes → Truth-state (must stay synchronized)
- ❌ No → View-state (doesn't matter if different)

### Question 4: "Does the backend need to know about this?"
- ✅ Yes → Truth-state (involves business logic)
- ❌ No → View-state (pure UI concern)

---

## Examples in Practice

### E-Commerce Application

#### Truth-State (Verity)
- Product catalog and inventory
- Shopping cart contents
- Order history
- User profile and addresses
- Payment status
- Wishlist items

#### View-State (Framework)
- Product image carousel position
- Filters expanded/collapsed
- Sort preference (price, rating, newest)
- Quick view modal open/closed
- Notification toast visibility

### Project Management Tool

#### Truth-State (Verity)
- Project list and metadata
- Task assignments and status
- Comments and attachments
- Team member roles
- Due dates and milestones

#### View-State (Framework)
- Sidebar expanded/collapsed
- Task detail panel open/closed
- Current view (board, list, calendar)
- Selected date range filter
- Draft comment text (before posting)

### Real-Time Dashboard

#### Truth-State (Verity)
- Metrics and KPIs
- Alert states and thresholds
- System health status
- User activity logs

#### View-State (Framework)
- Time range selector (last hour, day, week)
- Chart type (line, bar, pie)
- Auto-refresh on/off
- Widget arrangement
- Zoom level

---

## Anti-Patterns to Avoid

### ❌ Storing Server Data in Component State

```javascript
// ❌ BAD
function UserProfile({ userId }) {
  const [user, setUser] = useState(null)  // truth-state in component!
  
  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then(r => r.json())
      .then(setUser)
  }, [userId])
  
  // Problems:
  // - No caching across components
  // - No staleness tracking
  // - No multi-client sync
  // - Fetches on every mount
}

// ✅ GOOD
function UserProfile({ userId }) {
  const user = useItem('user', userId)  // truth-state from Verity
  
  // Benefits:
  // - Cached and shared
  // - Staleness tracked
  // - Synced via directives
  // - Deduped fetches
}
```

### ❌ Mixing Truth and View State

```javascript
// ❌ BAD
const store = {
  todos: [],              // truth-state
  filter: 'all',          // view-state
  isAddingTodo: false,    // view-state
  newTodoText: ''         // view-state
}

// This creates coupling and confusion

// ✅ GOOD
// Truth-state
const todos = $verity.collection('todos')

// View-state
<div x-data="{ 
  filter: 'all',
  isAddingTodo: false,
  newTodoText: ''
}">
```

### ❌ Optimistic Updates to Truth-State

```javascript
// ❌ BAD
async function completeTodo(id) {
  // Optimistically mark complete
  todo.completed = true  // ← lying to the user!
  
  try {
    await fetch(`/api/todos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ completed: true })
    })
  } catch (e) {
    // Oops, rollback
    todo.completed = false  // ← flicker and confusion
  }
}

// ✅ GOOD
async function completeTodo(id) {
  // Show honest loading state
  isCompletingTodo = true
  
  const res = await fetch(`/api/todos/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ completed: true })
  })
  
  const { directives } = await res.json()
  
  // Server tells us what changed
  await applyDirectives(directives)
  
  isCompletingTodo = false
}
```

---

## Benefits of Separation

### 1. Correctness
- Truth-state always matches server
- No stale data bugs
- No optimistic update rollbacks

### 2. Simplicity
- Clear ownership boundaries
- Each layer does one thing well
- Easier to reason about data flow

### 3. Multi-Client Sync
- Directives keep truth-state in sync
- View-state is intentionally local
- No confusion about what should sync

### 4. Debuggability
- Verity devtools show truth-state
- Framework devtools show view-state
- Clear separation in logs

### 5. Performance
- Verity caches and deduplicates
- Framework only manages local state
- No accidental refetches

---

## Decision Framework

When adding new state to your application:

```
┌─────────────────────────────────────┐
│  Does the server know about this?  │
└──────────┬──────────────────────────┘
           │
     ┌─────┴─────┐
     ↓           ↓
    YES         NO
     │           │
     ↓           ↓
TRUTH-STATE  VIEW-STATE
     │           │
Use Verity   Use Framework
     │           │
     ↓           ↓
registry.   useState()
register    x-data={}
Collection  ref()
Type        etc.
```

---

## Real-World Scenario

Let's walk through a complete example:

### Feature: User can filter and view invoice list

#### Identify State Types

**Truth-State (Verity manages):**
- Invoice records (id, title, amount, status, due_date)
- Invoice count
- Last update timestamp

**View-State (Framework manages):**
- Current filter selection (all, paid, unpaid, overdue)
- Sort column and direction
- Expanded invoice ID (for detail view)
- Search query text (before applying filter)

#### Implementation

```javascript
// 1. Register truth-state with Verity
DL.createCollection('invoices', {
  fetch: async (params = {}) => {
    const url = new URL('/api/invoices', location.origin)
    if (params.status) url.searchParams.set('status', params.status)
    return fetch(url).then(r => r.json())
  }
})

// 2. Manage view-state in component
<div x-data="{
  // VIEW-STATE: managed by Alpine
  filterStatus: 'all',
  sortBy: 'due_date',
  sortOrder: 'asc',
  expandedId: null,
  
  // TRUTH-STATE: accessed via Verity
  get invoices() {
    return $verity.collection('invoices', {
      status: this.filterStatus === 'all' ? null : this.filterStatus
    })
  },
  
  // VIEW BEHAVIOR: pure transformation
  get sortedInvoices() {
    const items = [...this.invoices.items]
    items.sort((a, b) => {
      const aVal = a[this.sortBy]
      const bVal = b[this.sortBy]
      return this.sortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })
    return items
  }
}">
```

#### What This Achieves

1. **Truth-state is synchronized**: If another user or tab changes an invoice, directives update all clients
2. **View-state is local**: Each user can have their own filter/sort preference
3. **Clear boundaries**: You can see exactly what comes from the server vs what's local UI state
4. **No race conditions**: Server is always the authority for invoice data
5. **Simple to test**: View behavior is pure functions, truth-state comes from Verity

---

## Summary

**Truth-State:**
- Server-owned
- Managed by Verity
- Synchronized across clients
- Cached with staleness tracking
- Updated via directives

**View-State:**
- Client-owned
- Managed by framework
- Local to one user/tab/session
- Never leaves the client
- Resets on reload (usually)

**The Rule:**
If it's on the server, it's truth-state. If it's only in the UI, it's view-state. Never mix them.

---

## Next Steps

1. Read [Directives](directives.md) to understand how truth-state stays synchronized
2. Study [Architecture](../architecture.md) to see where each type of state lives
3. Review [UX Patterns](../guides/ux-patterns.md) for handling loading states honestly
4. Check [Getting Started](../guides/getting-started.md) for practical implementation

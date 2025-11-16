# Levels & Conversions: Minimal Fetching Strategy

> How Verity fetches just enough data—no more, no less

Levels are Verity's answer to a common problem: **How do you fetch the right amount of data for different views without over-fetching or making redundant requests?**

---

## The Problem

Different parts of your UI need different amounts of detail about the same entity:

```javascript
// List view needs minimal data
{
  id: 42,
  title: "Fix bug",
  status: "open"
}

// Detail view needs more
{
  id: 42,
  title: "Fix bug",
  status: "open",
  description: "Long description...",
  assignee: { id: 1, name: "Alice" },
  comments: [...],
  history: [...]
}

// Sidebar preview needs something in between
{
  id: 42,
  title: "Fix bug",
  status: "open",
  description: "Long description..."
}
```

### Common Approaches (and their problems)

**Approach 1: Always fetch everything**
```javascript
// ❌ Wasteful
fetch(`/api/todos/${id}?include=comments,history,assignee`)
// Even for list view that only shows title!
```

**Approach 2: Field-level normalization (GraphQL-style)**
```javascript
// ❌ Complex, leaky
const query = gql`
  fragment TodoListItem on Todo {
    id title status
  }
  fragment TodoDetail on Todo {
    id title status description assignee { name } comments { text }
  }
`
// Now your backend needs to support arbitrary field combinations
// And your cache needs to track field-level dependencies
```

**Approach 3: Multiple endpoints**
```javascript
// ❌ Rigid, hard to evolve
GET /api/todos/${id}/summary
GET /api/todos/${id}/full
GET /api/todos/${id}/with-comments
// Combinatorial explosion
```

---

## Verity's Solution: Named Levels

Define **explicit, named** detail levels for each entity type:

```javascript
registry.registerType('todo', {
  // Default level (minimal)
  fetch: ({ id }) => 
    fetch(`/api/todos/${id}`).then(r => r.json()),
  
  // Additional levels
  levels: {
    detailed: {
      fetch: ({ id }) => 
        fetch(`/api/todos/${id}?level=detailed`).then(r => r.json()),
      checkIfExists: (obj) => 'description' in obj && 'assignee' in obj
    },
    
    full: {
      fetch: ({ id }) => 
        fetch(`/api/todos/${id}?level=full`).then(r => r.json()),
      checkIfExists: (obj) => 'comments' in obj && 'history' in obj
    }
  }
})
```

**Benefits:**
- Explicit contract between frontend and backend
- Easy to evolve (just add new levels)
- Cache tracks level freshness
- Minimal refetching via conversions

---

## How Levels Work

### Basic Usage

```html
<script type="module">
import { createRegistry } from 'https://cdn.jsdelivr.net/npm/verity-dl@latest/+esm'

const registry = createRegistry()

// Request a specific level
const todo = registry.item('todo', 42, 'detailed')

// Access data
if (todo.meta.loading) {
  console.log('Loading...')
} else {
  console.log(todo.data.description)  // Available at 'detailed' level
}
</script>
```

### Level Caching

```javascript
// First request: fetches 'detailed' level
const todo1 = registry.item('todo', 42, 'detailed')
// → fetch('/api/todos/42?level=detailed')

// Second request: uses cached data (if fresh)
const todo2 = registry.item('todo', 42, 'detailed')
// → no fetch, returns cached data

// Different level: fetches separately
const todo3 = registry.item('todo', 42, 'full')
// → fetch('/api/todos/42?level=full')
```

### Staleness Per Level

```javascript
registry.registerType('todo', {
  stalenessMs: 60_000,  // Default: 60s
  
  levels: {
    detailed: {
      fetch: ({ id }) => fetch(`/api/todos/${id}?level=detailed`).then(r => r.json()),
      checkIfExists: (obj) => 'description' in obj,
      stalenessMs: 300_000  // Detailed level stays fresh for 5 minutes
    }
  }
})
```

---

## Conversion Graphs: The Key Innovation

Here's where Verity gets clever: **One fetch can satisfy multiple levels without re-fetching.**

### The Problem

```javascript
// User requests 'full' level
const todo = registry.item('todo', 42, 'full')
// → fetch('/api/todos/42?level=full')
// Returns: { id, title, status, description, assignee, comments, history }

// Later, user requests 'detailed' level
const todo2 = registry.item('todo', 42, 'detailed')
// → Should we refetch? Or does 'full' data satisfy 'detailed'?
```

**Without conversions:**
- Refetch (wasteful)
- Or assume 'full' includes 'detailed' (fragile, implicit)

**With conversions:**
- Explicitly declare that 'full' → 'detailed'
- Verity checks if data satisfies 'detailed'
- If yes, marks 'detailed' as fresh (no refetch)

### Declaring Conversions

```javascript
registry.registerType('todo', {
  fetch: ({ id }) => fetch(`/api/todos/${id}`).then(r => r.json()),
  
  levels: {
    detailed: {
      fetch: ({ id }) => fetch(`/api/todos/${id}?level=detailed`).then(r => r.json()),
      checkIfExists: (obj) => 'description' in obj && 'assignee' in obj,
      
      // Conversion: if we have 'full', we can derive 'detailed'
      levelConversionMap: {
        full: true  // ← 'full' data can satisfy 'detailed'
      }
    },
    
    full: {
      fetch: ({ id }) => fetch(`/api/todos/${id}?level=full`).then(r => r.json()),
      checkIfExists: (obj) => 'comments' in obj && 'history' in obj,
      
      // Conversion: 'full' can also satisfy the default level
      levelConversionMap: {
        null: true  // ← 'full' data can satisfy default level
      }
    }
  }
})
```

### Conversion Graph

```
       ┌──────────┐
       │   full   │
       └────┬─────┘
            │
       ┌────▼─────┐
       │ detailed │
       └────┬─────┘
            │
       ┌────▼─────┐
       │ default  │
       └──────────┘
```

**What this means:**
- Fetching 'full' marks all three levels as fresh
- Fetching 'detailed' marks 'detailed' and 'default' as fresh
- Fetching 'default' only marks 'default' as fresh

### How Conversion Works

1. **User requests level:** `registry.item('todo', 42, 'detailed')`
2. **Verity checks cache:** Do we have fresh 'detailed' data?
3. **If not, check conversions:** Do we have fresh 'full' data?
4. **If yes:**
   - Run `checkIfExists` on cached 'full' data
   - If it passes, mark 'detailed' as fresh with same timestamp
   - Return cached data (no fetch!)
5. **If no:** Fetch 'detailed' level from server

---

## The Maximal Level Pattern

**Best practice:** Define one "maximal" level that includes all fields, then derive narrower levels from it.

```javascript
registry.registerType('todo', {
  // Minimal default
  fetch: ({ id }) => fetch(`/api/todos/${id}`).then(r => r.json()),
  
  levels: {
    // Maximal level: union of all fields
    expanded: {
      fetch: ({ id }) => fetch(`/api/todos/${id}?level=expanded`).then(r => r.json()),
      checkIfExists: (obj) => 
        'description' in obj && 
        'assignee' in obj && 
        'comments' in obj && 
        'history' in obj,
      
      // Expanded can satisfy everything
      levelConversionMap: {
        detailed: true,
        null: true  // and default
      }
    },
    
    // Narrow level derived from expanded
    detailed: {
      fetch: ({ id }) => fetch(`/api/todos/${id}?level=detailed`).then(r => r.json()),
      checkIfExists: (obj) => 'description' in obj && 'assignee' in obj,
      
      levelConversionMap: {
        expanded: true,  // expanded → detailed
        null: true       // detailed → default
      }
    }
  }
})
```

**Server directive strategy:**
```python
@app.put('/api/todos/<int:id>')
def update_todo(id):
    # ... update todo ...
    
    return {
        'directives': [{
            'op': 'refresh_item',
            'name': 'todo',
            'id': id,
            # Include maximal level in directive payload
            'result': todo.to_dict(level='expanded')
        }]
    }
```

**Benefits:**
- Server only sends one level
- Verity uses conversions to satisfy all levels client needs
- Minimal network traffic
- Maximum freshness

---

## Directive Refetching with Levels

When a `refresh_item` directive arrives:

```javascript
// Directive says: "todo 42 changed"
{
  op: 'refresh_item',
  name: 'todo',
  id: 42
}
```

**Verity's refetch algorithm:**

1. **Identify levels in use:**
   - Check which levels the client currently holds
   - Example: client has 'default' and 'detailed' cached

2. **Apply directive payload (if provided):**
   - If directive includes `result`, apply it
   - Run conversion graph to populate derived levels

3. **Plan minimal fetches:**
   - For each level in use, check if directive payload satisfied it
   - If not, add to fetch plan
   - Use conversion graph to deduplicate fetches

4. **Execute fetch plan:**
   - Fetch only the levels not satisfied by payload/conversions
   - Always fetch at least one level (even if graph has cycles)

### Example: Directive with Payload

```javascript
// Server returns:
{
  directives: [{
    op: 'refresh_item',
    name: 'todo',
    id: 42,
    result: {  // ← Full 'expanded' level
      id: 42,
      title: 'Updated',
      status: 'done',
      description: '...',
      assignee: {...},
      comments: [...],
      history: [...]
    }
  }]
}

// Client has 'detailed' and 'default' levels in use
// Verity:
// 1. Applies 'result' to 'expanded' level
// 2. Runs conversion: expanded → detailed ✓
// 3. Runs conversion: expanded → default ✓
// 4. Both levels now fresh, no refetch needed!
```

---

## Advanced Patterns

### Multiple Conversion Paths

```javascript
levels: {
  withComments: {
    checkIfExists: (obj) => Array.isArray(obj.comments),
    levelConversionMap: {
      full: true,      // full → withComments
      expanded: true   // expanded → withComments
    }
  }
}
```

Conversion graph:
```
    ┌──────┐
    │ full │
    └──┬───┘
       │
    ┌──▼─────────┐
    │  expanded  │
    └──┬─────────┘
       │
       ├─────────┐
       │         │
   ┌───▼───┐ ┌──▼─────────┐
   │detail │ │withComments│
   └───┬───┘ └────────────┘
       │
   ┌───▼────┐
   │default │
   └────────┘
```

### Conditional Checks

```javascript
levels: {
  detailed: {
    fetch: ({ id }) => fetch(`/api/todos/${id}?level=detailed`).then(r => r.json()),
    
    // Complex check
    checkIfExists: (obj) => {
      if (!obj) return false
      if (!('description' in obj)) return false
      if (!obj.assignee || !obj.assignee.name) return false
      return true
    },
    
    levelConversionMap: {
      full: true
    }
  }
}
```

### Bidirectional Conversions (Advanced)

```javascript
// Rare: two levels that can satisfy each other
levels: {
  withComments: {
    checkIfExists: (obj) => Array.isArray(obj.comments),
    levelConversionMap: {
      withHistory: ['withComments']  // if withHistory has comments
    }
  },
  
  withHistory: {
    checkIfExists: (obj) => Array.isArray(obj.history),
    levelConversionMap: {
      withComments: ['withHistory']  // if withComments has history
    }
  }
}
```

**Note:** Verity's algorithm handles cycles and always fetches at least one level to ensure freshness.

---

## Performance Implications

### Cache Hit Rates

**Without conversions:**
```
User visits list → fetch default
User opens detail → fetch detailed
User edits → directive → refetch both levels
Result: 3 fetches
```

**With conversions:**
```
User visits list → fetch default
User opens detail → fetch expanded (includes detailed + default)
User edits → directive with expanded payload → 0 refetches (conversions!)
Result: 2 fetches total
```

### Memory Usage

Each level is cached separately:

```javascript
// Cache structure
cache.types.get('todo').get(42) = {
  default: { data: {...}, fetchedAt: 1234567890 },
  detailed: { data: {...}, fetchedAt: 1234567900 },
  expanded: { data: {...}, fetchedAt: 1234567910 }
}
```

**Note:** With conversions, you often only store one level (the maximal one) and derive others.

---

## Best Practices

### 1. Use Descriptive Level Names

```javascript
// ❌ Vague
levels: { l1: ..., l2: ..., l3: ... }

// ✅ Clear
levels: {
  summary: ...,
  detailed: ...,
  full: ...
}
```

### 2. Define Clear `checkIfExists`

```javascript
// ❌ Too loose
checkIfExists: (obj) => !!obj

// ✅ Explicit
checkIfExists: (obj) => 
  obj && 
  'description' in obj && 
  typeof obj.description === 'string' &&
  obj.assignee !== undefined
```

### 3. Use Maximal Level + Directive Payloads

```python
# Server: Always return maximal level in directives
{
  'directives': [{
    'op': 'refresh_item',
    'name': 'todo',
    'id': 42,
    'result': todo.to_dict(level='expanded')  # ← Maximal
  }]
}
```

### 4. Don't Over-Engineer Levels

```javascript
// ❌ Too many levels
levels: {
  mini, tiny, small, medium, large, huge, mega, ultra
}

// ✅ Just what you need
levels: {
  summary,    // For lists
  detailed,   // For detail views
  expanded    // With all relations loaded
}
```

---

## Common Scenarios

### Scenario 1: List + Detail View

```javascript
registry.registerType('product', {
  // List view needs: id, name, price, image
  fetch: ({ id }) => fetch(`/api/products/${id}`).then(r => r.json()),
  
  levels: {
    // Detail view adds: description, specs, reviews
    full: {
      fetch: ({ id }) => fetch(`/api/products/${id}?level=full`).then(r => r.json()),
      checkIfExists: (obj) => 'description' in obj && 'reviews' in obj,
      levelConversionMap: {
        null: true  // full includes default
      }
    }
  }
})
```

### Scenario 2: Progressive Enhancement

```javascript
// Start with summary, progressively load more
<div x-data="{
  get product() { return $verity.item('product', productId, currentLevel) },
  currentLevel: 'summary',
  
  loadMore() {
    this.currentLevel = 'detailed'
  },
  
  loadFull() {
    this.currentLevel = 'full'
  }
}">
```

### Scenario 3: Dashboard with Metrics

```javascript
registry.registerType('project', {
  // Minimal: just name and status
  fetch: ({ id }) => fetch(`/api/projects/${id}`).then(r => r.json()),
  
  levels: {
    // With computed metrics (expensive on backend)
    withMetrics: {
      fetch: ({ id }) => fetch(`/api/projects/${id}?include=metrics`).then(r => r.json()),
      checkIfExists: (obj) => 'metrics' in obj,
      stalenessMs: 30_000  // Metrics stale after 30s
    }
  }
})
```

---

## Testing Levels

### Test: Conversion Works

```javascript
test('fetching expanded level satisfies detailed', async () => {
  // Fetch expanded
  const item1 = registry.item('todo', 42, 'expanded')
  await waitFor(() => !item1.meta.loading)
  
  // Request detailed (should not fetch)
  const fetchSpy = vi.spyOn(window, 'fetch')
  const item2 = registry.item('todo', 42, 'detailed')
  
  expect(item2.data).toBe(item1.data)  // Same data
  expect(fetchSpy).not.toHaveBeenCalled()  // No refetch
})
```

### Test: checkIfExists Guards Conversion

```javascript
test('conversion only happens if checkIfExists passes', () => {
  // Fetch incomplete 'expanded' data (missing comments)
  cache.set('todo', 42, 'expanded', {
    id: 42,
    description: 'foo'
    // missing: comments (required for 'expanded')
  })
  
  // Try to use for 'detailed'
  const item = registry.item('todo', 42, 'detailed')
  
  // Should trigger fetch (checkIfExists fails)
  expect(item.meta.loading).toBe(true)
})
```

---

## Summary

**Levels solve the granularity problem:**
- Explicit named levels for different detail needs
- Per-level caching and staleness tracking
- Clear contract between frontend and backend

**Conversions minimize fetching:**
- Declare which levels can satisfy others
- `checkIfExists` guards conversions
- Maximal level pattern avoids redundant fetches

**Directive integration:**
- Include maximal level in directive payloads
- Conversions propagate freshness
- Minimal refetching on updates

---

## Next Steps

1. Study [Concurrency Model](concurrency-model.md) to see how levels interact with in-flight requests
2. Review [Directives](directives.md) to understand directive payloads
3. Check [API Reference](../reference/core.md) for complete level configuration options
4. See [Getting Started](../guides/getting-started.md) for practical examples

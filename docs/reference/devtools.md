# Reference: Devtools

> Visual debugging and inspection overlay for Verity applications

The Verity Devtools provide a **real-time overlay** for inspecting truth-state, directives, SSE events, and cache behavior. Essential for development and debugging.

!!! tip "Quick Start"
    ```html
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.css">
    <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.js"></script>
    ```
    Devtools automatically attach when loaded. Toggle with keyboard shortcut.

---

## Features Overview

The devtools overlay includes four panels:

1. **Truth Panel** - Live snapshot of all cached truth-state
2. **Events Panel** - Timeline of fetch, directive, and SSE events
3. **SSE Panel** - Server-Sent Events connection status and messages
4. **Config Panel** - Registry configuration and settings

---

## Installation

### Browser-Native (CDN)

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Verity Core -->
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
  
  <!-- Devtools CSS -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.css">
</head>
<body>
  <!-- Your app -->
  
  <!-- Devtools JS (load last) -->
  <script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.js"></script>
</body>
</html>
```

### NPM/Build Tools

```bash
npm install verity-dl
```

```javascript
// In your app entry point
import 'verity-dl/devtools/devtools.css'
import 'verity-dl/devtools/devtools.js'
```

---

## Usage

### Opening/Closing Devtools

**Keyboard Shortcuts:**
- **`Ctrl+Shift+D`** (Windows/Linux) or **`Cmd+Shift+D`** (Mac) - Toggle visibility
- **`Escape`** - Hide devtools (when focused)

**UI Controls:**
- Click **Minimize** button to collapse to mini view
- Click **Detach** to open in separate window
- Click **Close** button to hide

### Navigation

**Panel Tabs:**
- **Truth** - View cached truth-state
- **Events** - Timeline of all events
- **SSE** - SSE connection status
- **Config** - Registry settings

**Timeline Controls:**
- **Clear** - Clear event history
- **Pause** - Pause event collection
- **Filter** - Filter by event type

---

## Truth Panel

Shows a **live snapshot** of all cached truth-state.

### What You See

```
Collections
├─ todos (status=active)
│  ├─ items: [12 items]
│  ├─ meta: { total: 12 }
│  ├─ loading: false
│  ├─ error: null
│  └─ stale: false
│
├─ todos (status=completed)
│  ├─ items: [8 items]
│  ├─ meta: { total: 8 }
│  ├─ loading: false
│  ├─ error: null
│  └─ stale: true  ← Stale indicator
│
└─ users (page=1)
   ├─ items: [25 items]
   ├─ meta: { page: 1, total: 100 }
   ├─ loading: true  ← Currently fetching
   └─ error: null

Items
├─ user (userId=123)
│  ├─ value: { id: 123, name: "Alice", ... }
│  ├─ loading: false
│  ├─ error: null
│  └─ stale: false
│
└─ app_settings
   ├─ value: { theme: "dark", ... }
   ├─ loading: false
   └─ error: null
```

### Key Information

| Indicator | Meaning |
|-----------|---------|
| **Green dot** | Fresh (not stale) |
| **Yellow dot** | Stale (can be refetched) |
| **Spinner** | Currently loading |
| **Red dot** | Error state |

### Staleness

Items/collections show staleness based on `stalenessMs` configuration:
- **Fresh**: Recently fetched, within staleness window
- **Stale**: Older than `stalenessMs`, eligible for refetch

### Inspecting Data

Click any collection or item to **expand and view contents**:

```json
{
  "state": {
    "loading": false,
    "error": null,
    "items": [
      { "id": 1, "title": "Buy milk", "completed": false },
      { "id": 2, "title": "Write docs", "completed": true }
    ],
    "meta": {
      "total": 12,
      "page": 1
    }
  },
  "params": {
    "status": "active"
  },
  "cacheKey": "todos:{\"status\":\"active\"}"
}
```

---

## Events Panel

**Timeline of all registry events** with filtering and inspection.

### Event Types

#### Fetch Events

```
[12:34:56.123] FETCH START
  collection: todos
  params: { status: "active" }
  
[12:34:56.456] FETCH SUCCESS
  collection: todos
  params: { status: "active" }
  duration: 333ms
  items: 12
```

**Colors:**
- **Blue** - Fetch started
- **Green** - Fetch succeeded
- **Red** - Fetch failed

#### Directive Events

```
[12:35:01.789] DIRECTIVE
  op: refresh_collection
  name: todos
  params: { status: "active" }
  source: client-abc123  ← From this client
  
[12:35:02.012] DIRECTIVE
  op: refresh_item
  name: todo
  id: 42
  source: client-xyz789  ← From another client (via SSE)
```

**Colors:**
- **Purple** - Directive applied
- **Pink** - Directive skipped (source match)

#### Memory Events

```
[12:35:05.345] CACHE SET
  collection: todos
  params: { status: "active" }
  size: 12 items
  
[12:35:10.678] CACHE INVALIDATE
  collection: todos
  reason: directive
```

**Colors:**
- **Orange** - Cache operation

#### SSE Events

```
[12:35:15.901] SSE MESSAGE
  type: directives
  seq: 42
  audience: global
  directives: 2
  
[12:35:20.234] SSE RECONNECT
  reason: connection_lost
  retry_in: 1000ms
```

**Colors:**
- **Green** - SSE activity
- **Yellow** - SSE warning/reconnect

### Timeline Controls

**Buttons:**
- **Clear** - Clear all events
- **Pause** - Pause event collection (useful for inspecting)
- **Resume** - Resume event collection
- **Export** - Export events as JSON

**Filters:**
- **Fetch** - Show/hide fetch events
- **Directive** - Show/hide directive events
- **Memory** - Show/hide cache events
- **SSE** - Show/hide SSE events

### Inspecting Events

Click any event to see **full details**:

```json
{
  "type": "directive:apply",
  "timestamp": 1735512345678,
  "detail": {
    "directive": {
      "op": "refresh_collection",
      "name": "todos",
      "params": { "status": "active" },
      "source": "client-abc123",
      "idempotency_key": "update-todo-42",
      "timestamp": 1735512345000
    },
    "applied": true,
    "reason": "source_match"
  }
}
```

---

## SSE Panel

**Real-time SSE connection monitoring** and diagnostics.

### Connection Status

```
SSE Connection
├─ Status: Connected ✓
├─ Audience: global
├─ URL: /api/events
├─ Last Message: 2s ago
├─ Sequence: 42
└─ Uptime: 5m 23s
```

**Status Indicators:**
- **Green ✓** - Connected
- **Yellow ⚠** - Connecting/Reconnecting
- **Red ✗** - Disconnected/Error

### Reconnection Behavior

When SSE disconnects, devtools show:

```
SSE Connection
├─ Status: Reconnecting... ⚠
├─ Retry in: 2000ms
├─ Retry attempt: 3/∞
├─ Backoff: exponential (1.5x)
└─ Last error: network_error
```

**Exponential Backoff:**
- Initial delay: 1000ms
- Max delay: 30000ms (30s)
- Multiplier: 1.5x per retry

### Sequence Tracking

SSE messages include sequence numbers to detect gaps:

```
SSE Sequence
├─ Current: 42
├─ Expected: 42 ✓
├─ Gaps detected: 0
└─ Last resync: never
```

**If gap detected:**
```
SSE Sequence
├─ Current: 44
├─ Expected: 43 ✗
├─ Gap detected: seq 43 missing!
└─ Resync triggered: yes
```

Verity automatically triggers `resync()` when gaps detected.

### Message History

Recent SSE messages with content inspection:

```
[12:36:00.123] SSE Message #42
  type: directives
  audience: global
  directives: [
    { op: "refresh_collection", name: "todos" }
  ]
  
[12:36:05.456] SSE Message #43
  type: heartbeat
  timestamp: 1735512365456
```

### Manual Controls

**Buttons:**
- **Reconnect** - Force SSE reconnection
- **Disconnect** - Close SSE connection
- **Connect** - Open SSE connection (if disconnected)

---

## Config Panel

**Registry configuration** and runtime settings.

### Current Configuration

```yaml
Bulk/Coalescing
├─ delayMs: 50ms

Memory Cache
├─ enabled: true
├─ maxItemsPerType: 512
└─ stalenessMs: 60000ms (1 minute)

SSE
├─ enabled: true
├─ url: /api/events
├─ audience: global
├─ withCredentials: true
├─ initialRetryMs: 1000ms
├─ maxRetryMs: 30000ms
└─ retryBackoffFactor: 1.5x

Client
└─ clientId: client-abc123xyz
```

### Registered Types

```
Collections
├─ todos
│  ├─ stalenessMs: 30000ms (30 seconds)
│  └─ check: function defined
│
├─ users
│  └─ stalenessMs: 60000ms (1 minute)
│
└─ orders
   ├─ stalenessMs: 5000ms (5 seconds)
   └─ key: custom function

Items
├─ current_user
│  └─ stalenessMs: 300000ms (5 minutes)
│
└─ app_settings
   └─ stalenessMs: 120000ms (2 minutes)
```

### Runtime Statistics

```
Performance
├─ Total fetches: 142
├─ Cache hits: 89 (62.7%)
├─ Cache misses: 53 (37.3%)
├─ Avg fetch time: 245ms
├─ Directives processed: 38
├─ SSE messages: 156
└─ Uptime: 12m 45s
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+D` / `Cmd+Shift+D` | Toggle devtools visibility |
| `Escape` | Hide devtools |
| `Ctrl+K` / `Cmd+K` | Clear events timeline |
| `Ctrl+P` / `Cmd+P` | Pause/Resume events |
| `1` | Switch to Truth panel |
| `2` | Switch to Events panel |
| `3` | Switch to SSE panel |
| `4` | Switch to Config panel |

---

## Layout and Positioning

### Resize

Drag the **edges or corners** to resize the devtools window.

**Minimum size:** 320×240px

### Move

Drag the **header bar** to reposition the window.

### Minimize

Click **Minimize** button to collapse to mini view:

```
┌─────────────────┐
│ Verity Devtools │  ← Mini bar
└─────────────────┘
```

Click mini bar to restore full view.

### Detach

Click **Detach** to open devtools in a **separate browser window**. Useful for multi-monitor setups.

**In detached mode:**
- Devtools open in new window
- Original page remains unobstructed
- Data still synchronized in real-time

### Persistence

Devtools remember your layout preferences:
- Window size
- Window position
- Minimized state
- Panel selection

Stored in `localStorage` as `veritydl.devtools.layout`.

---

## Production Usage

!!! warning "Remove in Production"
    Devtools are meant for **development only**. Remove them from production builds:

### Option 1: Conditional Loading

```html
<script>
  // Only load devtools in development
  if (window.location.hostname === 'localhost' || window.location.hostname.includes('dev.')) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.css'
    document.head.appendChild(link)
    
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.js'
    document.body.appendChild(script)
  }
</script>
```

### Option 2: Build-Time Exclusion

```javascript
// vite.config.js
export default {
  define: {
    'import.meta.env.DEV': JSON.stringify(process.env.NODE_ENV === 'development')
  }
}
```

```javascript
// app.js
if (import.meta.env.DEV) {
  import('verity-dl/devtools/devtools.css')
  import('verity-dl/devtools/devtools.js')
}
```

### Option 3: Environment Variable

```javascript
// Only import in development
if (process.env.NODE_ENV === 'development') {
  require('verity-dl/devtools/devtools.css')
  require('verity-dl/devtools/devtools.js')
}
```

---

## Common Debugging Scenarios

### Scenario 1: Directive Not Applied

**Problem:** Made a server change but UI didn't update.

**Debug:**
1. Open **Events panel**
2. Look for `DIRECTIVE` event after mutation
3. Check if directive has correct `name` and `params`
4. Verify `source` doesn't match current client (would be skipped)
5. Check **Truth panel** to see if collection/item was invalidated

**Common issues:**
- Server forgot to return directives
- Wrong `name` or `params` in directive
- `check` function returned `false`
- SSE disconnected (check SSE panel)

### Scenario 2: Stale Data

**Problem:** Data looks outdated.

**Debug:**
1. Open **Truth panel**
2. Find the collection/item
3. Check **stale** indicator (yellow dot)
4. Check **last fetch** timestamp
5. Compare with `stalenessMs` setting in **Config panel**

**Solutions:**
- Decrease `stalenessMs` for more aggressive refetching
- Manually call `refresh()` after critical operations
- Ensure directives are being emitted

### Scenario 3: SSE Not Working

**Problem:** Other clients not seeing updates in real-time.

**Debug:**
1. Open **SSE panel**
2. Check connection status (should be green ✓)
3. Look for recent messages
4. Check sequence numbers for gaps
5. Verify audience matches server configuration

**Common issues:**
- SSE endpoint not configured (`sse.url`)
- Wrong audience (`sse.audience`)
- Server not emitting directives
- CORS/auth issues (`sse.withCredentials`)

### Scenario 4: Performance Issues

**Problem:** App feels slow or making too many requests.

**Debug:**
1. Open **Events panel**
2. Filter to show only `FETCH` events
3. Look for duplicate fetches (same params, close timing)
4. Check **Config panel** → `bulk.delayMs` (increase for more coalescing)
5. Check **Truth panel** → staleness settings

**Solutions:**
- Increase `stalenessMs` to cache longer
- Increase `bulk.delayMs` for more coalescing
- Use directive payloads (`result` field) to skip refetches
- Implement level conversions to reduce fetches

---

## Advanced: Programmatic Access

You can access devtools programmatically for testing or automation:

```javascript
// Global devtools instance
const devtools = window.__VERITY_DL_DEVTOOLS__

// Show/hide
devtools.show()
devtools.hide()
devtools.toggle()

// Access state
console.log(devtools.store.snapshot)        // Current truth snapshot
console.log(devtools.store.fetchEvents)     // Fetch event history
console.log(devtools.store.directiveEvents) // Directive history
console.log(devtools.store.sseState)        // SSE connection state

// Clear events
devtools.clearEvents()

// Trigger snapshot refresh
devtools.refreshSnapshot()
```

**Use cases:**
- Automated testing: verify directives were applied
- Performance testing: measure fetch counts
- Integration testing: ensure SSE connection established

---

## Summary

**Key Features:**

| Panel | Purpose |
|-------|---------|
| **Truth** | Inspect cached truth-state |
| **Events** | Timeline of fetch/directive/SSE events |
| **SSE** | Connection status and messages |
| **Config** | Registry settings and stats |

**Key Debugging Tools:**

| Issue | Where to Look |
|-------|--------------|
| Directive not applied | Events panel (filter: directives) |
| Stale data | Truth panel (check stale indicator) |
| SSE not working | SSE panel (connection status) |
| Too many fetches | Events panel (filter: fetch) |

**Production:**
- Remove devtools from production builds
- Use conditional loading or build-time exclusion
- Devtools add ~50KB to bundle size

---

## Next Steps

- **Getting Started:** [Quick start guide](../guides/getting-started.md)
- **Core API:** [Registry reference](core.md)
- **Directives:** [Directive contract](directives.md)
- **Examples:** [Example applications](../examples.md)

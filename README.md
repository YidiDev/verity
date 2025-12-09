# Verity

> **One strong idea:** the server is the only source of truth.  
> **One clear boundary:** **truth-state** (server-owned) is not the same as **view-state** (client-owned).  
> **One purpose:** a composable data layer that mediates between them—protocol-agnostic, framework-agnostic, and honest.

Verity is the **backend of your frontend**. It sits between your server and view layer, handling caching, staleness, fan-out, and directive processing so your UI can focus purely on rendering.

## The Problem

Modern frontends blur two fundamentally different kinds of state:

- **Truth-state** — authoritative data whose source of truth is the server (domain models, records, counters, permissions)
- **View-state** — ephemeral client concerns (which menu is open, which row is expanded, which tab has focus)

Most frameworks *can* represent both, but they rarely enforce a practical boundary. Teams end up mixing "what the server says" with "what the UI is doing," then try to paper over races and stale views with **optimistic updates**. That creates flicker, mismatch, and user distrust.

## The Solution

**Verity separates the lanes:**

1. The **server** owns data integrity and business logic
2. **Verity** is the **backend of the frontend**: it fetches, coalesces, tracks staleness, reacts to server **directives**, and exposes stable references to truth-state
3. The **view layer** renders those references and manages local view-state—**without** fetching, caching, guessing, or coordinating invalidation

This separation isn't just conceptual—it shows up in Verity's public API, internal guarantees, and strict UX policy.

## Core Principles

**Server Truth Only**  
The UI changes **after** the server confirms change. Unknowns render as skeletons; work in progress renders as spinners. No temporary lies, no speculation.

**Directive-Driven Updates**  
Rather than pushing DOM or raw events, servers emit **semantic directives**—small, transport-agnostic messages that describe what should be refreshed. Directives decouple server logic from UI structure and compose beautifully: mutation responses provide immediate local echo, while **fan-out over SSE** keeps other tabs and devices consistent.

**Levels & Minimal Fetching**  
A single entity can be viewed at different detail levels (`simplified`, `expanded`). Verity lets you declare conversion graphs so one fetch can satisfy multiple levels without redundant network calls. When directives arrive, Verity computes the minimal set of refetches needed to return to truth.

**Framework-Agnostic Core**  
Verity exposes stable refs (`{ data, meta }`) and a subscribe API. Thin adapters wire that into Alpine, React, Vue, or Svelte with identical semantics. The value lives in the core, not the glue.

**Honest by Design**  
Perceived snappiness never justifies lying. If your product needs "instant echo," build endpoints that return the truth immediately—don't fake it in the client.

## Quick Start

### No Build Tools? No Problem!

Drop these script tags into your HTML and you're ready to go:

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

<!-- Your app -->
<div x-data="verity.collection('todos')">
  <template x-if="state.loading">
    <p>Loading todos...</p>
  </template>
  <template x-for="todo in state.items" :key="todo.id">
    <div x-text="todo.title"></div>
  </template>
</div>

<!-- Verity setup -->
<script>
  // Initialize Verity
  DL.init({
    sse: { url: '/api/events' }
  })
  
  // Register collections and types
  DL.createCollection('todos', {
    fetch: async (params) => {
      const res = await fetch('/api/todos')
      return res.json()  // { ids: [...], count: number }
    }
  })
  
  DL.createType('todo', {
    fetch: async (id) => {
      const res = await fetch(`/api/todos/${id}`)
      return res.json()
    }
  })
</script>

</body>
</html>
```

**For production, use the minified versions:**

```html
<script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/lib/core.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/adapters/alpine.min.js"></script>
```

### Using npm (for build pipelines)

If you're using a bundler like Vite, Webpack, or Rollup:

```bash
npm install verity-dl
```

```javascript
import { init, createType, createCollection } from 'verity-dl/core'
import { ensureAlpineStore } from 'verity-dl/adapters/alpine'

// Initialize Verity
init({ sse: { url: '/api/events' } })

// Register your data
createCollection('todos', { /* ... */ })
createType('todo', { /* ... */ })
```

### Run Examples Locally

The repository includes full-stack examples built with Flask:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run an example
python verity/examples/invoices_alpine/app.py
# or try the manufacturing control room
python verity/examples/manufacturing_monitor/app.py
```

### Explore Documentation

Visit [verity.yidi.sh](https://verity.yidi.sh) or run locally:

```bash
mkdocs serve
```

Then open <http://127.0.0.1:8000> to dive into the mental model, guides, and API reference.

### Debug with Devtools

Add the visual debugging overlay to watch truth-state, directives, and SSE events in real-time:

```html
<!-- Add to development builds -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.css">
<script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/verity/shared/static/devtools/devtools.js"></script>
```

**Usage:** Press `Ctrl+Shift+V` (or `Cmd+Shift+V` on Mac) to toggle the devtools overlay.

[Complete Devtools Guide →](https://verity.yidi.sh/guides/getting-started.html#debugging-with-devtools)

## How This Differs from Alternatives

### vs htmx / LiveView / Turbo Streams
✅ Server is the source of truth  
❌ Server dictates DOM, tightly couples backend to view structure  
**Verity** pushes **data intent** (directives) and keeps **view-state** client-owned

### vs TanStack Query / RTK Query / Apollo
✅ Mature caches, good invalidation tooling, multi-framework support  
❌ Optimistic updates are first-class; invalidation semantics are app-defined glue; no concept of levels + conversion planning; server doesn't author the invalidation contract  
**Verity** bakes invalidation semantics into a **server-authored contract** and plans minimal refetches

### vs Roll-Your-Own Store + Fetch
✅ Maximum control  
❌ Re-implement coalescing, latest-wins, push integration, multi-client convergence, and UX semantics—again and again  
**Verity** exists to be the boring, correct default

## What's Included

- **`verity/`** — Flask helpers, JavaScript core, and multi-framework adapters
- **`verity/examples/`** — Production-scale demos for Alpine, React, and Vue, plus "baseline" builds that skip Verity so you can compare behaviors
- **`docs/`** — MkDocs documentation covering the mental model, directive contract, API surface, and example walkthroughs
- **`.github/workflows/docs.yml`** — GitHub Action that deploys the docs site to GitHub Pages

## Design Guarantees

- **Latest-wins**: stale network results won't clobber newer state
- **Coalesced**: identical in-flight requests reuse one promise
- **Deterministic**: the same sequence of directives + responses yields the same cache
- **Isolated**: truth-state doesn't leak view concerns; view-state doesn't influence server truth
- **Pluggable**: fetchers and directive sources are replaceable without touching views

## When to Use Verity

Use Verity where **server truth matters**—shared, audited, multi-client data. Keep purely local UIs (menus, focus, modals) in your framework's own state.

**Smell test:** if changing tabs or reloading should reset it, it's probably view-state. If a coworker on another device must see it, it's truth-state.

## Next Steps

1. Read [Philosophy](https://verity.yidi.sh/philosophy) for the full mental model
2. Understand [Architecture](https://verity.yidi.sh/architecture) to see how the three layers interact
3. Explore [Truth-State vs View-State](https://verity.yidi.sh/concepts/truth-vs-view-state) to master the core distinction
4. Follow [Getting Started](https://verity.yidi.sh/guides/getting-started) to wire Verity into a new project
5. Study the [examples](https://verity.yidi.sh/examples) to see patterns in action

## Repository Layout

```text
verity/
├─ shared/            # Static assets (core library, adapters, devtools)
└─ examples/          # Full-stack reference applications
docs/                 # MkDocs content (philosophy, guides, reference, examples)
mkdocs.yml            # MkDocs configuration
CONTRIBUTING.md       # Contribution guide
LICENSE               # MIT License
requirements.txt      # Runtime dependencies
```

## License

MIT. Build trustworthy, data-heavy apps with a simple, honest UI.

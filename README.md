# Verity

> **One strong idea:** the server is the only source of truth.  
> **One clear boundary:** **truth-state** (server-owned) is not the same as **view-state** (client-owned).  
> **One purpose:** a composable data layer that mediates between them--protocol-agnostic, framework-agnostic, and honest.

Verity is the **backend of your frontend**. It sits between your server and view layer, handling caching, staleness, fan-out, and directive processing so your UI can focus purely on rendering.

## The Problem

Modern frontends blur two fundamentally different kinds of state:

- **Truth-state** -- authoritative data whose source of truth is the server (domain models, records, counters, permissions)
- **View-state** -- ephemeral client concerns (which menu is open, which row is expanded, which tab has focus)

Most frameworks *can* represent both, but they rarely enforce a practical boundary. Teams end up mixing "what the server says" with "what the UI is doing," then try to paper over races and stale views with **optimistic updates**. That creates flicker, mismatch, and user distrust.

## The Solution

**Verity separates the lanes:**

1. The **server** owns data integrity and business logic
2. **Verity** is the **backend of the frontend**: it fetches, coalesces, tracks staleness, reacts to server **directives**, and exposes stable references to truth-state
3. The **view layer** renders those references and manages local view-state--**without** fetching, caching, guessing, or coordinating invalidation

This separation isn't just conceptual--it shows up in Verity's public API, internal guarantees, and strict UX policy.

## Core Principles

**Server Truth Only**  
The UI changes **after** the server confirms change. Unknowns render as skeletons; work in progress renders as spinners. No temporary lies, no speculation.

**Directive-Driven Updates**  
Rather than pushing DOM or raw events, servers emit **semantic directives**--small, transport-agnostic messages that describe what should be refreshed. Directives decouple server logic from UI structure and compose beautifully: mutation responses provide immediate local echo, while **fan-out over SSE** keeps other tabs and devices consistent.

**Levels & Minimal Fetching**  
A single entity can be viewed at different detail levels (`simplified`, `expanded`). Verity lets you declare conversion graphs so one fetch can satisfy multiple levels without redundant network calls. When directives arrive, Verity computes the minimal set of refetches needed to return to truth.

**Framework-Agnostic Core**  
Verity exposes stable refs (`{ data, meta }`) and a subscribe API. Thin adapters wire that into Alpine, React, Vue, or Svelte with identical semantics. The value lives in the core, not the glue.

**Honest by Design**  
Perceived snappiness never justifies lying. If your product needs "instant echo," build endpoints that return the truth immediately--don't fake it in the client.

## Installation

### Via CDN (no build tools)

Drop a script tag and go. Works with jsDelivr, unpkg, or bundle.run:

```html
<!-- jsDelivr -->
<script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/dist/core.umd.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/verity-dl@latest/dist/core.umd.js"></script>

<!-- bundle.run -->
<script src="https://bundle.run/verity-dl@latest/dist/core.umd.js"></script>
```

The UMD build exposes `window.DLCore` globally.

### Via npm / yarn (for bundlers)

```bash
# npm
npm install verity-dl

# yarn
yarn add verity-dl
```

```javascript
// ESM import
import { init, createType, createCollection, fetchItem } from 'verity-dl';

// CommonJS require
const { init, createType, createCollection, fetchItem } = require('verity-dl');
```

### TypeScript

The package ships bundled type declarations. No `@types/` package needed.

```typescript
import {
  init,
  createType,
  createCollection,
  fetchItem,
  fetchCollection,
  onChange,
  type ItemRef,
  type CollectionRef,
  type Directive,
  type SseConfig,
} from 'verity-dl';

// Full IntelliSense and type safety out of the box
createType('todo', {
  fetch: async (id: unknown): Promise<{ id: string; title: string }> => {
    const res = await fetch(`/api/todos/${id}`);
    return res.json();
  },
  stalenessMs: 30_000,
});
```

## Quick Start

### Minimal example (no framework)

```html
<script src="https://cdn.jsdelivr.net/npm/verity-dl@latest/dist/core.umd.js"></script>
<script>
  DLCore.createCollection('todos', {
    fetch: () => fetch('/api/todos').then(r => r.json()),
  });

  DLCore.createType('todo', {
    fetch: (id) => fetch(`/api/todos/${id}`).then(r => r.json()),
  });

  DLCore.init({ sse: { url: '/api/events' } });

  // Fetch and observe
  const ref = DLCore.fetchCollection('todos');
  DLCore.onChange(() => {
    console.log('Todos:', ref.data, 'Loading:', ref.meta.isLoading);
  });
</script>
```

### Run examples locally

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

### Explore documentation

Visit [verity.yidi.sh](https://verity.yidi.sh) or run locally:

```bash
mkdocs serve
```

Then open <http://127.0.0.1:8000> to dive into the mental model, guides, and API reference.

## How This Differs from Alternatives

### vs htmx / LiveView / Turbo Streams
Server is the source of truth, but server dictates DOM, tightly coupling backend to view structure.
**Verity** pushes **data intent** (directives) and keeps **view-state** client-owned.

### vs TanStack Query / RTK Query / Apollo
Mature caches with good invalidation tooling and multi-framework support, but optimistic updates are first-class, invalidation semantics are app-defined glue, and there is no concept of levels + conversion planning.
**Verity** bakes invalidation semantics into a **server-authored contract** and plans minimal refetches.

### vs Roll-Your-Own Store + Fetch
Maximum control, but you re-implement coalescing, latest-wins, push integration, multi-client convergence, and UX semantics every time.
**Verity** exists to be the boring, correct default.

## Design Guarantees

- **Latest-wins**: stale network results won't clobber newer state
- **Coalesced**: identical in-flight requests reuse one promise
- **Deterministic**: the same sequence of directives + responses yields the same cache
- **Isolated**: truth-state doesn't leak view concerns; view-state doesn't influence server truth
- **Pluggable**: fetchers and directive sources are replaceable without touching views

## When to Use Verity

Use Verity where **server truth matters**--shared, audited, multi-client data. Keep purely local UIs (menus, focus, modals) in your framework's own state.

**Smell test:** if changing tabs or reloading should reset it, it's probably view-state. If a coworker on another device must see it, it's truth-state.

## Development

```bash
# Install dependencies
corepack enable
yarn install

# Run all checks (typecheck + lint + test)
yarn check

# Individual commands
yarn typecheck      # TypeScript type checking
yarn lint           # ESLint
yarn test           # Vitest
yarn build          # Vite production build
```

## Repository Layout

```text
src/
  core/               # TypeScript source (modular)
  adapters/           # Framework adapters (Alpine, React, Vue, Svelte)
  devtools/           # In-browser devtools panel
dist/                 # Built output (ESM, UMD, .d.ts)
tests/                # Vitest test suite
verity/
  examples/           # Full-stack Flask reference applications
docs/                 # MkDocs content (philosophy, guides, reference)
```

## Next Steps

1. Read [Philosophy](https://verity.yidi.sh/philosophy) for the full mental model
2. Understand [Architecture](https://verity.yidi.sh/architecture) to see how the three layers interact
3. Explore [Truth-State vs View-State](https://verity.yidi.sh/concepts/truth-vs-view-state) to master the core distinction
4. Follow [Getting Started](https://verity.yidi.sh/guides/getting-started) to wire Verity into a new project
5. Study the [examples](https://verity.yidi.sh/examples) to see patterns in action

## License

MIT. Build trustworthy, data-heavy apps with a simple, honest UI.

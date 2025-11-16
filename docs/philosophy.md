# Philosophy

> **One strong idea:** the server is the only source of truth.  
> **One clear boundary:** **truth-state** (server-owned) is not the same as **view-state** (client-owned).  
> **One purpose:** a small, composable data layer that mediates between them—protocol-agnostic, framework-agnostic, and honest.

This document explains the philosophy behind Verity. It's not a tutorial or API reference; it's the set of beliefs and trade-offs that inform every design choice.

---

## 1. The Core Problem We're Solving

Modern frontends often blur two very different kinds of state:

- **Truth-state** — authoritative data whose source of truth is the server (domain models, records, counters, permissions)
- **View-state** — ephemeral client concerns (which menu is open, which row is expanded, which tab has focus)

Most frameworks *can* represent both, but they rarely enforce a practical boundary. Teams end up mixing "what the server says" with "what the UI is doing," then try to paper over race conditions and stale views with **optimistic updates**. That creates flicker, mismatch, and user distrust.

**Verity separates the lanes:**

- The **server** owns data integrity and business logic
- **Verity** is the **backend of the frontend**: it fetches, coalesces, tracks staleness, reacts to server **directives**, and exposes stable references to truth-state
- The **view layer** renders those references and manages local view-state—**without** fetching, caching, guessing, or coordinating invalidation

This separation is not just conceptual. It shows up in the data layer's public surface, its internal guarantees, and its strict UX policy.

---

## 2. Principles

### Server Truth Only
The UI changes **after** the server confirms change. Unknowns render as **skeletons**; work in progress renders as **spinners**. No temporary lies.

### Data Intent, Not DOM Diffs
Servers emit **directives** (e.g., "refresh this item")—they don't send HTML or dictate component structure.

### Two Lanes of State
Verity manages **truth-state**. Your components manage **view-state**. Mixing them is a bug factory.

### Latest-Wins Under Concurrency
Out-of-order responses must not clobber newer state. In-flight work is **coalesced** to avoid duplication and flicker.

### Protocol-Agnostic, Framework-Agnostic
Fetchers are async functions; the push path is a pluggable **directive source** (SSE today; WebSocket/GraphQL subscriptions tomorrow). UI adapters are thin.

### Honest by Design
Perceived snappiness never justifies lying. If your product needs "instant echo," build endpoints that return the truth immediately—do not fake it in the client.

---

## 3. Truth-State vs View-State

### Truth-State (owned by Verity)

- Originates on the server
- Includes entities, collections, counts, derived projections
- Updated by fetches or server-sent **directives**, not local speculation
- Comes with **staleness** rules and **levels**

### View-State (owned by the view layer)

- Originates in the client (menus, focus, sort toggles, light UI filters)
- Lives in component state or your favorite UI store
- Never leaves the client; never drives server invalidation logic

> **Smell test:** if changing tabs or reloading should reset it, it's probably view-state. If a coworker on another device must see it, it's truth-state.

See [Truth-State vs View-State](concepts/truth-vs-view-state.md) for a deeper exploration.

---

## 4. Directive-Driven Correctness

Rather than pushing diffs of DOM or raw events, the server sends **semantic directives**—small, transport-agnostic messages that describe what should be **refreshed**:

- `{ op: "refresh_collection", name: string, params?: object }` — "The list identified by (name, params) needs a fresh read."
- `{ op: "refresh_item", name: string, id: string|number, level?: string }` — "Item (type, id) changed. Clients should refresh whatever levels they currently hold."
- `{ op: "invalidate", targets: Directive[] }` — A wrapper directive that nests other directives.

**Why directives?**

- They **decouple** server logic from UI structure. The server doesn't need to know which components are mounted or which view is open.
- They **compose**: returning directives from mutation responses provides immediate local echo, and **fan-out over SSE** keeps other tabs/devices consistent.
- They are **loss-tolerant**: missing a directive merely delays convergence to truth; no fragile "apply this exact delta" logic.

The client ignores directives that originated from itself (via **client IDs**) to avoid double-apply.

Read [Directives](concepts/directives.md) for the full contract.

---

## 5. Levels & Conversion Graphs

A single entity can be viewed at different detail **levels** (e.g., `simplified`, `expanded`). Verity lets you:

- Declare levels and per-level **fetch** functions
- Provide `checkIfExists(obj)` to tell whether the currently cached object already satisfies a level
- Optionally register **conversion maps** that derive one level from another **without** a network call

When a directive arrives, Verity:

1. Detects which levels the client currently holds (including converted levels)
2. Computes the **minimal** set of fetches needed to return to truth (a small graph problem)
3. Applies results breadth-first, running conversions to populate other levels with the **same freshness**

**Why this matters:** it avoids the common extremes of "invalidate everything" (too chatty) or "field-level normalization" (complex and leaky). You fetch **just enough**—no more, no less.

See [Levels & Conversions](concepts/levels-and-conversions.md) for examples and patterns.

---

## 6. Concurrency, Coalescing, and Consistency

- **Latest-wins guards.** Each ref holds an `activeQueryId`; stale responses can't overwrite newer requests.
- **In-flight coalescing.** Identical fetches for the same (type, id, level) reuse a single promise. Collections serialize reloads per key and coalesce re-run requests.
- **Silent vs loud fetches.**
  - **Silent** hydration avoids row/detail overlays (used when hydrating lists in the background)
  - **Loud** fetches (server-directed refreshes or explicit detail opens) show overlays to set accurate expectations

See [Concurrency Model](concepts/concurrency-model.md) for implementation details.

---

## 7. Transport-Agnostic by Construction

Verity has two paths:

- **Pull (data fetchers):** user-provided async functions for collections and item levels. These can call REST, GraphQL, gRPC, anything—so long as they return the expected shapes.
- **Push (directive source):** a pluggable stream that calls `onMessage(Directive[])`. SSE is the default; WebSockets, GraphQL subscriptions, Service Workers, or polling with ETags can be adapters.

**The core never assumes "REST."** Examples in this repo use HTTP fetch only to keep demos simple.

---

## 8. Framework-Agnostic Core + Thin Adapters

The core exposes:

- Stable **refs** for collections/items: `{ data, meta }`, updated by **replacing** sub-objects (so identity changes are observable)
- A **subscribe(cb)** API that fires whenever refs change

Adapters wire that into different UI ecosystems:

- **Alpine:** an `$store` with a tiny `_tick` bump on subscribe
- **React:** `useSyncExternalStore` hooks that read current refs
- **Vue:** `shallowRef` + subscribe
- **Svelte:** `readable` stores

Adapters are intentionally small; the value lives in the core.

---

## 9. UX Policy (Strict, Simple, Honest)

Verity is unapologetically server-driven. Users deserve accuracy over wishful thinking, so we:

1. **Reject optimistic UI.** The interface never assumes success. Until the server confirms a write, components stay in a pending state.
2. **Embrace explicit loading.** Skeletons, disabled buttons, and busy indicators communicate uncertainty without lying to the user.
3. **Treat directives as facts.** Every directive is idempotent, timestamped, and scoped to an audience. Clients apply them in order to reach the same truth.
4. **Trace everything.** Lifecycle hooks and devtools make the data pipeline observable so debugging stays humane.

### The Rules

1. **Skeletons for unknowns.** If a row or field is not known yet, render a skeleton—not a placeholder value.
2. **Spinners for work.** Buttons show a spinner **immediately on click** and stop when the server replies. Refresh overlays follow **directives**.
3. **Overlays for loud fetches only.** Background hydration is silent; directive-driven or explicit detail fetches are loud.
4. **Never speculate.** No "temporary toggles," no optimistic writes. If instant feedback is needed, design server endpoints that return the updated truth quickly and still send directives.

This mindset produces calmer products. Teams make fewer excuses for flicker or stale information, and cross-functional stakeholders regain trust in the UI.

See [UX Patterns](guides/ux-patterns.md) for implementation guidance.

---

## 10. What This Is NOT

- **Not a global state store for all state.** It handles truth-state; your view-state belongs in the view layer.
- **Not a DOM-patching framework.** We don't ship HTML from the server (see htmx/LiveView/Turbo for that pattern).
- **Not optimistic-UI-first.** If you need local echo as a feature, make your server return truthier responses, don't ask the client to hallucinate.

---

## 11. Trade-Offs and Edge Cases

### Perceived Latency
Strict honesty can feel slower in consumer UIs. Countermeasure: return richer responses from writes, use good skeletons, and keep fetches fast. Do **not** flip to optimism by default.

### Directive Delivery Isn't Guaranteed
SSE is best-effort. Missing a directive delays refresh; it doesn't corrupt state. Add periodic, jittered collection refresh, sequence numbers, or reconcile on visibility changes.

### Level Drift Risk
Conversion maps are code; server shape changes can silently break them. Consider optional **level versioning/etags** from the server; invalidate derived levels when versions change.

### Parameterized Collections
Real apps need keys for pagination/filters. The philosophy is to treat `(name, params)` as the cache key and ensure directives can target the right keys.

### Memory Pressure and GC
Long-lived dashboards can accumulate entities. A pragmatic LRU/TTL policy (or reference counting) keeps memory bounded.

### Multi-Tab Writes Without a SharedWorker
We rely on fan-out + client IDs. This is robust and simple; if you need strict single-writer semantics, add server-side locking/version checks.

---

## 12. How This Differs from Common Alternatives

### htmx / LiveView / Turbo Streams
✅ Server is the source of truth  
❌ Server dictates DOM, tightly couples backend to view structure  
**Verity** pushes **data intent** (directives) and keeps **view-state** client-owned

### TanStack Query / RTK Query / Apollo
✅ Mature caches, good invalidation tooling, multi-framework support  
❌ Optimistic updates are first-class; invalidation semantics are app-defined glue; no concept of **levels + conversion planning**; server doesn't author the invalidation contract  
**Verity** bakes invalidation semantics into a **server-authored contract** and plans minimal refetches

### Write-Your-Own Store + Fetch
✅ Maximum control  
❌ Re-implement coalescing, latest-wins, push integration, multi-client convergence, and UX semantics—again and again  
**Verity** exists to be the boring, correct default

See [Why Verity?](why-verity.md) for detailed comparisons.

---

## 13. Design Guarantees

- **Latest-wins**: stale network results won't clobber newer state
- **Coalesced**: identical in-flight requests reuse one promise
- **Deterministic**: the same sequence of directives + responses yields the same cache
- **Isolated**: truth-state doesn't leak view concerns; view-state doesn't influence server truth
- **Pluggable**: fetchers and directive sources are replaceable without touching views

---

## 14. Core Principles Summary

- **Truth beats latency.** Accuracy earns confidence.
- **State is owned by the data layer.** Components watch state—they do not orchestrate it.
- **Determinism matters.** In-flight requests are coalesced, caches have TTLs, and directives guarantee convergence.
- **Portable semantics.** Whether you work in Alpine, React, Vue, or Svelte, the behaviour is consistent.

---

## 15. FAQ

**Q: Isn't this just "don't use optimistic updates"?**

A: It's more than a stance. The library encodes **how** to be honest—directive grammar, minimal refetch planning via **levels**, coalescing, and strict UX semantics.

**Q: Can I use GraphQL?**

A: Yes. Fetchers can call queries/mutations; the push path can be a GraphQL subscription that emits **directives**. The core is protocol-agnostic.

**Q: What if I really need instant UI feedback?**

A: Make server endpoints return the updated truth immediately (and still emit directives). Don't lie client-side.

**Q: Why not let the server push HTML?**

A: DOM coupling scales poorly across clients, routes, and view frameworks. Pushing **data intent** retains separation of concerns and keeps the server ignorant of the DOM.

**Q: Do I have to adopt this for everything?**

A: No. Use Verity where server truth matters (shared, audited, multi-client data). Keep purely local UIs in your framework's own state.

---

## 16. Glossary

- **Truth-state:** server-owned, authoritative application data
- **View-state:** client-owned UI concerns (menus, focus, selections)
- **Directive:** a small message from the server indicating which data to refresh
- **Level:** a named detail view of an entity (e.g., `simplified`, `expanded`)
- **Conversion map:** a function that derives fields for one level from another
- **Silent/Loud fetch:** background hydration vs user-visible refresh with overlays
- **Directive source:** a pluggable stream that delivers directives (SSE/WS/etc.)

---

## The Short Version

**Verity** treats the data layer as the **backend of your frontend**. It draws a hard line between **server truth** and **client view**, uses **directives** to keep them in sync, plans **minimal fetches** with **levels** and conversions, and refuses to lie to the user.

If that's the kind of correctness and clarity you want, this library is for you.

---

## Next Steps

1. Understand the [Architecture](architecture.md) to see how the three layers interact
2. Master [Truth-State vs View-State](concepts/truth-vs-view-state.md) distinction
3. Learn the [Directive Contract](concepts/directives.md)
4. Follow [Getting Started](guides/getting-started.md) to wire Verity into a project
5. Study [Levels & Conversions](concepts/levels-and-conversions.md) for optimal fetching

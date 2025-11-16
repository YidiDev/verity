# Trade-Offs and Edge Cases

An honest discussion of Verity's limitations and design trade-offs.

---

## Perceived Latency
Strict honesty can feel slower in consumer UIs. Countermeasure: return richer responses from writes, use good skeletons, and keep fetches fast. Do **not** flip to optimism by default.

---

## Directive Delivery Isn't Guaranteed
SSE is best-effort. Missing a directive delays refresh; it doesn't corrupt state. Add periodic, jittered collection refresh, sequence numbers, or reconcile on visibility changes.

---

## Level Drift Risk
Conversion maps are code; server shape changes can silently break them. Consider optional **level versioning/etags** from the server; invalidate derived levels when versions change.

---

## Parameterized Collections
Real apps need keys for pagination/filters. The philosophy is to treat `(name, params)` as the cache key and ensure directives can target the right keys.

---

## Memory Pressure and GC
Long-lived dashboards can accumulate entities. A pragmatic LRU/TTL policy (or reference counting) keeps memory bounded.

---

## Multi-Tab Writes Without a SharedWorker
We rely on fan-out + client IDs. This is robust and simple; if you need strict single-writer semantics, add server-side locking/version checks.

---

## What This Is NOT

- **Not a global state store for all state.** It handles truth-state; your view-state belongs in the view layer.
- **Not a DOM-patching framework.** We don't ship HTML from the server (see htmx/LiveView/Turbo for that pattern).
- **Not optimistic-UI-first.** If you need local echo as a feature, make your server return truthier responses, don't ask the client to hallucinate.

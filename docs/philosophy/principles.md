# Principles

The fundamental rules that guide Verity's design.

---

## Server Truth Only
The UI changes **after** the server confirms change. Unknowns render as **skeletons**; work in progress renders as **spinners**. No temporary lies.

---

## Data Intent, Not DOM Diffs
Servers emit **directives** (e.g., "refresh this item")—they don't send HTML or dictate component structure.

---

## Two Lanes of State
Verity manages **truth-state**. Your components manage **view-state**. Mixing them is a bug factory.

---

## Latest-Wins Under Concurrency
Out-of-order responses must not clobber newer state. In-flight work is **coalesced** to avoid duplication and flicker.

---

## Protocol-Agnostic, Framework-Agnostic
Fetchers are async functions; the push path is a pluggable **directive source** (SSE today; WebSocket/GraphQL subscriptions tomorrow). UI adapters are thin.

---

## Honest by Design
Perceived snappiness never justifies lying. If your product needs "instant echo," build endpoints that return the truth immediately—do not fake it in the client.

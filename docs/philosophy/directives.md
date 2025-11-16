# Directive-Driven Correctness

Rather than pushing diffs of DOM or raw events, the server sends **semantic directives**—small, transport-agnostic messages that describe what should be **refreshed**.

---

## Directive Types

- `{ op: "refresh_collection", name: string, params?: object }` — "The list identified by (name, params) needs a fresh read."
- `{ op: "refresh_item", name: string, id: string|number, level?: string }` — "Item (type, id) changed. Clients should refresh whatever levels they currently hold."
- `{ op: "invalidate", targets: Directive[] }` — A wrapper directive that nests other directives.

---

## Why Directives?

- They **decouple** server logic from UI structure. The server doesn't need to know which components are mounted or which view is open.
- They **compose**: returning directives from mutation responses provides immediate local echo, and **fan-out over SSE** keeps other tabs/devices consistent.
- They are **loss-tolerant**: missing a directive merely delays convergence to truth; no fragile "apply this exact delta" logic.

---

## Client ID Management

The client ignores directives that originated from itself (via **client IDs**) to avoid double-apply.

---

## See Also

Read [Directives](../concepts/directives.md) for the full contract and implementation details.

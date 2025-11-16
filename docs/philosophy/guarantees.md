# Design Guarantees

What Verity promises and ensures.

---

## Latest-Wins
Stale network results won't clobber newer state.

---

## Coalesced
Identical in-flight requests reuse one promise.

---

## Deterministic
The same sequence of directives + responses yields the same cache.

---

## Isolated
Truth-state doesn't leak view concerns; view-state doesn't influence server truth.

---

## Pluggable
Fetchers and directive sources are replaceable without touching views.

---

## Core Principles Summary

- **Truth beats latency.** Accuracy earns confidence.
- **State is owned by the data layer.** Components watch state—they do not orchestrate it.
- **Determinism matters.** In-flight requests are coalesced, caches have TTLs, and directives guarantee convergence.
- **Portable semantics.** Whether you work in Alpine, React, Vue, or Svelte, the behaviour is consistent.

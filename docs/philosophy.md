# Philosophy

Verity is unapologetically server-driven. Users deserve accuracy over wishful thinking, so we:

1. **Reject optimistic UI.** The interface never assumes success. Until the server confirms a
   write, components stay in a pending state.
2. **Embrace explicit loading.** Skeletons, disabled buttons, and busy indicators communicate
   uncertainty without lying to the user.
3. **Treat directives as facts.** Every directive is idempotent, timestamped, and scoped to an
   audience. Clients apply them in order to reach the same truth.
4. **Trace everything.** Lifecycle hooks and devtools make the data pipeline observable so
   debugging stays humane.

This mindset produces calmer products. Teams make fewer excuses for flicker or stale information,
and cross-functional stakeholders regain trust in the UI.

## Core Principles

- **Truth beats latency.** Accuracy earns confidence.
- **State is owned by the data layer.** Components watch state—they do not orchestrate it.
- **Determinism matters.** In-flight requests are coalesced, caches have TTLs, and directives
  guarantee convergence.
- **Portable semantics.** Whether you work in Alpine, React, Vue, or Svelte, the behaviour is
  consistent.

Read [Getting Started](guides/getting-started.md) and [Core Concepts](guides/state-model.md) for
practical guidance.

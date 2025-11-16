# Philosophy

> **One strong idea:** the server is the only source of truth.  
> **One clear boundary:** **truth-state** (server-owned) is not the same as **view-state** (client-owned).  
> **One purpose:** a small, composable data layer that mediates between them—protocol-agnostic, framework-agnostic, and honest.

This section explains the philosophy behind Verity. It's not a tutorial or API reference; it's the set of beliefs and trade-offs that inform every design choice.

---

## The Core Problem We're Solving

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

## Core Topics

- [Principles](principles.md) - The fundamental rules that guide Verity
- [Truth vs View State](truth-vs-view.md) - Understanding the critical distinction
- [Directives](directives.md) - How server-authored updates work
- [Design Guarantees](guarantees.md) - What Verity promises
- [Trade-offs](trade-offs.md) - Honest discussion of limitations
- [Comparisons](comparisons.md) - How Verity differs from alternatives

---

## The Short Version

**Verity** treats the data layer as the **backend of your frontend**. It draws a hard line between **server truth** and **client view**, uses **directives** to keep them in sync, plans **minimal fetches** with **levels** and conversions, and refuses to lie to the user.

If that's the kind of correctness and clarity you want, this library is for you.

---

## Next Steps

1. Understand the [Architecture](../architecture/index.md) to see how the three layers interact
2. Master [Truth-State vs View-State](../concepts/truth-vs-view-state.md) distinction
3. Learn the [Directive Contract](../concepts/directives.md)
4. Follow [Getting Started](../guides/getting-started.md) to wire Verity into a project
5. Study [Levels & Conversions](../concepts/levels-and-conversions.md) for optimal fetching

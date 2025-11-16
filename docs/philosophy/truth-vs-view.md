# Truth-State vs View-State

Understanding the distinction between truth-state and view-state is fundamental to using Verity correctly.

---

## Truth-State (owned by Verity)

- Originates on the server
- Includes entities, collections, counts, derived projections
- Updated by fetches or server-sent **directives**, not local speculation
- Comes with **staleness** rules and **levels**

---

## View-State (owned by the view layer)

- Originates in the client (menus, focus, sort toggles, light UI filters)
- Lives in component state or your favorite UI store
- Never leaves the client; never drives server invalidation logic

---

## Smell Test

> If changing tabs or reloading should reset it, it's probably view-state. If a coworker on another device must see it, it's truth-state.

---

## See Also

For a deeper exploration, see [Truth-State vs View-State](../concepts/truth-vs-view-state.md) in the concepts section.

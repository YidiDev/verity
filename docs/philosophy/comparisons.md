# How This Differs from Common Alternatives

---

## htmx / LiveView / Turbo Streams
✅ Server is the source of truth  
❌ Server dictates DOM, tightly couples backend to view structure  
**Verity** pushes **data intent** (directives) and keeps **view-state** client-owned

---

## TanStack Query / RTK Query / Apollo
✅ Mature caches, good invalidation tooling, multi-framework support  
❌ Optimistic updates are first-class; invalidation semantics are app-defined glue; no concept of **levels + conversion planning**; server doesn't author the invalidation contract  
**Verity** bakes invalidation semantics into a **server-authored contract** and plans minimal refetches

---

## Write-Your-Own Store + Fetch
✅ Maximum control  
❌ Re-implement coalescing, latest-wins, push integration, multi-client convergence, and UX semantics—again and again  
**Verity** exists to be the boring, correct default

---

## See Also

See [Why Verity?](../why-verity.md) for detailed comparisons with real-world examples.

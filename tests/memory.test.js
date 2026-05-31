import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { freshCore } from "./helpers.js";

/**
 * Flush microtasks under fake timers by advancing 0ms asynchronously.
 * This lets resolved promises settle without progressing the clock.
 */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("memory management / sweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- 1. configureMemory sets values correctly ----
  it("configureMemory sets values correctly (verify via devtools)", () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });

    DLCore.configureMemory({
      enabled: true,
      pruneIntervalMs: 30000,
      maxCollectionRefsPerCollection: 5,
      collectionEntryTtlMs: 120000,
      maxItemsPerType: 100,
      itemEntryTtlMs: 300000,
    });

    const mem = DLCore.devtools().memory;
    expect(mem.enabled).toBe(true);
    expect(mem.pruneIntervalMs).toBe(30000);
    expect(mem.maxCollectionRefsPerCollection).toBe(5);
    expect(mem.collectionEntryTtlMs).toBe(120000);
    expect(mem.maxItemsPerType).toBe(100);
    expect(mem.itemEntryTtlMs).toBe(300000);
  });

  // ---- 2. configureMemory({ enabled: false }) disables sweep timer ----
  it("configureMemory({ enabled: false }) disables sweep timer", () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });

    DLCore.configureMemory({ enabled: true, pruneIntervalMs: 5000 });
    expect(DLCore.devtools().memory.sweepTimerActive).toBe(true);

    DLCore.configureMemory({ enabled: false });
    expect(DLCore.devtools().memory.sweepTimerActive).toBe(false);
    expect(DLCore.devtools().memory.enabled).toBe(false);
  });

  // ---- 3. configureMemory({ enabled: true }) schedules a sweep ----
  it("configureMemory({ enabled: true }) schedules a sweep", () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });

    DLCore.configureMemory({ enabled: false });
    expect(DLCore.devtools().memory.sweepTimerActive).toBe(false);

    DLCore.configureMemory({ enabled: true, pruneIntervalMs: 10000 });
    expect(DLCore.devtools().memory.sweepTimerActive).toBe(true);
  });

  // ---- 4. Collection refs are evicted after TTL expires ----
  it("collection refs are evicted after TTL expires", async () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });
    DLCore.configureMemory({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 999999 });

    // Fetch with params to create a non-default ref entry
    DLCore.fetchCollection("widgets", { params: { page: 1 } });
    await flush();

    const { collections } = DLCore.state();
    const C = collections.get("widgets");
    const paramKey = Array.from(C.refs.keys()).find((k) => k !== "__default__");
    expect(paramKey).toBeDefined();

    // Make the entry old by setting lastUsedAt far in the past
    const entry = C.refs.get(paramKey);
    entry.meta.lastUsedAt = new Date(Date.now() - 999999).toISOString();

    // Configure memory with a short TTL and trigger sweep
    DLCore.configureMemory({
      enabled: true,
      pruneIntervalMs: 1000,
      collectionEntryTtlMs: 5000,
    });

    // Advance past the immediate sweep (delay 0) + the scheduled interval
    await vi.advanceTimersByTimeAsync(1100);

    // The stale entry should have been evicted
    expect(C.refs.has(paramKey)).toBe(false);
  });

  // ---- 5. Collection refs evicted when exceeding max (LRU) ----
  it("collection refs are evicted when exceeding maxCollectionRefsPerCollection (LRU order)", async () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });
    DLCore.configureMemory({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 999999 });

    // Create several parameterized refs
    for (let i = 0; i < 5; i++) {
      DLCore.fetchCollection("widgets", { params: { page: i } });
      await flush();
    }

    const { collections } = DLCore.state();
    const C = collections.get("widgets");
    const nonDefaultKeys = Array.from(C.refs.keys()).filter((k) => k !== "__default__");
    expect(nonDefaultKeys.length).toBe(5);

    // Make the first two entries the oldest (LRU victims)
    const now = Date.now();
    for (let i = 0; i < nonDefaultKeys.length; i++) {
      const entry = C.refs.get(nonDefaultKeys[i]);
      // Oldest first: i=0 oldest, i=4 newest
      entry.meta.lastUsedAt = new Date(now - (5 - i) * 10000).toISOString();
    }

    // Allow only 2 non-default refs
    DLCore.configureMemory({
      enabled: true,
      pruneIntervalMs: 1000,
      maxCollectionRefsPerCollection: 2,
      collectionEntryTtlMs: 0, // disable TTL eviction
    });

    await vi.advanceTimersByTimeAsync(1100);

    // Should have evicted the 3 oldest, keeping only 2 newest + __default__
    const remainingKeys = Array.from(C.refs.keys()).filter((k) => k !== "__default__");
    expect(remainingKeys.length).toBe(2);

    // The two newest keys should remain (index 3 and 4)
    expect(C.refs.has(nonDefaultKeys[3])).toBe(true);
    expect(C.refs.has(nonDefaultKeys[4])).toBe(true);

    // The oldest keys should be gone
    expect(C.refs.has(nonDefaultKeys[0])).toBe(false);
    expect(C.refs.has(nonDefaultKeys[1])).toBe(false);
    expect(C.refs.has(nonDefaultKeys[2])).toBe(false);
  });

  // ---- 6. Default collection ref is never evicted ----
  it('default collection ref ("__default__" key) is never evicted', async () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });
    DLCore.configureMemory({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 999999 });

    // Fetch default (no params) to populate the default ref
    DLCore.fetchCollection("widgets");
    await flush();

    const { collections } = DLCore.state();
    const C = collections.get("widgets");
    const defaultEntry = C.refs.get("__default__");
    expect(defaultEntry).toBeDefined();

    // Make it look very old
    defaultEntry.meta.lastUsedAt = new Date(Date.now() - 9999999).toISOString();

    // Very aggressive sweep settings
    DLCore.configureMemory({
      enabled: true,
      pruneIntervalMs: 1000,
      collectionEntryTtlMs: 1000,
      maxCollectionRefsPerCollection: 0,
    });

    await vi.advanceTimersByTimeAsync(1100);

    // Default entry must survive
    expect(C.refs.has("__default__")).toBe(true);
  });

  // ---- 7. Item entries are evicted after TTL expires ----
  it("item entries are evicted after TTL expires", async () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });
    DLCore.configureMemory({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ name: "test" });
    DLCore.createType("product", { fetch: fetchFn, stalenessMs: 999999 });

    DLCore.fetchItem("product", "p1");
    await flush();

    const { types } = DLCore.state();
    const T = types.get("product");
    expect(T.items.has("p1")).toBe(true);

    // Make it old
    const ref = T.items.get("p1");
    ref.meta.lastUsedAt = new Date(Date.now() - 999999).toISOString();

    DLCore.configureMemory({
      enabled: true,
      pruneIntervalMs: 1000,
      itemEntryTtlMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(T.items.has("p1")).toBe(false);
  });

  // ---- 8. Item entries evicted when exceeding maxItemsPerType (LRU) ----
  it("item entries are evicted when exceeding maxItemsPerType (LRU order)", async () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });
    DLCore.configureMemory({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ name: "test" });
    DLCore.createType("product", { fetch: fetchFn, stalenessMs: 999999 });

    // Create several items
    for (let i = 0; i < 5; i++) {
      DLCore.fetchItem("product", `p${i}`);
      await flush();
    }

    const { types } = DLCore.state();
    const T = types.get("product");
    expect(T.items.size).toBe(5);

    // Set up LRU ordering: p0 oldest, p4 newest
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const ref = T.items.get(`p${i}`);
      ref.meta.lastUsedAt = new Date(now - (5 - i) * 10000).toISOString();
    }

    // Allow only 2 items
    DLCore.configureMemory({
      enabled: true,
      pruneIntervalMs: 1000,
      maxItemsPerType: 2,
      itemEntryTtlMs: 0, // disable TTL eviction
    });

    await vi.advanceTimersByTimeAsync(1100);

    // Should keep the 2 newest: p3 and p4
    expect(T.items.size).toBe(2);
    expect(T.items.has("p3")).toBe(true);
    expect(T.items.has("p4")).toBe(true);

    // Oldest should be gone
    expect(T.items.has("p0")).toBe(false);
    expect(T.items.has("p1")).toBe(false);
    expect(T.items.has("p2")).toBe(false);
  });

  // ---- 9. Loading items are not evicted ----
  it("loading items are not evicted (isLoading protection)", async () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });
    DLCore.configureMemory({ enabled: false });

    // Use a fetch that never resolves so the item stays in loading state
    const fetchFn = vi.fn().mockReturnValue(new Promise(() => {}));
    DLCore.createType("product", { fetch: fetchFn, stalenessMs: 999999 });

    DLCore.fetchItem("product", "loading-item");
    // Do NOT await - item stays loading

    const { types } = DLCore.state();
    const T = types.get("product");
    const ref = T.items.get("loading-item");
    expect(ref.meta.isLoading).toBe(true);

    // Make it look old
    ref.meta.lastUsedAt = new Date(Date.now() - 9999999).toISOString();

    DLCore.configureMemory({
      enabled: true,
      pruneIntervalMs: 1000,
      itemEntryTtlMs: 1000,
      maxItemsPerType: 0,
    });

    await vi.advanceTimersByTimeAsync(1100);

    // Should still be there because it's loading
    expect(T.items.has("loading-item")).toBe(true);
  });

  // ---- 10. configureMemory ignores invalid values ----
  it("configureMemory ignores invalid values (non-object, missing fields)", () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });

    // Set known values first
    DLCore.configureMemory({
      enabled: true,
      pruneIntervalMs: 30000,
      maxCollectionRefsPerCollection: 10,
      collectionEntryTtlMs: 120000,
      maxItemsPerType: 200,
      itemEntryTtlMs: 300000,
    });

    // Calling with non-object should be a no-op
    DLCore.configureMemory(null);
    DLCore.configureMemory(undefined);
    DLCore.configureMemory("string");
    DLCore.configureMemory(42);

    const mem = DLCore.devtools().memory;
    expect(mem.enabled).toBe(true);
    expect(mem.pruneIntervalMs).toBe(30000);
    expect(mem.maxCollectionRefsPerCollection).toBe(10);
    expect(mem.collectionEntryTtlMs).toBe(120000);
    expect(mem.maxItemsPerType).toBe(200);
    expect(mem.itemEntryTtlMs).toBe(300000);

    // Calling with an empty object should also be a no-op
    DLCore.configureMemory({});

    const mem2 = DLCore.devtools().memory;
    expect(mem2.pruneIntervalMs).toBe(30000);
    expect(mem2.maxItemsPerType).toBe(200);

    // Calling with unrelated keys should not change anything
    DLCore.configureMemory({ bogus: true, foo: 123 });

    const mem3 = DLCore.devtools().memory;
    expect(mem3.pruneIntervalMs).toBe(30000);
    expect(mem3.maxItemsPerType).toBe(200);
  });
});

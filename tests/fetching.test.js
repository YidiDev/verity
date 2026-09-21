import { describe, it, expect, vi } from "vitest";
import { freshCore } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("fetchCollection", () => {
  it("returns a ref with isLoading=true initially, then data populates after await", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1, 2, 3], count: 3 });
    DLCore.createCollection("widgets", { fetch: fetchFn });

    const ref = DLCore.fetchCollection("widgets");
    expect(ref.meta.isLoading).toBe(true);

    await tick();

    expect(ref.meta.isLoading).toBe(false);
    expect(ref.data.ids).toEqual([1, 2, 3]);
    expect(ref.data.count).toBe(3);
  });

  it("sets ref.data.ids and ref.data.count from fetch result", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: ["a", "b"], count: 42 });
    DLCore.createCollection("items", { fetch: fetchFn });

    const ref = DLCore.fetchCollection("items");
    await tick();

    expect(ref.data.ids).toEqual(["a", "b"]);
    expect(ref.data.count).toBe(42);
  });

  it("sets ref.meta.lastFetched after successful fetch", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn });

    const ref = DLCore.fetchCollection("widgets");
    expect(ref.meta.lastFetched).toBeNull();

    await tick();

    expect(ref.meta.lastFetched).not.toBeNull();
    expect(typeof ref.meta.lastFetched).toBe("string");
    // Should be a valid ISO date string
    expect(Number.isNaN(Date.parse(ref.meta.lastFetched))).toBe(false);
  });

  it("skips fetch when data is fresh (within stalenessMs)", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 60000 });

    // First fetch
    DLCore.fetchCollection("widgets");
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second fetch - data is fresh, should be skipped
    DLCore.fetchCollection("widgets");
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("force: true bypasses staleness check", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 60000 });

    // First fetch
    DLCore.fetchCollection("widgets");
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second fetch with force - should bypass staleness
    DLCore.fetchCollection("widgets", { force: true });
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("handles fetch errors - sets ref.meta.error", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockRejectedValue(new Error("network failure"));
    DLCore.createCollection("widgets", { fetch: fetchFn });

    const ref = DLCore.fetchCollection("widgets");
    await tick();

    expect(ref.meta.isLoading).toBe(false);
    expect(ref.meta.error).toContain("network failure");
    expect(ref.meta.lastFailedAt).not.toBeNull();

    const onChange = vi.fn();
    const unsubscribe = DLCore.onChange(onChange);
    DLCore.fetchCollection("widgets");
    await tick();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("force: true retries a failed collection and clears its cooldown", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn });

    const ref = DLCore.fetchCollection("widgets");
    await tick();
    DLCore.fetchCollection("widgets", { force: true });
    await tick();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(ref.data.ids).toEqual([1]);
    expect(ref.meta.error).toBeNull();
    expect(ref.meta.lastFailedAt).toBeNull();
  });

  it("retries a failed refresh after its cooldown even while cached data is fresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    try {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ids: [1], count: 1 })
        .mockRejectedValueOnce(new Error("refresh failed"))
        .mockResolvedValueOnce({ ids: [1, 2], count: 2 });
      DLCore.createCollection("widgets", {
        fetch: fetchFn,
        stalenessMs: 60_000,
        errorRetryMs: 1_000,
      });

      const ref = DLCore.fetchCollection("widgets");
      await vi.advanceTimersByTimeAsync(0);
      DLCore.fetchCollection("widgets", { force: true });
      await vi.advanceTimersByTimeAsync(0);

      DLCore.fetchCollection("widgets");
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchFn).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      DLCore.fetchCollection("widgets");
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(ref.data.ids).toEqual([1, 2]);
      expect(ref.meta.lastFailedAt).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("parameterized fetch: different params create different ref entries", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ids: [1, 2], count: 2 })
      .mockResolvedValueOnce({ ids: [3, 4, 5], count: 3 });
    DLCore.createCollection("widgets", { fetch: fetchFn });

    const refA = DLCore.fetchCollection("widgets", { params: { status: "active" } });
    const refB = DLCore.fetchCollection("widgets", { params: { status: "archived" } });

    await tick();

    // They should be different ref objects
    expect(refA).not.toBe(refB);
    expect(refA.data.ids).toEqual([1, 2]);
    expect(refB.data.ids).toEqual([3, 4, 5]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("coalescing: two simultaneous fetches for same collection+params call fetch only once", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn });

    const ref1 = DLCore.fetchCollection("widgets");
    const ref2 = DLCore.fetchCollection("widgets");

    await tick();

    // Same ref since same params (default)
    expect(ref1).toBe(ref2);
    // Fetch function only called once due to coalescing
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(ref1.data.ids).toEqual([1]);
  });
});

describe("fetchItem", () => {
  it("returns a ref with isLoading=true (when not silent), then data populates", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ name: "Widget A", price: 10 });
    DLCore.createType("widget", { fetch: fetchFn });

    const ref = DLCore.fetchItem("widget", "1");
    expect(ref.meta.isLoading).toBe(true);

    await tick();

    expect(ref.meta.isLoading).toBe(false);
    expect(ref.data).toEqual(expect.objectContaining({ name: "Widget A", price: 10 }));
  });

  it("sets ref.data from fetch result", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ id: "42", title: "Test" });
    DLCore.createType("article", { fetch: fetchFn });

    const ref = DLCore.fetchItem("article", "42");
    await tick();

    expect(ref.data.id).toBe("42");
    expect(ref.data.title).toBe("Test");
  });

  it("skips fetch when data is fresh", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ id: "1", name: "W" });
    DLCore.createType("widget", { fetch: fetchFn, stalenessMs: 60000 });

    // First fetch
    DLCore.fetchItem("widget", "1");
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second fetch - data is fresh, should be skipped
    DLCore.fetchItem("widget", "1");
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("force: true bypasses staleness check", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ id: "1", name: "W" });
    DLCore.createType("widget", { fetch: fetchFn, stalenessMs: 60000 });

    // First fetch
    DLCore.fetchItem("widget", "1");
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second fetch with force
    DLCore.fetchItem("widget", "1", null, { force: true });
    await tick();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("handles fetch errors - sets ref.meta.error", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockRejectedValue(new Error("server error"));
    DLCore.createType("widget", { fetch: fetchFn });

    const ref = DLCore.fetchItem("widget", "1");
    await tick();

    expect(ref.meta.isLoading).toBe(false);
    expect(ref.meta.error).toContain("server error");
    expect(ref.meta.levelFailureStamps.default).toEqual(expect.any(String));

    const onChange = vi.fn();
    const unsubscribe = DLCore.onChange(onChange);
    DLCore.fetchItem("widget", "1");
    await tick();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("force: true retries a failed item and clears its level cooldown", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error("server error"))
      .mockResolvedValueOnce({ id: "1", name: "Recovered" });
    DLCore.createType("widget", { fetch: fetchFn });

    const ref = DLCore.fetchItem("widget", "1");
    await tick();
    DLCore.fetchItem("widget", "1", null, { force: true });
    await tick();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(ref.data).toEqual(expect.objectContaining({ name: "Recovered" }));
    expect(ref.meta.error).toBeNull();
    expect(ref.meta.levelFailureStamps.default).toBeUndefined();
    expect(ref.meta.levelErrors.default).toBeUndefined();
  });

  it("tracks retry cooldowns independently for each item level", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const defaultFetch = vi.fn().mockResolvedValue({ id: "1", name: "Summary" });
    const detailFetch = vi.fn().mockRejectedValue(new Error("detail failed"));
    DLCore.createType("widget", {
      fetch: defaultFetch,
      levels: {
        detail: {
          fetch: detailFetch,
          checkIfExists: (data) => Boolean(data?.description),
        },
      },
    });

    const ref = DLCore.fetchItem("widget", "1", "detail");
    await tick();
    DLCore.fetchItem("widget", "1", "detail");
    DLCore.fetchItem("widget", "1");
    await tick();

    expect(detailFetch).toHaveBeenCalledTimes(1);
    expect(defaultFetch).toHaveBeenCalledTimes(1);
    expect(ref.data).toEqual(expect.objectContaining({ name: "Summary" }));
    expect(ref.meta.levelFailureStamps.detail).toEqual(expect.any(String));
    expect(ref.meta.levelErrors.detail).toContain("detail failed");
    expect(ref.meta.error).toContain("detail failed");
  });

  it("keeps another level's error visible when the latest failure recovers", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const detailFetch = vi.fn().mockRejectedValue(new Error("detail failed"));
    const permissionsFetch = vi.fn()
      .mockRejectedValueOnce(new Error("permissions failed"))
      .mockResolvedValueOnce({ permissions: ["read"] });
    DLCore.createType("widget", {
      fetch: vi.fn(),
      levels: {
        detail: {
          fetch: detailFetch,
          checkIfExists: (data) => Boolean(data?.description),
        },
        permissions: {
          fetch: permissionsFetch,
          checkIfExists: (data) => Boolean(data?.permissions),
        },
      },
    });

    const ref = DLCore.fetchItem("widget", "1", "detail");
    await tick();
    DLCore.fetchItem("widget", "1", "permissions");
    await tick();
    expect(ref.meta.error).toContain("permissions failed");

    DLCore.fetchItem("widget", "1", "permissions", { force: true });
    await tick();

    expect(ref.meta.levelFailureStamps.permissions).toBeUndefined();
    expect(ref.meta.levelErrors.permissions).toBeUndefined();
    expect(ref.meta.levelFailureStamps.detail).toEqual(expect.any(String));
    expect(ref.meta.error).toContain("detail failed");
  });

  it("uses a level retry cooldown before type freshness when a refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    try {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const detailFetch = vi.fn()
        .mockResolvedValueOnce({ id: "1", description: "Cached" })
        .mockRejectedValueOnce(new Error("refresh failed"))
        .mockResolvedValueOnce({ id: "1", description: "Recovered" });
      DLCore.createType("widget", {
        fetch: vi.fn(),
        stalenessMs: 60_000,
        errorRetryMs: 10_000,
        levels: {
          detail: {
            fetch: detailFetch,
            errorRetryMs: 1_000,
            checkIfExists: (data) => Boolean(data?.description),
          },
        },
      });

      const ref = DLCore.fetchItem("widget", "1", "detail");
      await vi.advanceTimersByTimeAsync(0);
      DLCore.fetchItem("widget", "1", "detail", { force: true });
      await vi.advanceTimersByTimeAsync(0);

      DLCore.fetchItem("widget", "1", "detail");
      await vi.advanceTimersByTimeAsync(0);
      expect(detailFetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      DLCore.fetchItem("widget", "1", "detail");
      await vi.advanceTimersByTimeAsync(0);

      expect(detailFetch).toHaveBeenCalledTimes(3);
      expect(ref.data).toEqual(expect.objectContaining({ description: "Recovered" }));
      expect(ref.meta.levelFailureStamps.detail).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("silent: true does not set isLoading", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ id: "1", name: "W" });
    DLCore.createType("widget", { fetch: fetchFn });

    const ref = DLCore.fetchItem("widget", "1", null, { silent: true });
    // silent should not set isLoading to true
    expect(ref.meta.isLoading).toBe(false);

    await tick();

    expect(ref.meta.isLoading).toBe(false);
    expect(ref.data).toEqual(expect.objectContaining({ id: "1", name: "W" }));
  });

  it("coalescing: two simultaneous fetches for same item call fetch only once", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ id: "1", name: "W" });
    DLCore.createType("widget", { fetch: fetchFn });

    const ref1 = DLCore.fetchItem("widget", "1");
    const ref2 = DLCore.fetchItem("widget", "1");

    await tick();

    // Same ref object for same type+id
    expect(ref1).toBe(ref2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(ref1.data).toEqual(expect.objectContaining({ id: "1", name: "W" }));
  });

  it("latest-wins: slow first fetch is discarded when a newer update arrives via directive", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    let resolve1;
    const p1 = new Promise((r) => { resolve1 = r; });
    const fetchFn = vi.fn().mockReturnValueOnce(p1);

    DLCore.createType("widget", { fetch: fetchFn, stalenessMs: 0 });

    // First fetch starts - sets a qid in activeLevelQueryIds
    const ref = DLCore.fetchItem("widget", "1");
    expect(ref.meta.isLoading).toBe(true);
    await tick();

    // A directive arrives with inline data, clearing the old qid
    DLCore.applyDirectives([
      {
        op: "refresh_item",
        name: "widget",
        id: "1",
        result: { data: { id: "1", name: "FromDirective" } },
      },
    ]);
    await tick();

    expect(ref.data).toEqual(expect.objectContaining({ name: "FromDirective" }));

    // Now the slow first fetch resolves - its qid was cleared by the directive,
    // so this result should be discarded (latest-wins)
    resolve1({ id: "1", name: "FromSlowFetch" });
    await tick();

    // Data should still be from the directive, not the slow fetch
    expect(ref.data.name).toBe("FromDirective");
  });
});

describe("fetchCollection direct params format", () => {
  it("treats opts as params when non-meta keys present", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn });

    // Direct params format: { status: "active" } instead of { params: { status: "active" } }
    DLCore.fetchCollection("widgets", { status: "active" });
    await tick();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const calledWith = fetchFn.mock.calls[0][0];
    expect(calledWith.status).toBe("active");
  });
});

describe("collection data preserves server meta and items", () => {
  it("preserves meta and items from fetch response", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({
      ids: [1, 2],
      count: 2,
      meta: { cursor: "abc123" },
      items: { 1: { name: "A" }, 2: { name: "B" } },
    });
    DLCore.createCollection("widgets", { fetch: fetchFn });

    const ref = DLCore.fetchCollection("widgets");
    await tick();

    expect(ref.data.ids).toEqual([1, 2]);
    expect(ref.data.meta).toEqual({ cursor: "abc123" });
    expect(ref.data.items).toEqual({ 1: { name: "A" }, 2: { name: "B" } });
  });

  it("defaults meta and items to null when not in response", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn });

    const ref = DLCore.fetchCollection("widgets");
    await tick();

    expect(ref.data.meta).toBeNull();
    expect(ref.data.items).toBeNull();
  });
});

describe("source-of-truth loading helpers", () => {
  it("isItemLoading returns true for in-flight items", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    let resolve;
    const p = new Promise((r) => { resolve = r; });
    DLCore.createType("widget", { fetch: vi.fn().mockReturnValue(p) });

    DLCore.fetchItem("widget", "1");
    await tick();

    // Should be in-flight
    expect(DLCore.isItemLoading("widget", "1")).toBe(true);

    resolve({ id: "1", name: "test" });
    await tick();

    // Should no longer be in-flight
    expect(DLCore.isItemLoading("widget", "1")).toBe(false);
  });

  it("isCollectionLoading returns true for in-flight collections", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    let resolve;
    const p = new Promise((r) => { resolve = r; });
    DLCore.createCollection("widgets", { fetch: vi.fn().mockReturnValue(p) });

    DLCore.fetchCollection("widgets");
    await tick();

    expect(DLCore.isCollectionLoading("widgets")).toBe(true);

    resolve({ ids: [1], count: 1 });
    await tick();

    expect(DLCore.isCollectionLoading("widgets")).toBe(false);
  });

  it("hasAnyInFlightRequests returns true when anything is in-flight", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(DLCore.hasAnyInFlightRequests()).toBe(false);

    let resolve;
    const p = new Promise((r) => { resolve = r; });
    DLCore.createType("widget", { fetch: vi.fn().mockReturnValue(p) });

    DLCore.fetchItem("widget", "1");
    await tick();

    expect(DLCore.hasAnyInFlightRequests()).toBe(true);

    resolve({ id: "1" });
    await tick();

    expect(DLCore.hasAnyInFlightRequests()).toBe(false);
  });
});

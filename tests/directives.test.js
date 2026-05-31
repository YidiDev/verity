import { describe, it, expect, vi } from "vitest";
import { freshCore } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("applyDirectives", () => {
  describe("refresh_collection", () => {
    it("with inline result applies data directly without fetching", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const fetchFn = vi.fn().mockResolvedValue({ ids: [], count: 0 });
      DLCore.createCollection("widgets", { fetch: fetchFn });

      // Pre-fetch so the collection ref entry exists
      DLCore.fetchCollection("widgets");
      await tick();
      fetchFn.mockClear();

      await DLCore.applyDirectives([
        {
          op: "refresh_collection",
          name: "widgets",
          result: { data: { ids: [10, 20, 30], count: 3 } },
        },
      ]);

      // Data should be applied inline
      const { collections } = DLCore.state();
      const C = collections.get("widgets");
      const ref = C.ref;
      expect(ref.data.ids).toEqual([10, 20, 30]);
      expect(ref.data.count).toBe(3);
      // Fetch should NOT have been called
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("without result triggers a force fetch", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const fetchFn = vi
        .fn()
        .mockResolvedValue({ ids: [1, 2], count: 2 });
      DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 60000 });

      // Initial fetch to populate data
      DLCore.fetchCollection("widgets");
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Directive without result should trigger a new fetch even though data is fresh
      await DLCore.applyDirectives([
        { op: "refresh_collection", name: "widgets" },
      ]);
      await tick();

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("with params targets the right parameterized ref", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ids: [1], count: 1 })
        .mockResolvedValueOnce({ ids: [2], count: 1 })
        .mockResolvedValueOnce({ ids: [99], count: 1 });
      DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 60000 });

      // Create two parameterized entries
      const refActive = DLCore.fetchCollection("widgets", { params: { status: "active" } });
      const refArchived = DLCore.fetchCollection("widgets", { params: { status: "archived" } });
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(2);

      // Directive targets only the "active" params
      await DLCore.applyDirectives([
        {
          op: "refresh_collection",
          name: "widgets",
          params: { status: "active" },
        },
      ]);
      await tick();

      // Only one additional fetch for the "active" parameterized entry
      expect(fetchFn).toHaveBeenCalledTimes(3);
      // The "active" ref should have the new data
      expect(refActive.data.ids).toEqual([99]);
      // The "archived" ref should be untouched
      expect(refArchived.data.ids).toEqual([2]);
    });

    it("with params_mode 'contains' matches entries whose params contain the subset", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ ids: [callCount * 10], count: 1 });
      });
      DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 60000 });

      // Create entries with different params
      DLCore.fetchCollection("widgets", { params: { status: "active", org: "a" } });
      DLCore.fetchCollection("widgets", { params: { status: "active", org: "b" } });
      DLCore.fetchCollection("widgets", { params: { status: "archived", org: "a" } });
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(3);

      // Directive with contains mode should match all entries with status: "active"
      await DLCore.applyDirectives([
        {
          op: "refresh_collection",
          name: "widgets",
          params: { status: "active" },
          params_mode: "contains",
        },
      ]);
      await tick();

      // Should have triggered 2 additional fetches (the two "active" entries)
      expect(fetchFn).toHaveBeenCalledTimes(5);
    });
  });

  describe("refresh_item", () => {
    it("with inline result applies data to the item ref", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const fetchFn = vi.fn().mockResolvedValue({ id: "1", name: "old" });
      DLCore.createType("widget", { fetch: fetchFn });

      // Pre-fetch the item
      const ref = DLCore.fetchItem("widget", "1");
      await tick();
      expect(ref.data.name).toBe("old");
      fetchFn.mockClear();

      await DLCore.applyDirectives([
        {
          op: "refresh_item",
          name: "widget",
          id: "1",
          result: { data: { id: "1", name: "updated" } },
        },
      ]);

      expect(ref.data.name).toBe("updated");
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("with inline multi-level result applies level data", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const baseFetch = vi.fn().mockResolvedValue({ id: "1" });
      const detailFetch = vi.fn().mockResolvedValue({ id: "1", details: "full" });

      DLCore.createType("widget", {
        fetch: baseFetch,
        levels: {
          detail: {
            fetch: detailFetch,
            checkIfExists: (data) => !!data?.details,
          },
        },
      });

      // Pre-fetch at default level
      const ref = DLCore.fetchItem("widget", "1");
      await tick();
      baseFetch.mockClear();
      detailFetch.mockClear();

      await DLCore.applyDirectives([
        {
          op: "refresh_item",
          name: "widget",
          id: "1",
          result: {
            levels: {
              detail: { data: { id: "1", details: "from-directive" } },
            },
          },
        },
      ]);

      // The detail level data should be merged into the ref
      expect(ref.data.details).toBe("from-directive");
      // No fetch should have been triggered for the detail level
      expect(detailFetch).not.toHaveBeenCalled();
    });

    it("without result triggers a force fetch for fetched levels", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const fetchFn = vi.fn().mockResolvedValue({ id: "1", name: "W" });
      DLCore.createType("widget", { fetch: fetchFn, stalenessMs: 60000 });

      // Pre-fetch so there's a lastFetched stamp
      DLCore.fetchItem("widget", "1");
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Directive without result should trigger re-fetch
      await DLCore.applyDirectives([
        { op: "refresh_item", name: "widget", id: "1" },
      ]);
      await tick();

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidate", () => {
    it("recursively processes nested targets", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const colFetch = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
      const itemFetch = vi.fn().mockResolvedValue({ id: "1", name: "W" });
      DLCore.createCollection("widgets", { fetch: colFetch, stalenessMs: 60000 });
      DLCore.createType("widget", { fetch: itemFetch, stalenessMs: 60000 });

      // Pre-fetch both
      DLCore.fetchCollection("widgets");
      DLCore.fetchItem("widget", "1");
      await tick();
      expect(colFetch).toHaveBeenCalledTimes(1);
      expect(itemFetch).toHaveBeenCalledTimes(1);

      // Invalidate wrapping both a collection and item refresh
      await DLCore.applyDirectives([
        {
          op: "invalidate",
          targets: [
            { op: "refresh_collection", name: "widgets" },
            { op: "refresh_item", name: "widget", id: "1" },
          ],
        },
      ]);
      await tick();

      expect(colFetch).toHaveBeenCalledTimes(2);
      expect(itemFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("idempotency", () => {
    it("skips directives with the same idempotency_key on second processing", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
      DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 60000 });

      // Pre-fetch
      DLCore.fetchCollection("widgets");
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(1);

      const directive = {
        op: "refresh_collection",
        name: "widgets",
        idempotency_key: "unique-key-123",
      };

      // First application
      await DLCore.applyDirectives([directive]);
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(2);

      // Second application with the same key - should be skipped
      await DLCore.applyDirectives([directive]);
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("disableIdempotencyGuard allows reprocessing", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
      DLCore.createCollection("widgets", { fetch: fetchFn, stalenessMs: 60000 });

      // Pre-fetch
      DLCore.fetchCollection("widgets");
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(1);

      const directive = {
        op: "refresh_collection",
        name: "widgets",
        idempotency_key: "unique-key-456",
      };

      // First application
      await DLCore.applyDirectives([directive]);
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(2);

      // Second application with disableIdempotencyGuard - should NOT be skipped
      await DLCore.applyDirectives([directive], { disableIdempotencyGuard: true });
      await tick();
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });
  });

  describe("edge cases", () => {
    it("skips directives with no op", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
      DLCore.createCollection("widgets", { fetch: fetchFn });

      // These should be silently skipped - no errors thrown
      const result = await DLCore.applyDirectives([
        { name: "widgets" },         // missing op
        null,                         // null directive
        { op: "", name: "widgets" },  // empty op
      ]);

      expect(fetchFn).not.toHaveBeenCalled();
      // Promise.all should resolve (no tasks were pushed)
      expect(result).toBeDefined();
    });

    it("skips refresh_item for unknown/unregistered types", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      // Don't register any type - the directive should be silently skipped
      const result = await DLCore.applyDirectives([
        { op: "refresh_item", name: "nonexistent", id: "1" },
      ]);

      // Should not throw, just skip
      expect(result).toBeDefined();
    });

    it("force_reload_page emits lifecycle event in non-browser context", async () => {
      const DLCore = freshCore();
      DLCore.configureMemory({ enabled: false });
      DLCore.configureSse({ enabled: false });

      const events = [];
      DLCore.onLifecycle("directive:processed", (p) => events.push(p));

      // In jsdom, window.location exists but reload is a function.
      // The directive should process without throwing.
      // We can't easily test the actual reload, but we can verify it processes.
      await DLCore.applyDirectives([
        { op: "force_reload_page" },
      ]);

      // Should have processed the directive
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });
});

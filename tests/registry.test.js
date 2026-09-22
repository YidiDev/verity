import { describe, it, expect, vi } from "vitest";
import { freshCore } from "./helpers.js";

describe("createType", () => {
  it("creates a type with name and fetch - visible in state().types", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn();
    DLCore.createType("widget", { fetch: fetchFn });

    const { types } = DLCore.state();
    expect(types.has("widget")).toBe(true);
    expect(typeof types.get("widget").fetch).toBe("function");
  });

  it("throws if name is missing", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(() => DLCore.createType("", { fetch: vi.fn() })).toThrow();
    expect(() => DLCore.createType(null, { fetch: vi.fn() })).toThrow();
    expect(() => DLCore.createType(undefined, { fetch: vi.fn() })).toThrow();
  });

  it("throws if fetch is not a function", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(() => DLCore.createType("widget", { fetch: "not-a-fn" })).toThrow();
    expect(() => DLCore.createType("widget", { fetch: null })).toThrow();
    expect(() => DLCore.createType("widget", { fetch: 42 })).toThrow();
  });

  it("throws if type already exists (duplicate name)", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", { fetch: vi.fn() });
    expect(() => DLCore.createType("widget", { fetch: vi.fn() })).toThrow(
      /already exists/
    );
  });

  it("sets default stalenessMs of 15000", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", { fetch: vi.fn() });
    const T = DLCore.state().types.get("widget");
    expect(T.stalenessMs).toBe(15000);
  });

  it("accepts custom stalenessMs", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", { fetch: vi.fn(), stalenessMs: 5000 });
    const T = DLCore.state().types.get("widget");
    expect(T.stalenessMs).toBe(5000);
  });

  it("registers levels with their own fetch, check, stalenessMs, bulkFetch", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const summaryFetch = vi.fn();
    const detailFetch = vi.fn();
    const detailCheck = (data) => !!data?.details;
    const detailBulkFetch = vi.fn();

    DLCore.createType("widget", {
      fetch: vi.fn(),
      levels: {
        summary: { fetch: summaryFetch, stalenessMs: 3000 },
        detail: {
          fetch: detailFetch,
          checkIfExists: detailCheck,
          stalenessMs: 10000,
          bulkFetch: detailBulkFetch,
        },
      },
    });

    const T = DLCore.state().types.get("widget");
    expect(T.levels.summary).toBeDefined();
    expect(T.levels.summary.stalenessMs).toBe(3000);
    expect(typeof T.levels.summary.fetch).toBe("function");

    expect(T.levels.detail).toBeDefined();
    expect(T.levels.detail.stalenessMs).toBe(10000);
    expect(typeof T.levels.detail.fetch).toBe("function");
    expect(typeof T.levels.detail.check).toBe("function");
    expect(typeof T.levels.detail.bulkFetch).toBe("function");
  });

  it("throws if a level is missing its fetch function", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(() =>
      DLCore.createType("widget", {
        fetch: vi.fn(),
        levels: {
          summary: { stalenessMs: 3000 },
        },
      })
    ).toThrow(/Level.*needs fetch/);
  });

  it("registers bulkFetch at the type level", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const bulkFetch = vi.fn();
    DLCore.createType("widget", { fetch: vi.fn(), bulkFetch });

    const T = DLCore.state().types.get("widget");
    expect(typeof T.bulkFetch).toBe("function");
  });

  it("sets up levelConversionMap edges correctly (verify via devtools())", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn(),
      levels: {
        summary: { fetch: vi.fn() },
        detail: { fetch: vi.fn() },
      },
      // "detail" converts-from to both "summary" and "default"
      levelConversionMap: {
        detail: ["summary", "default"],
      },
    });

    const dt = DLCore.devtools();
    const widget = dt.types.widget;
    // convertFrom maps source -> targets
    // "detail" -> ["summary", "default"]
    expect(widget.convertFrom).toBeDefined();
    expect(widget.convertFrom["detail"]).toEqual(
      expect.arrayContaining(["summary", "default"])
    );
  });

  it("sets up per-level levelConversionMap edges", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn(),
      levels: {
        summary: { fetch: vi.fn() },
        detail: {
          fetch: vi.fn(),
          levelConversionMap: {
            detail: ["summary"],
          },
        },
      },
    });

    const dt = DLCore.devtools();
    const widget = dt.types.widget;
    expect(widget.convertFrom["detail"]).toEqual(
      expect.arrayContaining(["summary"])
    );
  });
});

describe("createCollection", () => {
  it("creates a collection with name and fetch - visible in state().collections", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn();
    DLCore.createCollection("widgets", { fetch: fetchFn });

    const { collections } = DLCore.state();
    expect(collections.has("widgets")).toBe(true);
    expect(typeof collections.get("widgets").fetch).toBe("function");
  });

  it("throws if name is missing/empty", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(() => DLCore.createCollection("", { fetch: vi.fn() })).toThrow();
    expect(() => DLCore.createCollection(null, { fetch: vi.fn() })).toThrow();
    expect(() =>
      DLCore.createCollection(undefined, { fetch: vi.fn() })
    ).toThrow();
  });

  it("throws if fetch is not a function", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(() =>
      DLCore.createCollection("widgets", { fetch: "not-a-fn" })
    ).toThrow();
    expect(() =>
      DLCore.createCollection("widgets", { fetch: null })
    ).toThrow();
    expect(() =>
      DLCore.createCollection("widgets", { fetch: 42 })
    ).toThrow();
  });

  it("throws if collection already exists", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createCollection("widgets", { fetch: vi.fn() });
    expect(() =>
      DLCore.createCollection("widgets", { fetch: vi.fn() })
    ).toThrow(/already exists/);
  });

  it("sets default stalenessMs of 15000", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createCollection("widgets", { fetch: vi.fn() });
    const C = DLCore.state().collections.get("widgets");
    expect(C.stalenessMs).toBe(15000);
  });

  it("accepts custom stalenessMs", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createCollection("widgets", { fetch: vi.fn(), stalenessMs: 8000 });
    const C = DLCore.state().collections.get("widgets");
    expect(C.stalenessMs).toBe(8000);
  });

  it("initial ref has correct shape", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createCollection("widgets", { fetch: vi.fn() });
    const C = DLCore.state().collections.get("widgets");
    const ref = C.ref;

    // Verify essential shape (data and meta present with expected keys)
    expect(ref.data.ids).toEqual([]);
    expect(ref.data.count).toBe(0);
    expect(ref.meta.isLoading).toBe(false);
    expect(ref.meta.lastFetched).toBeNull();
    expect(ref.meta.error).toBeNull();
    expect(ref.meta.activeQueryId).toBeNull();
    expect(ref.meta.paramsKey).toBe("__default__");
    expect(ref.meta.lastUsedAt).toBeNull();
  });
});

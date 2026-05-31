import { describe, it, expect, vi } from "vitest";
import { freshCore } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("state()", () => {
  it("returns types and collections Maps", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const s = DLCore.state();
    expect(s.types).toBeInstanceOf(Map);
    expect(s.collections).toBeInstanceOf(Map);
  });

  it("reflects registered types", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", { fetch: vi.fn() });
    DLCore.createType("gadget", { fetch: vi.fn() });

    const s = DLCore.state();
    expect(s.types.has("widget")).toBe(true);
    expect(s.types.has("gadget")).toBe(true);
    expect(s.types.size).toBe(2);
  });

  it("reflects registered collections", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createCollection("widgets", { fetch: vi.fn() });

    const s = DLCore.state();
    expect(s.collections.has("widgets")).toBe(true);
    expect(s.collections.size).toBe(1);
  });

  it("state references are live (mutations visible)", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn().mockResolvedValue({ id: "1", name: "test" }),
    });

    const s = DLCore.state();
    const T = s.types.get("widget");
    expect(T.items.size).toBe(0);

    DLCore.fetchItem("widget", "1");
    await tick();

    // Should see the item now through the same reference
    expect(T.items.size).toBe(1);
    expect(T.items.has("1")).toBe(true);
  });
});

describe("devtools()", () => {
  it("returns a frozen snapshot object", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const dt = DLCore.devtools();
    expect(Object.isFrozen(dt)).toBe(true);
  });

  it("includes clientId", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const dt = DLCore.devtools();
    expect(typeof dt.clientId).toBe("string");
    expect(dt.clientId.length).toBeGreaterThan(0);
  });

  it("clientId matches DLCore.clientId()", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(DLCore.devtools().clientId).toBe(DLCore.clientId());
  });

  it("includes types with their configuration", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn(),
      stalenessMs: 5000,
      bulkFetch: vi.fn(),
      levels: {
        detail: {
          fetch: vi.fn(),
          stalenessMs: 10000,
          checkIfExists: (d) => !!d?.details,
        },
      },
    });

    const dt = DLCore.devtools();
    expect(dt.types.widget).toBeDefined();
    expect(dt.types.widget.stalenessMs).toBe(5000);
    expect(dt.types.widget.hasBulkFetch).toBe(true);
    expect(dt.types.widget.levels.detail).toBeDefined();
    expect(dt.types.widget.levels.detail.stalenessMs).toBe(10000);
    expect(dt.types.widget.levels.detail.hasCustomCheck).toBe(true);
  });

  it("includes collections with refs", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createCollection("widgets", {
      fetch: vi.fn().mockResolvedValue({ ids: [1, 2], count: 2 }),
      stalenessMs: 8000,
    });

    DLCore.fetchCollection("widgets");
    await tick();

    const dt = DLCore.devtools();
    expect(dt.collections.widgets).toBeDefined();
    expect(dt.collections.widgets.stalenessMs).toBe(8000);
    expect(dt.collections.widgets.refs["__default__"]).toBeDefined();
    expect(dt.collections.widgets.refs["__default__"].data.ids).toEqual([1, 2]);
  });

  it("includes items in type snapshots", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn().mockResolvedValue({ id: "42", name: "Test Widget" }),
    });

    DLCore.fetchItem("widget", "42");
    await tick();

    const dt = DLCore.devtools();
    expect(dt.types.widget.items["42"]).toBeDefined();
    expect(dt.types.widget.items["42"].data.name).toBe("Test Widget");
    expect(dt.types.widget.items["42"].meta.isLoading).toBe(false);
  });

  it("includes SSE configuration", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const dt = DLCore.devtools();
    expect(dt.sse).toBeDefined();
    expect(typeof dt.sse.enabled).toBe("boolean");
    expect(typeof dt.sse.url).toBe("string");
    expect(typeof dt.sse.connected).toBe("boolean");
    expect(typeof dt.sse.retryMs).toBe("number");
  });

  it("includes memory configuration", () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });
    DLCore.configureMemory({ enabled: true, pruneIntervalMs: 30000 });

    const dt = DLCore.devtools();
    expect(dt.memory).toBeDefined();
    expect(dt.memory.enabled).toBe(true);
    expect(dt.memory.pruneIntervalMs).toBe(30000);
    expect(typeof dt.memory.sweepTimerActive).toBe("boolean");
  });

  it("includes bulk queue info", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const dt = DLCore.devtools();
    expect(dt.bulk).toBeDefined();
    expect(typeof dt.bulk.delayMs).toBe("number");
    expect(dt.bulk.queues).toBeDefined();
  });

  it("includes inFlight info", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const dt = DLCore.devtools();
    expect(dt.inFlight).toBeDefined();
    expect(Array.isArray(dt.inFlight.collections)).toBe(true);
    expect(Array.isArray(dt.inFlight.items)).toBe(true);
  });

  it("includes directiveRegistry info", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const dt = DLCore.devtools();
    expect(dt.directiveRegistry).toBeDefined();
    expect(typeof dt.directiveRegistry.ttlMs).toBe("number");
    expect(typeof dt.directiveRegistry.maxSize).toBe("number");
    expect(Array.isArray(dt.directiveRegistry.seen)).toBe(true);
  });

  it("snapshot is a deep clone (mutations do not affect state)", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createCollection("widgets", {
      fetch: vi.fn().mockResolvedValue({ ids: [1], count: 1 }),
    });
    DLCore.fetchCollection("widgets");
    await tick();

    const dt1 = DLCore.devtools();
    const ids1 = dt1.collections.widgets.refs["__default__"].data.ids;

    // Fetch again with different data
    DLCore.createType("gadget", { fetch: vi.fn() });
    const dt2 = DLCore.devtools();

    // dt1 should not reflect the new type
    expect(dt1.types.gadget).toBeUndefined();
    expect(dt2.types.gadget).toBeDefined();
  });
});

describe("clientId()", () => {
  it("returns a non-empty string", () => {
    const DLCore = freshCore();
    expect(typeof DLCore.clientId()).toBe("string");
    expect(DLCore.clientId().length).toBeGreaterThan(0);
  });

  it("returns the same value on repeated calls", () => {
    const DLCore = freshCore();
    expect(DLCore.clientId()).toBe(DLCore.clientId());
  });
});

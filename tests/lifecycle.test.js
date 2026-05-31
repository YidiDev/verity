import { describe, it, expect, vi } from "vitest";
import { freshCore } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("lifecycle events", () => {
  it("onLifecycle registers a listener that receives events", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const handler = vi.fn();
    DLCore.onLifecycle("collection:fetch:success", handler);

    DLCore.createCollection("widgets", {
      fetch: vi.fn().mockResolvedValue({ ids: [1], count: 1 }),
    });
    DLCore.fetchCollection("widgets");
    await tick();

    expect(handler).toHaveBeenCalled();
    const payload = handler.mock.calls[0][0];
    expect(payload.event).toBe("collection:fetch:success");
    expect(payload.detail).toBeDefined();
    expect(typeof payload.timestamp).toBe("string");
  });

  it("wildcard '*' listener receives all events", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const handler = vi.fn();
    DLCore.onLifecycle("*", handler);

    DLCore.createCollection("widgets", {
      fetch: vi.fn().mockResolvedValue({ ids: [1], count: 1 }),
    });
    DLCore.fetchCollection("widgets");
    await tick();

    // Should receive multiple events (intent, success, complete, etc.)
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
    const eventNames = handler.mock.calls.map((c) => c[0].event);
    expect(eventNames).toContain("collection:fetch:intent");
    expect(eventNames).toContain("collection:fetch:success");
  });

  it("unsubscribe stops receiving events", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const handler = vi.fn();
    const unsub = DLCore.onLifecycle("collection:fetch:success", handler);

    DLCore.createCollection("widgets", {
      fetch: vi.fn().mockResolvedValue({ ids: [1], count: 1 }),
      stalenessMs: 0,
    });
    DLCore.fetchCollection("widgets");
    await tick();
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();

    DLCore.fetchCollection("widgets", { force: true });
    await tick();

    // Should not have been called again
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("onLifecycle with invalid args returns a no-op unsubscribe", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const unsub1 = DLCore.onLifecycle("", vi.fn());
    const unsub2 = DLCore.onLifecycle(null, vi.fn());
    const unsub3 = DLCore.onLifecycle("test", "not-a-function");
    const unsub4 = DLCore.onLifecycle("test", null);

    expect(typeof unsub1).toBe("function");
    expect(typeof unsub2).toBe("function");
    expect(typeof unsub3).toBe("function");
    expect(typeof unsub4).toBe("function");

    // Calling should not throw
    expect(() => unsub1()).not.toThrow();
    expect(() => unsub2()).not.toThrow();
    expect(() => unsub3()).not.toThrow();
    expect(() => unsub4()).not.toThrow();
  });

  it("lifecycle payload is frozen", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    let capturedPayload = null;
    DLCore.onLifecycle("collection:fetch:success", (p) => {
      capturedPayload = p;
    });

    DLCore.createCollection("widgets", {
      fetch: vi.fn().mockResolvedValue({ ids: [1], count: 1 }),
    });
    DLCore.fetchCollection("widgets");
    await tick();

    expect(capturedPayload).not.toBeNull();
    expect(Object.isFrozen(capturedPayload)).toBe(true);
  });

  it("handler errors are swallowed", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const badHandler = vi.fn(() => {
      throw new Error("handler boom");
    });
    const goodHandler = vi.fn();

    DLCore.onLifecycle("collection:fetch:success", badHandler);
    DLCore.onLifecycle("collection:fetch:success", goodHandler);

    DLCore.createCollection("widgets", {
      fetch: vi.fn().mockResolvedValue({ ids: [1], count: 1 }),
    });

    expect(() => DLCore.fetchCollection("widgets")).not.toThrow();
    await tick();

    expect(badHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });

  it("item fetch emits lifecycle events", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const events = [];
    DLCore.onLifecycle("*", (p) => events.push(p.event));

    DLCore.createType("widget", {
      fetch: vi.fn().mockResolvedValue({ id: "1", name: "test" }),
    });
    DLCore.fetchItem("widget", "1");
    await tick();

    expect(events).toContain("item:fetch:intent");
    expect(events).toContain("item:fetch:success");
    expect(events).toContain("item:fetch:complete");
  });

  it("directive processing emits lifecycle events", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const events = [];
    DLCore.onLifecycle("*", (p) => events.push(p.event));

    DLCore.createCollection("widgets", {
      fetch: vi.fn().mockResolvedValue({ ids: [1], count: 1 }),
    });

    await DLCore.applyDirectives([
      {
        op: "refresh_collection",
        name: "widgets",
        result: { data: { ids: [10, 20], count: 2 } },
      },
    ]);

    expect(events).toContain("directive:processed");
  });
});

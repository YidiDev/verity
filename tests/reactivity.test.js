import { describe, it, expect, vi } from "vitest";
import { freshCore } from "./helpers.js";

/**
 * Helper: create a DLCore instance with memory and SSE disabled,
 * ready for reactivity tests.
 */
function setup() {
  const DLCore = freshCore();
  DLCore.configureMemory({ enabled: false });
  DLCore.configureSse({ enabled: false });
  return DLCore;
}

describe("onChange reactivity", () => {
  it("registers a listener and fires it on data changes", async () => {
    const DLCore = setup();
    const listener = vi.fn();
    DLCore.onChange(listener);

    DLCore.createType("test", {
      fetch: (id) => Promise.resolve({ id, name: "item" }),
    });

    // fetchItem triggers assignRef synchronously (isLoading) and async (data)
    DLCore.fetchItem("test", 1);

    // Synchronous assignRef for isLoading should have fired the listener
    expect(listener).toHaveBeenCalled();

    // Wait for the async fetch to complete
    await vi.waitFor(() => {
      // At least 2 calls: one for isLoading=true, one for data arrival
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("returns a no-op unsubscribe when given a non-function", () => {
    const DLCore = setup();

    const unsub1 = DLCore.onChange(null);
    const unsub2 = DLCore.onChange(undefined);
    const unsub3 = DLCore.onChange(42);
    const unsub4 = DLCore.onChange("string");

    // All should return functions
    expect(typeof unsub1).toBe("function");
    expect(typeof unsub2).toBe("function");
    expect(typeof unsub3).toBe("function");
    expect(typeof unsub4).toBe("function");

    // Calling them should not throw
    expect(() => unsub1()).not.toThrow();
    expect(() => unsub2()).not.toThrow();
    expect(() => unsub3()).not.toThrow();
    expect(() => unsub4()).not.toThrow();

    // Verify no listeners were registered by triggering a change
    const spy = vi.fn();
    DLCore.onChange(spy);
    DLCore.createType("test", {
      fetch: (id) => Promise.resolve({ id }),
    });
    DLCore.fetchItem("test", 1);

    // Only the spy we explicitly added should fire
    expect(spy).toHaveBeenCalled();
  });

  it("fires multiple listeners when data changes", async () => {
    const DLCore = setup();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const listener3 = vi.fn();

    DLCore.onChange(listener1);
    DLCore.onChange(listener2);
    DLCore.onChange(listener3);

    DLCore.createType("test", {
      fetch: (id) => Promise.resolve({ id, name: "item" }),
    });
    DLCore.fetchItem("test", 1);

    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
    expect(listener3).toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(listener1.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(listener2.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(listener3.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("stops firing a listener after unsubscribe", async () => {
    const DLCore = setup();
    const listener = vi.fn();
    const unsub = DLCore.onChange(listener);

    DLCore.createType("test", {
      fetch: (id) => Promise.resolve({ id, name: "item" }),
    });

    // Fire once to confirm it works
    DLCore.fetchItem("test", 1);
    expect(listener).toHaveBeenCalled();

    // Wait for async fetch to settle
    await vi.waitFor(() => {
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const callsBeforeUnsub = listener.mock.calls.length;
    unsub();

    // Trigger another change — force a new fetch on a different item
    DLCore.fetchItem("test", 2, null, { force: true });

    // Wait a tick for any async work
    await new Promise((r) => setTimeout(r, 50));

    // Listener should not have been called again
    expect(listener.mock.calls.length).toBe(callsBeforeUnsub);
  });

  it("double unsubscribe is safe (no error)", () => {
    const DLCore = setup();
    const listener = vi.fn();
    const unsub = DLCore.onChange(listener);

    unsub();
    expect(() => unsub()).not.toThrow();

    // A third call is also fine
    expect(() => unsub()).not.toThrow();
  });

  it("swallows listener errors without breaking other listeners", async () => {
    const DLCore = setup();

    const errorListener = vi.fn(() => {
      throw new Error("listener boom");
    });
    const goodListener = vi.fn();

    // Register error-throwing listener first
    DLCore.onChange(errorListener);
    DLCore.onChange(goodListener);

    DLCore.createType("test", {
      fetch: (id) => Promise.resolve({ id, name: "item" }),
    });

    // This should not throw despite the first listener throwing
    expect(() => DLCore.fetchItem("test", 1)).not.toThrow();

    // Both listeners should have been called
    expect(errorListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalled();

    // Wait for async work
    await vi.waitFor(() => {
      expect(goodListener.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // The good listener should have continued to fire on each notify
    expect(goodListener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("fires listener when collection data changes via fetchCollection", async () => {
    const DLCore = setup();
    const listener = vi.fn();
    DLCore.onChange(listener);

    DLCore.createCollection("testCol", {
      fetch: () => Promise.resolve({ ids: [1, 2], count: 2 }),
    });

    DLCore.fetchCollection("testCol");

    // Synchronous assignRef for isLoading should fire
    expect(listener).toHaveBeenCalled();

    // Wait for async fetch to complete and fire again
    await vi.waitFor(() => {
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("fires listener when item data changes via fetchItem", async () => {
    const DLCore = setup();
    const listener = vi.fn();
    DLCore.onChange(listener);

    DLCore.createType("test", {
      fetch: (id) => Promise.resolve({ id, name: "fetched" }),
    });

    const ref = DLCore.fetchItem("test", 42);

    // Should have been notified synchronously at least once (isLoading)
    expect(listener).toHaveBeenCalled();

    // Wait for the fetch to resolve and update the ref data
    await vi.waitFor(() => {
      expect(ref.data).not.toBeNull();
      expect(ref.data.name).toBe("fetched");
    });

    // Listener should have fired multiple times (loading + data)
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

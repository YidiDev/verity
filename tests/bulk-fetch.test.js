import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { freshCore } from "./helpers.js";

/**
 * Flush the bulk queue timer and let all async work settle.
 * advanceTimersByTimeAsync fires the bulk delay timer and drains microtasks,
 * but the async flushBulkQueue may schedule further work (e.g. fallback fetches).
 * A second small advance ensures any trailing setTimeout(0) calls also run.
 */
async function flushBulk() {
  await vi.advanceTimersByTimeAsync(60);
  await vi.advanceTimersByTimeAsync(10);
}

describe("bulk fetch queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches multiple fetchItem calls and invokes bulkFetch with all IDs", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const bulkFetch = vi.fn().mockResolvedValue([
      { id: "1", name: "Product 1" },
      { id: "2", name: "Product 2" },
      { id: "3", name: "Product 3" },
    ]);
    DLCore.createType("product", {
      fetch: vi.fn().mockResolvedValue({ id: "1", name: "fallback" }),
      bulkFetch,
    });

    DLCore.fetchItem("product", "1");
    DLCore.fetchItem("product", "2");
    DLCore.fetchItem("product", "3");

    // bulkFetch should not have been called yet (queued for 50ms)
    expect(bulkFetch).not.toHaveBeenCalled();

    await flushBulk();

    expect(bulkFetch).toHaveBeenCalledTimes(1);
    const ids = bulkFetch.mock.calls[0][0];
    expect(ids).toContain("1");
    expect(ids).toContain("2");
    expect(ids).toContain("3");
    expect(ids).toHaveLength(3);
  });

  it("distributes array-format bulkFetch results to correct refs", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("product", {
      fetch: vi.fn(),
      bulkFetch: vi.fn().mockResolvedValue([
        { id: "1", name: "Product 1", price: 10 },
        { id: "2", name: "Product 2", price: 20 },
      ]),
    });

    const ref1 = DLCore.fetchItem("product", "1");
    const ref2 = DLCore.fetchItem("product", "2");

    await flushBulk();

    expect(ref1.data).toEqual(expect.objectContaining({ id: "1", name: "Product 1", price: 10 }));
    expect(ref2.data).toEqual(expect.objectContaining({ id: "2", name: "Product 2", price: 20 }));
    expect(ref1.meta.isLoading).toBe(false);
    expect(ref2.meta.isLoading).toBe(false);
    expect(ref1.meta.error).toBeNull();
    expect(ref2.meta.error).toBeNull();
  });

  it("distributes object-format bulkFetch results to correct refs", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("product", {
      fetch: vi.fn(),
      bulkFetch: vi.fn().mockResolvedValue({
        "1": { name: "Product 1", price: 10 },
        "2": { name: "Product 2", price: 20 },
      }),
    });

    const ref1 = DLCore.fetchItem("product", "1");
    const ref2 = DLCore.fetchItem("product", "2");

    await flushBulk();

    expect(ref1.data).toEqual(expect.objectContaining({ name: "Product 1", price: 10 }));
    expect(ref2.data).toEqual(expect.objectContaining({ name: "Product 2", price: 20 }));
    expect(ref1.meta.isLoading).toBe(false);
    expect(ref2.meta.isLoading).toBe(false);
  });

  it("falls back to individual fetch when item is missing from bulk results", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const individualFetch = vi.fn().mockResolvedValue({ id: "2", name: "Fallback Product 2" });
    const bulkFetch = vi.fn().mockResolvedValue([
      { id: "1", name: "Product 1" },
      // id "2" intentionally missing
    ]);

    DLCore.createType("product", {
      fetch: individualFetch,
      bulkFetch,
    });

    const ref1 = DLCore.fetchItem("product", "1");
    const ref2 = DLCore.fetchItem("product", "2");

    await flushBulk();

    expect(bulkFetch).toHaveBeenCalledTimes(1);
    expect(individualFetch).toHaveBeenCalledTimes(1);
    expect(individualFetch).toHaveBeenCalledWith("2", "default");

    expect(ref1.data).toEqual(expect.objectContaining({ id: "1", name: "Product 1" }));
    expect(ref2.data).toEqual(expect.objectContaining({ id: "2", name: "Fallback Product 2" }));
  });

  it("sets error on all items in the batch when bulkFetch rejects", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("product", {
      fetch: vi.fn(),
      bulkFetch: vi.fn().mockRejectedValue(new Error("bulk network failure")),
    });

    const ref1 = DLCore.fetchItem("product", "1");
    const ref2 = DLCore.fetchItem("product", "2");

    await flushBulk();

    expect(ref1.meta.isLoading).toBe(false);
    expect(ref2.meta.isLoading).toBe(false);
    expect(ref1.meta.error).toContain("bulk network failure");
    expect(ref2.meta.error).toContain("bulk network failure");
    expect(ref1.data).toBeNull();
    expect(ref2.data).toBeNull();
  });

  it("coalesces: same item queued twice within delay window returns same ref", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const bulkFetch = vi.fn().mockResolvedValue([
      { id: "1", name: "Product 1" },
    ]);
    DLCore.createType("product", {
      fetch: vi.fn(),
      bulkFetch,
    });

    const ref1 = DLCore.fetchItem("product", "1");
    const ref2 = DLCore.fetchItem("product", "1");

    // Same ref object for same type+id
    expect(ref1).toBe(ref2);

    await flushBulk();

    // bulkFetch should only receive id "1" once
    expect(bulkFetch).toHaveBeenCalledTimes(1);
    const ids = bulkFetch.mock.calls[0][0];
    expect(ids.filter((id) => id === "1")).toHaveLength(1);

    expect(ref1.data).toEqual(expect.objectContaining({ id: "1", name: "Product 1" }));
  });

  it("per-level bulkFetch: levels with their own bulkFetch use it", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const typeBulkFetch = vi.fn().mockResolvedValue([
      { id: "1", name: "Default Product 1" },
    ]);
    const detailBulkFetch = vi.fn().mockResolvedValue([
      { id: "1", name: "Detailed Product 1", description: "Full details" },
    ]);

    DLCore.createType("product", {
      fetch: vi.fn().mockResolvedValue({ id: "1", name: "fallback" }),
      bulkFetch: typeBulkFetch,
      levels: {
        detail: {
          fetch: vi.fn().mockResolvedValue({ id: "1", name: "detail fallback" }),
          bulkFetch: detailBulkFetch,
          checkIfExists: (data) => data && data.description,
        },
      },
    });

    // Fetch at the detail level
    const ref = DLCore.fetchItem("product", "1", "detail");

    await flushBulk();

    // The level-specific bulkFetch should have been used, not the type-level one
    expect(detailBulkFetch).toHaveBeenCalledTimes(1);
    expect(typeBulkFetch).not.toHaveBeenCalled();

    expect(ref.data).toEqual(
      expect.objectContaining({ id: "1", name: "Detailed Product 1", description: "Full details" })
    );
  });

  it("handles fallback fetch error gracefully", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const individualFetch = vi.fn().mockRejectedValue(new Error("fallback failed"));
    const bulkFetch = vi.fn().mockResolvedValue([
      { id: "1", name: "Product 1" },
      // id "2" missing, so fallback will be called and it will fail
    ]);

    DLCore.createType("product", {
      fetch: individualFetch,
      bulkFetch,
    });

    const ref1 = DLCore.fetchItem("product", "1");
    const ref2 = DLCore.fetchItem("product", "2");

    await flushBulk();

    // ref1 should succeed via bulk
    expect(ref1.data).toEqual(expect.objectContaining({ id: "1", name: "Product 1" }));
    expect(ref1.meta.error).toBeNull();

    // ref2 should have error from fallback failure
    expect(ref2.meta.isLoading).toBe(false);
    expect(ref2.meta.error).toContain("fallback failed");
  });
});

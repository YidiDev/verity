import { describe, it, expect, vi } from "vitest";
import { freshCore } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("level conversion graph", () => {
  it("fetching a higher level propagates data to lower levels via conversion map", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn().mockResolvedValue({ id: "1", name: "basic" }),
      levels: {
        detail: {
          fetch: vi.fn().mockResolvedValue({
            id: "1",
            name: "detailed",
            description: "full desc",
          }),
          checkIfExists: (d) => !!d?.description,
        },
      },
      // detail data can satisfy the default level
      levelConversionMap: {
        detail: ["default"],
      },
    });

    // Fetch at detail level
    const ref = DLCore.fetchItem("widget", "1", "detail");
    await tick();

    // Detail data should be present
    expect(ref.data.description).toBe("full desc");

    // The default level stamp should also be set (propagated via conversion)
    expect(ref.meta.levelStamps.detail).toBeDefined();
    expect(ref.meta.levelStamps.default).toBeDefined();
  });

  it("conversion does not propagate if check function fails", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn().mockResolvedValue({ id: "1", name: "basic" }),
      levels: {
        summary: {
          fetch: vi.fn().mockResolvedValue({ id: "1", title: "sum" }),
          checkIfExists: (d) => !!d?.title,
        },
        detail: {
          fetch: vi.fn().mockResolvedValue({ id: "1", description: "full" }),
          // Check requires 'title' which detail fetch doesn't provide
          checkIfExists: (d) => !!d?.title && !!d?.description,
        },
      },
      // detail converts to summary
      levelConversionMap: {
        detail: ["summary"],
      },
    });

    // Fetch detail level - data has description but not title
    const ref = DLCore.fetchItem("widget", "1", "detail");
    await tick();

    // Detail should be stamped
    expect(ref.meta.levelStamps.detail).toBeDefined();
    // Summary should NOT be stamped because check fails (no title in data)
    expect(ref.meta.levelStamps.summary).toBeUndefined();
  });

  it("multi-hop conversion: A -> B -> C", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn(),
      levels: {
        summary: {
          fetch: vi.fn(),
          checkIfExists: (d) => !!d?.name,
        },
        detail: {
          fetch: vi.fn().mockResolvedValue({
            id: "1",
            name: "detailed",
            description: "full",
            specs: { weight: 10 },
          }),
          checkIfExists: (d) => !!d?.description,
        },
      },
      // detail -> summary (summary check: has name)
      // detail -> default
      levelConversionMap: {
        detail: ["summary"],
        summary: ["default"],
      },
    });

    const ref = DLCore.fetchItem("widget", "1", "detail");
    await tick();

    // All three levels should be stamped via chain: detail -> summary -> default
    expect(ref.meta.levelStamps.detail).toBeDefined();
    expect(ref.meta.levelStamps.summary).toBeDefined();
    expect(ref.meta.levelStamps.default).toBeDefined();
  });

  it("conversion map at per-level works", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn(),
      levels: {
        summary: {
          fetch: vi.fn(),
          checkIfExists: (d) => !!d?.name,
        },
        detail: {
          fetch: vi.fn().mockResolvedValue({
            id: "1",
            name: "test",
            description: "full",
          }),
          checkIfExists: (d) => !!d?.description,
          levelConversionMap: {
            detail: ["summary"],
          },
        },
      },
    });

    const ref = DLCore.fetchItem("widget", "1", "detail");
    await tick();

    expect(ref.meta.levelStamps.detail).toBeDefined();
    expect(ref.meta.levelStamps.summary).toBeDefined();
  });

  it("devtools shows convertFrom and levelAccepts edges", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn(),
      levels: {
        summary: { fetch: vi.fn() },
        detail: { fetch: vi.fn() },
      },
      levelConversionMap: {
        detail: ["summary", "default"],
      },
    });

    const dt = DLCore.devtools();
    const w = dt.types.widget;

    // convertFrom: detail -> [summary, default]
    expect(w.convertFrom.detail).toEqual(
      expect.arrayContaining(["summary", "default"])
    );

    // levelAccepts: summary accepts from detail; default accepts from detail
    expect(w.levelAccepts.summary).toEqual(expect.arrayContaining(["detail"]));
    expect(w.levelAccepts.default).toEqual(expect.arrayContaining(["detail"]));
  });

  it("fetching default level does not reverse-propagate to detail", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createType("widget", {
      fetch: vi.fn().mockResolvedValue({ id: "1", name: "basic" }),
      levels: {
        detail: {
          fetch: vi.fn(),
          checkIfExists: (d) => !!d?.description,
        },
      },
      // Only detail -> default, not the reverse
      levelConversionMap: {
        detail: ["default"],
      },
    });

    const ref = DLCore.fetchItem("widget", "1");
    await tick();

    // Default should be stamped
    expect(ref.meta.levelStamps.default).toBeDefined();
    // Detail should NOT be stamped (no reverse edge, and check would fail anyway)
    expect(ref.meta.levelStamps.detail).toBeUndefined();
  });

  it("self-referencing conversion edge is ignored", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    // This should not cause infinite loops
    DLCore.createType("widget", {
      fetch: vi.fn().mockResolvedValue({ id: "1", name: "test" }),
      levelConversionMap: {
        default: ["default"], // self-referencing
      },
    });

    const ref = DLCore.fetchItem("widget", "1");
    await tick();

    expect(ref.data.name).toBe("test");
    expect(ref.meta.levelStamps.default).toBeDefined();
  });
});

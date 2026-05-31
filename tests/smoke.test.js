import { describe, it, expect } from "vitest";
import { freshCore } from "./helpers.js";

describe("smoke test - freshCore loads", () => {
  it("returns an object with the expected API surface", () => {
    const DLCore = freshCore();
    expect(DLCore).toBeDefined();
    expect(typeof DLCore.init).toBe("function");
    expect(typeof DLCore.onChange).toBe("function");
    expect(typeof DLCore.createType).toBe("function");
    expect(typeof DLCore.createCollection).toBe("function");
    expect(typeof DLCore.fetchCollection).toBe("function");
    expect(typeof DLCore.fetchItem).toBe("function");
    expect(typeof DLCore.applyDirectives).toBe("function");
    expect(typeof DLCore.state).toBe("function");
    expect(typeof DLCore.devtools).toBe("function");
    expect(typeof DLCore.clientId).toBe("function");
    expect(typeof DLCore.onLifecycle).toBe("function");
    expect(typeof DLCore.configureDirectiveSource).toBe("function");
    expect(typeof DLCore.configureSse).toBe("function");
    expect(typeof DLCore.configureMemory).toBe("function");
    expect(typeof DLCore.connectDirectiveSource).toBe("function");
    expect(typeof DLCore.connectSse).toBe("function");
    expect(typeof DLCore.disconnectDirectiveSource).toBe("function");
    expect(typeof DLCore.disconnectSse).toBe("function");
    expect(typeof DLCore.ingestDirectiveEnvelope).toBe("function");
  });

  it("each freshCore call returns independent state", () => {
    const a = freshCore();
    const b = freshCore();
    a.createType("foo", { fetch: () => ({}) });
    // b should not see foo
    expect(() => b.fetchItem("foo", "1")).toThrow();
  });
});

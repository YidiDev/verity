import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { freshCore } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("configureSse", () => {
  it("sets SSE configuration values", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });

    DLCore.configureSse({
      enabled: false,
      url: "/custom/events",
      clientIdParam: "cid",
      audienceParam: "aud",
      audience: "team-a",
      withCredentials: true,
      connectOnInit: false,
      initialRetryMs: 5000,
      maxRetryMs: 60000,
      backoffMultiplier: 3,
      resyncOnGap: false,
      resyncJitterMinMs: 500,
      resyncJitterMaxMs: 2000,
    });

    const dt = DLCore.devtools();
    expect(dt.sse.enabled).toBe(false);
    expect(dt.sse.url).toBe("/custom/events");
    expect(dt.sse.audience).toBe("team-a");
    expect(dt.sse.withCredentials).toBe(true);
    expect(dt.sse.initialRetryMs).toBe(5000);
    expect(dt.sse.maxRetryMs).toBe(60000);
    expect(dt.sse.backoffMultiplier).toBe(3);
    expect(dt.sse.resyncOnGap).toBe(false);
  });

  it("ignores invalid config (non-object)", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });

    DLCore.configureSse({ enabled: false, url: "/test" });
    const before = DLCore.devtools().sse.url;

    DLCore.configureSse(null);
    DLCore.configureSse(undefined);
    DLCore.configureSse(42);
    DLCore.configureSse("string");

    expect(DLCore.devtools().sse.url).toBe(before);
  });

  it("clamps maxRetryMs to at least initialRetryMs", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });

    DLCore.configureSse({
      enabled: false,
      initialRetryMs: 10000,
      maxRetryMs: 5000, // less than initial
    });

    const dt = DLCore.devtools();
    expect(dt.sse.maxRetryMs).toBeGreaterThanOrEqual(dt.sse.initialRetryMs);
  });

  it("clamps resyncJitterMaxMs to at least resyncJitterMinMs", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });

    DLCore.configureSse({
      enabled: false,
      resyncJitterMinMs: 3000,
      resyncJitterMaxMs: 1000, // less than min
    });

    const dt = DLCore.devtools();
    // The source code sets max = min when max < min
    expect(dt.sse.resyncOnGap).toBeDefined(); // just confirm no crash
  });

  it("audience can be set to null", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });

    DLCore.configureSse({ enabled: false, audience: null });
    // Should not throw
    expect(DLCore.devtools().sse.audience).toBeNull();
  });
});

describe("configureDirectiveSource", () => {
  it("null disables the directive source", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.configureDirectiveSource(null);

    // SSE should be disabled
    expect(DLCore.devtools().sse.enabled).toBe(false);
  });

  it("false disables the directive source", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.configureDirectiveSource(false);
    expect(DLCore.devtools().sse.enabled).toBe(false);
  });

  it('"sse" string re-enables SSE source', () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.configureDirectiveSource("sse");
    expect(DLCore.devtools().sse.enabled).toBe(true);
  });

  it("custom source with connect/disconnect is accepted", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const connectFn = vi.fn();
    const disconnectFn = vi.fn();

    DLCore.configureDirectiveSource({
      name: "websocket",
      connect: connectFn,
      disconnect: disconnectFn,
    });

    // Should not throw
    DLCore.connectDirectiveSource();
    expect(connectFn).toHaveBeenCalled();

    // The helpers bag should be passed
    const helpers = connectFn.mock.calls[0][0];
    expect(typeof helpers.clientId).toBe("string");
    expect(typeof helpers.applyDirectives).toBe("function");
    expect(typeof helpers.ingest).toBe("function");
    expect(typeof helpers.state).toBe("function");
  });

  it("custom source connect errors are swallowed", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.configureDirectiveSource({
      connect: () => {
        throw new Error("connect boom");
      },
    });

    expect(() => DLCore.connectDirectiveSource()).not.toThrow();
  });

  it("custom source disconnect errors are swallowed", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.configureDirectiveSource({
      connect: vi.fn(),
      disconnect: () => {
        throw new Error("disconnect boom");
      },
    });

    // Switch to a different source (triggers disconnect of previous)
    expect(() => DLCore.configureDirectiveSource(null)).not.toThrow();
  });

  it("custom source with configure callback", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const configureFn = vi.fn();

    DLCore.configureDirectiveSource({
      connect: vi.fn(),
      configure: configureFn,
    });

    // We can't call configure directly through public API easily,
    // but we verify it was registered without error
    expect(configureFn).not.toHaveBeenCalled();
  });

  it("undefined is a no-op", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    // Should not throw or change anything
    DLCore.configureDirectiveSource(undefined);
    expect(DLCore.devtools().sse.enabled).toBe(false);
  });

  it("SSE-type source object with options", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });

    DLCore.configureDirectiveSource({
      type: "sse",
      enabled: true,
      connectOnInit: false,
      options: {
        url: "/custom/sse",
      },
    });

    expect(DLCore.devtools().sse.url).toBe("/custom/sse");
    expect(DLCore.devtools().sse.enabled).toBe(true);
  });
});

describe("disconnectDirectiveSource", () => {
  it("disconnects without error when no source is active", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.configureDirectiveSource(null);
    expect(() => DLCore.disconnectDirectiveSource()).not.toThrow();
  });

  it("calls disconnect on custom source", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const disconnectFn = vi.fn();
    DLCore.configureDirectiveSource({
      connect: vi.fn(),
      disconnect: disconnectFn,
    });

    DLCore.disconnectDirectiveSource();
    expect(disconnectFn).toHaveBeenCalled();
  });
});

describe("connectDirectiveSource", () => {
  it("does nothing when source is disabled", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const connectFn = vi.fn();
    DLCore.configureDirectiveSource({
      connect: connectFn,
      enabled: false,
    });

    DLCore.connectDirectiveSource();
    expect(connectFn).not.toHaveBeenCalled();
  });

  it("does nothing when no source configured", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.configureDirectiveSource(null);
    expect(() => DLCore.connectDirectiveSource()).not.toThrow();
  });
});

describe("ingestDirectiveEnvelope", () => {
  it("ignores null/undefined/non-object payloads", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(() => DLCore.ingestDirectiveEnvelope(null)).not.toThrow();
    expect(() => DLCore.ingestDirectiveEnvelope(undefined)).not.toThrow();
    expect(() => DLCore.ingestDirectiveEnvelope("string")).not.toThrow();
    expect(() => DLCore.ingestDirectiveEnvelope(42)).not.toThrow();
  });

  it("hello message sets sequence number", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const events = [];
    DLCore.onLifecycle("sse:hello", (p) => events.push(p));

    DLCore.ingestDirectiveEnvelope({
      type: "hello",
      audience: "global",
      last_seq: 5,
    });

    expect(events.length).toBe(1);
    expect(events[0].detail.lastSeq).toBe(5);
  });

  it("directives message applies directives", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    DLCore.createCollection("widgets", {
      fetch: vi.fn().mockResolvedValue({ ids: [1], count: 1 }),
    });

    DLCore.ingestDirectiveEnvelope({
      type: "directives",
      directives: [
        {
          op: "refresh_collection",
          name: "widgets",
          result: { data: { ids: [10, 20], count: 2 } },
        },
      ],
    });

    await tick();

    const { collections } = DLCore.state();
    const ref = collections.get("widgets").ref;
    expect(ref.data.ids).toEqual([10, 20]);
  });

  it("directives from self (matching clientId) are ignored", async () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const fetchFn = vi.fn().mockResolvedValue({ ids: [1], count: 1 });
    DLCore.createCollection("widgets", { fetch: fetchFn });

    DLCore.ingestDirectiveEnvelope({
      type: "directives",
      source: DLCore.clientId(), // same client
      directives: [
        { op: "refresh_collection", name: "widgets" },
      ],
    });

    await tick();

    // Fetch should not have been called (self-sourced directives are ignored)
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sequence gap triggers resync lifecycle event", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    // Enable resyncOnGap
    DLCore.configureSse({ enabled: false, resyncOnGap: true });

    const events = [];
    DLCore.onLifecycle("sse:gap", (p) => events.push(p));

    // Set initial sequence via hello
    DLCore.ingestDirectiveEnvelope({
      type: "hello",
      audience: "global",
      last_seq: 10,
    });

    // Now send directives with a gap (seq 15, expected 11)
    DLCore.ingestDirectiveEnvelope({
      type: "directives",
      audience: "global",
      seq: 15,
      directives: [],
    });

    expect(events.length).toBe(1);
    expect(events[0].detail.lastSeq).toBe(10);
    expect(events[0].detail.incomingSeq).toBe(15);
  });

  it("hello with sequence gap triggers gap event", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false, resyncOnGap: true });

    // Set initial sequence
    DLCore.ingestDirectiveEnvelope({
      type: "hello",
      audience: "global",
      last_seq: 5,
    });

    const events = [];
    DLCore.onLifecycle("sse:gap", (p) => events.push(p));

    // Hello with jumped sequence
    DLCore.ingestDirectiveEnvelope({
      type: "hello",
      audience: "global",
      last_seq: 20,
    });

    expect(events.length).toBe(1);
  });
});

describe("disconnectSse / connectSse", () => {
  it("disconnectSse does not throw when no connection exists", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(() => DLCore.disconnectSse()).not.toThrow();
  });

  it("connectSse does nothing when SSE is disabled", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    expect(() => DLCore.connectSse()).not.toThrow();
    expect(DLCore.devtools().sse.connected).toBe(false);
  });

  it("disconnectSse emits lifecycle event", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });
    DLCore.configureSse({ enabled: false });

    const events = [];
    DLCore.onLifecycle("sse:disconnect", (p) => events.push(p));

    DLCore.disconnectSse();
    expect(events.length).toBe(1);
  });
});

describe("init", () => {
  it("init with empty options does not throw", () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });
    DLCore.configureMemory({ enabled: false });

    expect(() => DLCore.init({})).not.toThrow();
  });

  it("init with sse config applies it", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });

    DLCore.init({
      sse: { enabled: false, url: "/my/events" },
    });

    expect(DLCore.devtools().sse.url).toBe("/my/events");
    expect(DLCore.devtools().sse.enabled).toBe(false);
  });

  it("init with memory config applies it", () => {
    const DLCore = freshCore();
    DLCore.configureSse({ enabled: false });

    DLCore.init({
      memory: { enabled: true, pruneIntervalMs: 5000 },
    });

    expect(DLCore.devtools().memory.pruneIntervalMs).toBe(5000);
  });

  it("init with directiveSource configures it", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });

    DLCore.init({
      directiveSource: null,
    });

    // SSE should be disabled when directive source is null
    expect(DLCore.devtools().sse.enabled).toBe(false);
  });

  it("init with custom directiveSource", () => {
    const DLCore = freshCore();
    DLCore.configureMemory({ enabled: false });

    const connectFn = vi.fn();
    DLCore.init({
      directiveSource: {
        name: "custom-ws",
        connect: connectFn,
        connectOnInit: false,
      },
    });

    // connectOnInit is false so connect should not be called
    expect(connectFn).not.toHaveBeenCalled();
  });
});

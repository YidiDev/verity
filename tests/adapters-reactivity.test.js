import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settle = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function createReactiveRuntime() {
  const dependencies = new WeakMap();
  let activeEffect = null;
  const scheduled = new Set();

  const schedule = (effect) => {
    if (scheduled.has(effect)) return;
    scheduled.add(effect);
    queueMicrotask(() => {
      scheduled.delete(effect);
      runEffect(effect);
    });
  };

  const runEffect = (effect) => {
    activeEffect = effect;
    try {
      effect();
    } finally {
      activeEffect = null;
    }
  };

  const reactive = (target) => new Proxy(target, {
    get(object, key, receiver) {
      if (activeEffect) {
        let byKey = dependencies.get(object);
        if (!byKey) {
          byKey = new Map();
          dependencies.set(object, byKey);
        }
        let effects = byKey.get(key);
        if (!effects) {
          effects = new Set();
          byKey.set(key, effects);
        }
        effects.add(activeEffect);
      }
      return Reflect.get(object, key, receiver);
    },
    set(object, key, value, receiver) {
      const changed = Reflect.get(object, key, receiver) !== value;
      const result = Reflect.set(object, key, value, receiver);
      if (changed) {
        for (const effect of dependencies.get(object)?.get(key) ?? []) {
          schedule(effect);
        }
      }
      return result;
    },
  });

  return { reactive, runEffect };
}

async function setupAdapter(adapterName) {
  const runtime = createReactiveRuntime();
  let alpineStore;

  if (adapterName === "alpine") {
    window.Alpine = {
      reactive: runtime.reactive,
      store(_name, value) {
        if (value !== undefined) alpineStore = runtime.reactive(value);
        return alpineStore;
      },
    };
  } else {
    window.Vue = {
      reactive: runtime.reactive,
      inject(_key, fallback) {
        return fallback;
      },
    };
  }

  const adapter = await import(`../src/adapters/${adapterName}.ts`);
  adapter.configureMemory({ enabled: false });
  adapter.configureSse({ enabled: false });
  const store = adapterName === "alpine"
    ? adapter.ensureAlpineStore()
    : adapter.ensureVueStore();
  return { adapter, store, runEffect: runtime.runEffect };
}

describe.each(["alpine", "vue"])("%s ref-scoped reactivity", (adapterName) => {
  beforeEach(() => vi.resetModules());

  afterEach(() => {
    delete window.Alpine;
    delete window.Vue;
  });

  it("settles a rejected item read and retries only when forced", async () => {
    const { adapter, store, runEffect } = await setupAdapter(adapterName);
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "x", name: "Recovered" });
    adapter.createType("thing", { fetch });

    let renders = 0;
    let error = null;
    runEffect(() => {
      renders += 1;
      error = store.it("thing", "x").meta.error;
    });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error).toContain("boom");
    expect(renders).toBeLessThan(10);

    store.it("thing", "x", null, { force: true });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error).toBeNull();
  });

  it("does not invalidate an item reader for an unrelated item", async () => {
    const { adapter, store, runEffect } = await setupAdapter(adapterName);
    adapter.createType("thing", { fetch: async (id) => ({ id }) });

    let renders = 0;
    runEffect(() => {
      renders += 1;
      void store.it("thing", "a").data;
    });
    await settle();
    const settledRenders = renders;

    store.it("thing", "b", null, { force: true });
    await settle();
    expect(renders).toBe(settledRenders);
  });

  it("settles a rejected collection read", async () => {
    const { adapter, store, runEffect } = await setupAdapter(adapterName);
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    adapter.createCollection("things", { fetch });

    let error = null;
    let renders = 0;
    runEffect(() => {
      renders += 1;
      error = store.col("things").meta.error;
    });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error).toContain("offline");
    expect(renders).toBeLessThan(10);
  });

  it("consumes force once inside a tracked item read", async () => {
    const { adapter, store, runEffect } = await setupAdapter(adapterName);
    const fetch = vi.fn().mockResolvedValue({ id: "x" });
    adapter.createType("thing", { fetch, stalenessMs: 60_000 });

    let renders = 0;
    runEffect(() => {
      renders += 1;
      void store.it("thing", "x", null, { force: true }).data;
    });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(renders).toBeLessThan(10);

    store.it("thing", "x", null, { force: true });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not let a normal reader release another reader's force latch", async () => {
    const { adapter, store, runEffect } = await setupAdapter(adapterName);
    const fetch = vi.fn().mockResolvedValue({ id: "x" });
    adapter.createType("thing", { fetch, stalenessMs: 60_000 });

    let forcedRenders = 0;
    let normalRenders = 0;
    runEffect(() => {
      forcedRenders += 1;
      void store.it("thing", "x", null, { force: true }).data;
    });
    runEffect(() => {
      normalRenders += 1;
      void store.it("thing", "x").data;
    });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(forcedRenders).toBeLessThan(10);
    expect(normalRenders).toBeLessThan(10);
  });
});

describe("svelte ref-scoped reactivity", () => {
  it("rebinds an active item store after cache eviction", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    try {
      const adapter = await import("../src/adapters/svelte.ts");
      adapter.configureMemory({ enabled: false });
      adapter.configureSse({ enabled: false });
      const fetch = vi.fn(async (id) => ({ id }));
      adapter.createType("thing", { fetch });

      let current;
      const unsubscribe = adapter.itemStore("thing", "x").subscribe((ref) => {
        current = ref;
      });
      await vi.runAllTimersAsync();
      const evictedRef = current;
      evictedRef.meta.lastUsedAt = new Date(0).toISOString();

      adapter.configureMemory({
        enabled: true,
        pruneIntervalMs: 1_000,
        itemEntryTtlMs: 1,
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(current).not.toBe(evictedRef);
      expect(current.data).toEqual({ id: "x" });
      expect(fetch).toHaveBeenCalledTimes(2);
      unsubscribe();
      adapter.configureMemory({ enabled: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

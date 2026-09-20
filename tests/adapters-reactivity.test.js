import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

async function createReactiveAdapter(adapterName) {
  let store;
  let effect = null;
  let scheduled = false;

  const invalidate = () => {
    if (scheduled || !effect) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      effect?.();
    });
  };

  const reactive = (target) => new Proxy(target, {
    set(object, key, value) {
      const changed = Reflect.get(object, key) !== value;
      const result = Reflect.set(object, key, value);
      if (changed && key === "_tick") invalidate();
      return result;
    },
  });

  if (adapterName === "alpine") {
    window.Alpine = {
      store(_name, value) {
        if (value !== undefined) store = reactive(value);
        return store;
      },
    };
  } else {
    window.Vue = {
      reactive,
      inject(_key, fallback) {
        return fallback;
      },
    };
  }

  const adapter = await import(`../src/adapters/${adapterName}.ts`);
  adapter.configureMemory({ enabled: false });
  adapter.configureSse({ enabled: false });
  store = adapterName === "alpine"
    ? adapter.ensureAlpineStore()
    : adapter.ensureVueStore();

  return {
    adapter,
    store,
    runEffect(nextEffect) {
      effect = nextEffect;
      effect();
    },
  };
}

describe.each(["alpine", "vue"])("%s adapter failed-fetch reactivity", (adapterName) => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete window.Alpine;
    delete window.Vue;
  });

  it("settles an item effect after a rejected fetch and supports forced recovery", async () => {
    const { adapter, store, runEffect } = await createReactiveAdapter(adapterName);
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("item failed"))
      .mockResolvedValueOnce({ id: "1", name: "Recovered" });
    adapter.createType("thing", { fetch });

    let renders = 0;
    let overflowed = false;
    let ref;
    runEffect(() => {
      renders += 1;
      if (renders > 20) {
        overflowed = true;
        return;
      }
      ref = store.it("thing", "1");
    });
    await settle();

    expect(overflowed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ref.meta.error).toContain("item failed");

    store.it("thing", "1", null, { force: true });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(ref.data).toEqual(expect.objectContaining({ name: "Recovered" }));
  });

  it("settles a collection effect after a rejected fetch", async () => {
    const { adapter, store, runEffect } = await createReactiveAdapter(adapterName);
    const fetch = vi.fn().mockRejectedValue(new Error("collection failed"));
    adapter.createCollection("things", { fetch });

    let renders = 0;
    let overflowed = false;
    let ref;
    runEffect(() => {
      renders += 1;
      if (renders > 20) {
        overflowed = true;
        return;
      }
      ref = store.col("things");
    });
    await settle();

    expect(overflowed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ref.meta.error).toContain("collection failed");
  });
});

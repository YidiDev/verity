// ---------------------------------------------------------------------------
// verity-dl  –  Vue 3 adapter (plugin + composable)
// ---------------------------------------------------------------------------

import {
  init as coreInit,
  onChange as coreOnChange,
  onRefChange as coreOnRefChange,
  fetchCollection,
  fetchItem,
  getCollectionRef,
  getItemRef,
  applyDirectives,
  state as coreState,
  createType,
  createCollection,
  configureDirectiveSource,
  configureSse,
  configureMemory,
  connectDirectiveSource,
  connectSse,
  disconnectDirectiveSource,
  disconnectSse,
  ingestDirectiveEnvelope,
  onLifecycle,
  clientId,
  devtools,
  isItemLoading,
  isCollectionLoading,
  hasAnyInFlightRequests,
  type InitOptions,
  type Directive,
  type CollectionRef,
  type ItemRef,
} from "../core/index.js";

// ---- Types ----------------------------------------------------------------

interface VueAPI {
  reactive: <T extends object>(target: T) => T;
  inject: <T>(key: string | symbol, fallback?: T) => T;
}

interface VueApp {
  provide: (key: string | symbol, value: unknown) => void;
  config: {
    globalProperties: Record<string, unknown>;
  };
}

interface VueStore {
  _state: ReturnType<typeof coreState>;
  col: (name: string, opts?: Record<string, unknown>) => CollectionRef;
  it: (
    typeName: string,
    id: unknown,
    level?: string | null,
    opts?: Record<string, unknown>,
  ) => ItemRef;
  apply: (directives: Directive[]) => Promise<unknown[]>;
  state: () => ReturnType<typeof coreState>;
}

interface VueInitOptions extends InitOptions {
  vueStoreKey?: string;
  vueProvideKey?: string | symbol;
  vueGlobalProperty?: string | null;
}

interface VueInstallOptions {
  storeKey?: string;
  provideKey?: string | symbol;
  globalProperty?: string | null;
}

interface UseDLOptions {
  storeKey?: string;
  injectKey?: string | symbol;
}

// ---- State ----------------------------------------------------------------

const DEFAULT_STORE_KEY = "dl";
const DEFAULT_INJECT_KEY: string | symbol = "dl";
const DEFAULT_GLOBAL_PROPERTY: string | null = "$dl";

let defaultStoreKey = DEFAULT_STORE_KEY;
let defaultInjectKey: string | symbol = DEFAULT_INJECT_KEY;
let defaultGlobalProperty: string | null = DEFAULT_GLOBAL_PROPERTY;

const stores = new Map<string, VueStore>();
const bridges = new WeakMap<object, CollectionRef | ItemRef>();
const pendingRequests = new WeakMap<object, Set<string>>();
const forcedReads = new WeakMap<object, Set<string>>();

// ---- Helpers --------------------------------------------------------------

function resolveVue(): VueAPI | null {
  if (typeof window !== "undefined") {
    const w = window as unknown as Record<string, unknown>;
    if (w.Vue) return w.Vue as unknown as VueAPI;
  }
  return null;
}

function normalizeStoreKey(
  key: unknown,
  fallback: string,
): string {
  if (typeof key === "string" && key.trim()) return key.trim();
  return fallback;
}

function normalizeInjectKey(
  key: unknown,
  fallback: string | symbol,
): string | symbol {
  if (typeof key === "symbol") return key;
  if (typeof key === "string" && key.trim()) return key.trim();
  return fallback;
}

function normalizeGlobalProperty(
  value: unknown,
  fallback: string | null,
): string | null {
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
  }
  return fallback;
}

function queueRequest(
  ref: object,
  key: string,
  request: () => void,
): void {
  let pending = pendingRequests.get(ref);
  if (!pending) {
    pending = new Set();
    pendingRequests.set(ref, pending);
  }
  if (pending.has(key)) return;
  pending.add(key);
  const currentPending = pending;
  queueMicrotask(() => {
    currentPending.delete(key);
    request();
  });
}

function shouldQueueRequest(ref: object, key: string, force: boolean): boolean {
  if (!force) return true;
  let forced = forcedReads.get(ref);
  if (!forced) {
    forced = new Set();
    forcedReads.set(ref, forced);
  }
  if (forced.has(key)) return false;
  forced.add(key);
  return true;
}

function releaseForcedRead(
  ref: CollectionRef | ItemRef,
  key: string,
): void {
  let unsubscribe = (): void => {};
  unsubscribe = coreOnRefChange(ref, () => {
    if (ref.meta.isLoading || ref.meta.activeQueryId !== null) return;
    unsubscribe();
    queueMicrotask(() => forcedReads.get(ref)?.delete(key));
  });
}

function bridgeRef<T extends CollectionRef | ItemRef>(Vue: VueAPI, ref: T): T {
  const existing = bridges.get(ref);
  if (existing) return existing as T;

  const bridge = Vue.reactive({ data: ref.data, meta: ref.meta }) as T;
  bridges.set(ref, bridge);
  coreOnRefChange(ref, () => {
    bridge.data = ref.data as T["data"];
    bridge.meta = ref.meta as T["meta"];
  });
  return bridge;
}

// ---- Store factory --------------------------------------------------------

function createVueStore(Vue: VueAPI | null): VueStore | null {
  if (!Vue || typeof Vue.reactive !== "function") return null;

  return Vue.reactive<VueStore>({
    _state: coreState(),
    col(name: string, opts = {}) {
      const ref = getCollectionRef(name, opts);
      const bridge = bridgeRef(Vue, ref);
      const force = !!(opts as { force?: boolean }).force;
      const requestKey = "collection";
      if (shouldQueueRequest(ref, requestKey, force)) {
        queueRequest(ref, requestKey, () => {
          if (force) releaseForcedRead(ref, requestKey);
          fetchCollection(name, opts);
        });
      }
      return bridge;
    },
    it(
      typeName: string,
      id: unknown,
      level: string | null = null,
      opts = {},
    ) {
      const ref = getItemRef(typeName, id);
      const bridge = bridgeRef(Vue, ref);
      const force = !!(opts as { force?: boolean }).force;
      const requestKey = `item:${level ?? "default"}`;
      if (shouldQueueRequest(ref, requestKey, force)) {
        queueRequest(ref, requestKey, () => {
          if (force) releaseForcedRead(ref, requestKey);
          fetchItem(typeName, id, level, opts);
        });
      }
      return bridge;
    },
    apply(directives: Directive[]) {
      return applyDirectives(directives);
    },
    state() {
      // Reading the tick registers this getter with Vue's reactivity.
      // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator
      void this._tick;
      return this._state;
    },
  });
}

export function ensureVueStore(
  name: string = defaultStoreKey,
): VueStore | null {
  const key = normalizeStoreKey(name, defaultStoreKey);
  if (stores.has(key)) return stores.get(key)!;

  const Vue = resolveVue();
  const store = createVueStore(Vue);
  if (!store) return null;

  stores.set(key, store);
  return store;
}

// ---- Reactivity bridge ----------------------------------------------------

coreOnChange(() => {
  if (!stores.size) return;
  const nextState = coreState();

  for (const store of stores.values()) {
    if (!store || typeof store !== "object") continue;
    store._state = nextState;
  }
});

// ---- Init wrapper ---------------------------------------------------------

export function init(options: VueInitOptions = {}): void {
  const {
    vueStoreKey,
    vueProvideKey,
    vueGlobalProperty,
    ...rest
  } = options;

  if (typeof vueStoreKey !== "undefined") {
    defaultStoreKey = normalizeStoreKey(vueStoreKey, defaultStoreKey);
  }
  if (typeof vueProvideKey !== "undefined") {
    defaultInjectKey = normalizeInjectKey(
      vueProvideKey,
      defaultInjectKey,
    );
  }
  if (typeof vueGlobalProperty !== "undefined") {
    defaultGlobalProperty = normalizeGlobalProperty(
      vueGlobalProperty,
      defaultGlobalProperty,
    );
  }

  if (resolveVue()) {
    ensureVueStore(defaultStoreKey);
  }

  return coreInit(rest);
}

// ---- Vue plugin -----------------------------------------------------------

export function install(
  app: VueApp,
  options: VueInstallOptions = {},
): VueStore {
  if (!app || typeof app !== "object") {
    throw new Error(
      "A Vue app instance is required to install the DL Vue adapter",
    );
  }

  const { storeKey, provideKey, globalProperty } = options;

  const normalizedStoreKey = normalizeStoreKey(
    storeKey,
    defaultStoreKey,
  );
  const injectionKey =
    typeof provideKey !== "undefined"
      ? normalizeInjectKey(provideKey, defaultInjectKey)
      : defaultInjectKey;
  const globalKey =
    typeof globalProperty !== "undefined"
      ? normalizeGlobalProperty(globalProperty, defaultGlobalProperty)
      : defaultGlobalProperty;

  const store = ensureVueStore(normalizedStoreKey);
  if (!store) {
    throw new Error(
      "Vue must be available before installing the DL Vue adapter",
    );
  }

  if (typeof app.provide === "function") {
    app.provide(injectionKey, store);
  }

  if (globalKey && app.config && app.config.globalProperties) {
    app.config.globalProperties[globalKey] = store;
  }

  return store;
}

// ---- Composable -----------------------------------------------------------

export function useDL(
  options: UseDLOptions = {},
): VueStore | null {
  const storeKey = normalizeStoreKey(
    options.storeKey,
    defaultStoreKey,
  );
  const injectionKey =
    typeof options.injectKey !== "undefined"
      ? normalizeInjectKey(options.injectKey, defaultInjectKey)
      : defaultInjectKey;

  const Vue = resolveVue();
  const fallbackStore = ensureVueStore(storeKey);
  if (!Vue) return fallbackStore;

  const { inject } = Vue;
  if (typeof inject === "function") {
    return inject(injectionKey, fallbackStore);
  }

  return fallbackStore;
}

// ---- Re-exports from core -------------------------------------------------

export {
  coreOnChange as onChange,
  fetchCollection,
  fetchItem,
  applyDirectives,
  coreState as state,
  createType,
  createCollection,
  configureDirectiveSource,
  configureSse,
  configureMemory,
  connectDirectiveSource,
  connectSse,
  disconnectDirectiveSource,
  disconnectSse,
  ingestDirectiveEnvelope,
  onLifecycle,
  clientId,
  devtools,
  isItemLoading,
  isCollectionLoading,
  hasAnyInFlightRequests,
};

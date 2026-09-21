// ---------------------------------------------------------------------------
// verity-dl  –  Alpine.js adapter
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

interface AlpineStore {
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

interface AlpineInstance {
  store: (name: string, value?: unknown) => unknown;
  reactive: <T extends object>(target: T) => T;
}

interface AlpineInitOptions extends InitOptions {
  alpineStoreName?: string;
}

// ---- State ----------------------------------------------------------------

const DEFAULT_STORE_NAME = "lib";
let storeName = DEFAULT_STORE_NAME;
let alpineReady = false;
const bridges = new WeakMap<object, CollectionRef | ItemRef>();
const pendingRequests = new WeakMap<object, Set<string>>();
const forcedReads = new WeakMap<object, Set<string>>();

// ---- Helpers --------------------------------------------------------------

function resolveWindow(): (Window & { Alpine?: AlpineInstance }) | undefined {
  if (typeof window === "undefined") return undefined;
  return window as Window & { Alpine?: AlpineInstance };
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

function bridgeRef<T extends CollectionRef | ItemRef>(
  Alpine: AlpineInstance,
  ref: T,
): T {
  const existing = bridges.get(ref);
  if (existing) return existing as T;

  const bridge = Alpine.reactive({ data: ref.data, meta: ref.meta }) as T;
  bridges.set(ref, bridge);
  coreOnRefChange(ref, () => {
    bridge.data = ref.data as T["data"];
    bridge.meta = ref.meta as T["meta"];
  });
  return bridge;
}

/**
 * Ensures the Alpine store is registered.
 * Creates it if it doesn't exist yet.
 */
export function ensureAlpineStore(
  name: string = storeName,
): AlpineStore | null {
  const nextName =
    typeof name === "string" && name.trim() ? name.trim() : storeName;

  if (nextName !== storeName) {
    storeName = nextName;
    alpineReady = false;
  }

  const win = resolveWindow();
  if (!win || !win.Alpine) return null;

  const Alpine = win.Alpine;

  if (!alpineReady) {
    Alpine.store(storeName, {
      _state: coreState(),
      col(collectionName: string, opts = {}) {
        const ref = getCollectionRef(collectionName, opts);
        const bridge = bridgeRef(Alpine, ref);
        const force = !!(opts as { force?: boolean }).force;
        const requestKey = "collection";
        if (shouldQueueRequest(ref, requestKey, force)) {
          queueRequest(ref, requestKey, () => {
            if (force) releaseForcedRead(ref, requestKey);
            fetchCollection(collectionName, opts);
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
        const bridge = bridgeRef(Alpine, ref);
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
        return (this as AlpineStore)._state;
      },
    } satisfies AlpineStore);
    alpineReady = true;
  }

  return Alpine.store(storeName) as AlpineStore;
}

// ---- Reactivity bridge ----------------------------------------------------

coreOnChange(() => {
  const win = resolveWindow();
  if (!win || !win.Alpine) return;

  const store = ensureAlpineStore();
  if (store) store._state = coreState();
});

// ---- Auto-init on alpine:init event --------------------------------------

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("alpine:init", () => {
    ensureAlpineStore();
  });
}

// ---- Init wrapper ---------------------------------------------------------

export function init(options: AlpineInitOptions = {}): void {
  const { alpineStoreName, ...rest } = options;

  if (typeof alpineStoreName === "string" && alpineStoreName.trim()) {
    storeName = alpineStoreName.trim();
    alpineReady = false;
  }

  if (resolveWindow()?.Alpine) {
    ensureAlpineStore();
  }

  return coreInit(rest);
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

// ---------------------------------------------------------------------------
// verity-dl  –  Alpine.js adapter
// ---------------------------------------------------------------------------

import {
  init as coreInit,
  onChange as coreOnChange,
  fetchCollection,
  fetchItem,
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
  _tick: number;
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
}

interface AlpineInitOptions extends InitOptions {
  alpineStoreName?: string;
}

// ---- State ----------------------------------------------------------------

const DEFAULT_STORE_NAME = "lib";
let storeName = DEFAULT_STORE_NAME;
let alpineReady = false;

// ---- Helpers --------------------------------------------------------------

function resolveWindow(): (Window & { Alpine?: AlpineInstance }) | undefined {
  if (typeof window === "undefined") return undefined;
  return window as Window & { Alpine?: AlpineInstance };
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
      _tick: 0,
      col(collectionName: string, opts = {}) {
        void (this as AlpineStore)._tick;
        return fetchCollection(collectionName, opts);
      },
      it(
        typeName: string,
        id: unknown,
        level: string | null = null,
        opts = {},
      ) {
        void (this as AlpineStore)._tick;
        return fetchItem(typeName, id, level, opts);
      },
      apply(directives: Directive[]) {
        return applyDirectives(directives);
      },
      state() {
        return coreState();
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
  if (store && typeof store._tick === "number") {
    store._tick = (store._tick + 1) % 1e9;
  }
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

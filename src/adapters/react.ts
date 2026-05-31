// ---------------------------------------------------------------------------
// verity-dl  –  React adapter (hooks)
// ---------------------------------------------------------------------------

import {
  init as coreInit,
  onChange as coreOnChange,
  fetchCollection,
  fetchItem,
  state as coreState,
  createType,
  createCollection,
  applyDirectives,
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
  type CollectionRef,
  type ItemRef,
  type FetchCollectionOptions,
  type FetchItemOptions,
} from "../core/index.js";

// ---- Types ----------------------------------------------------------------

interface ReactAPI {
  useRef: <T>(initial: T) => { current: T };
  useEffect: (effect: () => void, deps: unknown[]) => void;
  useMemo: <T>(factory: () => T, deps: unknown[]) => T;
  useCallback: <T>(fn: T, deps: unknown[]) => T;
  useSyncExternalStore: <T>(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ) => T;
}

// ---- Params key helpers ---------------------------------------------------

const PARAM_DEFAULT_KEY = "__default__";

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeForKey(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(normalizeForKey);
  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeForKey(value[key]);
    }
    return normalized;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }
  return value;
}

function paramsKey(params: unknown): string {
  if (params === undefined || params === null) return PARAM_DEFAULT_KEY;
  if (isPlainObject(params) && Object.keys(params).length === 0) {
    return PARAM_DEFAULT_KEY;
  }
  try {
    return JSON.stringify(normalizeForKey(params));
  } catch {
    return PARAM_DEFAULT_KEY;
  }
}

// ---- Option normalization -------------------------------------------------

function normalizeCollectionOptions(
  options: FetchCollectionOptions,
): FetchCollectionOptions {
  if (!options || typeof options !== "object") return {};
  const normalized: FetchCollectionOptions = {};
  if (Object.prototype.hasOwnProperty.call(options, "params")) {
    normalized.params = options.params;
  }
  if (Object.prototype.hasOwnProperty.call(options, "force")) {
    normalized.force = !!options.force;
  }
  return normalized;
}

function normalizeItemOptions(
  options: FetchItemOptions,
): FetchItemOptions {
  if (!options || typeof options !== "object") return {};
  const normalized: FetchItemOptions = {};
  if (Object.prototype.hasOwnProperty.call(options, "silent")) {
    normalized.silent = !!options.silent;
  }
  if (Object.prototype.hasOwnProperty.call(options, "force")) {
    normalized.force = !!options.force;
  }
  return normalized;
}

// ---- Signature builders ---------------------------------------------------

function buildCollectionSignature(
  name: string,
  options: FetchCollectionOptions,
): string {
  const opts =
    options && typeof options === "object" ? options : {};
  const params = paramsKey(opts.params);
  const force = opts.force ? "1" : "0";
  return `${String(name)}|${params}|force:${force}`;
}

function buildItemSignature(
  typeName: string,
  id: unknown,
  level: string | null,
  options: FetchItemOptions,
): string {
  const opts =
    options && typeof options === "object" ? options : {};
  const force = opts.force ? "1" : "0";
  const silent = opts.silent ? "1" : "0";
  const levelLabel = level == null ? "default" : String(level);
  return `${String(typeName)}|${String(id)}|${levelLabel}|force:${force}|silent:${silent}`;
}

// ---- React resolution -----------------------------------------------------

function resolveReact(): ReactAPI | null {
  const g = typeof globalThis !== "undefined" ? globalThis : undefined;
  const w = typeof window !== "undefined" ? window : undefined;
  const react = (w as unknown as Record<string, unknown>)?.React ??
    (g as unknown as Record<string, unknown>)?.React;
  if (react) return react as unknown as ReactAPI;
  return null;
}

function ensureReact(): ReactAPI {
  const React = resolveReact();
  if (!React) {
    throw new Error(
      "React must be available before using the VerityDL React adapter",
    );
  }
  if (typeof React.useSyncExternalStore !== "function") {
    throw new Error(
      "React 18+ with useSyncExternalStore is required",
    );
  }
  return React;
}

// ---- Subscribe helper -----------------------------------------------------

function subscribe(listener: () => void): () => void {
  return coreOnChange(listener);
}

// ---- Init wrapper ---------------------------------------------------------

export function init(options: InitOptions = {}): void {
  return coreInit(options);
}

// ---- Hooks ----------------------------------------------------------------

export function useCollection(
  name: string,
  options: FetchCollectionOptions = {},
): CollectionRef {
  const React = ensureReact();
  const { useRef, useEffect, useMemo, useSyncExternalStore } = React;

  const signature = buildCollectionSignature(name, options);
  const normalizedOptions = useMemo(
    () => normalizeCollectionOptions(options),
    [signature],
  );
  const holderRef = useRef<{ key: string | null; ref: CollectionRef | null }>({
    key: null,
    ref: null,
  });

  const getSnapshot = useMemo(() => {
    return (): CollectionRef => {
      if (
        !holderRef.current.ref ||
        holderRef.current.key !== signature
      ) {
        holderRef.current = {
          key: signature,
          ref: fetchCollection(name, normalizedOptions),
        };
      }
      return holderRef.current.ref!;
    };
  }, [signature, name, normalizedOptions]);

  useEffect(() => {
    const current = holderRef.current;
    if (!current.ref || current.key !== signature) {
      holderRef.current = {
        key: signature,
        ref: fetchCollection(name, normalizedOptions),
      };
    }
  }, [signature, name, normalizedOptions]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useItem(
  typeName: string,
  id: unknown,
  level: string | null = null,
  options: FetchItemOptions = {},
): ItemRef {
  const React = ensureReact();
  const { useRef, useEffect, useMemo, useSyncExternalStore } = React;

  const signature = buildItemSignature(typeName, id, level, options);
  const normalizedOptions = useMemo(
    () => normalizeItemOptions(options),
    [signature],
  );
  const holderRef = useRef<{ key: string | null; ref: ItemRef | null }>({
    key: null,
    ref: null,
  });
  const levelArg = level == null ? null : level;

  const getSnapshot = useMemo(() => {
    return (): ItemRef => {
      if (
        !holderRef.current.ref ||
        holderRef.current.key !== signature
      ) {
        holderRef.current = {
          key: signature,
          ref: fetchItem(typeName, id, levelArg, normalizedOptions),
        };
      }
      return holderRef.current.ref!;
    };
  }, [signature, typeName, id, levelArg, normalizedOptions]);

  useEffect(() => {
    const current = holderRef.current;
    if (!current.ref || current.key !== signature) {
      holderRef.current = {
        key: signature,
        ref: fetchItem(typeName, id, levelArg, normalizedOptions),
      };
    }
  }, [signature, typeName, id, levelArg, normalizedOptions]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useDLState<T = unknown>(
  selector?: (snapshot: ReturnType<typeof coreState>) => T,
): T {
  const React = ensureReact();
  const { useCallback, useSyncExternalStore } = React;

  const getSnapshot = useCallback((): T => {
    const snapshot = coreState();
    return typeof selector === "function"
      ? selector(snapshot)
      : (snapshot as unknown as T);
  }, [selector]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---- Re-exports from core -------------------------------------------------

export {
  subscribe,
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

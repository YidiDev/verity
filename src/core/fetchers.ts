// ---------------------------------------------------------------------------
// verity-dl  –  Collection & item fetch orchestration
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import {
  nowISO,
  genQid,
  toLevelKey,
  PARAM_DEFAULT_KEY,
} from "./constants.js";
import { emitLifecycle } from "./lifecycle.js";
import {
  assignRef,
  isStale,
  ensureItemRef,
  ensureCollectionRefEntry,
  itemKey,
  cloneParams,
  paramsKey,
  setActiveLevelQueryId,
  latestItemError,
} from "./helpers.js";
import { queueBulkItemFetch } from "./bulk-fetch.js";
import { runDirectItemFetch } from "./direct-item-fetch.js";
import type {
  TypeEntry,
} from "./types.js";

// ---- Level conversion planning --------------------------------------------

export function hasConversionPath(
  T: TypeEntry,
  fromKey: string,
  targetKey: string,
  visited: Set<string> = new Set(),
): boolean {
  if (fromKey === targetKey) return true;
  if (visited.has(fromKey)) return false;
  visited.add(fromKey);
  const edges = T.convertFrom.get(fromKey);
  if (!edges || !edges.size) return false;
  for (const next of edges) {
    if (hasConversionPath(T, next, targetKey, visited)) return true;
  }
  return false;
}

export function planFetchLevels(
  T: TypeEntry,
  levelsSet: Set<string>,
): string[] {
  if (!levelsSet || !levelsSet.size) return [];
  const fetchSet = new Set(levelsSet);
  for (const levelKey of [...fetchSet]) {
    fetchSet.delete(levelKey);
    let covered = false;
    for (const source of fetchSet) {
      if (hasConversionPath(T, source, levelKey, new Set())) {
        covered = true;
        break;
      }
    }
    if (!covered) {
      fetchSet.add(levelKey);
    }
  }
  if (!fetchSet.size && levelsSet.size) {
    fetchSet.add(levelsSet.values().next().value!);
  }
  return Array.from(fetchSet);
}

// ---- Source-of-truth loading state helpers ---------------------------------

export function isItemLoading(
  typeName: string,
  id: unknown,
  levelName: string | null = null,
): boolean {
  const key = itemKey(typeName, id, levelName);
  return G.inFlightItm.has(key);
}

export function isCollectionLoading(
  name: string,
  params?: unknown,
): boolean {
  const key = `${name}::${paramsKey(params)}`;
  return G.inFlightCol.has(key);
}

export function hasAnyInFlightRequests(): boolean {
  return G.inFlightItm.size > 0 || G.inFlightCol.size > 0;
}

// ---- Internal collection fetcher ------------------------------------------

export async function _startCollectionFetch(
  name: string,
  { force = false, params }: { force?: boolean; params?: unknown } = {},
): Promise<void> {
  const C = G.collections.get(name);
  if (!C) throw new Error(`Unknown collection '${name}'`);
  const { fetch, stalenessMs } = C;

  // Compute the params key directly to ensure correct in-flight tracking
  // for parameterized collections. This ensures parameterized collections
  // are tracked separately from non-parameterized ones.
  const effectiveParamsKey = paramsKey(params);
  const { ref } = ensureCollectionRefEntry(name, params);
  const inFlightKey = `${name}::${effectiveParamsKey}`;
  const snapshot = cloneParams(
    params ?? (ref.meta as { paramsSnapshot?: unknown }).paramsSnapshot ?? {},
  );

  const currentCollectionFetch = G.inFlightCol.get(inFlightKey);
  if (currentCollectionFetch) {
    // Don't update isLoading here - it will be synced with in-flight state
    // Setting isLoading=true without activeQueryId breaks the invariant
    emitLifecycle("collection:fetch:coalesced", {
      name,
      params: snapshot,
      key: inFlightKey,
    });
    if (force) {
      if (!currentCollectionFetch.pendingForce) {
        let resolve = (): void => {};
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        currentCollectionFetch.pendingForce = { promise, resolve };
      }
      return currentCollectionFetch.pendingForce.promise;
    }
    return currentCollectionFetch.promise;
  }

  // Verify that the ref's paramsKey matches the expected key.
  // If they don't match, the ref's lastFetched is for different params,
  // so we must fetch.
  const refParamsKey =
    ref.meta && ref.meta.paramsKey ? ref.meta.paramsKey : PARAM_DEFAULT_KEY;
  const paramsKeyMismatch = refParamsKey !== effectiveParamsKey;
  const neverFetchedForParams = !ref.meta.lastFetched;
  if (!force && !paramsKeyMismatch && ref.meta.error !== null) {
    emitLifecycle("collection:fetch:skip", {
      name,
      params: snapshot,
      reason: "previous-error",
    });
    return;
  }

  const shouldFetch =
    force ||
    paramsKeyMismatch ||
    neverFetchedForParams ||
    isStale(ref.meta.lastFetched, stalenessMs);

  if (!shouldFetch) {
    if (ref.meta.isLoading) {
      assignRef(ref, { meta: { ...ref.meta, isLoading: false } });
    }
    emitLifecycle("collection:fetch:skip", {
      name,
      params: snapshot,
      reason: "fresh",
    });
    return;
  }

  const qid = genQid();
  let start = (): void => {};
  const startGate = new Promise<void>((resolve) => {
    start = resolve;
  });
  const promise = (async (): Promise<void> => {
    await startGate;
    try {
      const result = await fetch(snapshot || {});
      if (ref.meta.activeQueryId !== qid) {
        emitLifecycle("collection:fetch:aborted", {
          name,
          params: snapshot,
          qid,
          reason: "superseded",
        });
        return;
      }
      // Preserve all server response fields non-destructively
      const resultObj = result as Record<string, unknown>;
      const ids = Array.isArray(resultObj.ids)
        ? (resultObj.ids as unknown[]).slice()
        : [];
      const count =
        typeof resultObj.count === "number"
          ? resultObj.count
          : ids.length;
      const serverMeta =
        resultObj.meta !== undefined ? resultObj.meta : null;
      const items =
        resultObj.items !== undefined ? resultObj.items : null;

      assignRef(ref, {
        data: { ids, count, meta: serverMeta, items },
        meta: {
          ...ref.meta,
          isLoading: false,
          lastFetched: nowISO(),
          error: null,
          activeQueryId: null,
        },
      });
      emitLifecycle("collection:fetch:success", {
        name,
        params: snapshot,
        qid,
      });
    } catch (e) {
      if (ref.meta.activeQueryId !== qid) {
        emitLifecycle("collection:fetch:aborted", {
          name,
          params: snapshot,
          qid,
          reason: "superseded",
        });
        return;
      }
      assignRef(ref, {
        meta: {
          ...ref.meta,
          isLoading: false,
          error: String(e),
          activeQueryId: null,
        },
      });
      emitLifecycle("collection:fetch:error", {
        name,
        params: snapshot,
        qid,
        error: String(e),
      });
    }
  })();

  G.inFlightCol.set(inFlightKey, { promise });
  promise.finally(() => {
    const bucket = G.inFlightCol.get(inFlightKey);
    const pendingForce = bucket?.promise === promise
      ? bucket.pendingForce
      : undefined;
    if (bucket?.promise === promise) G.inFlightCol.delete(inFlightKey);
    emitLifecycle("collection:fetch:complete", {
      name,
      params: snapshot,
      qid,
    });
    if (pendingForce) {
      queueMicrotask(() => {
        _startCollectionFetch(name, { force: true, params }).then(
          pendingForce.resolve,
          pendingForce.resolve,
        );
      });
    }
  });
  assignRef(ref, {
    meta: { ...ref.meta, isLoading: true, error: null, activeQueryId: qid },
  });
  emitLifecycle("collection:fetch:intent", {
    name,
    params: snapshot,
    qid,
    force: !!force,
  });
  start();
  return promise;
}

// ---- Internal item fetcher ------------------------------------------------

export async function _startItemFetch(
  typeName: string,
  id: unknown,
  levelName: string | null | undefined,
  { loud = false, force = false }: { loud?: boolean; force?: boolean } = {},
): Promise<void> {
  const T = G.types.get(typeName);
  if (!T) throw new Error(`Unknown type '${typeName}'`);
  const ref = ensureItemRef(typeName, id);
  const key = itemKey(typeName, id, levelName);
  const canonicalLevel = toLevelKey(levelName);
  const levelLabel = levelName == null ? null : levelName;
  const eventBase = { typeName, id, level: levelLabel, canonicalLevel };

  const currentItemFetch = G.inFlightItm.get(key);
  if (currentItemFetch) {
    // Don't update isLoading here - setting isLoading=true without
    // activeQueryId breaks the invariant (isLoading=true + activeQueryId=null)
    emitLifecycle("item:fetch:coalesced", {
      ...eventBase,
      loud: !!loud,
      key,
    });
    if (force) {
      if (!currentItemFetch.pendingForce) {
        let resolve = (): void => {};
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        currentItemFetch.pendingForce = { promise, resolve, loud };
      } else if (loud) {
        currentItemFetch.pendingForce.loud = true;
      }
      return currentItemFetch.pendingForce.promise;
    }
    return currentItemFetch.promise;
  }

  if (!force && ref.meta.failedLevels?.[canonicalLevel]) {
    emitLifecycle("item:fetch:skip", {
      ...eventBase,
      loud: !!loud,
      force: false,
      reason: "previous-error",
    });
    return;
  }

  const isDefault = !levelName;
  const levelCfg = levelName ? T.levels[levelName] : undefined;
  const hasEnough = isDefault
    ? !!ref.data
    : !!(levelCfg && levelCfg.check(ref.data));

  const staleClock =
    ref.meta.levelStamps[canonicalLevel] || ref.meta.lastFetchedAny;
  const stalenessMs = levelCfg ? levelCfg.stalenessMs : T.stalenessMs;
  const stale = isStale(staleClock, stalenessMs);

  const needs = force || !hasEnough || stale;
  if (!needs) {
    if (loud && ref.meta.isLoading) {
      assignRef(ref, { meta: { ...ref.meta, isLoading: false } });
    }
    emitLifecycle("item:fetch:skip", {
      ...eventBase,
      loud: !!loud,
      force: !!force,
      reason: "fresh",
    });
    return;
  }

  const qid = genQid();
  const nextActiveLevels = setActiveLevelQueryId(
    ref.meta,
    canonicalLevel,
    qid,
  );
  const nextFailedLevels = { ...(ref.meta.failedLevels || {}) };
  delete nextFailedLevels[canonicalLevel];
  const nextLevelErrors = { ...(ref.meta.levelErrors || {}) };
  delete nextLevelErrors[canonicalLevel];
  const remainingError = latestItemError(nextLevelErrors);
  const fallbackFetcher = levelCfg ? levelCfg.fetch : T.fetch;
  const bulkFetcher =
    levelCfg && typeof levelCfg.bulkFetch === "function"
      ? levelCfg.bulkFetch
      : typeof T.bulkFetch === "function"
        ? T.bulkFetch
        : null;
  const levelArg = levelName != null ? levelName : "default";
  let start = (): void => {};
  const startGate = new Promise<void>((resolve) => {
    start = resolve;
  });
  const promise = (async (): Promise<void> => {
    await startGate;
    if (typeof bulkFetcher === "function") {
      const queued = queueBulkItemFetch({
        typeName,
        id,
        canonicalLevel,
        levelArg,
        ref,
        qid,
        bulkFetcher,
        fallbackFetcher,
      });
      emitLifecycle("item:fetch:queued", {
        ...eventBase,
        qid,
        strategy: "bulk",
      });
      await queued;
      return;
    }

    await runDirectItemFetch({
      type: T,
      typeName,
      id,
      levelArg,
      canonicalLevel,
      eventBase,
      ref,
      qid,
      fetcher: fallbackFetcher,
    });
  })();

  G.inFlightItm.set(key, { promise, loud });
  promise.finally(() => {
    const bucket = G.inFlightItm.get(key);
    const pendingForce = bucket?.promise === promise
      ? bucket.pendingForce
      : undefined;
    if (bucket && bucket.promise === promise) {
      G.inFlightItm.delete(key);
    }
    emitLifecycle("item:fetch:complete", { ...eventBase, qid });
    if (pendingForce) {
      queueMicrotask(() => {
        _startItemFetch(typeName, id, levelName, {
          force: true,
          loud: pendingForce.loud,
        }).then(pendingForce.resolve, pendingForce.resolve);
      });
    }
  });

  // Always set activeQueryId for query matching, but only set isLoading if loud
  if (loud) {
    assignRef(ref, {
      meta: {
        ...ref.meta,
        isLoading: true,
        error: remainingError,
        activeQueryId: qid,
        activeLevelQueryIds: nextActiveLevels,
        failedLevels: nextFailedLevels,
        levelErrors: nextLevelErrors,
      },
    });
  } else {
    assignRef(ref, {
      meta: {
        ...ref.meta,
        error: remainingError,
        activeQueryId: qid,
        activeLevelQueryIds: nextActiveLevels,
        failedLevels: nextFailedLevels,
        levelErrors: nextLevelErrors,
      },
    });
  }
  emitLifecycle("item:fetch:intent", {
    ...eventBase,
    qid,
    loud: !!loud,
    force: !!force,
    strategy: bulkFetcher ? "bulk" : "direct",
  });
  start();
  return promise;
}

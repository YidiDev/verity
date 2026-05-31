// ---------------------------------------------------------------------------
// verity-dl  –  Collection & item fetch orchestration
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import {
  nowISO,
  genQid,
  toLevelKey,
} from "./constants.js";
import { emitLifecycle } from "./lifecycle.js";
import { scheduleMemorySweep } from "./memory.js";
import {
  assignRef,
  isStale,
  ensureItemRef,
  ensureCollectionRefEntry,
  itemKey,
  cloneParams,
  setActiveLevelQueryId,
  isLevelActive,
  finalizeItemMeta,
  applyFetchedLevel,
} from "./helpers.js";
import { queueBulkItemFetch } from "./bulk-fetch.js";
import type {
  TypeEntry,
  ItemRef,
  CollectionRef,
  FetchCollectionOptions,
  FetchItemOptions,
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

// ---- Internal fetchers (coalesced, latest-wins) ---------------------------

export async function _startCollectionFetch(
  name: string,
  { force = false, params }: { force?: boolean; params?: unknown } = {},
): Promise<void> {
  const C = G.collections.get(name);
  if (!C) throw new Error(`Unknown collection '${name}'`);
  const { fetch, stalenessMs } = C;
  const { ref, key } = ensureCollectionRefEntry(name, params);
  const inFlightKey = `${name}::${key}`;
  const snapshot = cloneParams(
    params ?? (ref.meta as { paramsSnapshot?: unknown }).paramsSnapshot ?? {},
  );

  if (G.inFlightCol.has(inFlightKey)) {
    const bucket = G.inFlightCol.get(inFlightKey)!;
    if (!ref.meta.isLoading)
      {assignRef(ref, { meta: { ...ref.meta, isLoading: true, error: null } });}
    emitLifecycle("collection:fetch:coalesced", {
      name,
      params: snapshot,
      key: inFlightKey,
    });
    return bucket.promise;
  }

  const shouldFetch = force || isStale(ref.meta.lastFetched, stalenessMs);
  if (!shouldFetch) {
    if (ref.meta.isLoading)
      {assignRef(ref, { meta: { ...ref.meta, isLoading: false } });}
    emitLifecycle("collection:fetch:skip", {
      name,
      params: snapshot,
      reason: "fresh",
    });
    return;
  }

  const qid = genQid();
  assignRef(ref, {
    meta: { ...ref.meta, isLoading: true, error: null, activeQueryId: qid },
  });
  emitLifecycle("collection:fetch:intent", {
    name,
    params: snapshot,
    qid,
    force: !!force,
  });

  const promise = (async (): Promise<void> => {
    try {
      const data = await fetch(snapshot || {});
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
        data: {
          ids: Array.isArray(data.ids) ? data.ids.slice() : [],
          count: Number(data.count ?? 0),
        },
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
    } finally {
      G.inFlightCol.delete(inFlightKey);
      emitLifecycle("collection:fetch:complete", {
        name,
        params: snapshot,
        qid,
      });
    }
  })();

  G.inFlightCol.set(inFlightKey, { promise });
  return promise;
}

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

  if (G.inFlightItm.has(key)) {
    const bucket = G.inFlightItm.get(key)!;
    if (loud && !ref.meta.isLoading)
      {assignRef(ref, { meta: { ...ref.meta, isLoading: true } });}
    emitLifecycle("item:fetch:coalesced", {
      ...eventBase,
      loud: !!loud,
      key,
    });
    return bucket.promise;
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
    if (loud && ref.meta.isLoading)
      {assignRef(ref, { meta: { ...ref.meta, isLoading: false } });}
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
  if (loud) {
    assignRef(ref, {
      meta: {
        ...ref.meta,
        isLoading: true,
        error: null,
        activeQueryId: qid,
        activeLevelQueryIds: nextActiveLevels,
      },
    });
  } else {
    assignRef(ref, {
      meta: {
        ...ref.meta,
        error: null,
        activeLevelQueryIds: nextActiveLevels,
      },
    });
  }

  const fallbackFetcher = levelCfg ? levelCfg.fetch : T.fetch;
  const bulkFetcher =
    levelCfg && typeof levelCfg.bulkFetch === "function"
      ? levelCfg.bulkFetch
      : typeof T.bulkFetch === "function"
        ? T.bulkFetch
        : null;
  const levelArg = levelName != null ? levelName : "default";
  emitLifecycle("item:fetch:intent", {
    ...eventBase,
    qid,
    loud: !!loud,
    force: !!force,
    strategy: bulkFetcher ? "bulk" : "direct",
  });

  let promise: Promise<void>;
  if (typeof bulkFetcher === "function") {
    promise = queueBulkItemFetch({
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
  } else {
    promise = (async (): Promise<void> => {
      try {
        const data = await fallbackFetcher(id, levelArg);
        if (!isLevelActive(ref.meta, canonicalLevel, qid)) {
          emitLifecycle("item:fetch:aborted", {
            ...eventBase,
            qid,
            reason: "superseded",
          });
          return;
        }
        const now = nowISO();
        applyFetchedLevel(
          T,
          typeName,
          id,
          ref,
          canonicalLevel,
          data,
          now,
          qid,
        );
        emitLifecycle("item:fetch:success", {
          ...eventBase,
          qid,
          strategy: "direct",
        });
      } catch (e) {
        if (!isLevelActive(ref.meta, canonicalLevel, qid)) {
          emitLifecycle("item:fetch:aborted", {
            ...eventBase,
            qid,
            reason: "superseded",
          });
          return;
        }
        const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, {
          error: String(e),
        });
        assignRef(ref, { meta: nextMeta });
        emitLifecycle("item:fetch:error", {
          ...eventBase,
          qid,
          error: String(e),
          strategy: "direct",
        });
      }
    })();
  }

  G.inFlightItm.set(key, { promise, loud });
  promise.finally(() => {
    const bucket = G.inFlightItm.get(key);
    if (bucket && bucket.promise === promise) {
      G.inFlightItm.delete(key);
    }
    emitLifecycle("item:fetch:complete", { ...eventBase, qid });
  });
  return promise;
}

// ---- Public fetch API (thin wrappers) -------------------------------------

export function fetchCollection(
  name: string,
  opts: FetchCollectionOptions = {},
): CollectionRef {
  const C = G.collections.get(name);
  if (!C) throw new Error(`Unknown collection '${name}'`);
  const { ref } = ensureCollectionRefEntry(name, opts.params);
  ref.meta.lastUsedAt = nowISO();
  scheduleMemorySweep();
  _startCollectionFetch(name, opts);
  return ref;
}

export function fetchItem(
  typeName: string,
  id: unknown,
  levelName: string | null = null,
  opts: FetchItemOptions = {},
): ItemRef {
  const ref = ensureItemRef(typeName, id);
  ref.meta.lastUsedAt = nowISO();
  scheduleMemorySweep();
  if (!opts.silent && !ref.meta.isLoading)
    {assignRef(ref, { meta: { ...ref.meta, isLoading: true, error: null } });}
  _startItemFetch(typeName, id, levelName, {
    loud: !opts.silent,
    force: !!opts.force,
  });
  return ref;
}

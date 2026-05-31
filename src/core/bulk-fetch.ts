// ---------------------------------------------------------------------------
// verity-dl  –  Bulk fetch queue
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import { nowISO } from "./constants.js";
import { emitLifecycle } from "./lifecycle.js";
import {
  assignRef,
  isLevelActive,
  finalizeItemMeta,
  applyFetchedLevel,
} from "./helpers.js";
import type { BulkFetchFn, ItemFetchFn, ItemRef } from "./types.js";

export function bulkQueueKey(
  typeName: string,
  canonicalLevel: string,
): string {
  return `${typeName}::${canonicalLevel}`;
}

export function queueBulkItemFetch(opts: {
  typeName: string;
  id: unknown;
  canonicalLevel: string;
  levelArg: string;
  ref: ItemRef;
  qid: string;
  bulkFetcher: BulkFetchFn;
  fallbackFetcher: ItemFetchFn;
}): Promise<void> {
  const {
    typeName,
    id,
    canonicalLevel,
    levelArg,
    ref,
    qid,
    bulkFetcher,
    fallbackFetcher,
  } = opts;
  const queueKey = bulkQueueKey(typeName, canonicalLevel);
  let bucket = G.bulk.queues.get(queueKey);
  if (!bucket) {
    bucket = {
      typeName,
      canonicalLevel,
      levelArg,
      bulkFetcher,
      fallbackFetcher,
      entries: new Map(),
      timer: null,
    };
    G.bulk.queues.set(queueKey, bucket);
    emitLifecycle("bulk:queue:created", {
      queueKey,
      typeName,
      canonicalLevel,
    });
  } else {
    if (typeof bulkFetcher === "function") bucket.bulkFetcher = bulkFetcher;
    if (typeof fallbackFetcher === "function")
      {bucket.fallbackFetcher = fallbackFetcher;}
    bucket.levelArg = levelArg;
  }

  const idKey = String(id);
  const existing = bucket.entries.get(idKey);
  const levelLabel = levelArg === "default" ? null : levelArg;
  if (existing && existing.promise) {
    existing.qid = qid;
    existing.ref = ref;
    existing.levelName = levelLabel;
    emitLifecycle("bulk:queue:coalesced", {
      queueKey,
      typeName,
      canonicalLevel,
      id,
      qid,
    });
    return existing.promise;
  }

  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  bucket.entries.set(idKey, {
    id,
    ref,
    qid,
    resolve: resolvePromise,
    promise,
    levelName: levelLabel,
  });
  emitLifecycle("bulk:queue:enqueue", {
    queueKey,
    typeName,
    canonicalLevel,
    id,
    qid,
  });

  if (!bucket.timer) {
    bucket.timer = setTimeout(() => {
      bucket!.timer = null;
      Promise.resolve(flushBulkQueue(queueKey)).catch(() => {});
    }, G.bulk.delayMs);
    emitLifecycle("bulk:queue:schedule", {
      queueKey,
      delayMs: G.bulk.delayMs,
      size: bucket.entries.size,
    });
  }

  return promise;
}

async function flushBulkQueue(queueKey: string): Promise<void> {
  const bucket = G.bulk.queues.get(queueKey);
  if (!bucket) return;
  G.bulk.queues.delete(queueKey);
  if (bucket.timer) {
    clearTimeout(bucket.timer);
  }

  const entries = Array.from(bucket.entries.values());
  bucket.entries.clear();
  if (!entries.length) return;
  emitLifecycle("bulk:queue:flush", {
    queueKey,
    size: entries.length,
    typeName: bucket.typeName,
    canonicalLevel: bucket.canonicalLevel,
  });

  const T = G.types.get(bucket.typeName);
  if (!T) {
    for (const entry of entries) {
      try {
        entry.resolve();
      } catch {
        /* ignore */
      }
    }
    return;
  }

  const ids = entries.map((entry) => entry.id);
  const levelArg = bucket.levelArg;
  const canonicalLevel = bucket.canonicalLevel;

  let bulkError: Error | null = null;
  let results: unknown;
  const fetcher =
    typeof bucket.bulkFetcher === "function" ? bucket.bulkFetcher : null;

  if (fetcher) {
    try {
      results = await fetcher(ids.slice(), levelArg, {
        type: bucket.typeName,
        level: levelArg,
        canonicalLevel,
      });
    } catch (err) {
      bulkError = err instanceof Error ? err : new Error(String(err));
    }
  } else {
    bulkError = new Error("No bulk fetcher registered");
  }

  const resultMap = new Map<string, unknown>();
  if (!bulkError && Array.isArray(results)) {
    for (const item of results) {
      if (!item || typeof item !== "object") continue;
      const rid = (item as Record<string, unknown>).id as
        | string
        | number
        | undefined
        | null;
      if (rid === undefined || rid === null) continue;
      resultMap.set(String(rid), item);
    }
  } else if (
    !bulkError &&
    results &&
    typeof results === "object" &&
    !Array.isArray(results)
  ) {
    for (const [rid, value] of Object.entries(
      results as Record<string, unknown>,
    )) {
      resultMap.set(rid, value);
    }
  }

  for (const entry of entries) {
    const { id, ref, qid, resolve } = entry;
    try {
      if (
        !ref ||
        !ref.meta ||
        !isLevelActive(ref.meta, canonicalLevel, qid)
      ) {
        resolve();
        continue;
      }

      if (bulkError) {
        const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, {
          error: String(bulkError),
        });
        assignRef(ref, { meta: nextMeta });
        emitLifecycle("item:fetch:error", {
          typeName: bucket.typeName,
          id,
          level: entry.levelName ?? null,
          canonicalLevel,
          qid,
          error: String(bulkError),
          strategy: "bulk",
        });
        resolve();
        continue;
      }

      const key = String(id);
      let data: unknown = resultMap.has(key)
        ? resultMap.get(key)
        : undefined;

      if (
        !resultMap.has(key) &&
        typeof bucket.fallbackFetcher === "function"
      ) {
        try {
          data = await bucket.fallbackFetcher(id, levelArg);
        } catch (fallbackErr) {
          if (isLevelActive(ref.meta, canonicalLevel, qid)) {
            const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, {
              error: String(fallbackErr),
            });
            assignRef(ref, { meta: nextMeta });
            emitLifecycle("item:fetch:error", {
              typeName: bucket.typeName,
              id,
              level: entry.levelName ?? null,
              canonicalLevel,
              qid,
              error: String(fallbackErr),
              strategy: "bulk",
            });
          }
          resolve();
          continue;
        }
      }

      if (!isLevelActive(ref.meta, canonicalLevel, qid)) {
        emitLifecycle("item:fetch:aborted", {
          typeName: bucket.typeName,
          id,
          level: entry.levelName ?? null,
          canonicalLevel,
          qid,
          reason: "superseded",
        });
        resolve();
        continue;
      }

      if (data && typeof data === "object") {
        const timestamp = nowISO();
        applyFetchedLevel(
          T,
          bucket.typeName,
          id,
          ref,
          canonicalLevel,
          data,
          timestamp,
          qid,
        );
        emitLifecycle("item:fetch:success", {
          typeName: bucket.typeName,
          id,
          level: entry.levelName ?? null,
          canonicalLevel,
          qid,
          strategy: "bulk",
        });
      } else {
        const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, {
          error: "Bulk fetch missing data",
        });
        assignRef(ref, { meta: nextMeta });
        emitLifecycle("item:fetch:error", {
          typeName: bucket.typeName,
          id,
          level: entry.levelName ?? null,
          canonicalLevel,
          qid,
          error: "Bulk fetch missing data",
          strategy: "bulk",
        });
      }
    } catch (err) {
      if (ref && ref.meta && isLevelActive(ref.meta, canonicalLevel, qid)) {
        const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, {
          error: String(err),
        });
        assignRef(ref, { meta: nextMeta });
        emitLifecycle("item:fetch:error", {
          typeName: bucket.typeName,
          id,
          level: entry.levelName ?? null,
          canonicalLevel,
          qid,
          error: String(err),
          strategy: "bulk",
        });
      }
    } finally {
      try {
        resolve();
      } catch {
        /* ignore */
      }
    }
  }
}

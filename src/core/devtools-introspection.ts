// ---------------------------------------------------------------------------
// verity-dl  –  State introspection & devtools snapshot
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import { CLIENT_ID, defaultCheck } from "./constants.js";
import { cloneForDiagnostics, deepFreeze } from "./helpers.js";
import type { TypeEntry, CollectionEntry } from "./types.js";

/**
 * Returns live references to the internal type and collection maps.
 * Mutations through these references affect the core state directly.
 */
export function state(): {
  types: Map<string, TypeEntry>;
  collections: Map<string, CollectionEntry>;
} {
  return {
    types: G.types,
    collections: G.collections,
  };
}

/**
 * Returns a deep-frozen, cloned snapshot of the entire system state
 * suitable for debugging and devtools display.
 */
export function devtools(): Readonly<Record<string, unknown>> {
  const types: Record<string, unknown> = {};

  for (const [name, T] of G.types) {
    const items: Record<string, unknown> = {};

    if (T && T.items) {
      for (const [id, ref] of T.items) {
        items[id] = {
          data: cloneForDiagnostics(ref.data),
          meta: cloneForDiagnostics(ref.meta),
        };
      }
    }

    const levels: Record<string, unknown> = {};

    if (T && T.levels) {
      for (const [levelName, cfg] of Object.entries(T.levels)) {
        if (!cfg) continue;
        levels[levelName] = {
          stalenessMs: cfg.stalenessMs,
          hasBulkFetch: typeof cfg.bulkFetch === "function",
          hasCustomCheck: cfg.check !== defaultCheck,
        };
      }
    }

    const convertFrom: Record<string, string[]> = {};

    if (T && T.convertFrom) {
      for (const [fromKey, set] of T.convertFrom) {
        convertFrom[fromKey] = Array.from(set || []);
      }
    }

    const levelAccepts: Record<string, string[]> = {};

    if (T && T.levelAccepts) {
      for (const [targetKey, set] of T.levelAccepts) {
        levelAccepts[targetKey] = Array.from(set || []);
      }
    }

    types[name] = {
      stalenessMs: T.stalenessMs,
      hasBulkFetch: typeof T.bulkFetch === "function",
      items,
      levels,
      convertFrom,
      levelAccepts,
    };
  }

  const collections: Record<string, unknown> = {};

  for (const [name, C] of G.collections) {
    const refs: Record<string, unknown> = {};

    if (C && C.refs) {
      for (const [key, ref] of C.refs) {
        refs[key] = {
          data: cloneForDiagnostics(ref.data),
          meta: cloneForDiagnostics(ref.meta),
        };
      }
    }

    collections[name] = {
      stalenessMs: C.stalenessMs,
      refs,
    };
  }

  const inFlightCollections: unknown[] = [];

  for (const [key, bucket] of G.inFlightCol) {
    inFlightCollections.push({
      key,
      pending: !!(bucket && bucket.promise),
    });
  }

  const inFlightItems: unknown[] = [];

  for (const [key, bucket] of G.inFlightItm) {
    inFlightItems.push({
      key,
      loud: !!(bucket && bucket.loud),
      pending: !!(bucket && bucket.promise),
    });
  }

  const directiveSeen: unknown[] = [];

  for (const [key, ts] of G.directiveRegistry.seen) {
    const iso = Number.isFinite(ts)
      ? new Date(ts).toISOString()
      : null;
    directiveSeen.push({ key, seenAt: iso });
  }

  const seqByAudience: Record<string, number> = {};

  for (const [audience, seq] of G.sse.seqByAudience) {
    seqByAudience[audience] = seq;
  }

  const bulkQueues: Record<string, unknown> = {};

  for (const [queueKey, bucket] of G.bulk.queues) {
    bulkQueues[queueKey] = {
      typeName: bucket.typeName,
      canonicalLevel: bucket.canonicalLevel,
      levelArg: bucket.levelArg,
      size: bucket.entries ? bucket.entries.size : 0,
      timerActive: !!bucket.timer,
    };
  }

  const snapshot = {
    clientId: CLIENT_ID,
    types,
    collections,
    inFlight: {
      collections: inFlightCollections,
      items: inFlightItems,
    },
    directiveRegistry: {
      ttlMs: G.directiveRegistry.ttlMs,
      maxSize: G.directiveRegistry.maxSize,
      seen: directiveSeen,
    },
    sse: {
      enabled: G.sse.enabled,
      url: G.sse.url,
      audience: G.sse.audience,
      connected: G.sse.connected,
      retryMs: G.sse.retryMs,
      initialRetryMs: G.sse.initialRetryMs,
      maxRetryMs: G.sse.maxRetryMs,
      backoffMultiplier: G.sse.backoffMultiplier,
      withCredentials: G.sse.withCredentials,
      resyncOnGap: G.sse.resyncOnGap,
      resyncTimerActive: !!G.sse.resyncTimer,
      seqByAudience,
    },
    bulk: {
      delayMs: G.bulk.delayMs,
      queues: bulkQueues,
    },
    memory: {
      enabled: G.memory.enabled,
      pruneIntervalMs: G.memory.pruneIntervalMs,
      maxCollectionRefsPerCollection:
        G.memory.maxCollectionRefsPerCollection,
      collectionEntryTtlMs: G.memory.collectionEntryTtlMs,
      maxItemsPerType: G.memory.maxItemsPerType,
      itemEntryTtlMs: G.memory.itemEntryTtlMs,
      sweepTimerActive: G.memory.sweepTimer !== null,
    },
  };

  return deepFreeze(snapshot);
}

/**
 * Returns the stable client identifier.
 */
export function clientId(): string {
  return CLIENT_ID;
}

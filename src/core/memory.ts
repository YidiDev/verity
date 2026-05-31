// ---------------------------------------------------------------------------
// verity-dl  –  Memory management (TTL-based + capacity-based eviction)
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import { PARAM_DEFAULT_KEY } from "./constants.js";
import { emitLifecycle } from "./lifecycle.js";
import {
  assignRef,
  hasAnyActiveLevels,
  parseMetaTimestamp,
} from "./helpers.js";
import { nowISO } from "./constants.js";
import type { MemoryConfig, CollectionRef, ItemRef } from "./types.js";

// ---- Timer management -----------------------------------------------------

export function cancelMemorySweepTimer(): void {
  if (G.memory.sweepTimer) {
    clearTimeout(G.memory.sweepTimer);
    G.memory.sweepTimer = null;
  }
}

export function scheduleMemorySweep(
  { immediate = false }: { immediate?: boolean } = {},
): void {
  if (!G.memory.enabled || !(Number(G.memory.pruneIntervalMs) > 0)) {
    cancelMemorySweepTimer();
    emitLifecycle("memory:schedule:disabled", { reason: "disabled" });
    return;
  }

  const delay = immediate ? 0 : Number(G.memory.pruneIntervalMs);
  if (G.memory.sweepTimer !== null) {
    if (immediate) {
      cancelMemorySweepTimer();
      emitLifecycle("memory:schedule:cancel", { reason: "immediate" });
    } else {
      emitLifecycle("memory:schedule:skip", { reason: "existing" });
      return;
    }
  }

  emitLifecycle("memory:schedule", {
    immediate: !!immediate,
    delayMs: delay,
  });
  G.memory.sweepTimer = setTimeout(() => {
    G.memory.sweepTimer = null;
    emitLifecycle("memory:sweep:timer", { scheduledAt: nowISO() });
    runMemorySweep();
  }, delay);
}

// ---- Configuration --------------------------------------------------------

export function configureMemory(cfg: MemoryConfig = {}): void {
  if (!cfg || typeof cfg !== "object") return;

  if (typeof cfg.enabled === "boolean") G.memory.enabled = cfg.enabled;
  if (typeof cfg.pruneIntervalMs === "number" && cfg.pruneIntervalMs >= 0)
    {G.memory.pruneIntervalMs = cfg.pruneIntervalMs;}
  if (
    typeof cfg.maxCollectionRefsPerCollection === "number" &&
    cfg.maxCollectionRefsPerCollection >= 0
  )
    {G.memory.maxCollectionRefsPerCollection = cfg.maxCollectionRefsPerCollection;}
  if (typeof cfg.collectionEntryTtlMs === "number" && cfg.collectionEntryTtlMs >= 0)
    {G.memory.collectionEntryTtlMs = cfg.collectionEntryTtlMs;}
  if (typeof cfg.maxItemsPerType === "number" && cfg.maxItemsPerType >= 0)
    {G.memory.maxItemsPerType = cfg.maxItemsPerType;}
  if (typeof cfg.itemEntryTtlMs === "number" && cfg.itemEntryTtlMs >= 0)
    {G.memory.itemEntryTtlMs = cfg.itemEntryTtlMs;}

  if (!G.memory.enabled) {
    cancelMemorySweepTimer();
  } else {
    scheduleMemorySweep({ immediate: true });
  }
}

// ---- Eviction helpers -----------------------------------------------------

function evictCollectionEntry(
  name: string,
  key: string,
  entry: CollectionRef,
): void {
  if (!entry || key === PARAM_DEFAULT_KEY) return;
  try {
    assignRef(entry, {
      data: { ids: [], count: 0 },
      meta: {
        ...entry.meta,
        isLoading: false,
        error: null,
        activeQueryId: null,
        lastFetched: null,
        lastUsedAt: null,
      },
    });
  } catch {
    /* ignore */
  }

  const C = G.collections.get(name);
  if (C && C.refs) {
    C.refs.delete(key);
  }
}

function evictItemEntry(typeName: string, id: string, ref: ItemRef): void {
  if (!ref) return;
  try {
    assignRef(ref, {
      data: null,
      meta: {
        ...ref.meta,
        isLoading: false,
        error: null,
        activeQueryId: null,
        lastFetchedAny: null,
        levelStamps: {},
        lastUsedAt: null,
        activeLevelQueryIds: Object.create(null) as Record<string, string | undefined>,
      },
    });
  } catch {
    /* ignore */
  }

  const T = G.types.get(typeName);
  if (T && T.items) {
    T.items.delete(id);
  }
}

// ---- Pruning --------------------------------------------------------------

function pruneCollections(now: number): { scanned: number; evicted: number } {
  const ttl = Number(G.memory.collectionEntryTtlMs) || 0;
  const maxRefs = Number(G.memory.maxCollectionRefsPerCollection) || 0;
  const stats = { scanned: 0, evicted: 0 };

  for (const [name, C] of G.collections) {
    if (!C || !C.refs || C.refs.size <= 1) continue;
    const candidates: { key: string; entry: CollectionRef; lastUsed: number }[] = [];
    for (const [key, entry] of C.refs) {
      if (key === PARAM_DEFAULT_KEY) continue;
      const meta = entry.meta || {};
      if (meta.isLoading || meta.activeQueryId || hasAnyActiveLevels(meta as never))
        {continue;}
      const parsed = parseMetaTimestamp(meta.lastUsedAt);
      const lastUsed = Number.isFinite(parsed) ? parsed : now;
      stats.scanned += 1;
      if (ttl > 0 && Number.isFinite(parsed) && now - parsed > ttl) {
        evictCollectionEntry(name, key, entry);
        stats.evicted += 1;
        continue;
      }
      candidates.push({ key, entry, lastUsed });
    }

    if (maxRefs > 0 && candidates.length > maxRefs) {
      candidates.sort((a, b) => a.lastUsed - b.lastUsed);
      const excess = candidates.length - maxRefs;
      for (let i = 0; i < excess; i += 1) {
        const victim = candidates[i]!;
        evictCollectionEntry(name, victim.key, victim.entry);
        stats.evicted += 1;
      }
    }
  }
  return stats;
}

function pruneItems(now: number): { scanned: number; evicted: number } {
  const ttl = Number(G.memory.itemEntryTtlMs) || 0;
  const maxItems = Number(G.memory.maxItemsPerType) || 0;
  const stats = { scanned: 0, evicted: 0 };

  for (const [typeName, T] of G.types) {
    if (!T || !T.items) continue;
    const candidates: { id: string; ref: ItemRef; lastUsed: number }[] = [];
    for (const [id, ref] of T.items) {
      const meta = ref.meta || ({} as ItemRef["meta"]);
      if (meta.isLoading || meta.activeQueryId || hasAnyActiveLevels(meta))
        {continue;}
      const parsed = parseMetaTimestamp(meta.lastUsedAt);
      const lastUsed = Number.isFinite(parsed) ? parsed : now;
      stats.scanned += 1;
      if (ttl > 0 && Number.isFinite(parsed) && now - parsed > ttl) {
        evictItemEntry(typeName, id, ref);
        stats.evicted += 1;
        continue;
      }
      candidates.push({ id, ref, lastUsed });
    }

    if (maxItems > 0 && candidates.length > maxItems) {
      candidates.sort((a, b) => a.lastUsed - b.lastUsed);
      const excess = candidates.length - maxItems;
      for (let i = 0; i < excess; i += 1) {
        const victim = candidates[i]!;
        evictItemEntry(typeName, victim.id, victim.ref);
        stats.evicted += 1;
      }
    }
  }
  return stats;
}

// ---- Sweep orchestration --------------------------------------------------

function runMemorySweep(): void {
  if (!G.memory.enabled) {
    cancelMemorySweepTimer();
    return;
  }

  const now = Date.now();
  emitLifecycle("memory:sweep:start", { timestamp: nowISO() });
  const colStats = pruneCollections(now);
  const itemStats = pruneItems(now);
  emitLifecycle("memory:sweep:finish", {
    timestamp: nowISO(),
    collections: colStats,
    items: itemStats,
  });

  if (G.memory.enabled && Number(G.memory.pruneIntervalMs) > 0) {
    G.memory.sweepTimer = setTimeout(() => {
      G.memory.sweepTimer = null;
      runMemorySweep();
    }, Number(G.memory.pruneIntervalMs));
  }
}

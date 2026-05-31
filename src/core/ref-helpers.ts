// ---------------------------------------------------------------------------
// verity-dl  –  Ref assignment, item ref management, level query tracking
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import { notify } from "./reactivity.js";
import { nowISO } from "./constants.js";
import type { ItemRef, ItemMeta } from "./types.js";

// ---- Ref assignment -------------------------------------------------------

/**
 * Mutates a ref's data and/or meta, then notifies all listeners.
 */
export function assignRef(
  ref: { data: unknown; meta: unknown },
  update: { data?: unknown; meta?: unknown },
): void {
  let changed = false;

  if (update.data !== undefined) {
    ref.data = update.data;
    changed = true;
  }

  if (update.meta !== undefined) {
    ref.meta = update.meta;
    changed = true;
  }

  if (changed) notify();
}

// ---- Staleness check ------------------------------------------------------

/**
 * Returns true if the given timestamp is older than `ms` milliseconds,
 * or if the timestamp is null/invalid.
 */
export function isStale(
  ts: string | null | undefined,
  ms: number,
): boolean {
  if (!ts) return true;

  try {
    return Date.now() - new Date(ts).getTime() > ms;
  } catch {
    return true;
  }
}

// ---- Item ref management --------------------------------------------------

/**
 * Ensures an item ref exists in the registry for the given type + id.
 * Creates a fresh ref if one doesn't exist; otherwise touches lastUsedAt.
 */
export function ensureItemRef(typeName: string, id: unknown): ItemRef {
  const T = G.types.get(typeName);
  if (!T) throw new Error(`Unknown type '${typeName}'`);

  const idStr = String(id);
  const now = nowISO();

  if (!T.items.has(idStr)) {
    T.items.set(idStr, {
      data: null,
      meta: {
        isLoading: false,
        error: null,
        activeQueryId: null,
        lastFetchedAny: null,
        levelStamps: Object.create(null) as Record<string, string | null>,
        lastUsedAt: now,
        activeLevelQueryIds: Object.create(null) as Record<
          string,
          string | undefined
        >,
      },
    });
  } else {
    const existing = T.items.get(idStr)!;
    if (existing.meta) {
      existing.meta.lastUsedAt = now;
    }
  }

  return T.items.get(idStr)!;
}

// ---- Active level query ID management -------------------------------------

export function cloneActiveLevelQueryIds(
  meta: ItemMeta | undefined,
): Record<string, string | undefined> {
  const src =
    meta &&
    typeof meta.activeLevelQueryIds === "object" &&
    meta.activeLevelQueryIds
      ? meta.activeLevelQueryIds
      : null;

  if (!src) return Object.create(null) as Record<string, string | undefined>;
  return { ...src };
}

export function setActiveLevelQueryId(
  meta: ItemMeta,
  canonicalLevel: string,
  qid: string,
): Record<string, string | undefined> {
  const next = cloneActiveLevelQueryIds(meta);
  next[canonicalLevel] = qid;
  return next;
}

export function clearActiveLevelQueryId(
  meta: ItemMeta,
  canonicalLevel: string,
  qid: string,
  { force = false }: { force?: boolean } = {},
): Record<string, string | undefined> {
  const prev =
    meta &&
    typeof meta.activeLevelQueryIds === "object" &&
    meta.activeLevelQueryIds
      ? meta.activeLevelQueryIds
      : null;

  if (!prev) {
    return Object.create(null) as Record<string, string | undefined>;
  }

  const current = prev[canonicalLevel];
  if (!force && current !== qid) {
    return { ...prev };
  }

  const next = { ...prev };
  delete next[canonicalLevel];
  return next;
}

export function hasAnyActiveLevels(meta: ItemMeta | undefined): boolean {
  const map =
    meta &&
    typeof meta.activeLevelQueryIds === "object" &&
    meta.activeLevelQueryIds
      ? meta.activeLevelQueryIds
      : null;

  if (!map) return false;

  for (const key of Object.keys(map)) {
    if (map[key]) return true;
  }

  return false;
}

export function isLevelActive(
  meta: ItemMeta | undefined,
  canonicalLevel: string,
  qid?: string,
): boolean {
  if (!meta || typeof meta !== "object") return false;

  const map = meta.activeLevelQueryIds;
  if (!map || typeof map !== "object") return false;

  if (qid === undefined) {
    return Object.prototype.hasOwnProperty.call(map, canonicalLevel);
  }

  return map[canonicalLevel] === qid;
}

// ---- Item meta finalization -----------------------------------------------

/**
 * Computes the final item meta after a fetch completes.
 * Clears the level query ID and optionally the global activeQueryId.
 */
export function finalizeItemMeta(
  ref: ItemRef,
  canonicalLevel: string,
  qid: string | null,
  overrides: Partial<ItemMeta> = {},
  { force = false }: { force?: boolean } = {},
): ItemMeta {
  const meta = ref.meta || ({} as ItemMeta);

  const nextActive = clearActiveLevelQueryId(
    meta,
    canonicalLevel,
    qid ?? "",
    { force },
  );

  const prevActiveQueryId = meta.activeQueryId ?? null;
  const matchedActiveQuery =
    force || (prevActiveQueryId !== null && prevActiveQueryId === qid);
  const nextActiveQueryId = matchedActiveQuery ? null : prevActiveQueryId;

  const next: ItemMeta = {
    ...meta,
    ...overrides,
    activeLevelQueryIds: nextActive,
    activeQueryId: Object.prototype.hasOwnProperty.call(
      overrides,
      "activeQueryId",
    )
      ? (overrides.activeQueryId ?? null)
      : nextActiveQueryId,
  };

  if (!Object.prototype.hasOwnProperty.call(overrides, "isLoading")) {
    if (matchedActiveQuery || next.activeQueryId == null) {
      next.isLoading = false;
    }
  }

  return next;
}

// ---- Parse timestamp helper -----------------------------------------------

export function parseMetaTimestamp(ts: unknown): number {
  if (!ts || typeof ts !== "string") return NaN;

  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : NaN;
}

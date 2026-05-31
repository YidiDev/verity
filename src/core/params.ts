// ---------------------------------------------------------------------------
// verity-dl  –  Params key generation and collection ref management
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import { nowISO, PARAM_DEFAULT_KEY, toLevelKey } from "./constants.js";
import { assignRef } from "./ref-helpers.js";
import { cloneParams } from "./clone-utils.js";
import type { CollectionRef } from "./types.js";

// ---- Params key -----------------------------------------------------------

function normalizeForKey(value: unknown): unknown {
  if (value === null) return null;

  if (Array.isArray(value)) return value.map(normalizeForKey);

  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(
      value as Record<string, unknown>,
    ).sort()) {
      sorted[key] = normalizeForKey(
        (value as Record<string, unknown>)[key],
      );
    }
    return sorted;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }

  return value;
}

/**
 * Generates a deterministic string key for a params value.
 * Returns PARAM_DEFAULT_KEY for null, undefined, or empty objects.
 */
export function paramsKey(params: unknown): string {
  if (params === undefined || params === null) return PARAM_DEFAULT_KEY;

  if (typeof params === "object" && !Array.isArray(params)) {
    const keys = Object.keys(params as Record<string, unknown>);
    if (!keys.length) return PARAM_DEFAULT_KEY;
  }

  try {
    return JSON.stringify(normalizeForKey(params));
  } catch {
    return PARAM_DEFAULT_KEY;
  }
}

// ---- Collection ref management --------------------------------------------

/**
 * Ensures a collection ref entry exists for the given collection + params.
 * Creates a fresh entry if one doesn't exist; otherwise touches lastUsedAt.
 */
export function ensureCollectionRefEntry(
  name: string,
  params: unknown,
): { ref: CollectionRef; key: string } {
  const C = G.collections.get(name);
  if (!C) throw new Error(`Unknown collection '${name}'`);

  const key = paramsKey(params);
  const now = nowISO();

  if (key === PARAM_DEFAULT_KEY) {
    const snapshot = cloneParams(params);

    if (snapshot !== undefined) {
      const prevKey = paramsKey(
        C.ref.meta ? C.ref.meta.paramsSnapshot : undefined,
      );
      const nextKey = paramsKey(snapshot);

      if (prevKey !== nextKey) {
        assignRef(C.ref, {
          meta: {
            ...C.ref.meta,
            paramsSnapshot: snapshot,
            paramsKey: key,
          },
        });
      }
    }

    if (C.ref && C.ref.meta) {
      C.ref.meta.lastUsedAt = now;
    }

    return { ref: C.ref, key };
  }

  if (!C.refs.has(key)) {
    const snapshot = cloneParams(params);

    const entry: CollectionRef = {
      data: { ids: [], count: 0, meta: null, items: null },
      meta: {
        isLoading: false,
        lastFetched: null,
        error: null,
        activeQueryId: null,
        paramsSnapshot: snapshot !== undefined ? snapshot : params,
        paramsKey: key,
        lastUsedAt: now,
      },
    };

    C.refs.set(key, entry);
  } else {
    const snapshot = cloneParams(params);

    if (snapshot !== undefined) {
      const existing = C.refs.get(key)!;
      const prevKey = paramsKey(
        existing.meta ? existing.meta.paramsSnapshot : undefined,
      );
      const nextKey = paramsKey(snapshot);

      if (prevKey !== nextKey) {
        assignRef(existing, {
          meta: {
            ...existing.meta,
            paramsSnapshot: snapshot,
            paramsKey: key,
          },
        });
      }
    }
  }

  const entry = C.refs.get(key)!;
  if (entry && entry.meta) {
    entry.meta.lastUsedAt = now;
  }

  return { ref: entry, key };
}

// ---- Composite cache key for in-flight dedup ------------------------------

/**
 * Builds a composite string key for in-flight item request deduplication.
 */
export function itemKey(
  typeName: string,
  id: unknown,
  levelName: string | null | undefined,
): string {
  return `${typeName}:${String(id)}:${toLevelKey(levelName)}`;
}

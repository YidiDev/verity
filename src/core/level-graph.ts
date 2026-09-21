// ---------------------------------------------------------------------------
// verity-dl  –  Level conversion graph application
// ---------------------------------------------------------------------------

import { LEVEL_DEFAULT, defaultCheck } from "./constants.js";
import {
  assignRef,
  finalizeItemMeta,
  latestItemFailureError,
} from "./ref-helpers.js";
import type { TypeEntry, ItemRef, ItemMeta } from "./types.js";

/**
 * Applies fetched data for a single level, then propagates through
 * the level conversion graph (BFS) to stamp any downstream levels
 * whose check functions are satisfied by the merged data.
 */
export function applyFetchedLevel(
  T: TypeEntry,
  _typeName: string,
  _id: unknown,
  ref: ItemRef,
  sourceLevelKey: string,
  data: unknown,
  timestamp: string,
  qid: string | null = null,
  options: { force?: boolean } = {},
): void {
  const nextData: Record<string, unknown> = {
    ...((ref.data || {}) as Record<string, unknown>),
    ...((data || {}) as Record<string, unknown>),
  };

  const nextLevelStamps: Record<string, string | null> = {
    ...ref.meta.levelStamps,
  };
  const nextLevelFailureStamps: Record<string, string | null> = {
    ...(ref.meta.levelFailureStamps || {}),
  };
  const nextLevelErrors: Record<string, string | null> = {
    ...(ref.meta.levelErrors || {}),
  };

  const levelSatisfies = (levelKey: string): boolean => {
    const cfg =
      levelKey === LEVEL_DEFAULT ? null : T.levels[levelKey];
    const checkFn =
      cfg && typeof cfg.check === "function" ? cfg.check : defaultCheck;

    try {
      return !!checkFn(nextData);
    } catch {
      return false;
    }
  };

  const visited = new Set<string>();
  const queue: string[] = [];

  const enqueueIfSatisfied = (levelKey: string): boolean => {
    if (visited.has(levelKey)) return false;
    visited.add(levelKey);

    if (!levelSatisfies(levelKey)) return false;

    nextLevelStamps[levelKey] = timestamp;
    delete nextLevelFailureStamps[levelKey];
    delete nextLevelErrors[levelKey];
    queue.push(levelKey);
    return true;
  };

  // Always stamp the source level
  nextLevelStamps[sourceLevelKey] = timestamp;
  delete nextLevelFailureStamps[sourceLevelKey];
  delete nextLevelErrors[sourceLevelKey];
  enqueueIfSatisfied(sourceLevelKey);

  // BFS through conversion edges
  while (queue.length) {
    const current = queue.shift()!;
    const edges = T.convertFrom.get(current);
    if (!edges || !edges.size) continue;

    for (const targetKey of edges) {
      if (targetKey === current) continue;
      enqueueIfSatisfied(targetKey);
    }
  }

  const overrides: Partial<ItemMeta> = {
    error: latestItemFailureError(
      ref.meta,
      nextLevelErrors,
      nextLevelFailureStamps,
    ),
    lastFetchedAny: timestamp,
    levelStamps: nextLevelStamps,
    levelFailureStamps: nextLevelFailureStamps,
    levelErrors: nextLevelErrors,
    isLoading: false, // Fetch completed successfully, clear loading state
  };

  const nextMeta = finalizeItemMeta(
    ref,
    sourceLevelKey,
    qid,
    overrides,
    options,
  );

  assignRef(ref, { data: nextData, meta: nextMeta });
}

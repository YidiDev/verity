// ---------------------------------------------------------------------------
// verity-dl  –  Level conversion graph application
// ---------------------------------------------------------------------------

import { LEVEL_DEFAULT, defaultCheck } from "./constants.js";
import { assignRef, finalizeItemMeta } from "./ref-helpers.js";
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
    queue.push(levelKey);
    return true;
  };

  // Always stamp the source level
  nextLevelStamps[sourceLevelKey] = timestamp;
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
    error: null,
    lastFetchedAny: timestamp,
    levelStamps: nextLevelStamps,
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

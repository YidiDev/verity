// ---------------------------------------------------------------------------
// verity-dl  –  Level conversion graph application
// ---------------------------------------------------------------------------

import { LEVEL_DEFAULT, defaultCheck, fromLevelKey } from "./constants.js";
import { G } from "./state.js";
import { itemKey } from "./params.js";
import {
  assignRef,
  finalizeItemMeta,
  latestItemError,
} from "./ref-helpers.js";
import type { TypeEntry, ItemRef, ItemMeta } from "./types.js";

/**
 * Applies fetched data for a single level, then propagates through
 * the level conversion graph (BFS) to stamp any downstream levels
 * whose check functions are satisfied by the merged data.
 */
export function applyFetchedLevel(
  T: TypeEntry,
  typeName: string,
  id: unknown,
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
  const stampedLevels = new Set<string>([sourceLevelKey]);
  const queue: string[] = [];

  const enqueueIfSatisfied = (levelKey: string): boolean => {
    if (visited.has(levelKey)) return false;
    visited.add(levelKey);

    if (!levelSatisfies(levelKey)) return false;

    nextLevelStamps[levelKey] = timestamp;
    delete nextLevelErrors[levelKey];
    stampedLevels.add(levelKey);
    queue.push(levelKey);
    return true;
  };

  // Always stamp the source level
  nextLevelStamps[sourceLevelKey] = timestamp;
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

  const nextFailedLevels = { ...(ref.meta.failedLevels || {}) };
  for (const levelKey of stampedLevels) {
    delete nextFailedLevels[levelKey];
    delete nextLevelErrors[levelKey];
  }
  const overrides: Partial<ItemMeta> = {
    error: latestItemError(nextLevelErrors),
    lastFetchedAny: timestamp,
    levelStamps: nextLevelStamps,
    levelErrors: nextLevelErrors,
    isLoading: false, // Fetch completed successfully, clear loading state
    failedLevels: nextFailedLevels,
  };

  const nextMeta = finalizeItemMeta(
    ref,
    sourceLevelKey,
    qid,
    overrides,
    options,
  );

  const activeLevelQueryIds = { ...nextMeta.activeLevelQueryIds };
  const supersededQueryIds = new Set<string>();
  for (const levelKey of stampedLevels) {
    const activeQid = activeLevelQueryIds[levelKey];
    if (activeQid && activeQid !== qid) supersededQueryIds.add(activeQid);
    delete activeLevelQueryIds[levelKey];
  }
  nextMeta.activeLevelQueryIds = activeLevelQueryIds;
  if (
    nextMeta.activeQueryId &&
    supersededQueryIds.has(nextMeta.activeQueryId)
  ) {
    nextMeta.activeQueryId = null;
  }
  nextMeta.isLoading = Object.keys(activeLevelQueryIds).some((levelKey) => {
    const bucket = G.inFlightItm.get(
      itemKey(typeName, id, fromLevelKey(levelKey)),
    );
    return bucket?.loud === true;
  });

  assignRef(ref, { data: nextData, meta: nextMeta });
}

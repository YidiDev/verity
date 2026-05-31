// ---------------------------------------------------------------------------
// verity-dl  –  Pure constants and utility functions
// ---------------------------------------------------------------------------

import type { MemoryDefaults } from "./types.js";

/** Returns the current time as an ISO-8601 string. */
export const nowISO = (): string => new Date().toISOString();

/** Generates a short, unique query-id (not cryptographically secure). */
export const genQid = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Generates a client identifier, preferring `crypto.randomUUID` when available. */
export const genClientId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
};

/** Stable client identifier for the lifetime of this module. */
export const CLIENT_ID: string = genClientId();

/** Default level check – always returns true. */
export const defaultCheck = (_data: unknown): boolean => true;

/** The canonical name used for the default (unnamed) level. */
export const LEVEL_DEFAULT = "default" as const;

/**
 * Converts a user-supplied level name (which may be `null` / `undefined`)
 * into a canonical level key suitable for map lookups.
 */
export const toLevelKey = (levelName: string | null | undefined): string =>
  levelName ? String(levelName) : LEVEL_DEFAULT;

/**
 * Converts a canonical level key back to the user-facing level name.
 * Returns `null` for the default level.
 */
export const fromLevelKey = (levelKey: string): string | null =>
  levelKey === LEVEL_DEFAULT ? null : levelKey;

/** The key used for the default (no-params) collection ref entry. */
export const PARAM_DEFAULT_KEY = "__default__" as const;

/** Default delay in milliseconds before flushing a bulk fetch queue. */
export const DEFAULT_BULK_DELAY_MS = 50;

/** Default window (ms) for considering an item "recently used" during resync. */
export const DEFAULT_RESYNC_ITEM_LAST_USED_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

/** Default memory-management configuration values. */
export const DEFAULT_MEMORY_CONFIG: MemoryDefaults = {
  enabled: true,
  pruneIntervalMs: 60_000,
  maxCollectionRefsPerCollection: 12,
  collectionEntryTtlMs: 10 * 60 * 1000,
  maxItemsPerType: 512,
  itemEntryTtlMs: 15 * 60 * 1000,
};

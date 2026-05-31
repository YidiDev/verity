// ---------------------------------------------------------------------------
// verity-dl  –  Type & collection registry
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import {
  PARAM_DEFAULT_KEY,
  LEVEL_DEFAULT,
  toLevelKey,
  defaultCheck,
} from "./constants.js";
import type {
  CreateTypeOptions,
  CreateCollectionOptions,
  LevelConversionEntry,
} from "./types.js";

/**
 * Registers a new data type with the given fetch function and options.
 */
export function createType(name: string, options: CreateTypeOptions): void {
  if (!name || typeof options.fetch !== "function")
    {throw new Error("createType requires name and fetch(id)");}
  if (G.types.has(name)) throw new Error(`Type '${name}' already exists`);

  const {
    fetch,
    bulkFetch = null,
    stalenessMs = 15_000,
    levelConversionMap = {},
    levels = {},
  } = options;

  const lvl: Record<string, { name: string; fetch: typeof fetch; check: (d: unknown) => boolean; stalenessMs: number; bulkFetch: typeof bulkFetch }> = {};
  const convertFrom = new Map<string, Set<string>>();
  const accepts = new Map<string, Set<string>>();

  const normalizeConversionTargets = (
    entry: LevelConversionEntry,
    implicitTargetKey: string | null,
  ): (string | null)[] => {
    if (entry == null) return [];
    if (Array.isArray(entry)) return entry;
    if (typeof entry === "string" && entry) return [entry];
    if (typeof entry === "object") {
      const obj = entry as { targets?: string[]; levels?: string[] };
      if (Array.isArray(obj.targets)) return obj.targets;
      if (Array.isArray(obj.levels)) return obj.levels;
    }
    if (entry === true) {
      if (implicitTargetKey != null) {
        return [implicitTargetKey === LEVEL_DEFAULT ? null : implicitTargetKey];
      }
      return [];
    }
    if (typeof entry === "function") {
      if (implicitTargetKey != null) {
        return [implicitTargetKey === LEVEL_DEFAULT ? null : implicitTargetKey];
      }
      return [];
    }
    if (implicitTargetKey != null) {
      return [implicitTargetKey === LEVEL_DEFAULT ? null : implicitTargetKey];
    }
    return [];
  };

  const registerConversions = (
    targetKey: string,
    map: Record<string, LevelConversionEntry>,
  ): void => {
    if (!map || typeof map !== "object") return;
    for (const [fromName, entry] of Object.entries(map)) {
      const targets = normalizeConversionTargets(entry, targetKey);
      if (!targets || !targets.length) continue;
      const fromKey = toLevelKey(fromName === LEVEL_DEFAULT ? null : fromName);
      let fromSet = convertFrom.get(fromKey);
      if (!fromSet) {
        fromSet = new Set<string>();
        convertFrom.set(fromKey, fromSet);
      }
      for (const targetName of targets) {
        const canonicalTarget = toLevelKey(
          targetName === LEVEL_DEFAULT ? null : targetName,
        );
        if (canonicalTarget === fromKey) continue;
        fromSet.add(canonicalTarget);
        let targetAccepts = accepts.get(canonicalTarget);
        if (!targetAccepts) {
          targetAccepts = new Set<string>();
          accepts.set(canonicalTarget, targetAccepts);
        }
        targetAccepts.add(fromKey);
      }
      if (!fromSet.size) {
        convertFrom.delete(fromKey);
      }
    }
  };

  for (const [levelName, cfg] of Object.entries(levels)) {
    if (!cfg || typeof cfg.fetch !== "function")
      {throw new Error(`Level '${levelName}' needs fetch`);}
    lvl[levelName] = {
      name: levelName,
      fetch: cfg.fetch,
      check: cfg.checkIfExists || defaultCheck,
      stalenessMs: cfg.stalenessMs ?? stalenessMs,
      bulkFetch: typeof cfg.bulkFetch === "function" ? cfg.bulkFetch : null,
    };
    if (cfg.levelConversionMap) {
      registerConversions(levelName, cfg.levelConversionMap);
    }
  }

  registerConversions(LEVEL_DEFAULT, levelConversionMap);

  G.types.set(name, {
    fetch,
    bulkFetch: typeof bulkFetch === "function" ? bulkFetch : null,
    stalenessMs,
    levels: lvl,
    items: new Map(),
    convertFrom,
    levelAccepts: accepts,
  });
}

/**
 * Registers a new collection with the given fetch function and options.
 */
export function createCollection(
  name: string,
  options: CreateCollectionOptions,
): void {
  if (!name || typeof options.fetch !== "function")
    {throw new Error("createCollection requires name and fetch()");}
  if (G.collections.has(name))
    {throw new Error(`Collection '${name}' already exists`);}

  const { fetch, stalenessMs = 15_000 } = options;

  const ref = {
    data: { ids: [] as unknown[], count: 0 },
    meta: {
      isLoading: false,
      lastFetched: null,
      error: null,
      activeQueryId: null,
      paramsSnapshot: {} as unknown,
      paramsKey: PARAM_DEFAULT_KEY,
      lastUsedAt: null,
    },
  };
  const refs = new Map([[PARAM_DEFAULT_KEY, ref]]);
  G.collections.set(name, { fetch, stalenessMs, ref, refs });
}

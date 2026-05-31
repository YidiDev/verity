// ---------------------------------------------------------------------------
// verity-dl  –  Re-export barrel for helper modules
//
// This file re-exports from the focused helper modules so that other
// core modules can import everything from a single path.
// ---------------------------------------------------------------------------

export {
  assignRef,
  isStale,
  ensureItemRef,
  cloneActiveLevelQueryIds,
  setActiveLevelQueryId,
  clearActiveLevelQueryId,
  hasAnyActiveLevels,
  isLevelActive,
  finalizeItemMeta,
  parseMetaTimestamp,
} from "./ref-helpers.js";

export {
  cloneParams,
  cloneForDiagnostics,
  deepFreeze,
  isPlainObject,
  deepEqualParams,
  paramsContainsSubset,
  matchesParamsSnapshot,
} from "./clone-utils.js";

export {
  paramsKey,
  ensureCollectionRefEntry,
  itemKey,
} from "./params.js";

export { applyFetchedLevel } from "./level-graph.js";

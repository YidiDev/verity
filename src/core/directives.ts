// ---------------------------------------------------------------------------
// verity-dl  –  Directive processing
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import {
  nowISO,
  LEVEL_DEFAULT,
  toLevelKey,
} from "./constants.js";
import { emitLifecycle } from "./lifecycle.js";
import {
  pruneDirectiveKeys,
  hasProcessedDirective,
  rememberDirectiveKey,
} from "./directive-idempotency.js";
import {
  ensureItemRef,
  ensureCollectionRefEntry,
  assignRef,
  applyFetchedLevel,
  cloneForDiagnostics,
  cloneParams,
  paramsKey,
  matchesParamsSnapshot,
} from "./helpers.js";
import {
  _startCollectionFetch,
  _startItemFetch,
  planFetchLevels,
} from "./fetchers.js";
import { fromLevelKey } from "./constants.js";
import type {
  Directive,
  DirectiveResult,
  ApplyDirectivesOptions,
  TypeEntry,
  ItemRef,
} from "./types.js";

// ---- Inline result application helpers ------------------------------------

function normalizeDirectiveLevelEntry(
  entry: unknown,
): { data: unknown; ts: string | null } | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, "data")) {
    const payload = obj.data;
    if (!payload || typeof payload !== "object") return null;
    return { data: payload, ts: typeof obj.ts === "string" ? obj.ts : null };
  }
  return {
    data: entry,
    ts: typeof obj.ts === "string" ? obj.ts : null,
  };
}

function applyCollectionDirectiveResult(
  name: string,
  result: DirectiveResult | undefined,
  params?: unknown,
): boolean {
  if (!result || typeof result !== "object") return false;
  const C = G.collections.get(name);
  if (!C) return false;
  const { ref } = ensureCollectionRefEntry(name, params);
  const payload = Object.prototype.hasOwnProperty.call(result, "data")
    ? result.data
    : result;
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;
  if (!Array.isArray(obj.ids)) return false;
  // Preserve all server response fields non-destructively
  const ids = (obj.ids as unknown[]).slice();
  const count = Number.isFinite(obj.count)
    ? Number(obj.count)
    : ids.length;
  const serverMeta = obj.meta !== undefined ? obj.meta : null;
  const items = obj.items !== undefined ? obj.items : null;
  const ts = typeof result.ts === "string" ? result.ts : nowISO();
  assignRef(ref, {
    data: { ids, count, meta: serverMeta, items },
    meta: {
      ...ref.meta,
      isLoading: false,
      error: null,
      lastFetched: ts,
      activeQueryId: null,
    },
  });
  return true;
}

function applyItemDirectiveResult(
  T: TypeEntry,
  typeName: string,
  id: unknown,
  ref: ItemRef,
  result: DirectiveResult | undefined,
): Set<string> {
  const satisfied = new Set<string>();
  if (!result || typeof result !== "object") return satisfied;
  const baseTs = typeof result.ts === "string" ? result.ts : nowISO();

  const applyLevel = (
    levelName: string | null | undefined,
    entry: unknown,
  ): void => {
    const normalized = normalizeDirectiveLevelEntry(entry);
    if (!normalized || !normalized.data) return;
    const canonical = ((): string | null => {
      if (!levelName) return LEVEL_DEFAULT;
      const key = toLevelKey(
        levelName === LEVEL_DEFAULT ? null : levelName,
      );
      if (key !== LEVEL_DEFAULT && !T.levels[key]) return null;
      return key;
    })();
    if (!canonical) return;
    const ts = typeof normalized.ts === "string" ? normalized.ts : baseTs;
    applyFetchedLevel(T, typeName, id, ref, canonical, normalized.data, ts, null, {
      force: true,
    });
    const after =
      ref.meta && typeof ref.meta.levelStamps === "object" && ref.meta.levelStamps
        ? ref.meta.levelStamps
        : {};
    for (const [levelKey, stamp] of Object.entries(after)) {
      if (stamp === ts) {
        satisfied.add(levelKey === LEVEL_DEFAULT ? LEVEL_DEFAULT : levelKey);
      }
    }
  };

  if (result.levels && typeof result.levels === "object") {
    for (const [levelName, entry] of Object.entries(result.levels)) {
      applyLevel(levelName, entry);
    }
  }

  if (
    typeof result.level === "string" &&
    Object.prototype.hasOwnProperty.call(result, "data")
  ) {
    applyLevel(result.level, { data: result.data, ts: result.ts });
  } else if (
    !result.levels &&
    Object.prototype.hasOwnProperty.call(result, "data")
  ) {
    applyLevel(null, { data: result.data, ts: result.ts });
  }

  return satisfied;
}

// ---- Main directive processor ---------------------------------------------

export function applyDirectives(
  directives: Directive[] = [],
  options: ApplyDirectivesOptions = {},
): Promise<unknown[]> {
  const opts =
    options && typeof options === "object" ? options : ({} as ApplyDirectivesOptions);
  const disableIdempotencyGuard = !!opts.disableIdempotencyGuard;
  const tasks: Promise<unknown>[] = [];
  const now = Date.now();
  pruneDirectiveKeys(now);

  for (const d of directives) {
    if (!d || !d.op) continue;
    const key =
      typeof d.idempotency_key === "string" && d.idempotency_key
        ? d.idempotency_key
        : null;
    const detail: Record<string, unknown> = {
      directive: cloneForDiagnostics(d),
      idempotencyKey: key,
      op: d.op,
      triggered: [] as unknown[],
      satisfied: false,
    };
    if (key) {
      if (!disableIdempotencyGuard && hasProcessedDirective(key, now)) {
        emitLifecycle("directive:skipped", {
          ...detail,
          reason: "idempotent",
        });
        continue;
      }
      rememberDirectiveKey(key, now);
    }

    if (d.op === "refresh_collection") {
      const satisfied = applyCollectionDirectiveResult(
        d.name!,
        d.result,
        d.params,
      );
      detail.satisfied = !!satisfied;
      if (!satisfied) {
        const C = G.collections.get(d.name!);
        if (d.params !== undefined) {
          const matchMode =
            typeof d.params_mode === "string" ? d.params_mode : null;
          if (matchMode === "contains" && C && C.refs && C.refs.size) {
            const seenKeys = new Set<string>();
            for (const entry of C.refs.values()) {
              const snapshot =
                entry && entry.meta ? entry.meta.paramsSnapshot : undefined;
              if (
                matchesParamsSnapshot(snapshot, d.params, "contains")
              ) {
                const k = paramsKey(snapshot);
                if (!seenKeys.has(k)) {
                  seenKeys.add(k);
                  const paramsClone = cloneParams(snapshot);
                  tasks.push(
                    _startCollectionFetch(d.name!, {
                      force: true,
                      params: snapshot,
                    }),
                  );
                  (detail.triggered as unknown[]).push({
                    kind: "collection",
                    name: d.name,
                    params: paramsClone,
                    mode: "contains",
                  });
                }
              }
            }
            if (!seenKeys.size) {
              const paramsClone = cloneParams(d.params);
              tasks.push(
                _startCollectionFetch(d.name!, {
                  force: true,
                  params: d.params,
                }),
              );
              (detail.triggered as unknown[]).push({
                kind: "collection",
                name: d.name,
                params: paramsClone,
              });
            }
          } else {
            const paramsClone = cloneParams(d.params);
            tasks.push(
              _startCollectionFetch(d.name!, {
                force: true,
                params: d.params,
              }),
            );
            (detail.triggered as unknown[]).push({
              kind: "collection",
              name: d.name,
              params: paramsClone,
            });
          }
        } else if (C && C.refs && C.refs.size) {
          for (const entry of C.refs.values()) {
            const paramsClone = cloneParams(entry.meta.paramsSnapshot);
            tasks.push(
              _startCollectionFetch(d.name!, {
                force: true,
                params: entry.meta.paramsSnapshot,
              }),
            );
            (detail.triggered as unknown[]).push({
              kind: "collection",
              name: d.name,
              params: paramsClone,
            });
          }
        } else {
          tasks.push(_startCollectionFetch(d.name!, { force: true }));
          (detail.triggered as unknown[]).push({
            kind: "collection",
            name: d.name,
            params: null,
          });
        }
      }
    } else if (d.op === "refresh_item") {
      if (!G.types.has(d.name!)) continue;

      const ref = ensureItemRef(d.name!, d.id);
      const T = G.types.get(d.name!)!;
      const satisfiedLevels = applyItemDirectiveResult(
        T,
        d.name!,
        d.id,
        ref,
        d.result,
      );
      detail.satisfied = satisfiedLevels.size > 0;
      detail.levelsSatisfied = Array.from(satisfiedLevels.values());
      const levelsToRefresh = new Set<string>();
      const stamps: Record<string, string | null> =
        ref.meta && ref.meta.levelStamps ? ref.meta.levelStamps : {};

      for (const [levelName, stamp] of Object.entries(stamps)) {
        if (!stamp) continue;
        const levelKey =
          levelName === LEVEL_DEFAULT ? LEVEL_DEFAULT : levelName;
        if (
          (levelKey === LEVEL_DEFAULT || T.levels[levelKey]) &&
          !satisfiedLevels.has(levelKey)
        ) {
          levelsToRefresh.add(levelKey);
        }
      }

      for (const [levelName, cfg] of Object.entries(T.levels)) {
        if (!cfg) continue;
        try {
          if (
            typeof cfg.check === "function" &&
            cfg.check(ref.data) &&
            !satisfiedLevels.has(levelName)
          ) {
            levelsToRefresh.add(levelName);
          }
        } catch {
          /* ignore */
        }
      }

      if (
        !levelsToRefresh.size &&
        !satisfiedLevels.has(LEVEL_DEFAULT)
      ) {
        if (ref.meta && ref.meta.lastFetchedAny) {
          levelsToRefresh.add(LEVEL_DEFAULT);
        } else if (ref.data) {
          levelsToRefresh.add(LEVEL_DEFAULT);
        }
      }

      if (!levelsToRefresh.size) continue;

      const fetchPlan = planFetchLevels(T, levelsToRefresh).filter(
        (levelKey) => !satisfiedLevels.has(levelKey),
      );
      if (!fetchPlan.length) continue;
      for (const levelKey of fetchPlan) {
        const level = fromLevelKey(levelKey);
        tasks.push(
          _startItemFetch(d.name!, d.id, level, {
            force: true,
            loud: true,
          }),
        );
        (detail.triggered as unknown[]).push({
          kind: "item",
          name: d.name,
          id: d.id,
          level,
        });
      }
    } else if (d.op === "invalidate" && Array.isArray(d.targets)) {
      tasks.push(applyDirectives(d.targets, opts));
      (detail.triggered as unknown[]).push({
        kind: "cascade",
        count: d.targets.length,
      });
    } else if (d.op === "force_reload_page") {
      if (typeof window !== "undefined" && window.location) {
        const hard = (d as unknown as Record<string, unknown>).hard === true;
        (detail.triggered as unknown[]).push({ kind: "page_reload", hard });
        emitLifecycle("directive:processed", detail);

        if (hard) {
          try {
            window.location.reload();
          } catch {
            window.location.reload();
          }
        } else {
          window.location.reload();
        }

        return Promise.resolve([]);
      } else {
        (detail.triggered as unknown[]).push({
          kind: "page_reload",
          skipped: "not_browser",
        });
      }
    }

    emitLifecycle("directive:processed", detail);
  }

  return Promise.all(tasks);
}

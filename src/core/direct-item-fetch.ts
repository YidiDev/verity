import { nowISO } from "./constants.js";
import { emitLifecycle } from "./lifecycle.js";
import {
  applyFetchedLevel,
  assignRef,
  finalizeItemFailureMeta,
  isLevelActive,
} from "./helpers.js";
import type { ItemFetchFn, ItemRef, TypeEntry } from "./types.js";

interface DirectItemFetchOptions {
  type: TypeEntry;
  typeName: string;
  id: unknown;
  levelArg: string;
  canonicalLevel: string;
  eventBase: Record<string, unknown>;
  ref: ItemRef;
  qid: string;
  fetcher: ItemFetchFn;
}

export async function runDirectItemFetch({
  type,
  typeName,
  id,
  levelArg,
  canonicalLevel,
  eventBase,
  ref,
  qid,
  fetcher,
}: DirectItemFetchOptions): Promise<void> {
  try {
    const data = await fetcher(id, levelArg);
    if (!isLevelActive(ref.meta, canonicalLevel, qid)) {
      emitLifecycle("item:fetch:aborted", {
        ...eventBase,
        qid,
        reason: "superseded",
      });
      return;
    }
    applyFetchedLevel(
      type,
      typeName,
      id,
      ref,
      canonicalLevel,
      data,
      nowISO(),
      qid,
    );
    emitLifecycle("item:fetch:success", {
      ...eventBase,
      qid,
      strategy: "direct",
    });
  } catch (error) {
    if (!isLevelActive(ref.meta, canonicalLevel, qid)) {
      emitLifecycle("item:fetch:aborted", {
        ...eventBase,
        qid,
        reason: "superseded",
      });
      return;
    }
    assignRef(ref, {
      meta: finalizeItemFailureMeta(
        ref,
        typeName,
        id,
        canonicalLevel,
        qid,
        error,
      ),
    });
    emitLifecycle("item:fetch:error", {
      ...eventBase,
      qid,
      error: String(error),
      strategy: "direct",
    });
  }
}

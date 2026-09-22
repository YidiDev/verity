import { nowISO } from "./constants.js";
import { _startCollectionFetch, _startItemFetch } from "./fetchers.js";
import { scheduleMemorySweep } from "./memory.js";
import {
  ensureCollectionRefEntry,
  normalizeCollectionOptions,
  paramsKey,
} from "./params.js";
import { ensureItemRef } from "./ref-helpers.js";
import { G } from "./state.js";
import type {
  CollectionRef,
  FetchCollectionOptions,
  FetchItemOptions,
  ItemRef,
} from "./types.js";

export function fetchCollection(
  name: string,
  opts: FetchCollectionOptions = {},
): CollectionRef {
  const normalizedOpts = normalizeCollectionOptions(opts);
  const ref = getCollectionRef(name, opts);
  _startCollectionFetch(name, normalizedOpts);
  return ref;
}

export function getCollectionRef(
  name: string,
  opts: FetchCollectionOptions = {},
): CollectionRef {
  const { params } = normalizeCollectionOptions(opts);
  const { ref } = ensureCollectionRefEntry(name, params);
  ref.meta.lastUsedAt = nowISO();
  scheduleMemorySweep();
  return ref;
}

export function findCollectionRef(
  name: string,
  opts: FetchCollectionOptions = {},
): CollectionRef | null {
  const C = G.collections.get(name);
  if (!C) throw new Error(`Unknown collection '${name}'`);
  const { params } = normalizeCollectionOptions(opts);
  return C.refs.get(paramsKey(params)) ?? null;
}

export function fetchItem(
  typeName: string,
  id: unknown,
  levelName: string | null = null,
  opts: FetchItemOptions = {},
): ItemRef {
  const ref = getItemRef(typeName, id);
  _startItemFetch(typeName, id, levelName, {
    loud: !opts.silent,
    force: !!opts.force,
  });
  return ref;
}

export function getItemRef(typeName: string, id: unknown): ItemRef {
  const ref = ensureItemRef(typeName, id);
  ref.meta.lastUsedAt = nowISO();
  scheduleMemorySweep();
  return ref;
}

export function findItemRef(typeName: string, id: unknown): ItemRef | null {
  const T = G.types.get(typeName);
  if (!T) throw new Error(`Unknown type '${typeName}'`);
  return T.items.get(String(id)) ?? null;
}

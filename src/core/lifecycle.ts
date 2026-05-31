// ---------------------------------------------------------------------------
// verity-dl  –  Lifecycle event emission & subscription
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import { nowISO } from "./constants.js";
import { cloneForDiagnostics } from "./helpers.js";
import type { LifecyclePayload } from "./types.js";

/**
 * Emits a lifecycle event to all registered handlers for the given
 * event name, plus any wildcard (`*`) handlers.
 */
export function emitLifecycle(
  eventName: string,
  detail: Record<string, unknown> = {},
): void {
  if (!eventName) return;
  const name = String(eventName);
  const clonedDetail = cloneForDiagnostics(detail);
  const payload: LifecyclePayload = Object.freeze({
    event: name,
    detail: clonedDetail,
    timestamp: nowISO(),
  });
  const registry = G.devtools.lifecycle.byEvent;

  const dispatch = (bucket: Map<number, (p: LifecyclePayload) => void> | undefined): void => {
    if (!bucket || !bucket.size) return;
    for (const handler of bucket.values()) {
      try {
        handler(payload);
      } catch {
        /* ignore listener errors */
      }
    }
  };

  dispatch(registry.get(name));
  dispatch(registry.get("*"));
}

/**
 * Subscribes to lifecycle events. Returns an unsubscribe function.
 *
 * Use `"*"` as the event name to receive all events.
 */
export function onLifecycle(
  eventName: string,
  callback: (payload: LifecyclePayload) => void,
): () => void {
  if (!eventName || typeof callback !== "function") return () => {};
  const name = eventName === "*" ? "*" : String(eventName);
  const registry = G.devtools.lifecycle.byEvent;
  let bucket = registry.get(name);
  if (!bucket) {
    bucket = new Map();
    registry.set(name, bucket);
  }
  const token = G.devtools.lifecycle.nextId++;
  bucket.set(token, callback);
  return () => {
    const target = registry.get(name);
    if (!target) return;
    target.delete(token);
    if (!target.size) {
      registry.delete(name);
    }
  };
}

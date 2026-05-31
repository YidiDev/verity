// ---------------------------------------------------------------------------
// verity-dl  –  Directive idempotency registry
// ---------------------------------------------------------------------------

import { G } from "./state.js";

/**
 * Prunes expired and excess entries from the directive idempotency map.
 */
export function pruneDirectiveKeys(now: number = Date.now()): void {
  const { seen, ttlMs, maxSize } = G.directiveRegistry;
  if (!seen.size) return;
  if (ttlMs) {
    for (const [key, ts] of seen) {
      if (now - ts > ttlMs) {
        seen.delete(key);
      }
    }
  }
  if (maxSize && seen.size > maxSize) {
    const entriesByAge = Array.from(seen.entries()).sort((a, b) => a[1] - b[1]);
    for (const [key] of entriesByAge) {
      if (seen.size <= maxSize) break;
      seen.delete(key);
    }
  }
}

/**
 * Returns true if the given idempotency key has already been processed
 * and has not expired.
 */
export function hasProcessedDirective(
  key: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!key) return false;
  const ts = G.directiveRegistry.seen.get(key);
  if (ts === undefined) return false;
  if (G.directiveRegistry.ttlMs && now - ts > G.directiveRegistry.ttlMs) {
    G.directiveRegistry.seen.delete(key);
    return false;
  }
  return true;
}

/**
 * Records an idempotency key as processed. Prunes afterwards.
 */
export function rememberDirectiveKey(
  key: string | null | undefined,
  now: number = Date.now(),
): void {
  if (!key) return;
  G.directiveRegistry.seen.set(key, now);
  pruneDirectiveKeys(now);
}

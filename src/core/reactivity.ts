// ---------------------------------------------------------------------------
// verity-dl  –  Reactivity bridge (onChange / notify)
// ---------------------------------------------------------------------------

import { G } from "./state.js";

/**
 * Registers a change listener that is called whenever any ref data
 * is mutated (via `assignRef`).  Returns an unsubscribe function.
 */
export function onChange(cb: () => void): () => void {
  if (typeof cb !== "function") return () => {};
  G.listeners.push(cb);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const idx = G.listeners.indexOf(cb);
    if (idx >= 0) G.listeners.splice(idx, 1);
  };
}

/** Registers a listener for changes to one item or collection ref. */
export function onRefChange(ref: object, cb: () => void): () => void {
  if (!ref || typeof ref !== "object" || typeof cb !== "function") {
    return () => {};
  }

  let listeners = G.refListeners.get(ref);
  if (!listeners) {
    listeners = new Set();
    G.refListeners.set(ref, listeners);
  }
  const listener = (): void => cb();
  listeners.add(listener);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(listener);
    if (!listeners.size) G.refListeners.delete(ref);
  };
}

/** Prevents an actively observed ref from being evicted. */
export function retainRef(ref: object): void {
  G.refRetainers.set(ref, (G.refRetainers.get(ref) ?? 0) + 1);
}

/** Releases one active-observer hold on a ref. */
export function releaseRef(ref: object): void {
  const count = G.refRetainers.get(ref) ?? 0;
  if (count <= 1) {
    G.refRetainers.delete(ref);
  } else {
    G.refRetainers.set(ref, count - 1);
  }
}

export function isRefRetained(ref: object): boolean {
  return (G.refRetainers.get(ref) ?? 0) > 0;
}

/** Returns the current change revision for one ref. */
export function getRefRevision(ref: object): number {
  return G.refRevisions.get(ref) ?? 0;
}

/**
 * Broadcasts a change notification to all registered listeners.
 * Called internally by `assignRef` whenever ref data/meta changes.
 */
export function notify(ref?: object): void {
  if (ref) {
    G.refRevisions.set(ref, getRefRevision(ref) + 1);
    const listeners = G.refListeners.get(ref);
    if (listeners) {
      for (const cb of [...listeners]) {
        try {
          cb();
        } catch {
          /* ignore listener errors */
        }
      }
    }
  }

  for (const cb of G.listeners) {
    try {
      cb();
    } catch {
      /* ignore listener errors */
    }
  }
}

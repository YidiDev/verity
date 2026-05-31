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

/**
 * Broadcasts a change notification to all registered listeners.
 * Called internally by `assignRef` whenever ref data/meta changes.
 */
export function notify(): void {
  for (const cb of G.listeners) {
    try {
      cb();
    } catch {
      /* ignore listener errors */
    }
  }
}

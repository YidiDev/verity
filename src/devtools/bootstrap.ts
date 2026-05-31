// ---------------------------------------------------------------------------
// verity-dl devtools – Bootstrap / entry point
// ---------------------------------------------------------------------------

import { resolveAdapter, resolveAssetUrl } from "./adapter.js";
import { createStore, createLayout, readStoredLayout, applyStoredLayout } from "./store.js";
import { createElements, PANELS } from "./dom.js";
import { wireInteractions } from "./interactions.js";

/**
 * Initialises the devtools panel. Safe to call multiple times -- subsequent
 * calls simply show the existing panel.
 */
export function initDevtools(): void {
  if (window.__VERITY_DL_DEVTOOLS__) {
    try {
      window.__VERITY_DL_DEVTOOLS__.show();
    } catch {
      /* ignore */
    }
    return;
  }

  const adapter = resolveAdapter();
  if (!adapter || typeof adapter.devtools !== "function") {
    // eslint-disable-next-line no-console
    console.warn("VerityDL devtools: DL.devtools() is unavailable.");
    return;
  }

  // Inject stylesheet
  const head = document.head ?? document.getElementsByTagName("head")[0];
  if (head) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = resolveAssetUrl("devtools.css");
    head.appendChild(link);
  }

  // Initialise state
  const store = createStore();
  const layout = createLayout();

  const initialLayout = readStoredLayout();
  if (initialLayout) {
    applyStoredLayout(initialLayout, layout);
  }

  // Create DOM
  const els = createElements();

  // Wire everything together and mount
  wireInteractions(adapter, store, layout, els, PANELS);
}

/**
 * Auto-start: if the DOM is still loading, defer; otherwise run immediately.
 */
export function autoStart(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDevtools, { once: true });
  } else {
    initDevtools();
  }
}

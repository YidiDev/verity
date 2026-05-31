// ---------------------------------------------------------------------------
// verity-dl devtools – Layout application, state mutators, detach/dock
// ---------------------------------------------------------------------------

import type {
  DevtoolsLayout,
  DevtoolsElements,
} from "./types.js";
import {
  clampWithinViewport,
  storagePersist,
  readStoredLayout,
  applyStoredLayout,
} from "./store.js";
import { resolveAssetUrl } from "./adapter.js";

// ---- Layout application --------------------------------------------------

function updateButtonLabels(
  layout: DevtoolsLayout,
  els: DevtoolsElements,
): void {
  if (els.detachBtn) {
    els.detachBtn.textContent = layout.detached ? "Dock" : "Pop out";
  }
  if (els.toggleBtn) {
    els.toggleBtn.textContent = layout.hidden ? "Show" : "Hide";
    els.toggleBtn.setAttribute(
      "title",
      layout.hidden ? "Show the devtools" : "Hide the devtools",
    );
  }
}

export function applyLayout(
  layout: DevtoolsLayout,
  els: DevtoolsElements,
): void {
  const hideContainer = layout.hidden || layout.minimized;
  els.container.classList.toggle("is-hidden", hideContainer);
  els.container.classList.toggle("is-detached", layout.detached);

  if (els.minimizeBtn) {
    const disableMini = layout.detached;
    els.minimizeBtn.disabled = disableMini;
    els.minimizeBtn.setAttribute(
      "title",
      disableMini
        ? "Mini view is unavailable while the devtools are popped out. Dock to enable it again."
        : "Switch to the floating mini devtools view.",
    );
  }

  if (layout.detached) {
    els.container.style.position = "relative";
    els.container.style.left = "";
    els.container.style.top = "";
    els.container.style.right = "";
    els.container.style.bottom = "";
    els.container.style.width = "";
    els.container.style.height = "";
  } else {
    els.container.style.position = "fixed";
    if (layout.manualPosition && layout.position) {
      const { left, top } = clampWithinViewport(
        layout.position.left,
        layout.position.top,
        els.container,
      );
      els.container.style.left = `${left}px`;
      els.container.style.top = `${top}px`;
      els.container.style.right = "auto";
      els.container.style.bottom = "auto";
    } else {
      els.container.style.left = "";
      els.container.style.top = "";
      els.container.style.right = "";
      els.container.style.bottom = "";
    }
    if (layout.size) {
      els.container.style.width = `${layout.size.width}px`;
      els.container.style.height = `${layout.size.height}px`;
    } else {
      els.container.style.width = "";
      els.container.style.height = "";
    }
  }

  const visibleMini =
    !layout.hidden && layout.minimized && !layout.detached;
  els.mini.classList.toggle("is-visible", visibleMini);
  if (visibleMini && layout.miniPosition) {
    els.mini.style.left = `${layout.miniPosition.left}px`;
    els.mini.style.top = `${layout.miniPosition.top}px`;
    els.mini.style.right = "auto";
    els.mini.style.bottom = "auto";
  } else {
    els.mini.style.left = "";
    els.mini.style.top = "";
    els.mini.style.right = "";
    els.mini.style.bottom = "";
  }

  updateButtonLabels(layout, els);
}

// ---- State mutators ------------------------------------------------------

export function setMinimized(
  value: boolean,
  layout: DevtoolsLayout,
  els: DevtoolsElements,
): void {
  const next = !!value;
  if (next && layout.detached) return;
  layout.minimized = next;
  if (next) layout.hidden = false;
  applyLayout(layout, els);
  if (next) {
    try {
      els.mini.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }
  storagePersist(layout);
}

export function setHidden(
  value: boolean,
  layout: DevtoolsLayout,
  els: DevtoolsElements,
): void {
  layout.hidden = !!value;
  if (layout.hidden) layout.minimized = false;
  applyLayout(layout, els);
  storagePersist(layout);
}

// ---- Detach / dock -------------------------------------------------------

export interface DetachState {
  detachedWindow: Window | null;
  detachCleanup: (() => void) | null;
}

export function dock(
  layout: DevtoolsLayout,
  els: DevtoolsElements,
  ds: DetachState,
  closeWindow = true,
): void {
  if (!layout.detached) return;
  layout.detached = false;
  if (ds.detachCleanup) {
    try {
      ds.detachCleanup();
    } catch {
      /* ignore */
    }
    ds.detachCleanup = null;
  }
  document.body.appendChild(els.container);
  const restored = readStoredLayout();
  if (restored) {
    applyStoredLayout(restored, layout);
  }
  if (closeWindow && ds.detachedWindow && !ds.detachedWindow.closed) {
    try {
      ds.detachedWindow.close();
    } catch {
      /* ignore */
    }
  }
  ds.detachedWindow = null;
  applyLayout(layout, els);
  storagePersist(layout);
}

export function detach(
  layout: DevtoolsLayout,
  els: DevtoolsElements,
  ds: DetachState,
): void {
  if (layout.detached) return;
  storagePersist(layout);
  const win = window.open("", "", "width=720,height=640");
  if (!win || win.closed) {
    // eslint-disable-next-line no-console
    console.warn(
      "VerityDL devtools: Unable to open a separate window. The popup may have been blocked.",
    );
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  win.document.write(
    `<!DOCTYPE html><html><head><title>VerityDL Devtools</title></head><body></body></html>`,
  );
  win.document.close();
  const doc = win.document;
  doc.body.style.margin = "0";
  doc.body.style.background = "rgba(15, 23, 42, 0.98)";
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = resolveAssetUrl("devtools.css");
  doc.head.appendChild(link);
  doc.body.appendChild(els.container);
  const handleUnload = (): void => {
    dock(layout, els, ds, false);
  };
  win.addEventListener("beforeunload", handleUnload);
  ds.detachCleanup = () => {
    try {
      win.removeEventListener("beforeunload", handleUnload);
    } catch {
      /* ignore */
    }
  };
  ds.detachedWindow = win;
  layout.detached = true;
  layout.hidden = false;
  layout.minimized = false;
  layout.manualPosition = false;
  layout.position = null;
  layout.size = null;
  applyLayout(layout, els);
  try {
    win.focus();
  } catch {
    /* ignore */
  }
}

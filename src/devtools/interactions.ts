// ---------------------------------------------------------------------------
// verity-dl devtools – Interaction wiring (drag, resize, events, keyboard)
// ---------------------------------------------------------------------------

import type {
  DLAdapter,
  DevtoolsLayout,
  DevtoolsStore,
  DevtoolsElements,
  DragState,
  ResizeState,
  PanelDefinition,
} from "./types.js";
import {
  RESIZE_LIMITS,
  clampWithinViewport,
  storagePersist,
} from "./store.js";
import { updateSnapshot, handleLifecycle, replayDirective } from "./events.js";
import { renderActivePanel } from "./panels.js";
import {
  applyLayout,
  setMinimized,
  setHidden,
  dock,
  detach,
} from "./layout.js";
import type { DetachState } from "./layout.js";

/**
 * Wires all interaction handlers (drag, resize, tabs, keyboard shortcuts)
 * and mounts the devtools DOM into the page. Returns a teardown function.
 */
export function wireInteractions(
  adapter: DLAdapter,
  store: DevtoolsStore,
  layout: DevtoolsLayout,
  els: DevtoolsElements,
  panels: PanelDefinition[],
): () => void {
  const ds: DetachState = { detachedWindow: null, detachCleanup: null };

  // --- Scheduling helpers ---
  const doRender = (): void => {
    renderActivePanel(els.panelNodes, store, els.mini);
  };
  const scheduleRender = (): void => {
    if (store.renderPending) return;
    store.renderPending = true;
    const exec = (): void => {
      store.renderPending = false;
      doRender();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(exec);
    } else {
      setTimeout(exec, 16);
    }
  };
  const doUpdateSnapshot = (): void => {
    updateSnapshot(adapter, store, scheduleRender);
  };
  const queueSnapshotRefresh = (): void => {
    if (store.snapshotRefreshPending) return;
    store.snapshotRefreshPending = true;
    const exec = (): void => {
      store.snapshotRefreshPending = false;
      doUpdateSnapshot();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(exec);
    } else {
      setTimeout(exec, 16);
    }
  };

  // --- Header drag ---
  let headerDragState: DragState | null = null;
  els.header.addEventListener("pointerdown", (event) => {
    if (layout.detached || event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(".vdl-header-actions")
    ) {
      return;
    }
    const rect = els.container.getBoundingClientRect();
    headerDragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    try {
      els.header.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    els.header.classList.add("is-dragging");
    els.container.classList.add("is-dragging");
    event.preventDefault();
  });
  const finishHeaderDrag = (event: PointerEvent): void => {
    if (
      !headerDragState ||
      (event.pointerId != null &&
        event.pointerId !== headerDragState.pointerId)
    ) {
      return;
    }
    try {
      els.header.releasePointerCapture(headerDragState.pointerId);
    } catch {
      /* ignore */
    }
    headerDragState = null;
    els.header.classList.remove("is-dragging");
    els.container.classList.remove("is-dragging");
    storagePersist(layout);
  };
  els.header.addEventListener("pointermove", (event) => {
    if (!headerDragState || event.pointerId !== headerDragState.pointerId) {
      return;
    }
    const next = clampWithinViewport(
      event.clientX - headerDragState.offsetX,
      event.clientY - headerDragState.offsetY,
      els.container,
    );
    layout.position = next;
    layout.manualPosition = true;
    els.container.style.left = `${next.left}px`;
    els.container.style.top = `${next.top}px`;
    els.container.style.right = "auto";
    els.container.style.bottom = "auto";
  });
  els.header.addEventListener("pointerup", finishHeaderDrag);
  els.header.addEventListener("pointercancel", finishHeaderDrag);

  // --- Mini drag ---
  let miniDragState: DragState | null = null;
  let miniWasDragged = false;
  els.mini.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    miniWasDragged = false;
    const rect = els.mini.getBoundingClientRect();
    miniDragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    try {
      els.mini.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    els.mini.classList.add("is-dragging");
    event.preventDefault();
  });
  const finishMiniDrag = (event: PointerEvent): void => {
    if (
      !miniDragState ||
      (event.pointerId != null &&
        event.pointerId !== miniDragState.pointerId)
    ) {
      return;
    }
    try {
      els.mini.releasePointerCapture(miniDragState.pointerId);
    } catch {
      /* ignore */
    }
    els.mini.classList.remove("is-dragging");
    miniDragState = null;
    storagePersist(layout);
  };
  els.mini.addEventListener("pointermove", (event) => {
    if (!miniDragState || event.pointerId !== miniDragState.pointerId) return;
    miniWasDragged = true;
    const next = clampWithinViewport(
      event.clientX - miniDragState.offsetX,
      event.clientY - miniDragState.offsetY,
      els.mini,
      8,
    );
    layout.miniPosition = next;
    els.mini.style.left = `${next.left}px`;
    els.mini.style.top = `${next.top}px`;
    els.mini.style.right = "auto";
    els.mini.style.bottom = "auto";
  });
  els.mini.addEventListener("pointerup", finishMiniDrag);
  els.mini.addEventListener("pointercancel", finishMiniDrag);
  els.mini.addEventListener("click", (event) => {
    if (miniWasDragged) {
      event.preventDefault();
      event.stopPropagation();
      miniWasDragged = false;
      return;
    }
    setMinimized(false, layout, els);
  });

  // --- Window resize ---
  const handleResize = (): void => {
    if (!layout.detached && layout.manualPosition && layout.position) {
      const prev = layout.position;
      const next = clampWithinViewport(
        layout.position.left,
        layout.position.top,
        els.container,
      );
      layout.position = next;
      els.container.style.left = `${next.left}px`;
      els.container.style.top = `${next.top}px`;
      els.container.style.right = "auto";
      els.container.style.bottom = "auto";
      if (next.left !== prev.left || next.top !== prev.top) {
        storagePersist(layout);
      }
    }
    if (!layout.detached && layout.size) {
      const rect = els.container.getBoundingClientRect();
      const margin = RESIZE_LIMITS.margin;
      const maxW = Math.max(
        RESIZE_LIMITS.minWidth,
        window.innerWidth - rect.left - margin,
      );
      const maxH = Math.max(
        RESIZE_LIMITS.minHeight,
        window.innerHeight - rect.top - margin,
      );
      const width = Math.min(layout.size.width, maxW);
      const height = Math.min(layout.size.height, maxH);
      if (width !== layout.size.width || height !== layout.size.height) {
        layout.size = { width, height };
        storagePersist(layout);
      }
      els.container.style.width = `${layout.size.width}px`;
      els.container.style.height = `${layout.size.height}px`;
    }
    if (
      !layout.detached &&
      layout.miniPosition &&
      !layout.hidden &&
      layout.minimized
    ) {
      const prevM = layout.miniPosition;
      const nextM = clampWithinViewport(
        layout.miniPosition.left,
        layout.miniPosition.top,
        els.mini,
        8,
      );
      layout.miniPosition = nextM;
      els.mini.style.left = `${nextM.left}px`;
      els.mini.style.top = `${nextM.top}px`;
      els.mini.style.right = "auto";
      els.mini.style.bottom = "auto";
      if (prevM.left !== nextM.left || prevM.top !== nextM.top) {
        storagePersist(layout);
      }
    }
  };
  window.addEventListener("resize", handleResize);

  // --- Resize handle ---
  let resizeState: ResizeState | null = null;
  els.resizeHandle.addEventListener("pointerdown", (event) => {
    if (layout.detached || layout.minimized || layout.hidden) return;
    if (event.button !== 0) return;
    const rect = els.container.getBoundingClientRect();
    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      originLeft: rect.left,
      originTop: rect.top,
    };
    els.container.classList.add("is-resizing");
    els.resizeHandle.classList.add("is-active");
    try {
      els.resizeHandle.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    event.preventDefault();
  });
  const finishResize = (event: PointerEvent): void => {
    if (
      !resizeState ||
      (event.pointerId != null && event.pointerId !== resizeState.pointerId)
    ) {
      return;
    }
    try {
      els.resizeHandle.releasePointerCapture(resizeState.pointerId);
    } catch {
      /* ignore */
    }
    resizeState = null;
    els.container.classList.remove("is-resizing");
    els.resizeHandle.classList.remove("is-active");
    applyLayout(layout, els);
    storagePersist(layout);
  };
  els.resizeHandle.addEventListener("pointermove", (event) => {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    const margin = RESIZE_LIMITS.margin;
    const deltaX = event.clientX - resizeState.startX;
    const deltaY = event.clientY - resizeState.startY;
    const maxW = Math.max(
      RESIZE_LIMITS.minWidth,
      window.innerWidth - resizeState.originLeft - margin,
    );
    const maxH = Math.max(
      RESIZE_LIMITS.minHeight,
      window.innerHeight - resizeState.originTop - margin,
    );
    const width = Math.min(
      Math.max(RESIZE_LIMITS.minWidth, resizeState.startWidth + deltaX),
      maxW,
    );
    const height = Math.min(
      Math.max(RESIZE_LIMITS.minHeight, resizeState.startHeight + deltaY),
      maxH,
    );
    layout.size = { width, height };
    els.container.style.width = `${width}px`;
    els.container.style.height = `${height}px`;
  });
  els.resizeHandle.addEventListener("pointerup", finishResize);
  els.resizeHandle.addEventListener("pointercancel", finishResize);

  // --- Header actions (detach/minimize/toggle) ---
  els.header.addEventListener("click", (event) => {
    const target =
      event.target instanceof HTMLElement
        ? event.target.closest("[data-action]")
        : null;
    if (!(target instanceof HTMLElement)) return;
    const action = target.getAttribute("data-action");
    if (!action) return;
    if (action === "detach") {
      event.preventDefault();
      if (layout.detached) {
        dock(layout, els, ds);
      } else {
        detach(layout, els, ds);
      }
    } else if (action === "minimize") {
      event.preventDefault();
      setMinimized(true, layout, els);
    } else if (action === "toggle") {
      event.preventDefault();
      setHidden(!layout.hidden, layout, els);
    }
  });

  // --- Tab navigation ---
  els.nav.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const panel = target.getAttribute("data-panel");
    if (!panel) return;
    store.activePanel = panel;
    doRender();
    for (const btn of els.nav.querySelectorAll(".vdl-tab")) {
      btn.classList.toggle(
        "is-active",
        btn.getAttribute("data-panel") === panel,
      );
    }
  });

  // --- Directive replay ---
  els.content.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const replayIndex = target.getAttribute("data-replay");
    if (replayIndex != null) {
      replayDirective(Number(replayIndex), store, adapter);
    }
  });

  // --- Mount DOM ---
  document.body.appendChild(els.container);
  document.body.appendChild(els.mini);
  applyLayout(layout, els);

  // --- Subscribe to adapter events ---
  const lifecycleUnsub = adapter.onLifecycle
    ? adapter.onLifecycle("*", (payload) => {
        handleLifecycle(payload, store, scheduleRender, queueSnapshotRefresh);
      })
    : () => {};
  const changeUnsub = adapter.onChange
    ? adapter.onChange(doUpdateSnapshot)
    : () => {};
  doUpdateSnapshot();

  // --- Initial tab highlight ---
  panels.forEach((panel) => {
    const btn = els.nav.querySelector(
      `.vdl-tab[data-panel="${panel.id}"]`,
    );
    if (btn) {
      btn.classList.toggle("is-active", panel.id === store.activePanel);
    }
  });
  doRender();

  // --- Keyboard shortcut ---
  const handleGlobalKeydown = (event: KeyboardEvent): void => {
    if (!event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
    if (event.key?.toLowerCase() === "v") {
      event.preventDefault();
      window.__VERITY_DL_DEVTOOLS__?.toggle();
    }
  };
  window.addEventListener("keydown", handleGlobalKeydown);

  // --- Public API on window ---
  window.__VERITY_DL_DEVTOOLS__ = {
    show() {
      setHidden(false, layout, els);
      setMinimized(false, layout, els);
      applyLayout(layout, els);
      if (layout.detached && ds.detachedWindow && !ds.detachedWindow.closed) {
        try {
          ds.detachedWindow.focus();
        } catch {
          /* ignore */
        }
      }
    },
    hide() {
      setHidden(true, layout, els);
    },
    toggle() {
      if (layout.hidden) {
        this.show();
      } else {
        this.hide();
      }
    },
    destroy() {
      try {
        lifecycleUnsub();
      } catch {
        /* ignore */
      }
      try {
        changeUnsub();
      } catch {
        /* ignore */
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleGlobalKeydown);
      if (layout.detached) {
        dock(layout, els, ds);
      }
      els.mini.remove();
      els.container.remove();
      delete window.__VERITY_DL_DEVTOOLS__;
    },
  };

  return () => {
    window.__VERITY_DL_DEVTOOLS__?.destroy();
  };
}

// ---------------------------------------------------------------------------
// verity-dl devtools – DOM element creation
// ---------------------------------------------------------------------------

import type { DevtoolsElements, PanelDefinition } from "./types.js";

/** Panel tab definitions. */
export const PANELS: PanelDefinition[] = [
  { id: "truth", label: "Truth" },
  { id: "fetches", label: "Fetches" },
  { id: "sse", label: "SSE" },
  { id: "directives", label: "Directives" },
  { id: "memory", label: "Memory" },
  { id: "levels", label: "Levels" },
];

/**
 * Creates all DOM elements that make up the devtools panel, including the
 * container, header, tab bar, content area, resize handle, and mini widget.
 */
export function createElements(): DevtoolsElements {
  const container = document.createElement("div");
  container.className = "vdl-devtools";

  const header = document.createElement("div");
  header.className = "vdl-header";
  header.innerHTML = `
    <div class="vdl-title">VerityDL Devtools</div>
    <div class="vdl-header-actions">
      <button type="button" class="vdl-btn" data-action="detach">Pop out</button>
      <button type="button" class="vdl-btn" data-action="minimize">Mini view</button>
      <button type="button" class="vdl-btn" data-action="toggle">Hide</button>
    </div>`;
  container.appendChild(header);

  const nav = document.createElement("div");
  nav.className = "vdl-tabs";
  nav.innerHTML = PANELS.map(
    (p) =>
      `<button type="button" class="vdl-tab" data-panel="${p.id}">${p.label}</button>`,
  ).join("");
  container.appendChild(nav);

  const content = document.createElement("div");
  content.className = "vdl-content";
  container.appendChild(content);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "vdl-resize-handle";
  resizeHandle.setAttribute("aria-hidden", "true");
  resizeHandle.setAttribute("role", "presentation");
  resizeHandle.title = "Drag to resize";
  container.appendChild(resizeHandle);

  const mini = document.createElement("button");
  mini.type = "button";
  mini.className = "vdl-mini";
  mini.setAttribute("aria-label", "Open VerityDL devtools");
  mini.innerHTML = `
    <div class="vdl-mini-header">
      <span class="vdl-mini-title">VerityDL</span>
      <span class="vdl-mini-stat vdl-mini-sse" data-mini="sse">
        <span class="vdl-mini-dot" aria-hidden="true"></span>
        <span class="vdl-mini-sse-label">Offline</span>
      </span>
    </div>
    <div class="vdl-mini-stats">
      <span class="vdl-mini-stat">
        <span class="vdl-mini-label">Collections</span>
        <span class="vdl-mini-value" data-mini="collections">0</span>
      </span>
      <span class="vdl-mini-stat">
        <span class="vdl-mini-label">Types</span>
        <span class="vdl-mini-value" data-mini="types">0</span>
      </span>
      <span class="vdl-mini-stat">
        <span class="vdl-mini-label">In-flight</span>
        <span class="vdl-mini-value" data-mini="inflight">0</span>
      </span>
      <span class="vdl-mini-stat">
        <span class="vdl-mini-label">Bulk queued</span>
        <span class="vdl-mini-value" data-mini="queues">0</span>
      </span>
    </div>
    <div class="vdl-mini-footer">
      <span class="vdl-mini-label">Last event</span>
      <span class="vdl-mini-activity" data-mini="activity">No activity yet</span>
    </div>`;

  const panelNodes = new Map<string, HTMLDivElement>();
  for (const panel of PANELS) {
    const node = document.createElement("div");
    node.className = "vdl-panel";
    node.dataset["panel"] = panel.id;
    content.appendChild(node);
    panelNodes.set(panel.id, node);
  }

  const detachBtn = header.querySelector('[data-action="detach"]');
  const minimizeBtn = header.querySelector(
    '[data-action="minimize"]',
  ) as HTMLButtonElement | null;
  const toggleBtn = header.querySelector('[data-action="toggle"]');

  return {
    container,
    header,
    nav,
    content,
    resizeHandle,
    mini,
    detachBtn,
    minimizeBtn,
    toggleBtn,
    panelNodes,
  };
}

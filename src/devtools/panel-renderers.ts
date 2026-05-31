// ---------------------------------------------------------------------------
// verity-dl devtools – Individual panel renderers
//   (truth, fetches, SSE, directives, memory, levels)
// ---------------------------------------------------------------------------

import type { DevtoolsStore } from "./types.js";
import { fmtTime } from "./store.js";
import { describeEvent, renderEventBadge } from "./events.js";
import { renderTreeInto } from "./tree.js";

// ---- Truth panel ---------------------------------------------------------

export function renderTruthPanel(
  panelNodes: Map<string, HTMLDivElement>,
  store: DevtoolsStore,
): void {
  const node = panelNodes.get("truth");
  if (!node) return;
  const snap = store.snapshot;
  node.innerHTML = "";
  if (!snap) {
    node.innerHTML = `<p class="vdl-empty">Snapshot unavailable.</p>`;
    return;
  }

  const collectionsSection = document.createElement("section");
  const collectionsHeader = document.createElement("h3");
  collectionsHeader.textContent = "Collections";
  collectionsSection.appendChild(collectionsHeader);

  const colEntries = Object.entries(snap.collections ?? {});
  if (!colEntries.length) {
    const empty = document.createElement("p");
    empty.className = "vdl-empty";
    empty.textContent = "No collections registered.";
    collectionsSection.appendChild(empty);
  } else {
    colEntries.forEach(([name, cfg]) => {
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      const refs = (cfg?.refs ?? {}) as Record<string, unknown>;
      const refCount = Object.keys(refs).length;
      summary.textContent = `${name} \u2014 ${refCount} refs (staleness ${cfg?.stalenessMs ?? "\u221e"}ms)`;
      details.appendChild(summary);

      const treeHost = document.createElement("div");
      treeHost.className = "vdl-tree-host";
      if (refCount === 0) {
        const empty = document.createElement("p");
        empty.className = "vdl-empty";
        empty.textContent = "No references tracked.";
        details.appendChild(empty);
      } else {
        details.appendChild(treeHost);
        renderTreeInto(treeHost, refs, { collapseDepth: 2 });
      }
      collectionsSection.appendChild(details);
    });
  }

  const typesSection = document.createElement("section");
  const typesHeader = document.createElement("h3");
  typesHeader.textContent = "Types";
  typesSection.appendChild(typesHeader);

  const typeEntries = Object.entries(snap.types ?? {});
  if (!typeEntries.length) {
    const empty = document.createElement("p");
    empty.className = "vdl-empty";
    empty.textContent = "No types registered.";
    typesSection.appendChild(empty);
  } else {
    typeEntries.forEach(([name, cfg]) => {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      const items = (cfg?.items ?? {}) as Record<string, unknown>;
      const itemCount = Object.keys(items).length;
      summary.textContent = `${name} \u2014 ${itemCount} items${cfg?.hasBulkFetch ? " \u2022 bulk" : ""}`;
      details.appendChild(summary);

      const meta = document.createElement("div");
      meta.className = "vdl-type-meta";
      const levelKeys =
        Object.keys(cfg?.levels ?? {}).join(", ") || "default";
      meta.innerHTML = `<div>Levels: ${levelKeys}</div>`;
      details.appendChild(meta);

      if (!itemCount) {
        const empty = document.createElement("p");
        empty.className = "vdl-empty";
        empty.textContent = "No items cached.";
        details.appendChild(empty);
      } else {
        const treeHost = document.createElement("div");
        treeHost.className = "vdl-tree-host";
        details.appendChild(treeHost);
        renderTreeInto(treeHost, items, { collapseDepth: 2 });
      }

      typesSection.appendChild(details);
    });
  }

  node.appendChild(collectionsSection);
  node.appendChild(typesSection);
}

// ---- Fetches panel -------------------------------------------------------

export function renderFetchPanel(
  panelNodes: Map<string, HTMLDivElement>,
  store: DevtoolsStore,
): void {
  const node = panelNodes.get("fetches");
  if (!node) return;
  const snap = store.snapshot;
  const inflightCols = snap?.inFlight?.collections ?? [];
  const inflightItems = snap?.inFlight?.items ?? [];
  const queues = snap?.bulk?.queues ?? {};
  const lifecycleEvents = store.fetchEvents.slice(0, 40);
  node.innerHTML = `
    <section>
      <h3>In-flight collections (${inflightCols.length})</h3>
      <ul class="vdl-list">
        ${inflightCols.map((entry) => `<li><code>${entry.key}</code> \u2014 pending: ${entry.pending}</li>`).join("") || '<li class="vdl-empty">None</li>'}
      </ul>
    </section>
    <section>
      <h3>In-flight items (${inflightItems.length})</h3>
      <ul class="vdl-list">
        ${inflightItems.map((entry) => `<li><code>${entry.key}</code> \u2014 pending: ${entry.pending} ${entry.loud ? "\u2022 loud" : ""}</li>`).join("") || '<li class="vdl-empty">None</li>'}
      </ul>
    </section>
    <section>
      <h3>Bulk queues</h3>
      <ul class="vdl-list">
        ${Object.entries(queues).map(([key, info]) => `<li><code>${key}</code> \u2014 size: ${info.size}, timer: ${info.timerActive ? "waiting" : "idle"}</li>`).join("") || '<li class="vdl-empty">No bulk queues</li>'}
      </ul>
    </section>
    <section>
      <h3>Recent lifecycle events</h3>
      <ul class="vdl-log">
        ${lifecycleEvents.map((evt, index) => {
          const meta = describeEvent(evt.event);
          return `
            <li class="vdl-log-entry" data-event-kind="${meta.kind}">
              <div class="vdl-log-entry-head">
                <span class="vdl-log-time">${fmtTime(evt.timestamp)}</span>
                ${renderEventBadge(evt.event, meta)}
              </div>
              <div class="vdl-tree-host" data-tree="fetch-event" data-index="${index}"></div>
            </li>`;
        }).join("") || '<li class="vdl-empty">No events observed.</li>'}
      </ul>
    </section>`;
  node
    .querySelectorAll('[data-tree="fetch-event"]')
    .forEach((target, index) => {
      const entry = lifecycleEvents[index];
      renderTreeInto(target, entry?.detail ?? null, {
        collapseDepth: 2,
        emptyLabel: "No detail payload.",
      });
    });
}

// ---- SSE panel -----------------------------------------------------------

export function renderSsePanel(
  panelNodes: Map<string, HTMLDivElement>,
  store: DevtoolsStore,
): void {
  const node = panelNodes.get("sse");
  if (!node) return;
  const snap = store.snapshot;
  const seq = snap?.sse?.seqByAudience ?? {};
  const state = store.sseState;
  const sseEvents = store.sseEvents.slice(0, 50);
  node.innerHTML = `
    <section>
      <h3>Connection</h3>
      <dl class="vdl-definition">
        <div><dt>Connected</dt><dd>${state.connected}</dd></div>
        <div><dt>Audience</dt><dd>${state.audience ?? (snap?.sse?.audience ?? "")}</dd></div>
        <div><dt>Last open</dt><dd>${state.lastOpen ? fmtTime(state.lastOpen) : "\u2014"}</dd></div>
        <div><dt>Last message</dt><dd>${state.lastMessage ? fmtTime(state.lastMessage) : "\u2014"}</dd></div>
        <div><dt>Last error</dt><dd>${state.lastError ? fmtTime(state.lastError) : "\u2014"}</dd></div>
        <div><dt>Retry</dt><dd>${state.lastRetryInMs != null ? String(state.lastRetryInMs) + " ms" : "\u2014"}</dd></div>
      </dl>
    </section>
    <section>
      <h3>Sequences</h3>
      <div class="vdl-tree-host" data-tree="sse-seq"></div>
    </section>
    <section>
      <h3>Event log</h3>
      <ul class="vdl-log">
        ${sseEvents.map((evt, index) => {
          const meta = describeEvent(evt.event);
          return `
            <li class="vdl-log-entry" data-event-kind="${meta.kind}">
              <div class="vdl-log-entry-head">
                <span class="vdl-log-time">${fmtTime(evt.timestamp)}</span>
                ${renderEventBadge(evt.event, meta)}
              </div>
              <div class="vdl-tree-host" data-tree="sse-event" data-index="${index}"></div>
            </li>`;
        }).join("") || '<li class="vdl-empty">No SSE events observed.</li>'}
      </ul>
    </section>`;
  renderTreeInto(node.querySelector('[data-tree="sse-seq"]'), seq, {
    collapseDepth: 1,
    emptyLabel: "No sequences recorded.",
  });
  node
    .querySelectorAll('[data-tree="sse-event"]')
    .forEach((target, index) => {
      const entry = sseEvents[index];
      renderTreeInto(target, entry?.detail ?? null, {
        collapseDepth: 2,
        emptyLabel: "No detail payload.",
      });
    });
}

// ---- Directives panel ----------------------------------------------------

export function renderDirectivePanel(
  panelNodes: Map<string, HTMLDivElement>,
  store: DevtoolsStore,
): void {
  const node = panelNodes.get("directives");
  if (!node) return;
  const directiveEvents = store.directiveEvents.slice(0, 60);
  node.innerHTML = `
    <section>
      <h3>Directive stream</h3>
      <ul class="vdl-log vdl-directive-log">
        ${directiveEvents.map((evt, index) => {
          const action =
            evt.event === "directive:processed"
              ? `<button type="button" class="vdl-btn vdl-btn-secondary" data-replay="${index}">Replay</button>`
              : "";
          const meta = describeEvent(evt.event);
          return `
            <li class="vdl-log-entry" data-event-kind="${meta.kind}">
              <div class="vdl-log-entry-head vdl-directive-head">
                <div class="vdl-log-meta">
                  <span class="vdl-log-time">${fmtTime(evt.timestamp)}</span>
                  ${renderEventBadge(evt.event, meta)}
                </div>
                ${action ? `<div class="vdl-log-actions">${action}</div>` : ""}
              </div>
              <div class="vdl-tree-host" data-tree="directive" data-index="${index}"></div>
            </li>`;
        }).join("") || '<li class="vdl-empty">No directives yet.</li>'}
      </ul>
    </section>`;
  node
    .querySelectorAll('[data-tree="directive"]')
    .forEach((target, index) => {
      const entry = directiveEvents[index];
      renderTreeInto(target, entry?.detail ?? null, {
        collapseDepth: 2,
        emptyLabel: "No detail payload.",
      });
    });
}

// ---- Memory panel --------------------------------------------------------

export function renderMemoryPanel(
  panelNodes: Map<string, HTMLDivElement>,
  store: DevtoolsStore,
): void {
  const node = panelNodes.get("memory");
  if (!node) return;
  const snap = store.snapshot;
  const memoryEvents = store.memoryEvents.slice(0, 40);
  node.innerHTML = `
    <section>
      <h3>Configuration</h3>
      <div class="vdl-tree-host" data-tree="memory-config"></div>
    </section>
    <section>
      <h3>Lifecycle</h3>
      <ul class="vdl-log">
        ${memoryEvents.map((evt, index) => {
          const meta = describeEvent(evt.event);
          return `
            <li class="vdl-log-entry" data-event-kind="${meta.kind}">
              <div class="vdl-log-entry-head">
                <span class="vdl-log-time">${fmtTime(evt.timestamp)}</span>
                ${renderEventBadge(evt.event, meta)}
              </div>
              <div class="vdl-tree-host" data-tree="memory-event" data-index="${index}"></div>
            </li>`;
        }).join("") || '<li class="vdl-empty">No memory sweeps recorded.</li>'}
      </ul>
    </section>`;
  renderTreeInto(
    node.querySelector('[data-tree="memory-config"]'),
    snap?.memory ?? {},
    { collapseDepth: 1, emptyLabel: "No memory configuration." },
  );
  node
    .querySelectorAll('[data-tree="memory-event"]')
    .forEach((target, index) => {
      const entry = memoryEvents[index];
      renderTreeInto(target, entry?.detail ?? null, {
        collapseDepth: 2,
        emptyLabel: "No detail payload.",
      });
    });
}

// ---- Levels panel --------------------------------------------------------

export function renderLevelsPanel(
  panelNodes: Map<string, HTMLDivElement>,
  store: DevtoolsStore,
): void {
  const node = panelNodes.get("levels");
  if (!node) return;
  const snap = store.snapshot;
  if (!snap) {
    node.innerHTML = `<p class="vdl-empty">Snapshot unavailable.</p>`;
    return;
  }
  const typeEntries = Object.entries(snap.types ?? {});
  node.innerHTML = `
    <section>
      <h3>Level conversions</h3>
      ${typeEntries.length ? "" : '<p class="vdl-empty">No types registered.</p>'}
      ${typeEntries.map(([name]) => `
        <details>
          <summary>${name}</summary>
          <div class="vdl-graph">
            <div>
              <h4>convertFrom</h4>
              <div class="vdl-tree-host" data-tree="level-convert"></div>
            </div>
            <div>
              <h4>levelAccepts</h4>
              <div class="vdl-tree-host" data-tree="level-accepts"></div>
            </div>
          </div>
        </details>`).join("")}
    </section>`;
  node
    .querySelectorAll('[data-tree="level-convert"]')
    .forEach((target, index) => {
      const entry = typeEntries[index];
      if (!entry) return;
      renderTreeInto(target, entry[1].convertFrom ?? {}, {
        collapseDepth: 1,
        emptyLabel: "No conversions registered.",
      });
    });
  node
    .querySelectorAll('[data-tree="level-accepts"]')
    .forEach((target, index) => {
      const entry = typeEntries[index];
      if (!entry) return;
      renderTreeInto(target, entry[1].levelAccepts ?? {}, {
        collapseDepth: 1,
        emptyLabel: "No acceptance rules.",
      });
    });
}

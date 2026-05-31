// ---------------------------------------------------------------------------
// verity-dl devtools – Mini summary and active-panel dispatch
// ---------------------------------------------------------------------------

import type { DevtoolsStore } from "./types.js";
import { fmtRelative, fmtAbsolute } from "./store.js";
import {
  renderTruthPanel,
  renderFetchPanel,
  renderSsePanel,
  renderDirectivePanel,
  renderMemoryPanel,
  renderLevelsPanel,
} from "./panel-renderers.js";

// ---- Mini summary --------------------------------------------------------

export function renderMiniSummary(
  mini: HTMLButtonElement | null,
  store: DevtoolsStore,
): void {
  if (!mini) return;
  const snap = store.snapshot;
  const collections =
    snap?.collections ? Object.keys(snap.collections).length : 0;
  const typeCount = snap?.types ? Object.keys(snap.types).length : 0;

  const inflightObj = snap?.inFlight;
  const inflightCollections = Array.isArray(inflightObj?.collections)
    ? inflightObj.collections.length
    : 0;
  const inflightItems = Array.isArray(inflightObj?.items)
    ? inflightObj.items.length
    : 0;
  const inflightTotal = inflightCollections + inflightItems;

  const queues =
    snap?.bulk?.queues && typeof snap.bulk.queues === "object"
      ? snap.bulk.queues
      : {};
  let queueCount = 0;
  let queueSize = 0;
  for (const info of Object.values(queues)) {
    queueCount += 1;
    if (
      info &&
      typeof info.size === "number" &&
      Number.isFinite(info.size)
    ) {
      queueSize += info.size;
    }
  }

  const setMiniValue = (
    name: string,
    value: string,
    options: { title?: string | null; hot?: boolean } = {},
  ): void => {
    const node = mini.querySelector(`[data-mini="${name}"]`);
    if (!node || !(node instanceof HTMLElement)) return;
    node.textContent = value;
    if (options.title != null) {
      if (options.title) {
        node.setAttribute("title", options.title);
      } else {
        node.removeAttribute("title");
      }
    }
    if (typeof options.hot === "boolean") {
      node.classList.toggle("is-hot", options.hot);
    }
  };

  setMiniValue("collections", collections.toLocaleString());
  setMiniValue("types", typeCount.toLocaleString());
  setMiniValue("inflight", inflightTotal.toLocaleString(), {
    title: `Collections ${inflightCollections} \u2022 Items ${inflightItems}`,
    hot: inflightTotal > 0,
  });
  setMiniValue("queues", queueSize.toLocaleString(), {
    title: queueCount
      ? `${queueCount} ${queueCount === 1 ? "queue" : "queues"} \u2022 ${queueSize} pending`
      : "No bulk work queued",
    hot: queueSize > 0,
  });

  // SSE status
  const sseNode = mini.querySelector('[data-mini="sse"]');
  if (sseNode) {
    const label = sseNode.querySelector(".vdl-mini-sse-label");
    const dot = sseNode.querySelector(".vdl-mini-dot");
    const state = store.sseState;
    const connected = !!state.connected;
    if (label) label.textContent = connected ? "Online" : "Offline";
    if (dot instanceof HTMLElement) {
      dot.classList.toggle("is-online", connected);
    }
    const tooltip: string[] = [];
    if (state.audience) tooltip.push(`Audience ${state.audience}`);
    if (state.lastOpen) tooltip.push(`Opened ${fmtAbsolute(state.lastOpen)}`);
    if (state.lastMessage) {
      tooltip.push(`Last message ${fmtAbsolute(state.lastMessage)}`);
    }
    if (state.lastError) {
      tooltip.push(`Last error ${fmtAbsolute(state.lastError)}`);
    }
    if (state.lastRetryInMs != null) {
      tooltip.push(`Retry ${state.lastRetryInMs}ms`);
    }
    if (tooltip.length) {
      sseNode.setAttribute("title", tooltip.join(" \u2022 "));
    } else {
      sseNode.removeAttribute("title");
    }
  }

  // Latest activity
  const activityNode = mini.querySelector('[data-mini="activity"]');
  if (activityNode) {
    const candidates = [
      store.fetchEvents[0],
      store.directiveEvents[0],
      store.sseEvents[0],
      store.memoryEvents[0],
    ].filter(Boolean);

    const latest = candidates.reduce<{
      time: number;
      event: string;
      raw: unknown;
    } | null>((acc, entry) => {
      if (!entry) return acc;
      const currentTime = entry.timestamp
        ? new Date(entry.timestamp as string | number).getTime()
        : NaN;
      if (!Number.isFinite(currentTime)) return acc;
      if (!acc || currentTime > acc.time) {
        return { time: currentTime, event: entry.event, raw: entry.timestamp };
      }
      return acc;
    }, null);

    if (latest) {
      const relative = fmtRelative(latest.time);
      activityNode.textContent = `${latest.event}${relative ? ` \u2022 ${relative}` : ""}`;
      if (activityNode instanceof HTMLElement) {
        activityNode.setAttribute("title", fmtAbsolute(latest.raw));
      }
    } else {
      activityNode.textContent = "No activity yet";
      if (activityNode instanceof HTMLElement) {
        activityNode.removeAttribute("title");
      }
    }
  }
}

// ---- Active panel dispatch -----------------------------------------------

export function renderActivePanel(
  panelNodes: Map<string, HTMLDivElement>,
  store: DevtoolsStore,
  mini: HTMLButtonElement | null,
): void {
  for (const [id, node] of panelNodes.entries()) {
    node.classList.toggle("is-active", id === store.activePanel);
  }
  switch (store.activePanel) {
    case "truth":
      renderTruthPanel(panelNodes, store);
      break;
    case "fetches":
      renderFetchPanel(panelNodes, store);
      break;
    case "sse":
      renderSsePanel(panelNodes, store);
      break;
    case "directives":
      renderDirectivePanel(panelNodes, store);
      break;
    case "memory":
      renderMemoryPanel(panelNodes, store);
      break;
    case "levels":
      renderLevelsPanel(panelNodes, store);
      break;
    default:
      break;
  }
  renderMiniSummary(mini, store);
}

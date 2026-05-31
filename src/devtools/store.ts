// ---------------------------------------------------------------------------
// verity-dl devtools – State store, layout persistence, utilities
// ---------------------------------------------------------------------------

import type {
  DevtoolsStore,
  DevtoolsLayout,
  SerializedLayout,
  ResizeLimits,
  EventEntry,
  Size,
} from "./types.js";

// ---- Constants -----------------------------------------------------------

export const RESIZE_LIMITS: ResizeLimits = {
  minWidth: 320,
  minHeight: 240,
  margin: 16,
};

export const MAX_EVENTS = 120;

export const LAYOUT_STORAGE_KEY = "veritydl.devtools.layout";

// ---- Store ---------------------------------------------------------------

export function createStore(): DevtoolsStore {
  return {
    snapshot: null,
    fetchEvents: [],
    directiveEvents: [],
    memoryEvents: [],
    sseEvents: [],
    sseState: {
      connected: false,
      lastOpen: null,
      lastError: null,
      lastMessage: null,
      lastRetryInMs: null,
      audience: null,
    },
    activePanel: "truth",
    renderPending: false,
    snapshotRefreshPending: false,
  };
}

// ---- Layout --------------------------------------------------------------

export function createLayout(): DevtoolsLayout {
  return {
    hidden: false,
    minimized: false,
    detached: false,
    manualPosition: false,
    position: null,
    miniPosition: null,
    size: null,
  };
}

// ---- Storage helpers -----------------------------------------------------

function getStorage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function sanitizeNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function clampSize(size: { width?: unknown; height?: unknown } | null): Size | null {
  if (!size) return null;
  const width = Math.max(
    RESIZE_LIMITS.minWidth,
    sanitizeNumber(size.width, RESIZE_LIMITS.minWidth),
  );
  const height = Math.max(
    RESIZE_LIMITS.minHeight,
    sanitizeNumber(size.height, RESIZE_LIMITS.minHeight),
  );
  return { width, height };
}

export function readStoredLayout(): SerializedLayout | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return data && typeof data === "object" ? (data as SerializedLayout) : null;
  } catch {
    return null;
  }
}

export function applyStoredLayout(
  data: SerializedLayout | null,
  layout: DevtoolsLayout,
): void {
  if (!data || typeof data !== "object") return;
  const size = clampSize(data.size);
  layout.size = size;
  if (data.manualPosition && data.position) {
    const left = sanitizeNumber(data.position.left, RESIZE_LIMITS.margin);
    const top = sanitizeNumber(data.position.top, RESIZE_LIMITS.margin);
    layout.position = { left, top };
    layout.manualPosition = true;
  } else {
    layout.position = null;
    layout.manualPosition = false;
  }
  if (data.miniPosition) {
    const left = sanitizeNumber(data.miniPosition.left, RESIZE_LIMITS.margin);
    const top = sanitizeNumber(data.miniPosition.top, RESIZE_LIMITS.margin);
    layout.miniPosition = { left, top };
  }
  layout.minimized = !!data.minimized;
}

export function serializeLayout(layout: DevtoolsLayout): SerializedLayout {
  const size = layout.size
    ? { width: Math.round(layout.size.width), height: Math.round(layout.size.height) }
    : null;
  const position =
    layout.manualPosition && layout.position
      ? {
          left: Math.round(layout.position.left),
          top: Math.round(layout.position.top),
        }
      : null;
  const miniPosition = layout.miniPosition
    ? {
        left: Math.round(layout.miniPosition.left),
        top: Math.round(layout.miniPosition.top),
      }
    : null;
  return {
    manualPosition: !!layout.manualPosition && !!position,
    position,
    size,
    miniPosition,
    minimized: !!layout.minimized,
  };
}

export function storagePersist(layout: DevtoolsLayout): void {
  const storage = getStorage();
  if (!storage || layout.detached) return;
  try {
    storage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify(serializeLayout(layout)),
    );
  } catch {
    /* ignore */
  }
}

// ---- Generic helpers -----------------------------------------------------

export function clone(value: unknown): unknown {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* ignore */
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export function escapeHtml(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : String(value as string);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function pushEvent(list: EventEntry[], entry: EventEntry): void {
  list.unshift(entry);
  if (list.length > MAX_EVENTS) list.length = MAX_EVENTS;
}

export function clampWithinViewport(
  left: number,
  top: number,
  element: HTMLElement | null,
  margin = 12,
): { left: number; top: number } {
  if (!element) return { left, top };
  const rect = element.getBoundingClientRect();
  const width = rect.width || element.offsetWidth || 0;
  const height = rect.height || element.offsetHeight || 0;
  const maxLeft = window.innerWidth - width - margin;
  const maxTop = window.innerHeight - height - margin;
  const clampedLeft =
    maxLeft < margin ? margin : Math.min(Math.max(margin, left), maxLeft);
  const clampedTop =
    maxTop < margin ? margin : Math.min(Math.max(margin, top), maxTop);
  return { left: clampedLeft, top: clampedTop };
}

// ---- Time formatting -----------------------------------------------------

export function fmtTime(ts: unknown): string {
  if (!ts) return "";
  try {
    const d = new Date(ts as string | number);
    if (Number.isNaN(d.getTime())) return String(ts as string);
    return d.toLocaleTimeString([], { hour12: false });
  } catch {
    return String(ts as string);
  }
}

export function fmtRelative(ts: unknown): string {
  if (!ts) return "";
  let value: number;
  if (typeof ts !== "number") {
    const parsed = new Date(ts as string | number).getTime();
    value = Number.isFinite(parsed) ? parsed : Number(ts);
  } else {
    value = ts;
  }
  if (!Number.isFinite(value)) return "";
  const delta = Date.now() - value;
  if (!Number.isFinite(delta) || delta < 0) return "";
  if (delta < 1000) return "<1s ago";
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

export function fmtAbsolute(ts: unknown): string {
  if (!ts) return "";
  try {
    const d = new Date(ts as string | number);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  } catch {
    /* ignore */
  }
  return String(ts as string);
}

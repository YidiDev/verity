// ---------------------------------------------------------------------------
// verity-dl devtools – Event classification and lifecycle handling
// ---------------------------------------------------------------------------

import type {
  DLAdapter,
  DevtoolsStore,
  EventEntry,
  EventKind,
  EventKindMeta,
  LifecyclePayload,
} from "./types.js";
import { clone, escapeHtml, pushEvent } from "./store.js";

// ---- Event kind metadata -------------------------------------------------

const EVENT_KIND_META: Record<EventKind, EventKindMeta> = {
  fetch: {
    icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path><path d="M5 3.5h4.5a2 2 0 0 1 1.58.79l2.17 2.89a2 2 0 0 1 0 2.44l-2.17 2.89a2 2 0 0 1-1.58.79H5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`,
  },
  sse: {
    icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 11.5c1.4-1.9 3.4-3 5.02-3s3.62 1.1 4.98 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path><path d="M4.5 7c1.2-1.6 2.8-2.5 3.52-2.5S10.8 5.4 12 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path><circle cx="8" cy="12.25" r="0.9" fill="currentColor"></circle></svg>`,
  },
  directive: {
    icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.75 9.7 6h4.05l-3.28 2.38 1.25 4.12L8 10.9l-3.72 1.6L5.5 8.38 2.25 6H6.3Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path></svg>`,
  },
  memory: {
    icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3.5" width="10" height="9" rx="1.6" ry="1.6" fill="none" stroke="currentColor" stroke-width="1.2"></rect><path d="M5.5 6.5h5M5.5 9.5h2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></path></svg>`,
  },
  system: {
    icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2.25 9.4 5.7l3.8.28-2.9 2.36.92 3.72L8 10.72l-3.22 1.34.92-3.72L2.8 6l3.8-.28Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path></svg>`,
  },
};

// ---- Classification ------------------------------------------------------

export function classifyEventKind(eventName: string): EventKind {
  if (!eventName || typeof eventName !== "string") return "system";
  if (
    eventName.startsWith("collection:") ||
    eventName.startsWith("item:") ||
    eventName.startsWith("bulk:")
  ) {
    return "fetch";
  }
  if (eventName.startsWith("sse:")) return "sse";
  if (eventName.startsWith("directive:")) return "directive";
  if (eventName.startsWith("memory:")) return "memory";
  return "system";
}

export function describeEvent(eventName: string): {
  kind: EventKind;
  icon: string;
} {
  const kind = classifyEventKind(eventName);
  const meta = EVENT_KIND_META[kind];
  return { kind, icon: meta.icon };
}

export function renderEventBadge(
  eventName: string,
  meta?: { kind: EventKind; icon: string } | null,
): string {
  const info = meta ?? describeEvent(eventName);
  return `<span class="vdl-event-badge vdl-log-event" data-event-kind="${info.kind}">${info.icon}<span class="vdl-event-label">${escapeHtml(eventName)}</span></span>`;
}

// ---- Snapshot & lifecycle ------------------------------------------------

export function updateSnapshot(
  adapter: DLAdapter,
  store: DevtoolsStore,
  scheduleRender: () => void,
): void {
  let snapshot: unknown;
  try {
    snapshot = adapter.devtools();
    store.snapshot = snapshot as DevtoolsStore["snapshot"];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to collect diagnostics", err);
  }
  if (
    snapshot &&
    typeof snapshot === "object" &&
    "sse" in snapshot &&
    snapshot.sse &&
    typeof snapshot.sse === "object"
  ) {
    const sse = snapshot.sse as Record<string, unknown>;
    const state = store.sseState;
    const applyIfPresent = (
      key: keyof typeof state,
      transform?: (v: unknown) => unknown,
    ): void => {
      if (Object.prototype.hasOwnProperty.call(sse, key)) {
        (state as unknown as Record<string, unknown>)[key] = transform
          ? transform(sse[key])
          : sse[key];
      }
    };
    applyIfPresent("connected", (v) => !!v);
    applyIfPresent("audience");
    applyIfPresent("lastOpen");
    applyIfPresent("lastMessage");
    applyIfPresent("lastError");
    applyIfPresent("lastRetryInMs");
  }
  scheduleRender();
}

export function handleLifecycle(
  payload: LifecyclePayload,
  store: DevtoolsStore,
  scheduleRender: () => void,
  queueSnapshotRefresh: () => void,
): void {
  if (!payload?.event) return;
  const entry: EventEntry = {
    event: payload.event,
    detail: clone(payload.detail ?? {}),
    timestamp: payload.timestamp,
  };
  const e = payload.event;

  if (
    e.startsWith("collection:fetch") ||
    e.startsWith("item:fetch") ||
    e.startsWith("bulk:")
  ) {
    pushEvent(store.fetchEvents, entry);
  }
  if (e.startsWith("memory:")) {
    pushEvent(store.memoryEvents, entry);
  }
  if (e.startsWith("sse:")) {
    pushEvent(store.sseEvents, entry);
    if (e === "sse:open") {
      store.sseState.connected = true;
      store.sseState.lastOpen = payload.timestamp;
      store.sseState.audience = payload.detail
        ? (payload.detail["audience"] as string | null) ?? store.sseState.audience
        : store.sseState.audience;
    } else if (e === "sse:disconnect") {
      store.sseState.connected = false;
    } else if (e === "sse:error") {
      store.sseState.lastError = payload.timestamp;
      store.sseState.lastRetryInMs = payload.detail
        ? (payload.detail["retryInMs"] as number | null) ?? null
        : null;
    } else if (e === "sse:message") {
      store.sseState.lastMessage = payload.timestamp;
    }
  }
  if (e.startsWith("directive:")) {
    pushEvent(store.directiveEvents, entry);
  }

  if (
    e.startsWith("directive:") ||
    e.startsWith("collection:fetch") ||
    e.startsWith("item:fetch") ||
    e.startsWith("bulk:")
  ) {
    queueSnapshotRefresh();
  } else {
    scheduleRender();
  }
}

export function replayDirective(
  index: number,
  store: DevtoolsStore,
  adapter: DLAdapter,
): void {
  const evt = store.directiveEvents[index];
  if (!evt || evt.event !== "directive:processed") return;
  const detail = (evt.detail ?? {}) as Record<string, unknown>;
  const directive = detail["directive"];
  if (!directive) return;
  const payload = Array.isArray(directive) ? directive : [directive];
  try {
    const safePayload = clone(payload);
    if (Array.isArray(safePayload) && adapter.applyDirectives) {
      adapter.applyDirectives(safePayload, { disableIdempotencyGuard: true });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to replay directive", err);
  }
}

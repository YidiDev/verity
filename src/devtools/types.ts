// ---------------------------------------------------------------------------
// verity-dl devtools – Type definitions
// ---------------------------------------------------------------------------

// ---- Window globals (runtime-only, not ES-imported from core) ----

/** Minimal interface for the DL adapter as seen by devtools at runtime. */
export interface DLAdapter {
  devtools: () => DevtoolsSnapshot;
  onLifecycle?: (
    pattern: string,
    handler: (payload: LifecyclePayload) => void,
  ) => () => void;
  onChange?: (handler: () => void) => () => void;
  applyDirectives?: (
    payload: unknown[],
    options?: { disableIdempotencyGuard?: boolean },
  ) => void;
}

/** Shape of the adapters map exposed on `window.DLAdapters`. */
export interface DLAdaptersMap {
  default?: string;
  [key: string]: unknown;
}

// ---- Devtools snapshot shape (mirrors devtools-introspection output) ----

export interface DevtoolsSnapshot {
  clientId?: string;
  types?: Record<string, SnapshotType>;
  collections?: Record<string, SnapshotCollection>;
  inFlight?: SnapshotInFlight;
  directiveRegistry?: unknown;
  sse?: SnapshotSse;
  bulk?: SnapshotBulk;
  memory?: unknown;
}

export interface SnapshotType {
  stalenessMs?: number;
  hasBulkFetch?: boolean;
  items?: Record<string, unknown>;
  levels?: Record<string, unknown>;
  convertFrom?: Record<string, string[]>;
  levelAccepts?: Record<string, string[]>;
}

export interface SnapshotCollection {
  stalenessMs?: number;
  refs?: Record<string, unknown>;
}

export interface SnapshotInFlight {
  collections?: SnapshotInFlightEntry[];
  items?: SnapshotInFlightItemEntry[];
  totalCount?: number;
  hasAnyInFlight?: boolean;
}

export interface SnapshotInFlightEntry {
  key: string;
  pending: boolean;
}

export interface SnapshotInFlightItemEntry extends SnapshotInFlightEntry {
  loud?: boolean;
}

export interface SnapshotSse {
  enabled?: boolean;
  url?: string;
  audience?: string | null;
  connected?: boolean;
  retryMs?: number;
  initialRetryMs?: number;
  maxRetryMs?: number;
  backoffMultiplier?: number;
  withCredentials?: boolean;
  resyncOnGap?: boolean;
  resyncTimerActive?: boolean;
  seqByAudience?: Record<string, number>;
  lastOpen?: unknown;
  lastMessage?: unknown;
  lastError?: unknown;
  lastRetryInMs?: number | null;
}

export interface SnapshotBulk {
  delayMs?: number;
  queues?: Record<string, SnapshotBulkQueue>;
}

export interface SnapshotBulkQueue {
  typeName?: string;
  canonicalLevel?: string;
  levelArg?: string;
  size?: number;
  timerActive?: boolean;
}

// ---- Internal devtools state ----

export interface SseConnectionState {
  connected: boolean;
  lastOpen: unknown;
  lastError: unknown;
  lastMessage: unknown;
  lastRetryInMs: number | null;
  audience: string | null;
}

export interface DevtoolsStore {
  snapshot: DevtoolsSnapshot | null;
  fetchEvents: EventEntry[];
  directiveEvents: EventEntry[];
  memoryEvents: EventEntry[];
  sseEvents: EventEntry[];
  sseState: SseConnectionState;
  activePanel: string;
  renderPending: boolean;
  snapshotRefreshPending: boolean;
}

export interface EventEntry {
  event: string;
  detail: unknown;
  timestamp: unknown;
}

export interface LifecyclePayload {
  event: string;
  detail?: Record<string, unknown>;
  timestamp?: unknown;
}

// ---- Layout persistence ----

export interface Position {
  left: number;
  top: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface DevtoolsLayout {
  hidden: boolean;
  minimized: boolean;
  detached: boolean;
  manualPosition: boolean;
  position: Position | null;
  miniPosition: Position | null;
  size: Size | null;
}

export interface SerializedLayout {
  manualPosition: boolean;
  position: Position | null;
  size: Size | null;
  miniPosition: Position | null;
  minimized: boolean;
}

export interface ResizeLimits {
  minWidth: number;
  minHeight: number;
  margin: number;
}

// ---- Drag state ----

export interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

export interface ResizeState {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  originLeft: number;
  originTop: number;
}

// ---- Panel definition ----

export interface PanelDefinition {
  id: string;
  label: string;
}

// ---- Event kind metadata ----

export type EventKind = "fetch" | "sse" | "directive" | "memory" | "system";

export interface EventKindMeta {
  icon: string;
}

// ---- DOM element references shared across modules ----

export interface DevtoolsElements {
  container: HTMLDivElement;
  header: HTMLDivElement;
  nav: HTMLDivElement;
  content: HTMLDivElement;
  resizeHandle: HTMLDivElement;
  mini: HTMLButtonElement;
  detachBtn: Element | null;
  minimizeBtn: HTMLButtonElement | null;
  toggleBtn: Element | null;
  panelNodes: Map<string, HTMLDivElement>;
}

// ---- Global window augmentation ----

declare global {
  interface Window {
    __VERITY_DL_DEVTOOLS__?: {
      show: () => void;
      hide: () => void;
      toggle: () => void;
      destroy: () => void;
    };
    DL?: unknown;
    DLAdapters?: DLAdaptersMap;
  }
}

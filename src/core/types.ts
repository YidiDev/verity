// ---------------------------------------------------------------------------
// verity-dl  –  TypeScript type definitions
// ---------------------------------------------------------------------------

// ---- SSE Configuration & State -------------------------------------------

/** User-facing SSE configuration (partial, used with configureSse). */
export interface SseConfig {
  enabled?: boolean;
  url?: string;
  clientIdParam?: string;
  audienceParam?: string;
  audience?: string | null;
  withCredentials?: boolean;
  connectOnInit?: boolean;
  initialRetryMs?: number;
  maxRetryMs?: number;
  backoffMultiplier?: number;
  resyncOnGap?: boolean;
  resyncJitterMinMs?: number;
  resyncJitterMaxMs?: number;
  resyncItemLastUsedWindowMs?: number;
  onResync?: ((context: Record<string, unknown>) => unknown) | null;
}

/** Internal mutable SSE runtime state (the full G.sse shape). */
export interface SseState {
  enabled: boolean;
  url: string;
  clientIdParam: string;
  audienceParam: string;
  audience: string | null;
  withCredentials: boolean;
  connectOnInit: boolean;
  source: EventSource | null;
  connected: boolean;
  retryMs: number;
  initialRetryMs: number;
  maxRetryMs: number;
  backoffMultiplier: number;
  seqByAudience: Map<string, number>;
  resyncOnGap: boolean;
  resyncJitterMinMs: number;
  resyncJitterMaxMs: number;
  onResync: ((context: Record<string, unknown>) => unknown) | null;
  resyncTimer: ReturnType<typeof setTimeout> | null;
  resyncItemLastUsedWindowMs: number;
}

// ---- Memory Configuration & State ----------------------------------------

/** User-facing memory configuration (partial, used with configureMemory). */
export interface MemoryConfig {
  enabled?: boolean;
  pruneIntervalMs?: number;
  maxCollectionRefsPerCollection?: number;
  collectionEntryTtlMs?: number;
  maxItemsPerType?: number;
  itemEntryTtlMs?: number;
}

/** The default memory configuration shape (all fields required). */
export interface MemoryDefaults {
  enabled: boolean;
  pruneIntervalMs: number;
  maxCollectionRefsPerCollection: number;
  collectionEntryTtlMs: number;
  maxItemsPerType: number;
  itemEntryTtlMs: number;
}

/** Internal mutable memory runtime state (G.memory). */
export interface MemoryState extends MemoryDefaults {
  sweepTimer: ReturnType<typeof setTimeout> | null;
}

// ---- Collection ----------------------------------------------------------

export interface CollectionData {
  ids: unknown[];
  count: number;
}

export interface CollectionMeta {
  isLoading: boolean;
  lastFetched: string | null;
  error: string | null;
  activeQueryId: string | null;
  paramsSnapshot: unknown;
  paramsKey: string;
  lastUsedAt: string | null;
}

/** A single parameterised snapshot of a collection. */
export interface CollectionRef {
  data: CollectionData;
  meta: CollectionMeta;
}

/** Fetch function signature for collections. */
export type CollectionFetchFn = (
  params: unknown,
) => Promise<{ ids: unknown[]; count: number }>;

/** Registry entry for a registered collection. */
export interface CollectionEntry {
  fetch: CollectionFetchFn;
  stalenessMs: number;
  /** The default-params ref (always keyed as PARAM_DEFAULT_KEY). */
  ref: CollectionRef;
  /** All parameterised refs keyed by paramsKey. */
  refs: Map<string, CollectionRef>;
}

// ---- Item / Type ---------------------------------------------------------

export interface ItemMeta {
  isLoading: boolean;
  error: string | null;
  activeQueryId: string | null;
  lastFetchedAny: string | null;
  levelStamps: Record<string, string | null>;
  lastUsedAt: string | null;
  activeLevelQueryIds: Record<string, string | undefined>;
}

export interface ItemRef {
  data: Record<string, unknown> | null;
  meta: ItemMeta;
}

/** Fetch function signature for a single item (or a level). */
export type ItemFetchFn = (
  id: unknown,
  levelArg: string,
) => Promise<unknown>;

/** Bulk-fetch function signature. */
export type BulkFetchFn = (
  ids: unknown[],
  levelArg: string,
  ctx: { type: string; level: string; canonicalLevel: string },
) => Promise<unknown[] | Record<string, unknown>>;

/** Configuration for a single level within a type. */
export interface LevelConfig {
  name: string;
  fetch: ItemFetchFn;
  check: (data: unknown) => boolean;
  stalenessMs: number;
  bulkFetch: BulkFetchFn | null;
}

/** Registry entry for a registered type. */
export interface TypeEntry {
  fetch: ItemFetchFn;
  bulkFetch: BulkFetchFn | null;
  stalenessMs: number;
  levels: Record<string, LevelConfig>;
  items: Map<string, ItemRef>;
  /** Maps a source level-key → set of target level-keys it can convert to. */
  convertFrom: Map<string, Set<string>>;
  /** Maps a target level-key → set of source level-keys it accepts from. */
  levelAccepts: Map<string, Set<string>>;
}

// ---- Bulk Queue ----------------------------------------------------------

export interface BulkQueueEntry {
  id: unknown;
  ref: ItemRef;
  qid: string;
  resolve: () => void;
  promise: Promise<void>;
  levelName: string | null;
}

export interface BulkQueue {
  typeName: string;
  canonicalLevel: string;
  levelArg: string;
  bulkFetcher: BulkFetchFn | null;
  fallbackFetcher: ItemFetchFn;
  entries: Map<string, BulkQueueEntry>;
  timer: ReturnType<typeof setTimeout> | null;
}

// ---- Directive Source ----------------------------------------------------

/** Helpers object passed to custom directive source connect/disconnect/configure. */
export interface DirectiveSourceHelpers {
  clientId: string;
  applyDirectives: (
    directives: Directive[],
    options?: ApplyDirectivesOptions,
  ) => Promise<unknown[]>;
  ingest: (payload: DirectiveEnvelope) => void;
  hasProcessedDirective: (key: string | null | undefined, now?: number) => boolean;
  rememberDirectiveKey: (key: string | null | undefined, now?: number) => void;
  scheduleResync: (context?: Record<string, unknown>) => void;
  state: () => { types: Map<string, TypeEntry>; collections: Map<string, CollectionEntry> };
}

/** The normalised directive source stored in G.directiveSource. */
export interface DirectiveSource {
  kind: string;
  enabled: boolean;
  connectOnInit: boolean;
  connect: (opts?: Record<string, unknown>) => unknown;
  disconnect: () => void;
  configure?: (cfg: unknown, helpers: DirectiveSourceHelpers) => unknown;
}

// ---- Directives ----------------------------------------------------------

export interface Directive {
  op: string;
  name?: string;
  id?: unknown;
  result?: DirectiveResult;
  idempotency_key?: string;
  params?: unknown;
  params_mode?: string;
  targets?: Directive[];
}

export interface DirectiveResult {
  data?: unknown;
  ts?: string;
  level?: string;
  levels?: Record<string, DirectiveLevelEntry>;
}

export interface DirectiveLevelEntry {
  data?: unknown;
  ts?: string;
}

export interface ApplyDirectivesOptions {
  disableIdempotencyGuard?: boolean;
}

// ---- Directive Envelope (SSE payload) ------------------------------------

export interface DirectiveEnvelope {
  type?: string;
  audience?: string;
  last_seq?: number;
  seq?: number;
  source?: string;
  directives?: Directive[];
}

// ---- Directive Registry --------------------------------------------------

export interface DirectiveRegistry {
  seen: Map<string, number>;
  ttlMs: number;
  maxSize: number;
}

// ---- Lifecycle / Devtools ------------------------------------------------

export interface LifecyclePayload {
  event: string;
  detail: unknown;
  timestamp: string;
}

export type LifecycleHandler = (payload: LifecyclePayload) => void;

export interface LifecycleRegistry {
  nextId: number;
  byEvent: Map<string, Map<number, LifecycleHandler>>;
}

export interface DevtoolsState {
  lifecycle: LifecycleRegistry;
}

// ---- Global Mutable State ------------------------------------------------

export interface GlobalState {
  types: Map<string, TypeEntry>;
  collections: Map<string, CollectionEntry>;
  listeners: Array<() => void>;
  directiveSource: DirectiveSource | null;
  sse: SseState;
  inFlightCol: Map<string, { promise: Promise<void> }>;
  inFlightItm: Map<string, { promise: Promise<void>; loud: boolean }>;
  directiveRegistry: DirectiveRegistry;
  bulk: {
    delayMs: number;
    queues: Map<string, BulkQueue>;
  };
  memory: MemoryState;
  devtools: DevtoolsState;
}

// ---- Public API Options --------------------------------------------------

/** Options accepted by `init()`. */
export interface InitOptions {
  sse?: SseConfig;
  memory?: MemoryConfig;
  directiveSource?: DirectiveSourceInput | null | false;
}

/**
 * Input shapes accepted by `configureDirectiveSource()`.
 * Can be the string `"sse"`, a custom source object, or a descriptor.
 */
export type DirectiveSourceInput =
  | "sse"
  | CustomDirectiveSourceInput
  | DirectiveSourceDescriptor;

/** A custom directive source that supplies its own connect function. */
export interface CustomDirectiveSourceInput {
  name?: string;
  type?: string;
  enabled?: boolean;
  connectOnInit?: boolean;
  connect: (helpers: DirectiveSourceHelpers & { options: Record<string, unknown> }) => unknown;
  disconnect?: (helpers: DirectiveSourceHelpers) => void;
  configure?: (cfg: unknown, helpers: DirectiveSourceHelpers) => unknown;
}

/** A descriptor that selects a built-in source type with options. */
export interface DirectiveSourceDescriptor {
  type?: string;
  enabled?: boolean;
  connectOnInit?: boolean;
  options?: SseConfig;
  sse?: SseConfig;
}

/** Options accepted by `createType()`. */
export interface CreateTypeOptions {
  fetch: ItemFetchFn;
  bulkFetch?: BulkFetchFn | null;
  stalenessMs?: number;
  levelConversionMap?: Record<string, LevelConversionEntry>;
  levels?: Record<string, CreateTypeLevelOptions>;
}

export type LevelConversionEntry =
  | string
  | string[]
  | boolean
  | { targets?: string[]; levels?: string[] }
  | ((data: unknown) => boolean)
  | null
  | undefined;

export interface CreateTypeLevelOptions {
  fetch: ItemFetchFn;
  checkIfExists?: (data: unknown) => boolean;
  stalenessMs?: number;
  bulkFetch?: BulkFetchFn | null;
  levelConversionMap?: Record<string, LevelConversionEntry>;
}

/** Options accepted by `createCollection()`. */
export interface CreateCollectionOptions {
  fetch: CollectionFetchFn;
  stalenessMs?: number;
}

/** Options accepted by `fetchItem()`. */
export interface FetchItemOptions {
  silent?: boolean;
  force?: boolean;
}

/** Options accepted by `fetchCollection()`. */
export interface FetchCollectionOptions {
  force?: boolean;
  params?: unknown;
}

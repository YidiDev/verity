// ---------------------------------------------------------------------------
// verity-dl  –  Public API
// ---------------------------------------------------------------------------

// Side-effect import: bootstraps the default directive source on G.
import "./init.js";

// ---- Core API -------------------------------------------------------------

export { init } from "./init.js";
export { onChange } from "./reactivity.js";
export { createType, createCollection } from "./registry.js";
export {
  fetchCollection,
  fetchItem,
  isItemLoading,
  isCollectionLoading,
  hasAnyInFlightRequests,
} from "./fetchers.js";
export { applyDirectives } from "./directives.js";
export { state, devtools, clientId } from "./devtools-introspection.js";
export { onLifecycle } from "./lifecycle.js";

// ---- Configuration --------------------------------------------------------

export {
  configureDirectiveSource,
  connectDirectiveSource,
  disconnectDirectiveSource,
  ingestDirectiveEnvelope,
} from "./directive-source.js";

export { configureSse, connectSse, disconnectSse } from "./sse.js";
export { configureMemory } from "./memory.js";

// ---- Type re-exports for consumers ---------------------------------------

export type {
  InitOptions,
  CreateTypeOptions,
  CreateTypeLevelOptions,
  CreateCollectionOptions,
  FetchItemOptions,
  FetchCollectionOptions,
  SseConfig,
  MemoryConfig,
  Directive,
  DirectiveResult,
  ApplyDirectivesOptions,
  DirectiveEnvelope,
  DirectiveSourceInput,
  CustomDirectiveSourceInput,
  DirectiveSourceDescriptor,
  DirectiveSourceHelpers,
  CollectionRef,
  CollectionData,
  CollectionMeta,
  ItemRef,
  ItemMeta,
  LifecyclePayload,
} from "./types.js";

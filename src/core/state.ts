// ---------------------------------------------------------------------------
// verity-dl  –  Global mutable state singleton
// ---------------------------------------------------------------------------

import type { GlobalState } from "./types.js";
import {
  DEFAULT_BULK_DELAY_MS,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_RESYNC_ITEM_LAST_USED_WINDOW_MS,
} from "./constants.js";

/**
 * The single mutable state object that all modules read from and write to.
 *
 * This mirrors the `G` object from the original IIFE-based core.js.
 * By exporting it from one place, we avoid circular imports between the
 * SSE, directive, and fetcher modules — each imports `G` from here
 * rather than from each other.
 */
export const G: GlobalState = {
  types: new Map(),
  collections: new Map(),

  listeners: [],
  directiveSource: null,

  sse: {
    enabled: true,
    url: "/api/events",
    clientIdParam: "client_id",
    audienceParam: "audience",
    audience: "global",
    withCredentials: false,
    connectOnInit: true,
    source: null,
    connected: false,
    retryMs: 2000,
    initialRetryMs: 2000,
    maxRetryMs: 30000,
    backoffMultiplier: 2,
    seqByAudience: new Map(),
    resyncOnGap: true,
    resyncJitterMinMs: 1500,
    resyncJitterMaxMs: 3500,
    onResync: null,
    resyncTimer: null,
    resyncItemLastUsedWindowMs: DEFAULT_RESYNC_ITEM_LAST_USED_WINDOW_MS,
  },

  inFlightCol: new Map(),
  inFlightItm: new Map(),

  directiveRegistry: {
    seen: new Map(),
    ttlMs: 5 * 60 * 1000,
    maxSize: 2048,
  },

  bulk: {
    delayMs: DEFAULT_BULK_DELAY_MS,
    queues: new Map(),
  },

  memory: {
    ...DEFAULT_MEMORY_CONFIG,
    sweepTimer: null,
  },

  devtools: {
    lifecycle: {
      nextId: 1,
      byEvent: new Map(),
    },
  },
};

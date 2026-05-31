// ---------------------------------------------------------------------------
// verity-dl  –  SSE connection management
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import {
  CLIENT_ID,
  LEVEL_DEFAULT,
  DEFAULT_RESYNC_ITEM_LAST_USED_WINDOW_MS,
  fromLevelKey,
} from "./constants.js";
import { emitLifecycle } from "./lifecycle.js";
import {
  cloneForDiagnostics,
  hasAnyActiveLevels,
  parseMetaTimestamp,
} from "./helpers.js";
import { ingestDirectiveEnvelope } from "./directive-source.js";
import { _startCollectionFetch, _startItemFetch, planFetchLevels } from "./fetchers.js";
import type { SseConfig } from "./types.js";

// ---- Disconnect -----------------------------------------------------------

export function disconnectSse(): void {
  if (G.sse.source) {
    try {
      G.sse.source.close();
    } catch {
      /* ignore */
    }
    G.sse.source = null;
  }

  G.sse.connected = false;
  G.sse.retryMs = G.sse.initialRetryMs;

  if (G.sse.resyncTimer) {
    clearTimeout(G.sse.resyncTimer);
    G.sse.resyncTimer = null;
  }

  emitLifecycle("sse:disconnect", {});
}

// ---- Connect --------------------------------------------------------------

export function connectSse(
  { force = false }: { force?: boolean } = {},
): void {
  if (!G.sse.enabled) return;
  if (typeof EventSource === "undefined") return;

  if (G.sse.source) {
    if (!force) return;
    try {
      G.sse.source.close();
    } catch {
      /* ignore */
    }
    G.sse.source = null;
  }

  G.sse.retryMs = G.sse.initialRetryMs;
  emitLifecycle("sse:connect:start", {
    url: G.sse.url,
    audience: G.sse.audience,
    withCredentials: G.sse.withCredentials,
  });

  const connect = (): void => {
    if (!G.sse.enabled) return;

    let target: URL;
    try {
      target = new URL(G.sse.url, window.location.origin);
    } catch {
      return;
    }

    target.searchParams.set(G.sse.clientIdParam, CLIENT_ID);

    if (
      G.sse.audienceParam &&
      G.sse.audience !== undefined &&
      G.sse.audience !== null
    ) {
      target.searchParams.set(
        G.sse.audienceParam,
        String(G.sse.audience),
      );
    }

    const es = new EventSource(target.toString(), {
      withCredentials: G.sse.withCredentials,
    });
    G.sse.source = es;

    es.onopen = (): void => {
      G.sse.connected = true;
      G.sse.retryMs = G.sse.initialRetryMs;
      emitLifecycle("sse:open", {
        url: G.sse.url,
        audience: G.sse.audience,
      });
    };

    es.onmessage = (event: MessageEvent): void => {
      if (!event || !event.data) return;

      let payload: unknown;
      try {
        payload = JSON.parse(event.data as string);
      } catch {
        return;
      }

      const obj = payload as Record<string, unknown>;
      emitLifecycle("sse:message", {
        type: obj.type,
        audience: (obj.audience as string) ?? "global",
      });

      ingestDirectiveEnvelope(obj);
    };

    es.onerror = (): void => {
      G.sse.connected = false;
      try {
        es.close();
      } catch {
        /* ignore */
      }

      if (G.sse.source === es) {
        G.sse.source = null;
      }

      if (!G.sse.enabled) return;

      const timeout = G.sse.retryMs;
      G.sse.retryMs = Math.min(
        G.sse.retryMs * G.sse.backoffMultiplier,
        G.sse.maxRetryMs,
      );
      emitLifecycle("sse:error", { retryInMs: timeout });
      setTimeout(connect, timeout);
    };
  };

  connect();
}

// ---- Resync scheduling ----------------------------------------------------

export function scheduleResync(
  context: Record<string, unknown> = {},
): void {
  if (G.sse.resyncTimer) return;

  const min = Math.max(0, Number(G.sse.resyncJitterMinMs) || 0);
  const maxRaw = Number(G.sse.resyncJitterMaxMs);
  const max =
    Number.isFinite(maxRaw) && maxRaw >= min ? maxRaw : min;
  const wait = min + Math.random() * (max - min);

  emitLifecycle("sse:resync-scheduled", {
    waitMs: wait,
    context: cloneForDiagnostics(context),
  });

  G.sse.resyncTimer = setTimeout(() => {
    G.sse.resyncTimer = null;
    emitLifecycle("sse:resync-dispatch", {
      context: cloneForDiagnostics(context),
    });

    if (typeof G.sse.onResync === "function") {
      try {
        const handled = G.sse.onResync({ ...context });
        if (handled === false) {
          emitLifecycle("sse:resync-cancelled", {
            context: cloneForDiagnostics(context),
          });
          return;
        }
      } catch {
        /* ignore handler errors, fallback to default */
      }
    }

    // Re-fetch all collections
    for (const [name] of G.collections) {
      try {
        _startCollectionFetch(name, { force: true });
      } catch {
        /* ignore unknown collection */
      }
    }

    // Re-fetch recently-used items
    const windowMsRaw = Number(G.sse.resyncItemLastUsedWindowMs);
    const hasFiniteWindow =
      Number.isFinite(windowMsRaw) && windowMsRaw >= 0;
    const lastUsedWindowMs = hasFiniteWindow
      ? windowMsRaw
      : DEFAULT_RESYNC_ITEM_LAST_USED_WINDOW_MS;
    const considerLastUsed = lastUsedWindowMs > 0;
    const now = Date.now();

    for (const [typeName, T] of G.types) {
      if (!T || !T.items || !T.items.size) continue;

      for (const [id, ref] of T.items) {
        if (!ref || !ref.meta) continue;

        const meta = ref.meta;
        if (meta.isLoading) continue;

        const hasActiveLevels = hasAnyActiveLevels(meta);
        const lastUsedTs = parseMetaTimestamp(meta.lastUsedAt);
        const usedRecently =
          considerLastUsed && Number.isFinite(lastUsedTs)
            ? now - lastUsedTs <= lastUsedWindowMs
            : false;

        if (!hasActiveLevels && !usedRecently) continue;

        const levelStamps =
          meta &&
          typeof meta.levelStamps === "object" &&
          meta.levelStamps
            ? meta.levelStamps
            : {};

        const levelsToRefresh = new Set<string>();

        for (const [levelKey, stamp] of Object.entries(levelStamps)) {
          if (!stamp) continue;
          const canonical =
            levelKey === LEVEL_DEFAULT ? LEVEL_DEFAULT : levelKey;
          if (
            canonical === LEVEL_DEFAULT ||
            T.levels[canonical]
          ) {
            levelsToRefresh.add(canonical);
          }
        }

        if (!levelsToRefresh.size) {
          if (ref.data) {
            levelsToRefresh.add(LEVEL_DEFAULT);
          }
        }

        if (!levelsToRefresh.size) {
          levelsToRefresh.add(LEVEL_DEFAULT);
        }

        const fetchPlan = planFetchLevels(T, levelsToRefresh);
        if (!fetchPlan.length) continue;

        for (const levelKey of fetchPlan) {
          const level = fromLevelKey(levelKey);
          try {
            _startItemFetch(typeName, id, level, {
              force: true,
              loud: false,
            });
          } catch {
            /* ignore unknown item/level */
          }
        }
      }
    }
  }, wait);
}

// ---- Sequence gap handling ------------------------------------------------

export function handleSequenceGap(
  audienceKey: string,
  lastSeq: number,
  incomingSeq: number,
): void {
  if (!G.sse.resyncOnGap) return;

  emitLifecycle("sse:gap", {
    audience: audienceKey,
    lastSeq,
    incomingSeq,
  });

  scheduleResync({
    reason: "gap",
    audience: audienceKey,
    lastSeq,
    incomingSeq,
  });
}

// ---- Configure SSE --------------------------------------------------------

export function configureSse(cfg: SseConfig = {}): void {
  if (!cfg || typeof cfg !== "object") return;

  const prev = { ...G.sse };

  if (typeof cfg.enabled === "boolean") G.sse.enabled = cfg.enabled;

  if (typeof cfg.url === "string" && cfg.url) {
    if (cfg.url !== G.sse.url) {
      try {
        void new URL(cfg.url, window.location.origin);
        G.sse.url = cfg.url;
      } catch {
        // ignore invalid url, keep previous value
      }
    }
  }

  if (typeof cfg.clientIdParam === "string" && cfg.clientIdParam) {
    G.sse.clientIdParam = cfg.clientIdParam;
  }

  if (typeof cfg.audienceParam === "string" && cfg.audienceParam) {
    G.sse.audienceParam = cfg.audienceParam;
  }

  if (cfg.audience !== undefined) {
    if (cfg.audience === null) G.sse.audience = null;
    else G.sse.audience = String(cfg.audience);
  }

  if (typeof cfg.withCredentials === "boolean") {
    G.sse.withCredentials = cfg.withCredentials;
  }

  if (typeof cfg.connectOnInit === "boolean") {
    G.sse.connectOnInit = cfg.connectOnInit;
  }

  if (
    typeof cfg.initialRetryMs === "number" &&
    cfg.initialRetryMs > 0
  ) {
    G.sse.initialRetryMs = cfg.initialRetryMs;
  }

  if (typeof cfg.maxRetryMs === "number" && cfg.maxRetryMs > 0) {
    G.sse.maxRetryMs = cfg.maxRetryMs;
  }

  if (G.sse.maxRetryMs < G.sse.initialRetryMs) {
    G.sse.maxRetryMs = G.sse.initialRetryMs;
  }

  if (
    typeof cfg.backoffMultiplier === "number" &&
    cfg.backoffMultiplier >= 1
  ) {
    G.sse.backoffMultiplier = cfg.backoffMultiplier;
  }

  if (typeof cfg.resyncOnGap === "boolean") {
    G.sse.resyncOnGap = cfg.resyncOnGap;
  }

  if (
    typeof cfg.resyncJitterMinMs === "number" &&
    cfg.resyncJitterMinMs >= 0
  ) {
    G.sse.resyncJitterMinMs = cfg.resyncJitterMinMs;
  }

  if (
    typeof cfg.resyncJitterMaxMs === "number" &&
    cfg.resyncJitterMaxMs >= 0
  ) {
    G.sse.resyncJitterMaxMs = cfg.resyncJitterMaxMs;
  }

  if (G.sse.resyncJitterMaxMs < G.sse.resyncJitterMinMs) {
    G.sse.resyncJitterMaxMs = G.sse.resyncJitterMinMs;
  }

  if (
    typeof cfg.resyncItemLastUsedWindowMs === "number" &&
    Number.isFinite(cfg.resyncItemLastUsedWindowMs) &&
    cfg.resyncItemLastUsedWindowMs >= 0
  ) {
    G.sse.resyncItemLastUsedWindowMs = cfg.resyncItemLastUsedWindowMs;
  }

  if (typeof cfg.onResync === "function") {
    G.sse.onResync = cfg.onResync;
  } else if (cfg.onResync === null) {
    G.sse.onResync = null;
  }

  G.sse.retryMs = G.sse.initialRetryMs;

  if (G.directiveSource && G.directiveSource.kind === "sse") {
    G.directiveSource.enabled = G.sse.enabled;
    G.directiveSource.connectOnInit = G.sse.connectOnInit !== false;
  }

  const shouldReconnect = Boolean(
    G.sse.source &&
      (prev.url !== G.sse.url ||
        prev.withCredentials !== G.sse.withCredentials ||
        prev.clientIdParam !== G.sse.clientIdParam ||
        prev.audienceParam !== G.sse.audienceParam ||
        prev.audience !== G.sse.audience),
  );

  if (!G.sse.enabled) {
    disconnectSse();
    return;
  }

  if (!prev.enabled && G.sse.enabled) {
    if (
      G.directiveSource &&
      G.directiveSource.kind === "sse" &&
      G.directiveSource.connectOnInit !== false
    ) {
      connectDirectiveSource({ force: true });
    }
  } else if (shouldReconnect) {
    connectDirectiveSource({ force: true });
  }
}

// Import connectDirectiveSource lazily to avoid circular dependency.
// The function is defined in directive-source.ts which imports from sse.ts.
// We use a late import at the module level -- by the time configureSse runs,
// directive-source.ts will have finished loading.
import { connectDirectiveSource } from "./directive-source.js";

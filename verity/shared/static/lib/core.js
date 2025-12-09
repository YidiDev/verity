;(function (global) {
"use strict";

const nowISO = () => new Date().toISOString();
const genQid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const genClientId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `client-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
};
const CLIENT_ID = genClientId();
const defaultCheck = () => true;
const LEVEL_DEFAULT = "default";
const toLevelKey = (levelName) => (levelName ? String(levelName) : LEVEL_DEFAULT);
const fromLevelKey = (levelKey) => (levelKey === LEVEL_DEFAULT ? null : levelKey);

const PARAM_DEFAULT_KEY = "__default__";
const DEFAULT_BULK_DELAY_MS = 50;
const DEFAULT_RESYNC_ITEM_LAST_USED_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

const DEFAULT_MEMORY_CONFIG = {
    enabled: true,
    pruneIntervalMs: 60_000,
    maxCollectionRefsPerCollection: 12,
    collectionEntryTtlMs: 10 * 60 * 1000,
    maxItemsPerType: 512,
    itemEntryTtlMs: 15 * 60 * 1000,
};

const G = {
    types: new Map(),       // name -> { items: Map(id->ref), levels: {name:{fetch,check,stalenessMs}}, fetch, stalenessMs }
    collections: new Map(), // name -> { refs: Map(paramKey->ref), ref, fetch, stalenessMs }

    listeners: [],
    directiveSource: null,
    // SSE state
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
    // In-flight request registries for coalescing
    inFlightCol: new Map(), // `${name}::${paramKey}` -> { promise }
    inFlightItm: new Map(), // key  -> { promise, loud:boolean }
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

G.directiveSource = {
    kind: "sse",
    enabled: true,
    connectOnInit: true,
    connect: (opts = {}) => connectSse(opts),
    disconnect: () => disconnectSse(),
};

function pruneDirectiveKeys(now = Date.now()) {
    const { seen, ttlMs, maxSize } = G.directiveRegistry;
    if (!seen.size) return;
    if (ttlMs) {
        for (const [key, ts] of seen) {
            if (now - ts > ttlMs) {
                seen.delete(key);
            }
        }
    }
    if (maxSize && seen.size > maxSize) {
        const entriesByAge = Array.from(seen.entries()).sort((a, b) => a[1] - b[1]);
        for (const [key] of entriesByAge) {
            if (seen.size <= maxSize) break;
            seen.delete(key);
        }
    }
}

function hasProcessedDirective(key, now = Date.now()) {
    if (!key) return false;
    const ts = G.directiveRegistry.seen.get(key);
    if (ts === undefined) return false;
    if (G.directiveRegistry.ttlMs && now - ts > G.directiveRegistry.ttlMs) {
        G.directiveRegistry.seen.delete(key);
        return false;
    }
    return true;
}

function rememberDirectiveKey(key, now = Date.now()) {
    if (!key) return;
    G.directiveRegistry.seen.set(key, now);
    pruneDirectiveKeys(now);
}

// ----- reactivity bridge -----
function onChange(cb) {
    if (typeof cb !== 'function') return () => {};
    G.listeners.push(cb);
    let active = true;
    return () => {
        if (!active) return;
        active = false;
        const idx = G.listeners.indexOf(cb);
        if (idx >= 0) G.listeners.splice(idx, 1);
    };
}
function notify() {
    for (const cb of G.listeners) {
        try { cb(); }
        catch { /* ignore listener errors */ }
    }
}

function emitLifecycle(eventName, detail = {}) {
    if (!eventName) return;
    const name = String(eventName);
    const clonedDetail = cloneForDiagnostics(detail);
    const payload = Object.freeze({ event: name, detail: clonedDetail, timestamp: nowISO() });
    const registry = G.devtools.lifecycle.byEvent;
    const dispatch = (bucket) => {
        if (!bucket || !bucket.size) return;
        for (const handler of bucket.values()) {
            try { handler(payload); }
            catch { /* ignore listener errors */ }
        }
    };
    dispatch(registry.get(name));
    dispatch(registry.get('*'));
}
function init(options = {}) {
    if (options && Object.prototype.hasOwnProperty.call(options, "directiveSource")) {
        configureDirectiveSource(options.directiveSource);
    } else if (options && typeof options.sse === "object") {
        configureSse(options.sse);
    }
    if (options && typeof options.memory === "object") configureMemory(options.memory);
    scheduleMemorySweep({ immediate: true });
    const src = G.directiveSource;
    if (src && src.enabled !== false && src.connectOnInit !== false) {
        connectDirectiveSource();
    }
}

function configureSse(cfg = {}) {
    if (!cfg || typeof cfg !== "object") return;

    const prev = { ...G.sse };

    if (typeof cfg.enabled === "boolean") G.sse.enabled = cfg.enabled;
    if (typeof cfg.url === "string" && cfg.url) {
        if (cfg.url !== G.sse.url) {
            try {
                // Validate/parses relative or absolute URLs
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
    if (typeof cfg.initialRetryMs === "number" && cfg.initialRetryMs > 0) {
        G.sse.initialRetryMs = cfg.initialRetryMs;
    }
    if (typeof cfg.maxRetryMs === "number" && cfg.maxRetryMs > 0) {
        G.sse.maxRetryMs = cfg.maxRetryMs;
    }
    if (G.sse.maxRetryMs < G.sse.initialRetryMs) {
        G.sse.maxRetryMs = G.sse.initialRetryMs;
    }
    if (typeof cfg.backoffMultiplier === "number" && cfg.backoffMultiplier >= 1) {
        G.sse.backoffMultiplier = cfg.backoffMultiplier;
    }
    if (typeof cfg.resyncOnGap === "boolean") {
        G.sse.resyncOnGap = cfg.resyncOnGap;
    }
    if (typeof cfg.resyncJitterMinMs === "number" && cfg.resyncJitterMinMs >= 0) {
        G.sse.resyncJitterMinMs = cfg.resyncJitterMinMs;
    }
    if (typeof cfg.resyncJitterMaxMs === "number" && cfg.resyncJitterMaxMs >= 0) {
        G.sse.resyncJitterMaxMs = cfg.resyncJitterMaxMs;
    }
    if (G.sse.resyncJitterMaxMs < G.sse.resyncJitterMinMs) {
        G.sse.resyncJitterMaxMs = G.sse.resyncJitterMinMs;
    }
    if (typeof cfg.resyncItemLastUsedWindowMs === "number" && Number.isFinite(cfg.resyncItemLastUsedWindowMs) && cfg.resyncItemLastUsedWindowMs >= 0) {
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
        G.sse.source && (
            prev.url !== G.sse.url ||
            prev.withCredentials !== G.sse.withCredentials ||
            prev.clientIdParam !== G.sse.clientIdParam ||
            prev.audienceParam !== G.sse.audienceParam ||
            prev.audience !== G.sse.audience
        )
    );

    if (!G.sse.enabled) {
        disconnectSse();
        return;
    }

    if (!prev.enabled && G.sse.enabled) {
        if (G.directiveSource && G.directiveSource.kind === "sse" && G.directiveSource.connectOnInit !== false) {
            connectDirectiveSource({ force: true });
        }
    } else if (shouldReconnect) {
        connectDirectiveSource({ force: true });
    }
}

function directiveSourceHelpers() {
    return {
        clientId: CLIENT_ID,
        applyDirectives,
        ingest: ingestDirectiveEnvelope,
        hasProcessedDirective,
        rememberDirectiveKey,
        scheduleResync,
        state,
    };
}

function configureDirectiveSource(source) {
    if (source === undefined) return;

    const prev = G.directiveSource;
    if (prev) {
        disconnectDirectiveSource(prev);
    }

    if (source === null || source === false) {
        G.directiveSource = null;
        G.sse.enabled = false;
        disconnectSse();
        return;
    }

    if (source === "sse") {
        G.directiveSource = {
            kind: "sse",
            enabled: true,
            connectOnInit: G.sse.connectOnInit !== false,
            connect: (opts = {}) => connectSse(opts),
            disconnect: () => disconnectSse(),
        };
        G.sse.enabled = true;
        return;
    }

    if (!source || typeof source !== "object") {
        G.directiveSource = {
            kind: "sse",
            enabled: G.sse.enabled,
            connectOnInit: G.sse.connectOnInit !== false,
            connect: (opts = {}) => connectSse(opts),
            disconnect: () => disconnectSse(),
        };
        return;
    }

    if (typeof source.connect === "function") {
        const normalized = {
            kind: source.name ? String(source.name) : String(source.type || "custom"),
            enabled: source.enabled !== false,
            connectOnInit: source.connectOnInit !== false,
            connect: (opts = {}) => {
                if (normalized.enabled === false) return;
                try {
                    return source.connect({ ...directiveSourceHelpers(), options: { ...opts } });
                } catch {
                    return undefined;
                }
            },
            disconnect: () => {
                if (typeof source.disconnect === "function") {
                    try {
                        source.disconnect(directiveSourceHelpers());
                    } catch {
                        /* ignore disconnect errors */
                    }
                }
            },
        };

        if (typeof source.configure === "function") {
            normalized.configure = (cfg) => {
                try {
                    return source.configure(cfg, directiveSourceHelpers());
                } catch {
                    return undefined;
                }
            };
        }

        G.directiveSource = normalized;
        return;
    }

    if (!source.type || source.type === "sse") {
        const enabled = typeof source.enabled === "boolean" ? source.enabled : G.sse.enabled;
        const connectOnInit = typeof source.connectOnInit === "boolean" ? source.connectOnInit : G.sse.connectOnInit !== false;
        G.sse.enabled = enabled;
        G.sse.connectOnInit = connectOnInit;
        const placeholder = {
            kind: "sse",
            enabled,
            connectOnInit,
            connect: (opts = {}) => connectSse(opts),
            disconnect: () => disconnectSse(),
        };
        G.directiveSource = placeholder;
        if (typeof source.options === "object" && source.options) {
            configureSse(source.options);
        } else if (typeof source.sse === "object" && source.sse) {
            configureSse(source.sse);
        }
        placeholder.enabled = G.sse.enabled;
        placeholder.connectOnInit = G.sse.connectOnInit !== false;
        return;
    }

    G.directiveSource = {
        kind: "sse",
        enabled: G.sse.enabled,
        connectOnInit: G.sse.connectOnInit !== false,
        connect: (opts = {}) => connectSse(opts),
        disconnect: () => disconnectSse(),
    };
}

function connectDirectiveSource(options = {}) {
    const src = G.directiveSource;
    if (!src || src.enabled === false) return;
    if (typeof src.connect === "function") {
        try {
            return src.connect({ ...options });
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function disconnectDirectiveSource(source = G.directiveSource) {
    const src = source || G.directiveSource;
    if (!src) return;
    if (src.kind === "sse") {
        disconnectSse();
        return;
    }
    if (typeof src.disconnect === "function") {
        try {
            src.disconnect();
        } catch {
            /* ignore disconnect errors */
        }
    }
}

function ingestDirectiveEnvelope(payload = {}) {
    if (!payload || typeof payload !== "object") return;

    if (payload.type === "hello") {
        const audienceKey = payload.audience ? String(payload.audience) : "global";
        if (typeof payload.last_seq === "number") {
            const prev = G.sse.seqByAudience.get(audienceKey);
            if (Number.isFinite(prev) && payload.last_seq > prev) {
                handleSequenceGap(audienceKey, prev, payload.last_seq);
            }
            G.sse.seqByAudience.set(audienceKey, payload.last_seq);
        }
        emitLifecycle("sse:hello", { audience: audienceKey, lastSeq: payload.last_seq });
        return;
    }

    if (payload.type === "directives" && Array.isArray(payload.directives)) {
        if (payload.source && String(payload.source) === CLIENT_ID) return;
        const audienceKey = payload.audience ? String(payload.audience) : "global";
        if (typeof payload.seq === "number") {
            const prev = G.sse.seqByAudience.get(audienceKey);
            if (Number.isFinite(prev) && payload.seq > prev + 1) {
                handleSequenceGap(audienceKey, prev, payload.seq);
            }
            const next = !Number.isFinite(prev) || payload.seq > prev ? payload.seq : prev;
            G.sse.seqByAudience.set(audienceKey, next);
        }
        emitLifecycle("directive:received", {
            audience: audienceKey,
            count: payload.directives.length,
            seq: payload.seq,
            source: payload.source || null,
        });
        return applyDirectives(payload.directives);
    }
}

function cancelMemorySweepTimer() {
    if (G.memory.sweepTimer) {
        clearTimeout(G.memory.sweepTimer);
        G.memory.sweepTimer = null;
    }
}

function scheduleMemorySweep({ immediate = false } = {}) {
    if (!G.memory.enabled || !(Number(G.memory.pruneIntervalMs) > 0)) {
        cancelMemorySweepTimer();
        emitLifecycle("memory:schedule:disabled", { reason: "disabled" });
        return;
    }

    const delay = immediate ? 0 : Number(G.memory.pruneIntervalMs);
    if (G.memory.sweepTimer !== null) {
        if (immediate) {
            cancelMemorySweepTimer();
            emitLifecycle("memory:schedule:cancel", { reason: "immediate" });
        } else {
            emitLifecycle("memory:schedule:skip", { reason: "existing" });
            return;
        }
    }

    emitLifecycle("memory:schedule", { immediate: !!immediate, delayMs: delay });
    G.memory.sweepTimer = setTimeout(() => {
        G.memory.sweepTimer = null;
        emitLifecycle("memory:sweep:timer", { scheduledAt: nowISO() });
        runMemorySweep();
    }, delay);
}

function configureMemory(cfg = {}) {
    if (!cfg || typeof cfg !== "object") return;

    if (typeof cfg.enabled === "boolean") {
        G.memory.enabled = cfg.enabled;
    }
    if (typeof cfg.pruneIntervalMs === "number" && cfg.pruneIntervalMs >= 0) {
        G.memory.pruneIntervalMs = cfg.pruneIntervalMs;
    }
    if (typeof cfg.maxCollectionRefsPerCollection === "number" && cfg.maxCollectionRefsPerCollection >= 0) {
        G.memory.maxCollectionRefsPerCollection = cfg.maxCollectionRefsPerCollection;
    }
    if (typeof cfg.collectionEntryTtlMs === "number" && cfg.collectionEntryTtlMs >= 0) {
        G.memory.collectionEntryTtlMs = cfg.collectionEntryTtlMs;
    }
    if (typeof cfg.maxItemsPerType === "number" && cfg.maxItemsPerType >= 0) {
        G.memory.maxItemsPerType = cfg.maxItemsPerType;
    }
    if (typeof cfg.itemEntryTtlMs === "number" && cfg.itemEntryTtlMs >= 0) {
        G.memory.itemEntryTtlMs = cfg.itemEntryTtlMs;
    }

    if (!G.memory.enabled) {
        cancelMemorySweepTimer();
    } else {
        scheduleMemorySweep({ immediate: true });
    }
}

function parseMetaTimestamp(ts) {
    if (!ts || typeof ts !== "string") return NaN;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : NaN;
}

function evictCollectionEntry(name, key, entry) {
    if (!entry || key === PARAM_DEFAULT_KEY) return;
    try {
        assignRef(entry, {
            data: { ids: [], count: 0 },
            meta: {
                ...entry.meta,
                isLoading: false,
                error: null,
                activeQueryId: null,
                lastFetched: null,
                lastUsedAt: null,
            },
        });
    } catch { /* ignore */ }

    const C = G.collections.get(name);
    if (C && C.refs) {
        C.refs.delete(key);
    }
}

function evictItemEntry(typeName, id, ref) {
    if (!ref) return;
    try {
        assignRef(ref, {
            data: null,
            meta: {
                ...ref.meta,
                isLoading: false,
                error: null,
                activeQueryId: null,
                lastFetchedAny: null,
                levelStamps: {},
                lastUsedAt: null,
                activeLevelQueryIds: Object.create(null),
            },
        });
    } catch { /* ignore */ }

    const T = G.types.get(typeName);
    if (T && T.items) {
        T.items.delete(id);
    }
}

function pruneCollections(now) {
    const ttl = Number(G.memory.collectionEntryTtlMs) || 0;
    const maxRefs = Number(G.memory.maxCollectionRefsPerCollection) || 0;
    const stats = { scanned: 0, evicted: 0 };

    for (const [name, C] of G.collections) {
        if (!C || !C.refs || C.refs.size <= 1) continue;
        const candidates = [];
        for (const [key, entry] of C.refs) {
            if (key === PARAM_DEFAULT_KEY) continue;
            const meta = entry.meta || {};
            if (meta.isLoading || meta.activeQueryId || hasAnyActiveLevels(meta)) continue;
            const parsed = parseMetaTimestamp(meta.lastUsedAt);
            const lastUsed = Number.isFinite(parsed) ? parsed : now;
            stats.scanned += 1;
            if (ttl > 0 && Number.isFinite(parsed) && now - parsed > ttl) {
                evictCollectionEntry(name, key, entry);
                stats.evicted += 1;
                continue;
            }
            candidates.push({ key, entry, lastUsed });
        }

        if (maxRefs > 0 && candidates.length > maxRefs) {
            candidates.sort((a, b) => {
                return a.lastUsed - b.lastUsed;
            });
            const excess = candidates.length - maxRefs;
            for (let i = 0; i < excess; i += 1) {
                const victim = candidates[i];
                evictCollectionEntry(name, victim.key, victim.entry);
                stats.evicted += 1;
            }
        }
    }
    return stats;
}

function pruneItems(now) {
    const ttl = Number(G.memory.itemEntryTtlMs) || 0;
    const maxItems = Number(G.memory.maxItemsPerType) || 0;
    const stats = { scanned: 0, evicted: 0 };

    for (const [typeName, T] of G.types) {
        if (!T || !T.items) continue;
        const candidates = [];
        for (const [id, ref] of T.items) {
            const meta = ref.meta || {};
            if (meta.isLoading || meta.activeQueryId || hasAnyActiveLevels(meta)) continue;
            const parsed = parseMetaTimestamp(meta.lastUsedAt);
            const lastUsed = Number.isFinite(parsed) ? parsed : now;
            stats.scanned += 1;
            if (ttl > 0 && Number.isFinite(parsed) && now - parsed > ttl) {
                evictItemEntry(typeName, id, ref);
                stats.evicted += 1;
                continue;
            }
            candidates.push({ id, ref, lastUsed });
        }

        if (maxItems > 0 && candidates.length > maxItems) {
            candidates.sort((a, b) => {
                return a.lastUsed - b.lastUsed;
            });
            const excess = candidates.length - maxItems;
            for (let i = 0; i < excess; i += 1) {
                const victim = candidates[i];
                evictItemEntry(typeName, victim.id, victim.ref);
                stats.evicted += 1;
            }
        }
    }
    return stats;
}

function runMemorySweep() {
    if (!G.memory.enabled) {
        cancelMemorySweepTimer();
        return;
    }

    const now = Date.now();
    emitLifecycle("memory:sweep:start", { timestamp: nowISO() });
    const colStats = pruneCollections(now);
    const itemStats = pruneItems(now);
    emitLifecycle("memory:sweep:finish", {
        timestamp: nowISO(),
        collections: colStats,
        items: itemStats,
    });

    if (G.memory.enabled && Number(G.memory.pruneIntervalMs) > 0) {
        G.memory.sweepTimer = setTimeout(() => {
            G.memory.sweepTimer = null;
            runMemorySweep();
        }, Number(G.memory.pruneIntervalMs));
    }
}

function disconnectSse() {
    if (G.sse.source) {
        try { G.sse.source.close(); } catch { }
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

function connectSse({ force = false } = {}) {
    if (!G.sse.enabled) return;
    if (typeof EventSource === "undefined") return;

    if (G.sse.source) {
        if (!force) return;
        try { G.sse.source.close(); } catch { }
        G.sse.source = null;
    }

    G.sse.retryMs = G.sse.initialRetryMs;
    emitLifecycle("sse:connect:start", { url: G.sse.url, audience: G.sse.audience, withCredentials: G.sse.withCredentials });

    const connect = () => {
        if (!G.sse.enabled) return;

        let target;
        try {
            target = new URL(G.sse.url, window.location.origin);
        } catch {
            return;
        }

        target.searchParams.set(G.sse.clientIdParam, CLIENT_ID);
        if (G.sse.audienceParam && G.sse.audience !== undefined && G.sse.audience !== null) {
            target.searchParams.set(G.sse.audienceParam, String(G.sse.audience));
        }

        const es = new EventSource(target.toString(), { withCredentials: G.sse.withCredentials });
        G.sse.source = es;

        es.onopen = () => {
            G.sse.connected = true;
            G.sse.retryMs = G.sse.initialRetryMs;
            emitLifecycle("sse:open", { url: G.sse.url, audience: G.sse.audience });
        };

        es.onmessage = (event) => {
            if (!event || !event.data) return;
            let payload;
            try { payload = JSON.parse(event.data); }
            catch { return; }

            emitLifecycle("sse:message", { type: payload.type, audience: payload.audience ?? "global" });
            ingestDirectiveEnvelope(payload);
        };

        es.onerror = () => {
            G.sse.connected = false;
            try { es.close(); } catch { }
            if (G.sse.source === es) {
                G.sse.source = null;
            }
            if (!G.sse.enabled) return;
            const timeout = G.sse.retryMs;
            G.sse.retryMs = Math.min(G.sse.retryMs * G.sse.backoffMultiplier, G.sse.maxRetryMs);
            emitLifecycle("sse:error", { retryInMs: timeout });
            setTimeout(connect, timeout);
        };
    };

    connect();
}

function scheduleResync(context = {}) {
    if (G.sse.resyncTimer) return;
    const min = Math.max(0, Number(G.sse.resyncJitterMinMs) || 0);
    const maxRaw = Number(G.sse.resyncJitterMaxMs);
    const max = Number.isFinite(maxRaw) && maxRaw >= min ? maxRaw : min;
    const wait = min + Math.random() * (max - min);
    emitLifecycle("sse:resync-scheduled", { waitMs: wait, context: cloneForDiagnostics(context) });
    G.sse.resyncTimer = setTimeout(() => {
        G.sse.resyncTimer = null;
        emitLifecycle("sse:resync-dispatch", { context: cloneForDiagnostics(context) });
        if (typeof G.sse.onResync === "function") {
            try {
                const handled = G.sse.onResync({ ...context });
                if (handled === false) {
                    emitLifecycle("sse:resync-cancelled", { context: cloneForDiagnostics(context) });
                    return;
                }
            } catch { /* ignore handler errors, fallback to default */ }
        }
        for (const [name] of G.collections) {
            try {
                _startCollectionFetch(name, { force: true });
            } catch { /* ignore unknown collection */ }
        }

        const windowMsRaw = Number(G.sse.resyncItemLastUsedWindowMs);
        const hasFiniteWindow = Number.isFinite(windowMsRaw) && windowMsRaw >= 0;
        const lastUsedWindowMs = hasFiniteWindow ? windowMsRaw : DEFAULT_RESYNC_ITEM_LAST_USED_WINDOW_MS;
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
                const usedRecently = considerLastUsed && Number.isFinite(lastUsedTs)
                    ? (now - lastUsedTs <= lastUsedWindowMs)
                    : false;
                if (!hasActiveLevels && !usedRecently) continue;

                const levelStamps = meta && typeof meta.levelStamps === "object" && meta.levelStamps
                    ? meta.levelStamps
                    : {};
                const levelsToRefresh = new Set();
                for (const [levelKey, stamp] of Object.entries(levelStamps)) {
                    if (!stamp) continue;
                    const canonical = levelKey === LEVEL_DEFAULT ? LEVEL_DEFAULT : levelKey;
                    if (canonical === LEVEL_DEFAULT || T.levels[canonical]) {
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
                        _startItemFetch(typeName, id, level, { force: true, loud: false });
                    } catch { /* ignore unknown item/level */ }
                }
            }
        }
    }, wait);
}

function handleSequenceGap(audienceKey, lastSeq, incomingSeq) {
    if (!G.sse.resyncOnGap) return;
    emitLifecycle("sse:gap", { audience: audienceKey, lastSeq, incomingSeq });
    scheduleResync({ reason: "gap", audience: audienceKey, lastSeq, incomingSeq });
}

// ---------- Registry ----------
function createType(name, { fetch, bulkFetch = null, stalenessMs = 15_000, levelConversionMap = {}, levels = {} }) {
    if (!name || typeof fetch !== "function") throw new Error("createType requires name and fetch(id)");

    if (G.types.has(name)) throw new Error(`Type '${name}' already exists`);
    const lvl = {};
    const convertFrom = new Map();
    const accepts = new Map();

    const normalizeConversionTargets = (entry, implicitTargetKey) => {
        if (entry == null) return [];
        if (Array.isArray(entry)) return entry;
        if (typeof entry === "string" && entry) return [entry];
        if (typeof entry === "object") {
            if (Array.isArray(entry.targets)) return entry.targets;
            if (Array.isArray(entry.levels)) return entry.levels;
        }
        if (entry === true) {
            if (implicitTargetKey != null) {
                return [implicitTargetKey === LEVEL_DEFAULT ? null : implicitTargetKey];
            }
            return [];
        }
        if (typeof entry === "function") {
            if (implicitTargetKey != null) {
                return [implicitTargetKey === LEVEL_DEFAULT ? null : implicitTargetKey];
            }
            return [];
        }
        if (implicitTargetKey != null) {
            return [implicitTargetKey === LEVEL_DEFAULT ? null : implicitTargetKey];
        }
        return [];
    };

    const registerConversions = (targetKey, map) => {
        if (!map || typeof map !== "object") return;
        for (const [fromName, entry] of Object.entries(map)) {
            const targets = normalizeConversionTargets(entry, targetKey);
            if (!targets || !targets.length) continue;
            const fromKey = toLevelKey(fromName === LEVEL_DEFAULT ? null : fromName);
            let fromSet = convertFrom.get(fromKey);
            if (!fromSet) {
                fromSet = new Set();
                convertFrom.set(fromKey, fromSet);
            }
            for (const targetName of targets) {
                const canonicalTarget = toLevelKey(targetName === LEVEL_DEFAULT ? null : targetName);
                if (canonicalTarget === fromKey) continue;
                fromSet.add(canonicalTarget);
                let targetAccepts = accepts.get(canonicalTarget);
                if (!targetAccepts) {
                    targetAccepts = new Set();
                    accepts.set(canonicalTarget, targetAccepts);
                }
                targetAccepts.add(fromKey);
            }
            if (!fromSet.size) {
                convertFrom.delete(fromKey);
            }
        }
    };

    for (const [levelName, cfg] of Object.entries(levels || {})) {
        if (!cfg || typeof cfg.fetch !== "function") throw new Error(`Level '${levelName}' needs fetch`);
        lvl[levelName] = {
            name: levelName,
            fetch: cfg.fetch,
            check: cfg.checkIfExists || defaultCheck,
            stalenessMs: cfg.stalenessMs ?? stalenessMs,
            bulkFetch: typeof cfg.bulkFetch === "function" ? cfg.bulkFetch : null,
        };
        if (cfg.levelConversionMap) {
            registerConversions(levelName, cfg.levelConversionMap);
        }
    }

    registerConversions(LEVEL_DEFAULT, levelConversionMap);

    G.types.set(name, {
        fetch,
        bulkFetch: typeof bulkFetch === "function" ? bulkFetch : null,
        stalenessMs,
        levels: lvl,
        items: new Map(),
        convertFrom,
        levelAccepts: accepts,
    });
}

function createCollection(name, { fetch, stalenessMs = 15_000 }) {
    if (!name || typeof fetch !== "function") throw new Error("createCollection requires name and fetch()");
    if (G.collections.has(name)) throw new Error(`Collection '${name}' already exists`);
    const ref = {
        data: { ids: [], count: 0 },
        meta: {
            isLoading: false,
            lastFetched: null,
            error: null,
            activeQueryId: null,
            paramsSnapshot: {},
            paramsKey: PARAM_DEFAULT_KEY,
            lastUsedAt: null,
        }
    };
    const refs = new Map([[PARAM_DEFAULT_KEY, ref]]);
    G.collections.set(name, { fetch, stalenessMs, ref, refs });

}

// ---------- Helpers ----------

function isStale(ts, ms) {
    if (!ts) return true;
    try { return (Date.now() - new Date(ts).getTime()) > ms; }
    catch { return true; }

}

function ensureItemRef(typeName, id) {
    const T = G.types.get(typeName);
    if (!T) throw new Error(`Unknown type '${typeName}'`);

    const now = nowISO();

    if (!T.items.has(id)) {
        T.items.set(id, {
            data: null,
            meta: {
                isLoading: false,
                error: null,
                activeQueryId: null,
                lastFetchedAny: null,              // any successful fetch
                levelStamps: Object.create(null),  // per-level lastFetched
                lastUsedAt: now,
                activeLevelQueryIds: Object.create(null),
            }

        });
    } else {
        const existing = T.items.get(id);
        if (existing && existing.meta) {
            existing.meta.lastUsedAt = now;
        }
    }
    return T.items.get(id);

}

function assignRef(ref, { data, meta }) {
    let changed = false;
    if (data !== undefined) { ref.data = data; changed = true; }
    if (meta !== undefined) { ref.meta = meta; changed = true; }
    if (changed) notify();
}

function cloneActiveLevelQueryIds(meta) {
    const src = meta && typeof meta.activeLevelQueryIds === "object" && meta.activeLevelQueryIds
        ? meta.activeLevelQueryIds
        : null;
    if (!src) return Object.create(null);
    return { ...src };
}

function setActiveLevelQueryId(meta, canonicalLevel, qid) {
    const next = cloneActiveLevelQueryIds(meta);
    next[canonicalLevel] = qid;
    return next;
}

function clearActiveLevelQueryId(meta, canonicalLevel, qid, { force = false } = {}) {
    const prev = meta && typeof meta.activeLevelQueryIds === "object" && meta.activeLevelQueryIds
        ? meta.activeLevelQueryIds
        : null;
    if (!prev) {
        return Object.create(null);
    }
    const current = prev[canonicalLevel];
    if (!force && current !== qid) {
        return { ...prev };
    }
    const next = { ...prev };
    delete next[canonicalLevel];
    return next;
}

function hasAnyActiveLevels(meta) {
    const map = meta && typeof meta.activeLevelQueryIds === "object" && meta.activeLevelQueryIds
        ? meta.activeLevelQueryIds
        : null;
    if (!map) return false;
    for (const key of Object.keys(map)) {
        if (map[key]) return true;
    }
    return false;
}

function isLevelActive(meta, canonicalLevel, qid) {
    if (!meta || typeof meta !== "object") return false;
    const map = meta.activeLevelQueryIds;
    if (!map || typeof map !== "object") return false;
    if (qid === undefined) {
        return Object.prototype.hasOwnProperty.call(map, canonicalLevel);
    }
    return map[canonicalLevel] === qid;
}

function finalizeItemMeta(ref, canonicalLevel, qid, overrides = {}, { force = false } = {}) {
    const meta = ref.meta || {};
    const nextActive = clearActiveLevelQueryId(meta, canonicalLevel, qid, { force });
    const prevActiveQueryId = meta.activeQueryId ?? null;
    const matchedActiveQuery = force || (prevActiveQueryId !== null && prevActiveQueryId === qid);
    const nextActiveQueryId = matchedActiveQuery ? null : prevActiveQueryId;

    const next = {
        ...meta,
        ...overrides,
        activeLevelQueryIds: nextActive,
        activeQueryId: Object.prototype.hasOwnProperty.call(overrides, "activeQueryId")
            ? overrides.activeQueryId
            : nextActiveQueryId,
    };

    if (!Object.prototype.hasOwnProperty.call(overrides, "isLoading")) {
        // If we have data, we're definitely not loading
        // This handles cases where coalesced requests may have mismatched query IDs
        if (ref.data != null) {
            next.isLoading = false;
        } else if (matchedActiveQuery || next.activeQueryId == null) {
            next.isLoading = false;
        }
    }

    return next;
}

function cloneParams(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof structuredClone === "function") {
        try { return structuredClone(value); }
        catch { /* ignore */ }
    }
    if (typeof value === "object") {
        try { return JSON.parse(JSON.stringify(value)); }
        catch { return value; }
    }
    return value;
}

function cloneForDiagnostics(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof structuredClone === "function") {
        try { return structuredClone(value); }
        catch { /* ignore */ }
    }
    if (typeof value === "object") {
        try { return JSON.parse(JSON.stringify(value)); }
        catch { return value; }
    }
    return value;
}

function deepFreeze(value) {
    if (!value || typeof value !== "object") return value;
    if (Object.isFrozen(value)) return value;
    Object.freeze(value);
    if (Array.isArray(value)) {
        for (const entry of value) { deepFreeze(entry); }
    } else {
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
        }
    }
    return value;
}

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepEqualParams(a, b) {
    if (a === b) return true;
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (!deepEqualParams(a[i], b[i])) return false;
        }
        return true;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
            if (!deepEqualParams(a[key], b[key])) return false;
        }
        return true;
    }
    return false;
}

function paramsContainsSubset(haystack, subset) {
    if (!isPlainObject(subset) || !Object.keys(subset).length) {
        return deepEqualParams(haystack, subset);
    }
    if (!isPlainObject(haystack)) return false;
    for (const key of Object.keys(subset)) {
        if (!Object.prototype.hasOwnProperty.call(haystack, key)) return false;
        if (!deepEqualParams(haystack[key], subset[key])) return false;
    }
    return true;
}

function matchesParamsSnapshot(snapshot, target, mode) {
    const actualSnapshot = snapshot ?? {};
    const desired = target ?? {};
    if (mode === "contains") {
        return paramsContainsSubset(actualSnapshot, desired);
    }
    return deepEqualParams(actualSnapshot, desired);
}

function normalizeForKey(value) {
    if (value === null) return null;
    if (Array.isArray(value)) return value.map(normalizeForKey);
    if (typeof value === "object") {
        const sorted = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = normalizeForKey(value[key]);
        }
        return sorted;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
        return String(value);
    }
    return value;
}

function paramsKey(params) {
    if (params === undefined || params === null) return PARAM_DEFAULT_KEY;
    if (typeof params === "object" && !Array.isArray(params)) {
        const keys = Object.keys(params);
        if (!keys.length) return PARAM_DEFAULT_KEY;
    }
    try {
        return JSON.stringify(normalizeForKey(params));
    } catch {
        return PARAM_DEFAULT_KEY;
    }
}

function ensureCollectionRefEntry(name, params) {
    const C = G.collections.get(name);
    if (!C) throw new Error(`Unknown collection '${name}'`);
    const key = paramsKey(params);
    const now = nowISO();
    if (key === PARAM_DEFAULT_KEY) {
        const snapshot = cloneParams(params);
        if (snapshot !== undefined) {
            const prevKey = paramsKey(C.ref.meta ? C.ref.meta.paramsSnapshot : undefined);
            const nextKey = paramsKey(snapshot);
            if (prevKey !== nextKey) {
                assignRef(C.ref, { meta: { ...C.ref.meta, paramsSnapshot: snapshot, paramsKey: key } });
            }
        }
        if (C.ref && C.ref.meta) {
            C.ref.meta.lastUsedAt = now;
        }
        return { ref: C.ref, key };
    }
    if (!C.refs.has(key)) {
        const snapshot = cloneParams(params);
        const entry = {
            data: { ids: [], count: 0 },
            meta: {
                isLoading: false,
                lastFetched: null,
                error: null,
                activeQueryId: null,
                paramsSnapshot: snapshot !== undefined ? snapshot : params,
                paramsKey: key,
                lastUsedAt: now,
            }
        };
        C.refs.set(key, entry);
    } else {
        const snapshot = cloneParams(params);
        if (snapshot !== undefined) {
            const existing = C.refs.get(key);
            const prevKey = paramsKey(existing.meta ? existing.meta.paramsSnapshot : undefined);
            const nextKey = paramsKey(snapshot);
            if (prevKey !== nextKey) {
                assignRef(existing, { meta: { ...existing.meta, paramsSnapshot: snapshot, paramsKey: key } });
            }
        }
    }
    const entry = C.refs.get(key);
    if (entry && entry.meta) {
        entry.meta.lastUsedAt = now;
    }
    return { ref: entry, key };
}

function itemKey(typeName, id, levelName) {
    return `${typeName}:${id}:${toLevelKey(levelName)}`;
}

function applyFetchedLevel(T, typeName, id, ref, sourceLevelKey, data, timestamp, qid = null, options = {}) {
    let nextData = { ...(ref.data || {}), ...(data || {}) };
    const nextLevelStamps = { ...ref.meta.levelStamps };

    const levelSatisfies = (levelKey) => {
        const cfg = levelKey === LEVEL_DEFAULT ? null : T.levels[levelKey];
        const checkFn = cfg && typeof cfg.check === "function" ? cfg.check : defaultCheck;
        try {
            return !!checkFn(nextData);
        } catch {
            return false;
        }
    };

    const visited = new Set();
    const queue = [];

    const enqueueIfSatisfied = (levelKey) => {
        if (visited.has(levelKey)) return false;
        visited.add(levelKey);
        if (!levelSatisfies(levelKey)) return false;
        nextLevelStamps[levelKey] = timestamp;
        queue.push(levelKey);
        return true;
    };

    nextLevelStamps[sourceLevelKey] = timestamp;
    enqueueIfSatisfied(sourceLevelKey);

    while (queue.length) {
        const current = queue.shift();
        const edges = T.convertFrom.get(current);
        if (!edges || !edges.size) continue;
        for (const targetKey of edges) {
            if (targetKey === current) continue;
            enqueueIfSatisfied(targetKey);
        }
    }

    const overrides = {
        error: null,
        lastFetchedAny: timestamp,
        levelStamps: nextLevelStamps,
    };
    const nextMeta = finalizeItemMeta(ref, sourceLevelKey, qid, overrides, options);

    assignRef(ref, { data: nextData, meta: nextMeta });
}

function bulkQueueKey(typeName, canonicalLevel) {
    return `${typeName}::${canonicalLevel}`;
}

function queueBulkItemFetch({ typeName, id, canonicalLevel, levelArg, ref, qid, bulkFetcher, fallbackFetcher }) {
    const queueKey = bulkQueueKey(typeName, canonicalLevel);
    let bucket = G.bulk.queues.get(queueKey);
    if (!bucket) {
        bucket = {
            typeName,
            canonicalLevel,
            levelArg,
            bulkFetcher,
            fallbackFetcher,
            entries: new Map(),
            timer: null,
        };
        G.bulk.queues.set(queueKey, bucket);
        emitLifecycle("bulk:queue:created", { queueKey, typeName, canonicalLevel });
    } else {
        if (typeof bulkFetcher === "function") bucket.bulkFetcher = bulkFetcher;
        if (typeof fallbackFetcher === "function") bucket.fallbackFetcher = fallbackFetcher;
        bucket.levelArg = levelArg;
    }

    const idKey = String(id);
    const existing = bucket.entries.get(idKey);
    const levelLabel = levelArg === "default" ? null : levelArg;
    if (existing && existing.promise) {
        existing.qid = qid;
        existing.ref = ref;
        existing.levelName = levelLabel;
        emitLifecycle("bulk:queue:coalesced", { queueKey, typeName, canonicalLevel, id, qid });
        return existing.promise;
    }

    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    bucket.entries.set(idKey, { id, ref, qid, resolve: resolvePromise, promise, levelName: levelLabel });
    emitLifecycle("bulk:queue:enqueue", { queueKey, typeName, canonicalLevel, id, qid });

    if (!bucket.timer) {
        bucket.timer = setTimeout(() => {
            bucket.timer = null;
            Promise.resolve(flushBulkQueue(queueKey)).catch(() => {});
        }, G.bulk.delayMs);
        emitLifecycle("bulk:queue:schedule", { queueKey, delayMs: G.bulk.delayMs, size: bucket.entries.size });
    }

    return promise;
}

async function flushBulkQueue(queueKey) {
    const bucket = G.bulk.queues.get(queueKey);
    if (!bucket) return;
    G.bulk.queues.delete(queueKey);
    if (bucket.timer) {
        clearTimeout(bucket.timer);
    }

    const entries = Array.from(bucket.entries.values());
    bucket.entries.clear();
    if (!entries.length) return;
    emitLifecycle("bulk:queue:flush", { queueKey, size: entries.length, typeName: bucket.typeName, canonicalLevel: bucket.canonicalLevel });

    const T = G.types.get(bucket.typeName);
    if (!T) {
        for (const entry of entries) {
            try { entry.resolve(); } catch { }
        }
        return;
    }

    const ids = entries.map((entry) => entry.id);
    const levelArg = bucket.levelArg;
    const canonicalLevel = bucket.canonicalLevel;

    let bulkError = null;
    let results;
    const fetcher = typeof bucket.bulkFetcher === "function" ? bucket.bulkFetcher : null;

    if (fetcher) {
        try {
            results = await fetcher(ids.slice(), levelArg, { type: bucket.typeName, level: levelArg, canonicalLevel });
        } catch (err) {
            bulkError = err;
        }
    } else {
        bulkError = new Error("No bulk fetcher registered");
    }

    const resultMap = new Map();
    if (!bulkError && Array.isArray(results)) {
        for (const item of results) {
            if (!item || typeof item !== "object") continue;
            const rid = item.id;
            if (rid === undefined || rid === null) continue;
            resultMap.set(String(rid), item);
        }
    } else if (!bulkError && results && typeof results === "object") {
        for (const [rid, value] of Object.entries(results)) {
            resultMap.set(rid, value);
        }
    }

    for (const entry of entries) {
        const { id, ref, qid, resolve } = entry;
        try {
            if (!ref || !ref.meta || !isLevelActive(ref.meta, canonicalLevel, qid)) {
                resolve();
                continue;
            }

            if (bulkError) {
                const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, { error: String(bulkError) });
                assignRef(ref, { meta: nextMeta });
                emitLifecycle("item:fetch:error", {
                    typeName: bucket.typeName,
                    id,
                    level: entry.levelName ?? null,
                    canonicalLevel,
                    qid,
                    error: String(bulkError),
                    strategy: "bulk",
                });
                resolve();
                continue;
            }

            const key = String(id);
            let data = resultMap.has(key) ? resultMap.get(key) : undefined;

            if (!resultMap.has(key) && typeof bucket.fallbackFetcher === "function") {
                try {
                    data = await bucket.fallbackFetcher(id, levelArg);
                } catch (fallbackErr) {
                    if (isLevelActive(ref.meta, canonicalLevel, qid)) {
                        const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, { error: String(fallbackErr) });
                        assignRef(ref, { meta: nextMeta });
                        emitLifecycle("item:fetch:error", {
                            typeName: bucket.typeName,
                            id,
                            level: entry.levelName ?? null,
                            canonicalLevel,
                            qid,
                            error: String(fallbackErr),
                            strategy: "bulk",
                        });
                    }
                    resolve();
                    continue;
                }
            }

            if (!isLevelActive(ref.meta, canonicalLevel, qid)) {
                emitLifecycle("item:fetch:aborted", {
                    typeName: bucket.typeName,
                    id,
                    level: entry.levelName ?? null,
                    canonicalLevel,
                    qid,
                    reason: "superseded",
                });
                resolve();
                continue;
            }

            if (data && typeof data === "object") {
                const timestamp = nowISO();
                applyFetchedLevel(T, bucket.typeName, id, ref, canonicalLevel, data, timestamp, qid);
                emitLifecycle("item:fetch:success", {
                    typeName: bucket.typeName,
                    id,
                    level: entry.levelName ?? null,
                    canonicalLevel,
                    qid,
                    strategy: "bulk",
                });
            } else {
                const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, { error: "Bulk fetch missing data" });
                assignRef(ref, { meta: nextMeta });
                emitLifecycle("item:fetch:error", {
                    typeName: bucket.typeName,
                    id,
                    level: entry.levelName ?? null,
                    canonicalLevel,
                    qid,
                    error: "Bulk fetch missing data",
                    strategy: "bulk",
                });
            }
        } catch (err) {
            if (ref && ref.meta && isLevelActive(ref.meta, canonicalLevel, qid)) {
                const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, { error: String(err) });
                assignRef(ref, { meta: nextMeta });
                emitLifecycle("item:fetch:error", {
                    typeName: bucket.typeName,
                    id,
                    level: entry.levelName ?? null,
                    canonicalLevel,
                    qid,
                    error: String(err),
                    strategy: "bulk",
                });
            }
        } finally {
            try { resolve(); } catch { }
        }
    }
}

// ---------- Actual fetchers (immediate + coalesced, latest-wins) ----------
async function _startCollectionFetch(name, { force = false, params = undefined } = {}) {
    const C = G.collections.get(name); if (!C) throw new Error(`Unknown collection '${name}'`);
    const { fetch, stalenessMs } = C;
    const { ref, key } = ensureCollectionRefEntry(name, params);
    const inFlightKey = `${name}::${key}`;
    const snapshot = cloneParams(params ?? ref.meta.paramsSnapshot ?? {});

    if (G.inFlightCol.has(inFlightKey)) {
        const bucket = G.inFlightCol.get(inFlightKey);
        if (!ref.meta.isLoading) assignRef(ref, { meta: { ...ref.meta, isLoading: true, error: null } });
        emitLifecycle("collection:fetch:coalesced", { name, params: snapshot, key: inFlightKey });
        return bucket.promise;
    }

    const shouldFetch = force || isStale(ref.meta.lastFetched, stalenessMs);
    if (!shouldFetch) {
        if (ref.meta.isLoading) assignRef(ref, { meta: { ...ref.meta, isLoading: false } });
        emitLifecycle("collection:fetch:skip", { name, params: snapshot, reason: "fresh" });
        return Promise.resolve();
    }

    const qid = genQid();
    assignRef(ref, { meta: { ...ref.meta, isLoading: true, error: null, activeQueryId: qid } });
    emitLifecycle("collection:fetch:intent", { name, params: snapshot, qid, force: !!force });

    const promise = (async () => {
        try {
            const data = await fetch(snapshot || {}); // { ids, count }
            if (ref.meta.activeQueryId !== qid) {
                emitLifecycle("collection:fetch:aborted", { name, params: snapshot, qid, reason: "superseded" });
                return; // superseded
            }
            assignRef(ref, {
                data: { ids: Array.isArray(data.ids) ? data.ids.slice() : [], count: Number(data.count ?? 0) },
                meta: { ...ref.meta, isLoading: false, lastFetched: nowISO(), error: null, activeQueryId: null }
            });
            emitLifecycle("collection:fetch:success", { name, params: snapshot, qid });
        } catch (e) {
            if (ref.meta.activeQueryId !== qid) {
                emitLifecycle("collection:fetch:aborted", { name, params: snapshot, qid, reason: "superseded" });
                return;
            }
            assignRef(ref, { meta: { ...ref.meta, isLoading: false, error: String(e), activeQueryId: null } });
            emitLifecycle("collection:fetch:error", { name, params: snapshot, qid, error: String(e) });
        } finally {
            G.inFlightCol.delete(inFlightKey);
            emitLifecycle("collection:fetch:complete", { name, params: snapshot, qid });
        }
    })();

    G.inFlightCol.set(inFlightKey, { promise });
    return promise;
}

async function _startItemFetch(typeName, id, levelName, { loud = false, force = false } = {}) {
    const T = G.types.get(typeName); if (!T) throw new Error(`Unknown type '${typeName}'`);
    const ref = ensureItemRef(typeName, id);
    const key = itemKey(typeName, id, levelName);
    const canonicalLevel = toLevelKey(levelName);
    const levelLabel = levelName == null ? null : levelName;
    const eventBase = { typeName, id, level: levelLabel, canonicalLevel };

    // If a request for this item/level is already in-flight, coalesce.
    if (G.inFlightItm.has(key)) {
        const bucket = G.inFlightItm.get(key);
        // If a later caller is loud, reflect spinner even though we're reusing the same request
        if (loud && !ref.meta.isLoading) assignRef(ref, { meta: { ...ref.meta, isLoading: true } });
        emitLifecycle("item:fetch:coalesced", { ...eventBase, loud: !!loud, key });
        return bucket.promise;
    }

    const isDefault = !levelName;
    const levelCfg = levelName ? T.levels[levelName] : null;
    const hasEnough = isDefault ? !!ref.data : !!(levelCfg && levelCfg.check(ref.data));

    const staleClock = ref.meta.levelStamps[canonicalLevel] || ref.meta.lastFetchedAny;
    const stalenessMs = levelCfg ? levelCfg.stalenessMs : T.stalenessMs;
    const stale = isStale(staleClock, stalenessMs);

    const needs = force || !hasEnough || stale;
    if (!needs) {
        if (loud && ref.meta.isLoading) assignRef(ref, { meta: { ...ref.meta, isLoading: false } });
        emitLifecycle("item:fetch:skip", { ...eventBase, loud: !!loud, force: !!force, reason: "fresh" });
        return Promise.resolve();
    }


    const qid = genQid();
    const nextActiveLevels = setActiveLevelQueryId(ref.meta, canonicalLevel, qid);
    // Spin if loud; otherwise keep current spinner state
    if (loud) {
        assignRef(ref, { meta: { ...ref.meta, isLoading: true, error: null, activeQueryId: qid, activeLevelQueryIds: nextActiveLevels } });
    } else {
        assignRef(ref, { meta: { ...ref.meta, error: null, activeLevelQueryIds: nextActiveLevels } });
    }

    const fallbackFetcher = levelCfg ? levelCfg.fetch : T.fetch;
    const bulkFetcher = (levelCfg && typeof levelCfg.bulkFetch === "function")
        ? levelCfg.bulkFetch
        : (typeof T.bulkFetch === "function" ? T.bulkFetch : null);
    const levelArg = levelName != null ? levelName : "default";
    emitLifecycle("item:fetch:intent", { ...eventBase, qid, loud: !!loud, force: !!force, strategy: bulkFetcher ? "bulk" : "direct" });

    let promise;
    if (typeof bulkFetcher === "function") {
        promise = queueBulkItemFetch({
            typeName,
            id,
            canonicalLevel,
            levelArg,
            ref,
            qid,
            bulkFetcher,
            fallbackFetcher,
        });
        emitLifecycle("item:fetch:queued", { ...eventBase, qid, strategy: "bulk" });
    } else {
        promise = (async () => {
            try {
                const data = await fallbackFetcher(id, levelArg);
                if (!isLevelActive(ref.meta, canonicalLevel, qid)) {
                    emitLifecycle("item:fetch:aborted", { ...eventBase, qid, reason: "superseded" });
                    return; // superseded
                }
                const now = nowISO();
                applyFetchedLevel(T, typeName, id, ref, canonicalLevel, data, now, qid);
                emitLifecycle("item:fetch:success", { ...eventBase, qid, strategy: "direct" });
            } catch (e) {
                if (!isLevelActive(ref.meta, canonicalLevel, qid)) {
                    emitLifecycle("item:fetch:aborted", { ...eventBase, qid, reason: "superseded" });
                    return;
                }
                const nextMeta = finalizeItemMeta(ref, canonicalLevel, qid, { error: String(e) });
                assignRef(ref, { meta: nextMeta });
                emitLifecycle("item:fetch:error", { ...eventBase, qid, error: String(e), strategy: "direct" });
            }
        })();
    }

    G.inFlightItm.set(key, { promise, loud });
    promise.finally(() => {
        const bucket = G.inFlightItm.get(key);
        if (bucket && bucket.promise === promise) {
            G.inFlightItm.delete(key);
        }
        emitLifecycle("item:fetch:complete", { ...eventBase, qid });
    });
    return promise;
}

function hasConversionPath(T, fromKey, targetKey, visited = new Set()) {
    if (fromKey === targetKey) return true;
    if (visited.has(fromKey)) return false;
    visited.add(fromKey);
    const edges = T.convertFrom.get(fromKey);
    if (!edges || !edges.size) return false;
    for (const next of edges) {
        if (hasConversionPath(T, next, targetKey, visited)) return true;
    }
    return false;
}

function planFetchLevels(T, levelsSet) {
    if (!levelsSet || !levelsSet.size) return [];
    const fetchSet = new Set(levelsSet);
    for (const levelKey of [...fetchSet]) {
        fetchSet.delete(levelKey);
        let covered = false;
        for (const source of fetchSet) {
            if (hasConversionPath(T, source, levelKey, new Set())) {
                covered = true;
                break;
            }
        }
        if (!covered) {
            fetchSet.add(levelKey);
        }
    }
    if (!fetchSet.size && levelsSet.size) {
        fetchSet.add(levelsSet.values().next().value);
    }
    return Array.from(fetchSet);
}

// ---------- Public API (coalesced, immediate) ----------
function fetchCollection(name, opts = {}) {
    const C = G.collections.get(name);
    if (!C) throw new Error(`Unknown collection '${name}'`);
    const { ref } = ensureCollectionRefEntry(name, opts.params);
    ref.meta.lastUsedAt = nowISO();
    scheduleMemorySweep();
    _startCollectionFetch(name, opts);
    return ref;
}

function fetchItem(typeName, id, levelName = null, opts = {}) {

    const ref = ensureItemRef(typeName, id);
    ref.meta.lastUsedAt = nowISO();
    scheduleMemorySweep();
    // Don't set isLoading here - let _startItemFetch handle it based on whether fetch is actually needed
    _startItemFetch(typeName, id, levelName, { loud: !opts.silent, force: !!opts.force });
    return ref;
}

function normalizeDirectiveLevelEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    if (Object.prototype.hasOwnProperty.call(entry, "data")) {
        const payload = entry.data;
        if (!payload || typeof payload !== "object") return null;
        return { data: payload, ts: typeof entry.ts === "string" ? entry.ts : null };
    }
    return { data: entry, ts: typeof entry.ts === "string" ? entry.ts : null };
}

function applyCollectionDirectiveResult(name, result, params = undefined) {
    if (!result || typeof result !== "object") return false;
    const C = G.collections.get(name);
    if (!C) return false;
    const { ref } = ensureCollectionRefEntry(name, params);
    const payload = Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
    if (!payload || typeof payload !== "object") return false;
    if (!Array.isArray(payload.ids)) return false;
    const ids = payload.ids.slice();
    const count = Number.isFinite(payload.count) ? Number(payload.count) : ids.length;
    const ts = typeof result.ts === "string" ? result.ts : nowISO();
    assignRef(ref, {
        data: { ids, count },
        meta: { ...ref.meta, isLoading: false, error: null, lastFetched: ts, activeQueryId: null }
    });
    return true;
}

function applyItemDirectiveResult(T, typeName, id, ref, result) {
    const satisfied = new Set();
    if (!result || typeof result !== "object") return satisfied;
    const baseTs = typeof result.ts === "string" ? result.ts : nowISO();

    const applyLevel = (levelName, entry) => {
        const normalized = normalizeDirectiveLevelEntry(entry);
        if (!normalized || !normalized.data) return;
        const canonical = (() => {
            if (!levelName) return LEVEL_DEFAULT;
            const key = toLevelKey(levelName === LEVEL_DEFAULT ? null : levelName);
            if (key !== LEVEL_DEFAULT && !T.levels[key]) return null;
            return key;
        })();
        if (!canonical) return;
        const ts = typeof normalized.ts === "string" ? normalized.ts : baseTs;
        applyFetchedLevel(T, typeName, id, ref, canonical, normalized.data, ts, null, { force: true });
        const after = ref.meta && ref.meta.levelStamps ? ref.meta.levelStamps : {};
        for (const [levelKey, stamp] of Object.entries(after)) {
            if (stamp === ts) {
                satisfied.add(levelKey === LEVEL_DEFAULT ? LEVEL_DEFAULT : levelKey);
            }
        }
    };

    if (result.levels && typeof result.levels === "object") {
        for (const [levelName, entry] of Object.entries(result.levels)) {
            applyLevel(levelName, entry);
        }
    }

    if (typeof result.level === "string" && Object.prototype.hasOwnProperty.call(result, "data")) {
        applyLevel(result.level, { data: result.data, ts: result.ts });
    } else if (!result.levels && Object.prototype.hasOwnProperty.call(result, "data")) {
        applyLevel(null, { data: result.data, ts: result.ts });
    }

    return satisfied;
}

function applyDirectives(directives = [], options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const disableIdempotencyGuard = !!opts.disableIdempotencyGuard;
    const tasks = [];
    const now = Date.now();
    pruneDirectiveKeys(now);
    for (const d of directives) {
        if (!d || !d.op) continue;
        const key = typeof d.idempotency_key === "string" && d.idempotency_key ? d.idempotency_key : null;
        const detail = {
            directive: cloneForDiagnostics(d),
            idempotencyKey: key,
            op: d.op,
            triggered: [],
            satisfied: false,
        };
        if (key) {
            if (!disableIdempotencyGuard && hasProcessedDirective(key, now)) {
                emitLifecycle("directive:skipped", { ...detail, reason: "idempotent" });
                continue;
            }
            rememberDirectiveKey(key, now);
        }
        if (d.op === "refresh_collection") {
            const satisfied = applyCollectionDirectiveResult(d.name, d.result, d.params);
            detail.satisfied = !!satisfied;
            if (!satisfied) {
                const C = G.collections.get(d.name);
                if (d.params !== undefined) {
                    const matchMode = typeof d.params_mode === "string" ? d.params_mode : null;
                    if (matchMode === "contains" && C && C.refs && C.refs.size) {
                        const seenKeys = new Set();
                        for (const entry of C.refs.values()) {
                            const snapshot = entry && entry.meta ? entry.meta.paramsSnapshot : undefined;
                            if (matchesParamsSnapshot(snapshot, d.params, "contains")) {
                                const key = paramsKey(snapshot);
                                if (!seenKeys.has(key)) {
                                    seenKeys.add(key);
                                    const paramsClone = cloneParams(snapshot);
                                    tasks.push(_startCollectionFetch(d.name, { force: true, params: snapshot }));
                                    detail.triggered.push({ kind: "collection", name: d.name, params: paramsClone, mode: "contains" });
                                }
                            }
                        }
                        if (!seenKeys.size) {
                            const paramsClone = cloneParams(d.params);
                            tasks.push(_startCollectionFetch(d.name, { force: true, params: d.params }));
                            detail.triggered.push({ kind: "collection", name: d.name, params: paramsClone });
                        }
                    } else {
                        const paramsClone = cloneParams(d.params);
                        tasks.push(_startCollectionFetch(d.name, { force: true, params: d.params }));
                        detail.triggered.push({ kind: "collection", name: d.name, params: paramsClone });
                    }
                } else if (C && C.refs && C.refs.size) {
                    for (const entry of C.refs.values()) {
                        const paramsClone = cloneParams(entry.meta.paramsSnapshot);
                        tasks.push(_startCollectionFetch(d.name, { force: true, params: entry.meta.paramsSnapshot }));
                        detail.triggered.push({ kind: "collection", name: d.name, params: paramsClone });
                    }
                } else {
                    tasks.push(_startCollectionFetch(d.name, { force: true }));
                    detail.triggered.push({ kind: "collection", name: d.name, params: null });
                }
            }
        } else if (d.op === "refresh_item") {
            if (!G.types.has(d.name)) continue;

            const ref = ensureItemRef(d.name, d.id);
            const T = G.types.get(d.name);
            const satisfiedLevels = applyItemDirectiveResult(T, d.name, d.id, ref, d.result);
            detail.satisfied = satisfiedLevels.size > 0;
            detail.levelsSatisfied = Array.from(satisfiedLevels.values ? satisfiedLevels.values() : satisfiedLevels);
            const levelsToRefresh = new Set();
            const stamps = (ref.meta && ref.meta.levelStamps) ? ref.meta.levelStamps : {};

            for (const [levelName, stamp] of Object.entries(stamps)) {
                if (!stamp) continue;
                const levelKey = levelName === LEVEL_DEFAULT ? LEVEL_DEFAULT : levelName;
                if ((levelKey === LEVEL_DEFAULT || T.levels[levelKey]) && !satisfiedLevels.has(levelKey)) {
                    levelsToRefresh.add(levelKey);
                }
            }

            for (const [levelName, cfg] of Object.entries(T.levels)) {
                if (!cfg) continue;
                try {
                    if (typeof cfg.check === "function" && cfg.check(ref.data) && !satisfiedLevels.has(levelName)) {
                        levelsToRefresh.add(levelName);
                    }
                } catch { }
            }

            if (!levelsToRefresh.size && !satisfiedLevels.has(LEVEL_DEFAULT)) {
                if (ref.meta && ref.meta.lastFetchedAny) {
                    levelsToRefresh.add(LEVEL_DEFAULT);
                } else if (ref.data) {
                    levelsToRefresh.add(LEVEL_DEFAULT);
                }
            }

            if (!levelsToRefresh.size) continue;

            const fetchPlan = planFetchLevels(T, levelsToRefresh).filter(levelKey => !satisfiedLevels.has(levelKey));
            if (!fetchPlan.length) continue;
            for (const levelKey of fetchPlan) {
                const level = fromLevelKey(levelKey);
                tasks.push(_startItemFetch(d.name, d.id, level, { force: true, loud: true }));
                detail.triggered.push({ kind: "item", name: d.name, id: d.id, level });
            }
        } else if (d.op === "invalidate" && Array.isArray(d.targets)) {
            tasks.push(applyDirectives(d.targets, opts));
            detail.triggered.push({ kind: "cascade", count: d.targets.length });
        }

        emitLifecycle("directive:processed", detail);
    }

    return Promise.all(tasks);
}

function state() {

    return {

        types: G.types,
        collections: G.collections,

    };
}

function devtools() {
    const types = {};
    for (const [name, T] of G.types) {
        const items = {};
        if (T && T.items) {
            for (const [id, ref] of T.items) {
                items[id] = {
                    data: cloneForDiagnostics(ref.data),
                    meta: cloneForDiagnostics(ref.meta),
                };
            }
        }
        const levels = {};
        if (T && T.levels) {
            for (const [levelName, cfg] of Object.entries(T.levels)) {
                if (!cfg) continue;
                levels[levelName] = {
                    stalenessMs: cfg.stalenessMs,
                    hasBulkFetch: typeof cfg.bulkFetch === "function",
                    hasCustomCheck: cfg.check !== defaultCheck,
                };
            }
        }
        const convertFrom = {};
        if (T && T.convertFrom) {
            for (const [fromKey, set] of T.convertFrom) {
                convertFrom[fromKey] = Array.from(set || []);
            }
        }
        const levelAccepts = {};
        if (T && T.levelAccepts) {
            for (const [targetKey, set] of T.levelAccepts) {
                levelAccepts[targetKey] = Array.from(set || []);
            }
        }
        types[name] = {
            stalenessMs: T.stalenessMs,
            hasBulkFetch: typeof T.bulkFetch === "function",
            items,
            levels,
            convertFrom,
            levelAccepts,
        };
    }

    const collections = {};
    for (const [name, C] of G.collections) {
        const refs = {};
        if (C && C.refs) {
            for (const [key, ref] of C.refs) {
                refs[key] = {
                    data: cloneForDiagnostics(ref.data),
                    meta: cloneForDiagnostics(ref.meta),
                };
            }
        }
        collections[name] = {
            stalenessMs: C.stalenessMs,
            refs,
        };
    }

    const inFlightCollections = [];
    for (const [key, bucket] of G.inFlightCol) {
        inFlightCollections.push({
            key,
            pending: !!(bucket && bucket.promise),
        });
    }

    const inFlightItems = [];
    for (const [key, bucket] of G.inFlightItm) {
        inFlightItems.push({
            key,
            loud: !!(bucket && bucket.loud),
            pending: !!(bucket && bucket.promise),
        });
    }

    const directiveSeen = [];
    for (const [key, ts] of G.directiveRegistry.seen) {
        const iso = Number.isFinite(ts) ? new Date(ts).toISOString() : null;
        directiveSeen.push({ key, seenAt: iso });
    }

    const seqByAudience = {};
    for (const [audience, seq] of G.sse.seqByAudience) {
        seqByAudience[audience] = seq;
    }

    const bulkQueues = {};
    for (const [queueKey, bucket] of G.bulk.queues) {
        bulkQueues[queueKey] = {
            typeName: bucket.typeName,
            canonicalLevel: bucket.canonicalLevel,
            levelArg: bucket.levelArg,
            size: bucket.entries ? bucket.entries.size : 0,
            timerActive: !!bucket.timer,
        };
    }

    const snapshot = {
        clientId: CLIENT_ID,
        types,
        collections,
        inFlight: {
            collections: inFlightCollections,
            items: inFlightItems,
        },
        directiveRegistry: {
            ttlMs: G.directiveRegistry.ttlMs,
            maxSize: G.directiveRegistry.maxSize,
            seen: directiveSeen,
        },
        sse: {
            enabled: G.sse.enabled,
            url: G.sse.url,
            audience: G.sse.audience,
            connected: G.sse.connected,
            retryMs: G.sse.retryMs,
            initialRetryMs: G.sse.initialRetryMs,
            maxRetryMs: G.sse.maxRetryMs,
            backoffMultiplier: G.sse.backoffMultiplier,
            withCredentials: G.sse.withCredentials,
            resyncOnGap: G.sse.resyncOnGap,
            resyncTimerActive: !!G.sse.resyncTimer,
            seqByAudience,
        },
        bulk: {
            delayMs: G.bulk.delayMs,
            queues: bulkQueues,
        },
        memory: {
            enabled: G.memory.enabled,
            pruneIntervalMs: G.memory.pruneIntervalMs,
            maxCollectionRefsPerCollection: G.memory.maxCollectionRefsPerCollection,
            collectionEntryTtlMs: G.memory.collectionEntryTtlMs,
            maxItemsPerType: G.memory.maxItemsPerType,
            itemEntryTtlMs: G.memory.itemEntryTtlMs,
            sweepTimerActive: G.memory.sweepTimer !== null,
        },
    };

    return deepFreeze(snapshot);
}

function clientId() {
    return CLIENT_ID;
}

function onLifecycle(eventName, callback) {
    if (!eventName || typeof callback !== "function") return () => {};
    const name = eventName === "*" ? "*" : String(eventName);
    const registry = G.devtools.lifecycle.byEvent;
    let bucket = registry.get(name);
    if (!bucket) {
        bucket = new Map();
        registry.set(name, bucket);
    }
    const token = G.devtools.lifecycle.nextId++;
    bucket.set(token, callback);
    return () => {
        const target = registry.get(name);
        if (!target) return;
        target.delete(token);
        if (!target.size) {
            registry.delete(name);
        }
    };
}

const DLCore = {
    init,
    onChange,
    createType,
    createCollection,
    fetchCollection,
    fetchItem,
    applyDirectives,
    state,
    devtools,
    clientId,
    onLifecycle,
    configureDirectiveSource,
    configureSse,
    configureMemory,
    connectDirectiveSource,
    connectSse,
    disconnectDirectiveSource,
    disconnectSse,
    ingestDirectiveEnvelope,
};

// ES MODULE EXPORTS (for modern bundlers and ES imports)
if (typeof exports !== "undefined") {
    exports.init = init;
    exports.onChange = onChange;
    exports.createType = createType;
    exports.createCollection = createCollection;
    exports.fetchCollection = fetchCollection;
    exports.fetchItem = fetchItem;
    exports.applyDirectives = applyDirectives;
    exports.state = state;
    exports.devtools = devtools;
    exports.clientId = clientId;
    exports.onLifecycle = onLifecycle;
    exports.configureDirectiveSource = configureDirectiveSource;
    exports.configureSse = configureSse;
    exports.configureMemory = configureMemory;
    exports.connectDirectiveSource = connectDirectiveSource;
    exports.connectSse = connectSse;
    exports.disconnectDirectiveSource = disconnectDirectiveSource;
    exports.disconnectSse = disconnectSse;
    exports.ingestDirectiveEnvelope = ingestDirectiveEnvelope;
}

// UMD/Browser compatibility (for script tag loading)
const target = global || (typeof globalThis !== "undefined" ? globalThis : undefined);
if (target) {
    target.DLCore = DLCore;
}

// CommonJS default export (for backward compatibility)
if (typeof module !== "undefined" && module.exports) {
    module.exports = DLCore;
}

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

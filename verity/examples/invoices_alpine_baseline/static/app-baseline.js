;(function (global) {
    "use strict";

    const root = typeof global !== "undefined" && global ? global : (typeof window !== "undefined" ? window : this);

    const BENCH_VARIANT = "baseline";

    const createCounters = () => ({
        requests: {
            total: 0,
            success: 0,
            error: 0,
            byMethod: {},
            byPath: {},
            mutations: 0,
            byMutationPath: {},
        },
        cacheHits: {
            collection: 0,
            item: 0,
        },
        sse: {
            opened: 0,
            errors: 0,
            reconnects: 0,
        },
        directives: {
            received: 0,
            processed: 0,
        },
    });

    const preciseNow = () => (typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now());

    const sanitizeDetail = (value) => {
        if (value === undefined) return null;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (err) {
            return { note: "non-serializable", error: String(err) };
        }
    };

    const bench = (() => {
        const existing = root.__VDL_BENCH__;
        if (existing && existing.variant === BENCH_VARIANT) {
            return existing;
        }

        let requestSeq = 0;
        const instance = {
            variant: BENCH_VARIANT,
            version: "1.0",
            createdAt: new Date().toISOString(),
            events: [],
            counters: createCounters(),
            metadata: { resets: 0 },
            ready: false,
            readyAt: null,
        };

        const record = (event, detail = {}) => {
            if (!event) return;
            const payload = {
                event: String(event),
                ts: preciseNow(),
                iso: new Date().toISOString(),
                detail: sanitizeDetail(detail),
            };
            instance.events.push(payload);
            if (instance.events.length > 10_000) {
                instance.events.shift();
            }
            return payload;
        };

        Object.defineProperties(instance, {
            record: { value: record, enumerable: false },
            mark: { value: record, enumerable: false },
            nextRequestId: {
                value: () => {
                    requestSeq += 1;
                    return requestSeq;
                },
                enumerable: false,
            },
            reset: {
                value: () => {
                    instance.events.length = 0;
                    instance.counters = createCounters();
                    instance.createdAt = new Date().toISOString();
                    instance.metadata.resets += 1;
                    instance.ready = false;
                    instance.readyAt = null;
                    requestSeq = 0;
                },
                enumerable: false,
            },
        });

        root.__VDL_BENCH__ = instance;
        return instance;
    })();

    const scheduleUiUpdate = (detail) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => bench.record("ui:update", detail));
        } else {
            bench.record("ui:update", detail);
        }
    };

    if (typeof root.fetch === "function" && !root.__VDL_BENCH_FETCH_WRAPPED__) {
        const originalFetch = root.fetch.bind(root);
        root.fetch = async function baselineBenchFetch(resource, init = {}) {
            const requestId = bench.nextRequestId();
            let method = init && init.method ? init.method : undefined;
            if (!method && resource && typeof resource === "object" && resource.method) {
                method = resource.method;
            }
            const normalizedMethod = method ? String(method).toUpperCase() : "GET";
            const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod);
            let urlString = typeof resource === "string" ? resource : (resource && resource.url) ? resource.url : String(resource);
            let path = urlString;
            try {
                if (typeof window !== "undefined" && window.location) {
                    const parsed = new URL(urlString, window.location.origin);
                    path = parsed.pathname || urlString;
                }
            } catch {
                // keep raw path
            }

            bench.counters.requests.total += 1;
            bench.counters.requests.byMethod[normalizedMethod] = (bench.counters.requests.byMethod[normalizedMethod] || 0) + 1;
            bench.counters.requests.byPath[path] = (bench.counters.requests.byPath[path] || 0) + 1;
            if (isMutation) {
                bench.counters.requests.mutations += 1;
                bench.counters.requests.byMutationPath[path] = (bench.counters.requests.byMutationPath[path] || 0) + 1;
            }

            bench.record("fetch:start", { id: requestId, method: normalizedMethod, path, url: urlString });
            if (isMutation) {
                bench.record("mutation:start", { id: requestId, method: normalizedMethod, path });
            }
            const startedAt = preciseNow();
            try {
                const response = await originalFetch(resource, init);
                const durationMs = preciseNow() - startedAt;
                bench.counters.requests.success += 1;
                const detail = { id: requestId, status: response.status, method: normalizedMethod, path, durationMs };
                bench.record("fetch:success", detail);
                if (isMutation) {
                    bench.record("mutation:finish", { ...detail });
                }
                return response;
            } catch (error) {
                const durationMs = preciseNow() - startedAt;
                bench.counters.requests.error += 1;
                const detail = { id: requestId, method: normalizedMethod, path, durationMs, error: String(error && error.message ? error.message : error) };
                bench.record("fetch:error", detail);
                if (isMutation) {
                    bench.record("mutation:error", detail);
                }
                throw error;
            }
        };
        root.__VDL_BENCH_FETCH_WRAPPED__ = true;
    }

    let sseSeenOpen = false;

    const CLIENT_ID_STORAGE_KEY = "invoices-baseline-client-id";

    let clientId = loadStoredClientId();
    if (!clientId) {
        clientId = generateClientId();
        storeClientId(clientId);
    }

    function storageAvailable() {
        try {
            return typeof window !== "undefined" && window.localStorage && typeof window.localStorage.getItem === "function";
        } catch (err) {
            return false;
        }
    }

    function loadStoredClientId() {
        if (!storageAvailable()) {
            return root.__BASELINE_FALLBACK_CLIENT_ID__ || null;
        }
        try {
            const value = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
            return value || null;
        } catch (err) {
            return null;
        }
    }

    function storeClientId(value) {
        clientId = value;
        if (!storageAvailable()) {
            root.__BASELINE_FALLBACK_CLIENT_ID__ = value;
            return;
        }
        try {
            window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, value);
        } catch (err) {
            // ignore storage errors (private mode, etc.)
        }
    }

    function generateClientId() {
        return "baseline-" + Math.random().toString(16).slice(2) + Date.now().toString(16);
    }

    function buildHeaders(extra) {
        const headers = {
            Accept: "application/json",
        };
        if (clientId) {
            headers["X-Client-ID"] = clientId;
        }
        if (extra && typeof extra === "object") {
            for (const [key, value] of Object.entries(extra)) {
                headers[key] = value;
            }
        }
        return headers;
    }

    function stableStringify(value) {
        if (value === null || typeof value !== "object") {
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            return "[" + value.map((item) => stableStringify(item)).join(",") + "]";
        }
        const keys = Object.keys(value).sort();
        const parts = [];
        for (const key of keys) {
            parts.push(JSON.stringify(key) + ":" + stableStringify(value[key]));
        }
        return "{" + parts.join(",") + "}";
    }

    function normalizeParams(params) {
        if (!params || typeof params !== "object") {
            return {};
        }
        const normalized = {};
        for (const [key, value] of Object.entries(params)) {
            if (value === undefined) continue;
            normalized[key] = value;
        }
        return normalized;
    }

    function shallowEqual(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        for (const key of aKeys) {
            if (a[key] !== b[key]) return false;
        }
        return true;
    }

    function containsMatch(entryParams, directiveParams) {
        if (!directiveParams) return true;
        if (!entryParams) return false;
        for (const [key, value] of Object.entries(directiveParams)) {
            if (entryParams[key] !== value) {
                return false;
            }
        }
        return true;
    }

    async function fetchInvoicesCollection(params) {
        const url = new URL("/api/invoices", window.location.origin);
        if (params && typeof params === "object") {
            const { status, q, sort, direction } = params;
            if (status && status !== "all") url.searchParams.set("status", status);
            if (typeof q === "string" && q.trim()) url.searchParams.set("q", q.trim());
            if (sort) url.searchParams.set("sort", sort);
            if (direction) url.searchParams.set("direction", direction);
        }
        const res = await fetch(url.toString(), { headers: buildHeaders() });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || "Failed to load invoices");
        }
        return res.json();
    }

    async function fetchInvoiceLevel(id, level) {
        const levelParam = level === "expanded" ? "expanded" : "simplified";
        const res = await fetch(`/api/invoice/${id}?level=${encodeURIComponent(levelParam)}`, {
            headers: buildHeaders(),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || "Failed to load invoice");
        }
        return res.json();
    }

    async function fetchInvoiceBulk(ids, level) {
        if (!Array.isArray(ids) || !ids.length) {
            return [];
        }
        const url = new URL("/api/invoices/bulk", window.location.origin);
        const normalizedLevel = level === "expanded" ? "expanded" : "simplified";
        url.searchParams.set("level", normalizedLevel);
        const res = await fetch(url.toString(), {
            method: "POST",
            headers: buildHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ ids: ids.map((value) => Number(value)) }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || "Failed to load invoices");
        }
        return res.json();
    }

    const collectionFetchers = {
        invoices: fetchInvoicesCollection,
    };

    const itemFetchers = {
        invoice: fetchInvoiceLevel,
    };

    class EntryMeta {
        constructor() {
            this.isLoading = false;
            this.lastFetched = null;
            this.error = null;
            this.shouldRefetch = false;
            this.fetchPromise = null;
        }
    }

    class CollectionEntry {
        constructor(name, params) {
            this.kind = "collection";
            this.name = name;
            this.params = normalizeParams(params);
            this.key = `${name}::${stableStringify(this.params)}`;
            this.data = { ids: [], count: 0 };
            this.meta = new EntryMeta();
        }
    }

    class ItemEntry {
        constructor(type, id, level) {
            this.kind = "item";
            this.type = type;
            this.id = Number(id);
            this.level = level === "expanded" ? "expanded" : "simplified";
            this.meta = new EntryMeta();
            this.data = null;
        }
    }

    class DataStore {
        constructor() {
            this.collections = new Map();
            this.items = new Map();
            this.bulkQueues = new Map();
        }

        collectionKey(name, params) {
            const normalized = normalizeParams(params);
            return `${name}::${stableStringify(normalized)}`;
        }

        itemKey(type, id, level) {
            return `${type}::${Number(id)}::${level === "expanded" ? "expanded" : "simplified"}`;
        }

        ensureCollection(name, params) {
            const key = this.collectionKey(name, params);
            if (!this.collections.has(key)) {
                this.collections.set(key, new CollectionEntry(name, params));
            }
            return this.collections.get(key);
        }

        ensureItem(type, id, level) {
            const key = this.itemKey(type, id, level);
            if (!this.items.has(key)) {
                this.items.set(key, new ItemEntry(type, id, level));
            }
            return this.items.get(key);
        }

        async loadCollection(entry, { force = false } = {}) {
            const fetcher = collectionFetchers[entry.name];
            if (!fetcher) {
                entry.meta.error = new Error(`No fetcher for collection ${entry.name}`);
                return;
            }
            if (entry.meta.fetchPromise) {
                return entry.meta.fetchPromise;
            }
            if (!force && entry.meta.isLoading) {
                return entry.meta.fetchPromise;
            }
            entry.meta.isLoading = true;
            entry.meta.error = null;
            entry.meta.shouldRefetch = false;
            const startedAt = preciseNow();
            bench.record("collection:fetch:intent", { name: entry.name, params: entry.params, force });
            const promise = fetcher(entry.params)
                .then((result) => {
                    const ids = Array.isArray(result.ids) ? result.ids.slice() : [];
                    const count = typeof result.count === "number" ? result.count : ids.length;
                    entry.data = { ids, count };
                    entry.meta.lastFetched = Date.now();
                    const durationMs = preciseNow() - startedAt;
                    bench.record("collection:fetch:success", { name: entry.name, params: entry.params, count, durationMs });
                    if (!bench.ready) {
                        bench.ready = true;
                        bench.readyAt = preciseNow();
                        bench.record("app:ready", { reason: "collection-fetch-success", name: entry.name });
                    }
                    scheduleUiUpdate({ kind: "collection", name: entry.name, key: entry.key, count });
                    return entry.data;
                })
                .catch((err) => {
                    entry.meta.error = err;
                    const durationMs = preciseNow() - startedAt;
                    bench.record("collection:fetch:error", { name: entry.name, params: entry.params, error: String(err), durationMs });
                    throw err;
                })
                .finally(() => {
                    entry.meta.isLoading = false;
                    entry.meta.fetchPromise = null;
                    const durationMs = preciseNow() - startedAt;
                    bench.record("collection:fetch:complete", { name: entry.name, params: entry.params, durationMs });
                });
            entry.meta.fetchPromise = promise;
            return promise;
        }

        async loadItem(entry, { force = false } = {}) {
            const fetcher = itemFetchers[entry.type];
            if (!fetcher) {
                entry.meta.error = new Error(`No fetcher for item ${entry.type}`);
                return;
            }
            if (entry.meta.fetchPromise) {
                return entry.meta.fetchPromise;
            }
            if (!force && entry.meta.isLoading) {
                return entry.meta.fetchPromise;
            }
            entry.meta.isLoading = true;
            entry.meta.error = null;
            entry.meta.shouldRefetch = false;
            const startedAt = preciseNow();
            bench.record("item:fetch:intent", { type: entry.type, id: entry.id, level: entry.level, force });
            const promise = fetcher(entry.id, entry.level)
                .then((result) => {
                    entry.data = result;
                    entry.meta.lastFetched = Date.now();
                    const durationMs = preciseNow() - startedAt;
                    bench.record("item:fetch:success", { type: entry.type, id: entry.id, level: entry.level, durationMs });
                    if (entry.type === "invoice" && entry.level === "expanded" && result) {
                        const simplified = {
                            id: result.id,
                            title: result.title,
                            amount_cents: result.amount_cents,
                            status: result.status,
                            updated_at: result.updated_at,
                        };
                        const simplifiedEntry = this.ensureItem("invoice", entry.id, "simplified");
                        simplifiedEntry.data = simplified;
                        simplifiedEntry.meta.lastFetched = entry.meta.lastFetched;
                        simplifiedEntry.meta.isLoading = false;
                        simplifiedEntry.meta.shouldRefetch = false;
                    }
                    scheduleUiUpdate({ kind: "item", type: entry.type, id: entry.id, level: entry.level });
                    return entry.data;
                })
                .catch((err) => {
                    entry.meta.error = err;
                    const durationMs = preciseNow() - startedAt;
                    bench.record("item:fetch:error", { type: entry.type, id: entry.id, level: entry.level, error: String(err), durationMs });
                    throw err;
                })
                .finally(() => {
                    entry.meta.isLoading = false;
                    entry.meta.fetchPromise = null;
                    const durationMs = preciseNow() - startedAt;
                    bench.record("item:fetch:complete", { type: entry.type, id: entry.id, level: entry.level, durationMs });
                });
            entry.meta.fetchPromise = promise;
            return promise;
        }

        queueBulkFetch(type, level, id) {
            const normalizedLevel = level === "expanded" ? "expanded" : "simplified";
            const key = `${type}::${normalizedLevel}`;
            if (!this.bulkQueues.has(key)) {
                this.bulkQueues.set(key, { ids: new Set(), timer: null });
            }
            const bucket = this.bulkQueues.get(key);
            bucket.ids.add(Number(id));
            if (!bucket.timer) {
                bucket.timer = setTimeout(() => {
                    bucket.timer = null;
                    const ids = Array.from(bucket.ids);
                    bucket.ids.clear();
                    if (!ids.length) return;
                    if (type === "invoice") {
                        fetchInvoiceBulk(ids, normalizedLevel)
                            .then((items) => {
                                if (!Array.isArray(items)) return;
                                for (const item of items) {
                                    const entry = this.ensureItem(type, item.id, normalizedLevel);
                                    entry.data = item;
                                    entry.meta.lastFetched = Date.now();
                                    entry.meta.isLoading = false;
                                    entry.meta.shouldRefetch = false;
                                    scheduleUiUpdate({ kind: "item", type, id: item.id, level: normalizedLevel, source: "bulk" });
                                }
                            })
                            .catch(() => {
                                for (const targetId of ids) {
                                    const entry = this.ensureItem(type, targetId, normalizedLevel);
                                    entry.meta.shouldRefetch = true;
                                }
                            });
                    }
                }, 20);
            }
        }

        col(name, options = {}) {
            const params = options.params ? options.params : {};
            const entry = this.ensureCollection(name, params);
            const needsFetch = options.force || entry.meta.shouldRefetch || !entry.meta.lastFetched;
            if (needsFetch && !entry.meta.isLoading) {
                this.loadCollection(entry, { force: true });
            } else if (!entry.meta.lastFetched && !entry.meta.isLoading) {
                this.loadCollection(entry, { force: false });
            } else if (entry.meta.lastFetched && !entry.meta.isLoading) {
                bench.counters.cacheHits.collection += 1;
                bench.record("collection:cache-hit", { name, params: entry.params, key: entry.key });
            }
            return entry;
        }

        it(type, id, level = "default", options = {}) {
            const normalizedLevel = level === "default" ? "simplified" : level;
            const entry = this.ensureItem(type, id, normalizedLevel);
            const needsFetch = options.force || entry.meta.shouldRefetch || !entry.meta.lastFetched;
            if (needsFetch && !entry.meta.isLoading) {
                this.loadItem(entry, { force: true });
            } else if (!entry.meta.lastFetched && !entry.meta.isLoading) {
                if (normalizedLevel === "simplified") {
                    this.queueBulkFetch(type, normalizedLevel, id);
                } else {
                    this.loadItem(entry, { force: false });
                }
            } else if (entry.meta.lastFetched && !entry.meta.isLoading) {
                bench.counters.cacheHits.item += 1;
                bench.record("item:cache-hit", { type, id, level: normalizedLevel });
            }
            return entry;
        }

        reloadCollection(name, params = {}) {
            const entry = this.ensureCollection(name, params);
            entry.meta.shouldRefetch = true;
            return this.loadCollection(entry, { force: true });
        }

        reloadAllCollections(name) {
            const tasks = [];
            for (const entry of this.collections.values()) {
                if (entry.name !== name) continue;
                entry.meta.shouldRefetch = true;
                tasks.push(this.loadCollection(entry, { force: true }));
            }
            return Promise.allSettled(tasks);
        }

        markCollectionsDirty(name, predicate) {
            for (const entry of this.collections.values()) {
                if (entry.name !== name) continue;
                if (predicate && !predicate(entry)) continue;
                entry.meta.shouldRefetch = true;
            }
        }

        reloadItem(type, id, level = "simplified") {
            const entry = this.ensureItem(type, id, level);
            entry.meta.shouldRefetch = true;
            return this.loadItem(entry, { force: true });
        }

        markItemDirty(type, id, level) {
            if (level) {
                const entry = this.ensureItem(type, id, level);
                entry.meta.shouldRefetch = true;
                return;
            }
            const simplified = this.ensureItem(type, id, "simplified");
            simplified.meta.shouldRefetch = true;
            const expanded = this.ensureItem(type, id, "expanded");
            expanded.meta.shouldRefetch = true;
        }

        updateItemLevels(type, id, levels) {
            if (!levels || typeof levels !== "object") return;
            if (levels.simplified) {
                const entry = this.ensureItem(type, id, "simplified");
                entry.data = levels.simplified;
                entry.meta.lastFetched = Date.now();
                entry.meta.isLoading = false;
                entry.meta.shouldRefetch = false;
            }
            if (levels.expanded) {
                const entry = this.ensureItem(type, id, "expanded");
                entry.data = levels.expanded;
                entry.meta.lastFetched = Date.now();
                entry.meta.isLoading = false;
                entry.meta.shouldRefetch = false;
            }
        }
    }

    const dataStore = new DataStore();

    function handleDirective(directive) {
        if (!directive || typeof directive !== "object") return;
        const op = directive.op;
        let handled = false;
        if (op === "refresh_collection" && directive.name === "invoices") {
            const params = directive.params || {};
            const mode = directive.params_mode || "exact";
            dataStore.markCollectionsDirty("invoices", (entry) => {
                if (!params || Object.keys(params).length === 0) return true;
                if (mode === "contains") {
                    return containsMatch(entry.params, params);
                }
                if (mode === "exact") {
                    return shallowEqual(entry.params, params);
                }
                return true;
            });
            dataStore.reloadAllCollections("invoices");
            handled = true;
        } else if (op === "refresh_item" && directive.name === "invoice") {
            const id = directive.id;
            if (directive.result && directive.result.levels) {
                dataStore.updateItemLevels("invoice", id, directive.result.levels);
            } else if (id !== undefined) {
                dataStore.markItemDirty("invoice", id);
                dataStore.reloadItem("invoice", id, "simplified");
                dataStore.reloadItem("invoice", id, "expanded");
            }
            handled = true;
        }
        if (handled) {
            bench.counters.directives.processed += 1;
            bench.record("directive:processed", {
                op,
                name: directive.name,
                id: directive.id,
                params: directive.params,
            });
        }
    }

    function handleDirectiveBatch(directives) {
        if (!Array.isArray(directives)) return;
        if (directives.length) {
            bench.counters.directives.received += directives.length;
            bench.record("directive:received", {
                count: directives.length,
                directives: directives.map((dir) => ({
                    op: dir && dir.op,
                    name: dir && dir.name,
                    id: dir && dir.id,
                })),
            });
        }
        for (const directive of directives) {
            handleDirective(directive);
        }
    }

    function startEventStream() {
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
            return;
        }
        try {
            const url = new URL("/api/events", window.location.origin);
            if (clientId) {
                url.searchParams.set("client_id", clientId);
            }
            const es = new EventSource(url.toString());
            bench.record("sse:connect", { url: url.toString() });
            es.onopen = () => {
                bench.counters.sse.opened += 1;
                if (sseSeenOpen) {
                    bench.counters.sse.reconnects += 1;
                }
                sseSeenOpen = true;
                bench.record("sse:open", { url: url.toString() });
            };
            es.onmessage = (event) => {
                if (!event || !event.data) return;
                try {
                    const payload = JSON.parse(event.data);
                    if (!payload) return;
                    if (payload.type === "hello") {
                        if (payload.client_id && payload.client_id !== clientId) {
                            storeClientId(String(payload.client_id));
                        }
                        bench.record("sse:hello", { audience: payload.audience, lastSeq: payload.last_seq });
                        return;
                    }
                    if (payload.type === "directives" && Array.isArray(payload.directives)) {
                        bench.record("sse:message", { type: payload.type, count: payload.directives.length });
                        handleDirectiveBatch(payload.directives);
                    }
                } catch (err) {
                    console.warn("Failed to parse SSE payload", err);
                }
            };
            es.onerror = () => {
                // allow browser to handle retries
                bench.counters.sse.errors += 1;
                bench.record("sse:error", {});
            };
            return es;
        } catch (err) {
            console.warn("Failed to initialise SSE", err);
            bench.record("sse:connect-error", { error: String(err && err.message ? err.message : err) });
            return null;
        }
    }

    const eventStream = startEventStream();
    root.__BASELINE_EVENT_STREAM__ = eventStream;
    root.__BASELINE_START_EVENT_STREAM__ = startEventStream;

    async function mutate(method, url, body) {
        const normalizedMethod = method ? String(method).toUpperCase() : "GET";
        const options = {
            method: normalizedMethod,
            headers: buildHeaders({ "Content-Type": "application/json" }),
        };
        if (body !== undefined) {
            options.body = JSON.stringify(body);
        }
        bench.record("mutation:intent", {
            method: normalizedMethod,
            url,
            keys: body && typeof body === "object" ? Object.keys(body) : null,
        });
        const startedAt = preciseNow();
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const text = await response.text();
                const durationMs = preciseNow() - startedAt;
                bench.record("mutation:failure", {
                    method: normalizedMethod,
                    url,
                    status: response.status,
                    durationMs,
                    message: text || response.statusText,
                });
                throw new Error(text || `Request failed with status ${response.status}`);
            }
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const result = await response.json();
                bench.record("mutation:result", {
                    method: normalizedMethod,
                    url,
                    durationMs: preciseNow() - startedAt,
                    kind: "json",
                });
                return result;
            }
            const text = await response.text();
            bench.record("mutation:result", {
                method: normalizedMethod,
                url,
                durationMs: preciseNow() - startedAt,
                kind: "text",
            });
            return text;
        } catch (err) {
            bench.record("mutation:failure", {
                method: normalizedMethod,
                url,
                durationMs: preciseNow() - startedAt,
                error: String(err && err.message ? err.message : err),
            });
            throw err;
        }
    }

    const actions = {
        clientId() {
            return clientId;
        },
        createInvoice(payload) {
            return mutate("POST", "/api/invoice", payload).then((result) => {
                dataStore.reloadAllCollections("invoices");
                return result;
            });
        },
        updateInvoice(id, payload) {
            return mutate("PUT", `/api/invoice/${id}`, payload).then((result) => {
                dataStore.reloadAllCollections("invoices");
                dataStore.reloadItem("invoice", id, "simplified");
                dataStore.reloadItem("invoice", id, "expanded");
                return result;
            });
        },
        deleteInvoice(id) {
            return mutate("DELETE", `/api/invoice/${id}`).then((result) => {
                dataStore.reloadAllCollections("invoices");
                dataStore.markItemDirty("invoice", id);
                return result;
            });
        },
    };

    document.addEventListener("alpine:init", () => {
        if (!window.Alpine) return;
        Alpine.store("lib", {
            col: (name, options = {}) => dataStore.col(name, options),
            it: (type, id, level, options = {}) => dataStore.it(type, id, level, options),
            reloadCollection: (name, params = {}) => dataStore.reloadCollection(name, params),
            reloadItem: (type, id, level = "simplified") => dataStore.reloadItem(type, id, level),
        });

        Alpine.store("baseline", {
            actions,
            clientId: () => clientId,
            eventStream,
        });

        Alpine.store("ui", { detailId: null });

        Alpine.data("createInvoiceForm", () => ({
            title: "",
            amount: 1000,
            saving: false,
            async submit() {
                if (this.saving) return;
                this.saving = true;
                const payload = {
                    title: this.title && this.title.trim() ? this.title.trim() : "Untitled",
                    amount_cents: Number.isFinite(Number(this.amount)) ? Number(this.amount) : 0,
                };
                try {
                    await actions.createInvoice(payload);
                    this.title = "";
                    this.amount = 1000;
                } catch (err) {
                    console.error("Failed to create invoice", err);
                } finally {
                    this.saving = false;
                }
            },
        }));

        Alpine.data("invoicesPanel", () => ({
            statusFilter: "all",
            sortField: "updated_at",
            sortDir: "desc",
            search: "",
            _searchTimer: null,

            init() {
                this.$watch("statusFilter", () => this.refresh());
                this.$watch("sortField", () => this.refresh());
                this.$watch("sortDir", () => this.refresh());
                this.$watch("search", (value) => {
                    if (this._searchTimer) clearTimeout(this._searchTimer);
                    this._searchTimer = setTimeout(() => {
                        this.refresh();
                    }, 250);
                });
                window.addEventListener("invoices:set-status", (event) => {
                    if (!event || typeof event.detail === "undefined") return;
                    const next = event.detail === null ? "all" : String(event.detail);
                    this.statusFilter = next;
                });
            },

            params() {
                const params = { sort: this.sortField, direction: this.sortDir };
                if (this.statusFilter && this.statusFilter !== "all") params.status = this.statusFilter;
                const trimmed = typeof this.search === "string" ? this.search.trim() : "";
                if (trimmed) params.q = trimmed;
                return params;
            },

            col(opts = {}) {
                return Alpine.store("lib").col("invoices", { params: this.params(), ...opts });
            },

            ids() { return this.col().data.ids; },

            refresh(force = false) {
                return this.col({ force });
            },

            reload() { this.refresh(true); },

            row(id) { return Alpine.store("lib").it("invoice", id, "simplified", { silent: true }); },

            initialLoading() {
                const c = this.col();
                return c.meta.isLoading && !c.meta.lastFetched;
            },

            isEmptyLoading() {
                const c = this.col();
                return Array.isArray(c.data.ids) && c.data.ids.length === 0 && c.meta.isLoading;
            },

            isRowSkeleton(id) {
                const r = this.row(id);
                return !r.data;
            },

            isRowRefreshing(id) {
                const r = this.row(id);
                return !!r.data && r.meta.isLoading;
            },

            statusLabel() {
                if (this.statusFilter === "all") return "All statuses";
                return this.statusFilter.charAt(0).toUpperCase() + this.statusFilter.slice(1);
            },

            sortLabel() {
                if (this.sortField === "amount_cents") return "Amount";
                if (this.sortField === "title") return "Title";
                return "Updated";
            },

            openDetail(id) { this.$store.ui.detailId = id; }
        }));

        const statusLabels = {
            all: "All invoices",
            pending: "Pending",
            active: "Active",
            paused: "Paused",
        };

        Alpine.data("statusSummary", (status) => ({
            status,
            params() {
                if (this.status === "all") return undefined;
                return { status: this.status };
            },
            col() {
                const params = this.params();
                return Alpine.store("lib").col("invoices", params ? { params } : {});
            },
            label() { return statusLabels[this.status] || this.status; },
            count() {
                const ref = this.col();
                return ref.data.count;
            },
            isLoading() {
                const ref = this.col();
                return ref.meta.isLoading && !ref.meta.lastFetched;
            },
            refresh() {
                const params = this.params();
                Alpine.store("lib").col("invoices", params ? { params, force: true } : { force: true });
            }
        }));

        Alpine.data("detailPanel", () => ({
            _ref: null,
            _lastId: null,
            it() {
                const id = this.$store.ui.detailId;
                if (!id) {
                    this._ref = null;
                    this._lastId = null;
                    return null;
                }

                const changed = this._lastId !== id || !this._ref;
                const opts = changed ? { silent: false } : { silent: true };
                const ref = Alpine.store("lib").it("invoice", id, "expanded", opts);

                this._ref = ref;
                this._lastId = id;
                return ref;
            },
            isDetailSkeleton() {
                const ref = this.it();
                if (!ref) return false;
                const hasExpanded = !!(ref.data && typeof ref.data.description === "string");
                return !hasExpanded;
            },
            isDetailRefreshing() {
                const ref = this.it();
                return !!(ref && ref.data && ref.meta.isLoading);
            }
        }));
    });

    root.BaselineApp = {
        actions,
        store: dataStore,
        eventStream,
    };

})(typeof window !== "undefined" ? window : this);

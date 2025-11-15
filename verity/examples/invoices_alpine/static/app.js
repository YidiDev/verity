;(function (global) {
"use strict";

const root = global || (typeof globalThis !== "undefined" ? globalThis : this);
const DL = root && root.DL;
if (!DL) {
    throw new Error("DL must be available before app.js");
}

const BENCH_VARIANT = "verity";

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
    root.fetch = async function verityBenchFetch(resource, init = {}) {
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
            const parsed = new URL(urlString, window.location.origin);
            path = parsed.pathname || urlString;
        } catch {
            // keep raw string
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

DL.onLifecycle("*", ({ event, detail }) => {
    switch (event) {
        case "collection:fetch:intent":
            bench.record("collection:fetch:intent", {
                name: detail && detail.name,
                params: detail && detail.params,
                force: detail && detail.force,
                qid: detail && detail.qid,
            });
            break;
        case "collection:fetch:success":
            bench.record("collection:fetch:success", {
                name: detail && detail.name,
                params: detail && detail.params,
                qid: detail && detail.qid,
            });
            if (!bench.ready) {
                bench.ready = true;
                bench.readyAt = preciseNow();
                bench.record("app:ready", { reason: "collection-fetch-success", name: detail && detail.name });
            }
            scheduleUiUpdate({ kind: "collection", name: detail && detail.name });
            break;
        case "collection:fetch:complete":
            bench.record("collection:fetch:complete", {
                name: detail && detail.name,
                params: detail && detail.params,
                qid: detail && detail.qid,
            });
            break;
        case "collection:fetch:skip":
            bench.counters.cacheHits.collection += 1;
            bench.record("collection:cache-hit", {
                name: detail && detail.name,
                params: detail && detail.params,
                reason: detail && detail.reason,
            });
            break;
        case "item:fetch:intent":
            bench.record("item:fetch:intent", {
                type: detail && detail.type,
                id: detail && detail.id,
                level: detail && detail.level,
                qid: detail && detail.qid,
            });
            break;
        case "item:fetch:success":
            bench.record("item:fetch:success", {
                type: detail && detail.type,
                id: detail && detail.id,
                level: detail && detail.level,
                qid: detail && detail.qid,
                strategy: detail && detail.strategy,
            });
            scheduleUiUpdate({ kind: "item", type: detail && detail.type, id: detail && detail.id, level: detail && detail.level });
            break;
        case "item:fetch:complete":
            bench.record("item:fetch:complete", {
                type: detail && detail.type,
                id: detail && detail.id,
                level: detail && detail.level,
                qid: detail && detail.qid,
            });
            break;
        case "item:fetch:skip":
            bench.counters.cacheHits.item += 1;
            bench.record("item:cache-hit", {
                type: detail && detail.type,
                id: detail && detail.id,
                level: detail && detail.level,
                reason: detail && detail.reason,
            });
            break;
        case "directive:received": {
            const directives = detail && Array.isArray(detail.directives) ? detail.directives : [];
            bench.counters.directives.received += directives.length;
            const trimmed = directives.map((dir) => ({
                op: dir && dir.op,
                kind: dir && dir.kind,
                name: dir && dir.name,
                id: dir && dir.id,
                key: dir && dir.key,
                level: dir && dir.level,
            }));
            bench.record("directive:received", {
                count: directives.length,
                audience: detail && detail.audience,
                source: detail && detail.source,
                directives: trimmed,
            });
            break;
        }
        case "directive:processed":
            bench.counters.directives.processed += 1;
            bench.record("directive:processed", {
                op: detail && detail.directive && detail.directive.op,
                kind: detail && detail.directive && (detail.directive.kind || detail.directive.name),
                id: detail && detail.directive && detail.directive.id,
                level: detail && detail.directive && detail.directive.level,
            });
            break;
        case "sse:open":
            bench.counters.sse.opened += 1;
            if (sseSeenOpen) {
                bench.counters.sse.reconnects += 1;
            }
            sseSeenOpen = true;
            bench.record("sse:open", { audience: detail && detail.audience, url: detail && detail.url });
            break;
        case "sse:error":
            bench.counters.sse.errors += 1;
            bench.record("sse:error", { retryInMs: detail && detail.retryInMs });
            break;
        case "sse:resync-dispatch":
            bench.record("sse:resync", { context: detail && detail.context });
            break;
        default:
            break;
    }
});

const DIRECTIVE_HEADER_NAME = "X-Verity-Directive-Request";
const DIRECTIVE_HEADER_VALUE = "send me directives";

const directiveHeaders = (extra) => {
    const base = { [DIRECTIVE_HEADER_NAME]: DIRECTIVE_HEADER_VALUE };
    if (!extra) return base;
    if (typeof Headers !== "undefined" && extra instanceof Headers) {
        extra.forEach((value, key) => {
            base[key] = value;
        });
        return base;
    }
    if (typeof extra === "object") {
        return { ...base, ...extra };
    }
    return base;
};

DL.directiveHeaders = directiveHeaders;
DL.directiveHeaderName = DIRECTIVE_HEADER_NAME;
DL.directiveHeaderValue = DIRECTIVE_HEADER_VALUE;

DL.init({
    sse: {
        enabled: true,
        url: "/api/events",
        initialRetryMs: 1_500,
        maxRetryMs: 20_000,
        backoffMultiplier: 1.5,
    }
}); // no cross-tab option anymore

// ---- Register collection: invoices ----
DL.createCollection("invoices", {
    stalenessMs: 60_000,
    fetch: async (params = {}) => {
        const url = new URL("/api/invoices", window.location.origin);
        if (params && typeof params === "object") {
            const { status, q, sort, direction } = params;
            if (status && status !== "all") url.searchParams.set("status", status);
            if (typeof q === "string" && q.trim()) url.searchParams.set("q", q.trim());
            if (sort) url.searchParams.set("sort", sort);
            if (direction) url.searchParams.set("direction", direction);
        }
        const res = await fetch(url.toString(), { headers: DL.directiveHeaders() });

        if (!res.ok) throw new Error(await res.text());
        return res.json(); // { ids, count }
    }
});

// ---- Register type: invoice ----
DL.createType("invoice", {
    stalenessMs: 1_000_000,
    fetch: async (id) => {
        const res = await fetch(`/api/invoice/${id}?level=simplified`, { headers: DL.directiveHeaders() });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    bulkFetch: async (ids, level = "default") => {
        if (!Array.isArray(ids) || !ids.length) return [];
        const seen = new Set();
        const payloadIds = [];
        for (const value of ids) {
            const num = Number(value);
            if (!Number.isFinite(num)) continue;
            if (seen.has(num)) continue;
            seen.add(num);
            payloadIds.push(num);
        }
        if (!payloadIds.length) return [];
        const url = new URL("/api/invoices/bulk", window.location.origin);
        const normalizedLevel = level && level !== "default" ? level : "simplified";
        url.searchParams.set("level", normalizedLevel);
        const res = await fetch(url.toString(), {
            method: "POST",
            headers: DL.directiveHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ ids: payloadIds })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    levelConversionMap: {
        simplified: ["default"],
    },

    levels: {

        simplified: {
            fetch: async (id) => {
                const res = await fetch(`/api/invoice/${id}?level=simplified`, { headers: DL.directiveHeaders() });
                if (!res.ok) throw new Error(await res.text());
                return res.json();
            },
            checkIfExists: (obj) => !!(obj && typeof obj.title === "string" && typeof obj.amount_cents === "number"),
            levelConversionMap: {
                expanded: ["simplified"],
                default: ["simplified"],
            }
        },
        expanded: {
            fetch: async (id) => {
                const res = await fetch(`/api/invoice/${id}?level=expanded`, { headers: DL.directiveHeaders() });
                if (!res.ok) throw new Error(await res.text());
                return res.json();
            },

            checkIfExists: (obj) => !!(obj && typeof obj.description === "string")
        }
    }
});


// ---- Alpine glue ----
document.addEventListener('alpine:init', () => {
    Alpine.store('ui', { detailId: null });

    Alpine.data('invoicesPanel', () => ({
        statusFilter: 'all',
        sortField: 'updated_at',
        sortDir: 'desc',
        search: '',
        _searchTimer: null,

        init() {
            this.$watch('statusFilter', () => this.refresh());
            this.$watch('sortField', () => this.refresh());
            this.$watch('sortDir', () => this.refresh());
            this.$watch('search', (value) => {
                if (this._searchTimer) clearTimeout(this._searchTimer);
                this._searchTimer = setTimeout(() => {
                    this.refresh();
                }, 250);
            });
            window.addEventListener('invoices:set-status', (event) => {
                if (!event || typeof event.detail === 'undefined') return;
                const next = event.detail === null ? 'all' : String(event.detail);
                this.statusFilter = next;
            });
        },

        params() {
            const params = { sort: this.sortField, direction: this.sortDir };
            if (this.statusFilter && this.statusFilter !== 'all') params.status = this.statusFilter;
            const trimmed = typeof this.search === 'string' ? this.search.trim() : '';
            if (trimmed) params.q = trimmed;
            return params;
        },

        col(opts = {}) {
            return Alpine.store('lib').col('invoices', { params: this.params(), ...opts });
        },

        ids() { return this.col().data.ids; },

        refresh(force = false) {
            return this.col({ force });
        },

        reload() { this.refresh(true); },

        // Row accessor (simplified, silent background fetch)
        row(id) { return Alpine.store('lib').it('invoice', id, 'simplified', { silent: true }); },

        // Initial skeleton state: collection is loading and has never fetched
        initialLoading() {
            const c = this.col();
            return c.meta.isLoading && !c.meta.lastFetched;
        },

        isEmptyLoading() {
            const c = this.col();
            return Array.isArray(c.data.ids) && c.data.ids.length === 0 && c.meta.isLoading;
        },

        // A row should show skeleton cells when it has no data yet
        isRowSkeleton(id) {
            const r = this.row(id);
            return !r.data; // nothing yet → skeleton bars
        },

        // Row overlay (mask) only for refresh when data already exists
        isRowRefreshing(id) {
            const r = this.row(id);
            return !!r.data && r.meta.isLoading;
        },

        statusLabel() {
            if (this.statusFilter === 'all') return 'All statuses';
            return this.statusFilter.charAt(0).toUpperCase() + this.statusFilter.slice(1);
        },

        sortLabel() {
            if (this.sortField === 'amount_cents') return 'Amount';
            if (this.sortField === 'title') return 'Title';
            return 'Updated';
        },

        openDetail(id) { this.$store.ui.detailId = id; }
    }));

    const statusLabels = {
        all: 'All invoices',
        pending: 'Pending',
        active: 'Active',
        paused: 'Paused',
    };

    Alpine.data('statusSummary', (status) => ({
        status,
        params() {
            if (this.status === 'all') return undefined;
            return { status: this.status };
        },
        col() {
            const params = this.params();
            return Alpine.store('lib').col('invoices', params ? { params } : {});
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
            Alpine.store('lib').col('invoices', params ? { params, force: true } : { force: true });
        }
    }));

    Alpine.data('detailPanel', () => ({
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
            const ref = Alpine.store('lib').it('invoice', id, 'expanded', opts);

            this._ref = ref;
            this._lastId = id;
            return ref;
        },
        // Before expanded data arrives, render skeleton blocks
        isDetailSkeleton() {
            const ref = this.it();
            if (!ref) return false;
            const hasExpanded = !!(ref.data && typeof ref.data.description === 'string');
            return !hasExpanded; // show skeleton until we have expanded fields
        },
        // Show an overlay only when refreshing an already-rendered detail
        isDetailRefreshing() {
            const ref = this.it();

            return !!(ref && ref.data && ref.meta.isLoading);
        }
    }));

});



})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

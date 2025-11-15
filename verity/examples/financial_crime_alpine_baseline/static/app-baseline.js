;(function (global) {
    "use strict";

    const root = global || (typeof globalThis !== "undefined" ? globalThis : this);
    const win = typeof window !== "undefined" ? window : root;

    const CURRENT_USER = (root.AppConfig && root.AppConfig.currentUser) || "jordan.lee";
    const CLIENT_ID = (() => {
        try {
            const key = "fincrime-baseline-client";
            const existing = win.localStorage && win.localStorage.getItem(key);
            if (existing) return existing;
            const next = `baseline-${Math.random().toString(36).slice(2, 10)}`;
            win.localStorage && win.localStorage.setItem(key, next);
            return next;
        } catch (err) {
            return `baseline-${Math.random().toString(36).slice(2, 10)}`;
        }
    })();

    const CASE_TRANSITIONS = {
        "triage": ["needs_review", "awaiting_docs"],
        "needs_review": ["awaiting_docs", "ready_for_sar"],
        "awaiting_docs": ["needs_review", "ready_for_sar"],
        "ready_for_sar": ["sar_filed"],
        "sar_filed": ["closed"],
        "closed": [],
    };

    const STATUS_LABELS = {
        "triage": "Triage",
        "needs_review": "Needs Review",
        "awaiting_docs": "Awaiting Docs",
        "ready_for_sar": "Ready for SAR",
        "sar_filed": "SAR Filed",
        "closed": "Closed",
    };

    const REGION_LABELS = {
        "NA": "North America",
        "EMEA": "EMEA",
        "APAC": "APAC",
        "LATAM": "LATAM",
    };

    const RISK_BANDS = {
        "all": null,
        "low": { max: 40, label: "0-40" },
        "medium": { min: 41, max: 70, label: "41-70" },
        "high": { min: 71, label: "71+" },
    };

    function formatStatus(status) {
        if (!status) return "Unknown";
        return STATUS_LABELS[status] || status;
    }

    function formatDateDisplay(iso) {
        if (!iso) return "—";
        try {
            const date = new Date(iso);
            return date.toLocaleString();
        } catch (err) {
            return iso;
        }
    }

    function formatDate(iso) {
        if (!iso) return "—";
        try {
            const date = new Date(iso);
            return date.toLocaleDateString();
        } catch (err) {
            return iso;
        }
    }

    const NUMBER_FORMAT = new Intl.NumberFormat();
    const PERCENT_FORMATTERS = {
        0: new Intl.NumberFormat(undefined, { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 0 }),
        1: new Intl.NumberFormat(undefined, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        2: new Intl.NumberFormat(undefined, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    };

    function formatNumber(value, fallback = "0") {
        if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
        return NUMBER_FORMAT.format(value);
    }

    function formatPercent(value, digits = 0) {
        if (typeof value !== "number" || !Number.isFinite(value)) return "0%";
        const formatter = PERCENT_FORMATTERS[digits] || PERCENT_FORMATTERS[0];
        return formatter.format(value);
    }

    function defaultHeaders(extra = {}) {
        return Object.assign({
            "Accept": "application/json",
            "X-Client-ID": CLIENT_ID,
        }, extra);
    }

    function applyQuery(url, params) {
        if (!params || typeof params !== "object") return;
        Object.entries(params).forEach(([key, value]) => {
            if (value === undefined || value === null || value === "") return;
            url.searchParams.set(key, value);
        });
    }

    async function apiGet(path, params) {
        const url = new URL(path, win.location.origin);
        applyQuery(url, params);
        const res = await fetch(url.toString(), {
            method: "GET",
            headers: defaultHeaders(),
        });
        if (!res.ok) {
            const message = await res.text();
            throw new Error(message || res.statusText);
        }
        return res.json();
    }

    async function apiPost(path, body, params) {
        const url = new URL(path, win.location.origin);
        applyQuery(url, params);
        const res = await fetch(url.toString(), {
            method: "POST",
            headers: defaultHeaders({ "Content-Type": "application/json" }),
            body: body !== undefined ? JSON.stringify(body) : "{}",
        });
        if (!res.ok) {
            const message = await res.text();
            throw new Error(message || res.statusText);
        }
        if (res.status === 204) return null;
        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (err) {
            return null;
        }
    }

    function shallowEqual(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const key of keysA) {
            if (a[key] !== b[key]) return false;
        }
        return true;
    }

    function normalizeString(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim();
    }

    function transitionTargets(status) {
        return CASE_TRANSITIONS[status] || [];
    }

    function createEventStream(handler) {
        if (typeof EventSource === "undefined") {
            return null;
        }
        const params = new URLSearchParams({ audience: "global", client_id: CLIENT_ID });
        const connectUrl = `/api/events?${params.toString()}`;
        let source = null;
        let retry = 1500;
        const maxRetry = 20000;
        const multiplier = 1.5;

        function connect() {
            source = new EventSource(connectUrl, { withCredentials: false });
            source.onmessage = (event) => {
                if (!event || !event.data) return;
                try {
                    const payload = JSON.parse(event.data);
                    handler && handler(payload);
                } catch (err) {
                    console.error("Failed to parse SSE payload", err);
                }
            };
            source.onerror = () => {
                try {
                    source.close();
                } catch (err) {
                    // ignore
                }
                source = null;
                setTimeout(connect, retry);
                retry = Math.min(maxRetry, Math.ceil(retry * multiplier));
            };
        }

        connect();
        return {
            close() {
                if (source) {
                    try {
                        source.close();
                    } catch (err) {
                        // ignore
                    }
                }
            }
        };
    }

    function createCaseEntry() {
        return {
            levels: {
                simplified: { data: null, loading: false, error: null, ts: null },
                expanded: { data: null, loading: false, error: null, ts: null },
            },
        };
    }

    function ensureCaseEntry(map, id) {
        if (!map.has(id)) {
            map.set(id, createCaseEntry());
        }
        return map.get(id);
    }
    document.addEventListener("alpine:init", () => {
        const Alpine = root.Alpine || (win && win.Alpine);
        if (!Alpine) {
            console.warn("Alpine not detected; baseline stores not mounted");
            return;
        }

        Alpine.store("shell", {
            current: "operations",
            set(tab) {
                this.current = tab;
            },
            is(tab) {
                return this.current === tab;
            },
        });

        const casesStore = {
            filters: {
                status: "all",
                region: "all",
                riskBand: "all",
                sortField: "updated_at",
                sortDir: "desc",
                search: "",
            },
            ids: [],
            count: 0,
            loadingList: false,
            lastListParams: null,
            lastListKey: null,
            listError: null,
            _listPromise: null,
            detail: new Map(),
            timelines: new Map(),
            summary: { data: null, loading: false, error: null, ts: null },
            roster: { data: [], loading: false, loaded: false, error: null },
            selectedId: null,

            buildListParams() {
                const params = {
                    sort: this.filters.sortField || "updated_at",
                    direction: this.filters.sortDir || "desc",
                };
                if (this.filters.status && this.filters.status !== "all") {
                    params.status = this.filters.status;
                }
                if (this.filters.region && this.filters.region !== "all") {
                    params.region = this.filters.region;
                }
                const band = RISK_BANDS[this.filters.riskBand];
                if (band && typeof band.min === "number") {
                    params.risk_min = band.min;
                }
                if (band && typeof band.max === "number") {
                    params.risk_max = band.max;
                }
                const trimmed = normalizeString(this.filters.search);
                if (trimmed) {
                    params.q = trimmed;
                }
                return params;
            },

            updateFilters(updates) {
                this.filters = Object.assign({}, this.filters, updates || {});
            },

            async fetchList(force = false) {
                const params = this.buildListParams();
                const key = JSON.stringify(params);
                if (!force && this._listPromise && key === this.lastListKey) {
                    return this._listPromise;
                }
                if (!force && key === this.lastListKey && !this.loadingList) {
                    return Promise.resolve({ ids: this.ids, count: this.count });
                }
                this.loadingList = true;
                this.listError = null;
                this.lastListKey = key;
                const request = (async () => {
                    try {
                        const list = await apiGet("/api/cases", params);
                        const ids = Array.isArray(list.ids) ? list.ids : [];
                        this.ids = ids;
                        this.count = typeof list.count === "number" ? list.count : ids.length;
                        if (ids.length) {
                            try {
                                const rows = await apiPost("/api/cases/bulk", { ids }, { level: "simplified" });
                                if (Array.isArray(rows)) {
                                    rows.forEach((row) => {
                                        if (row && row.id !== undefined) {
                                            this.setCaseData(row.id, "simplified", row);
                                        }
                                    });
                                }
                            } catch (err) {
                                console.error("Failed to bulk hydrate cases", err);
                            }
                        }
                        return { ids: this.ids, count: this.count };
                    } catch (err) {
                        console.error("Failed to load cases", err);
                        this.listError = err;
                        throw err;
                    } finally {
                        this.loadingList = false;
                        this._listPromise = null;
                    }
                })();
                this._listPromise = request;
                return request;
            },

            getCaseEntry(id) {
                if (id === null || id === undefined) return createCaseEntry();
                return ensureCaseEntry(this.detail, Number(id));
            },

            getCase(id, level = "simplified") {
                const entry = this.getCaseEntry(id);
                return entry.levels[level] || { data: null, loading: false, error: null, ts: null };
            },

            setCaseData(id, level, data) {
                const entry = ensureCaseEntry(this.detail, Number(id));
                entry.levels[level] = {
                    data: data || null,
                    loading: false,
                    error: null,
                    ts: Date.now(),
                };
                this.detail.set(Number(id), entry);
            },

            setCaseLoading(id, level, loading = true) {
                const entry = ensureCaseEntry(this.detail, Number(id));
                const target = entry.levels[level] || { data: null, error: null };
                target.loading = loading;
                if (loading) {
                    target.error = null;
                }
                entry.levels[level] = target;
                this.detail.set(Number(id), entry);
            },

            async ensureCase(id, level = "simplified", opts = {}) {
                if (!id) return null;
                const numeric = Number(id);
                if (!Number.isFinite(numeric)) return null;
                const entry = this.getCase(numeric, level);
                if (!opts.force && entry.data && !entry.error) {
                    return entry.data;
                }
                this.setCaseLoading(numeric, level, true);
                try {
                    const data = await apiGet(`/api/case/${numeric}`, { level });
                    this.setCaseData(numeric, level, data);
                    return data;
                } catch (err) {
                    console.error("Failed to fetch case", err);
                    const existing = this.getCaseEntry(numeric);
                    const target = existing.levels[level] || {};
                    target.error = err;
                    target.loading = false;
                    existing.levels[level] = target;
                    this.detail.set(numeric, existing);
                    throw err;
                }
            },

            getTimelineEntry(id) {
                if (!this.timelines.has(id)) {
                    this.timelines.set(id, { data: { events: [] }, loading: false, error: null, ts: null });
                }
                return this.timelines.get(id);
            },

            timeline(id) {
                if (!id) return { data: { events: [] }, loading: false, error: null, ts: null };
                return this.getTimelineEntry(Number(id));
            },

            async ensureTimeline(id, opts = {}) {
                if (!id) return null;
                const numeric = Number(id);
                if (!Number.isFinite(numeric)) return null;
                const entry = this.getTimelineEntry(numeric);
                if (!opts.force && entry.data && entry.data.events && entry.data.events.length) {
                    return entry.data;
                }
                entry.loading = true;
                entry.error = null;
                this.timelines.set(numeric, entry);
                try {
                    const data = await apiGet(`/api/case/${numeric}/timeline`);
                    this.timelines.set(numeric, {
                        data: data || { events: [] },
                        loading: false,
                        error: null,
                        ts: Date.now(),
                    });
                    return data;
                } catch (err) {
                    console.error("Failed to fetch timeline", err);
                    entry.loading = false;
                    entry.error = err;
                    this.timelines.set(numeric, entry);
                    throw err;
                }
            },
            async fetchSummary(force = false) {
                if (!force && this.summary.data && !this.summary.error) {
                    return this.summary.data;
                }
                this.summary.loading = true;
                this.summary.error = null;
                try {
                    const data = await apiGet("/api/dashboard/summary");
                    this.summary = {
                        data,
                        loading: false,
                        error: null,
                        ts: Date.now(),
                    };
                    return data;
                } catch (err) {
                    console.error("Failed to fetch dashboard summary", err);
                    this.summary.loading = false;
                    this.summary.error = err;
                    throw err;
                }
            },

            shouldRefreshForParams(params, mode) {
                if (!params || typeof params !== "object" || Object.keys(params).length === 0) {
                    return true;
                }
                if (Object.prototype.hasOwnProperty.call(params, "status")) {
                    const current = this.filters.status;
                    if (current === "all" || current === params.status) {
                        return true;
                    }
                }
                if (Object.prototype.hasOwnProperty.call(params, "region")) {
                    const current = this.filters.region;
                    if (current === "all" || current.toLowerCase() === String(params.region).toLowerCase()) {
                        return true;
                    }
                }
                if (Object.prototype.hasOwnProperty.call(params, "case_id")) {
                    if (Number(params.case_id) === Number(this.selectedId)) {
                        return true;
                    }
                }
                if (mode === "exact") {
                    return shallowEqual(params, this.buildListParams());
                }
                return true;
            },

            applyCaseDirective(directive) {
                if (!directive) return;
                const id = directive.id;
                if (directive.result && directive.result.levels) {
                    const levels = directive.result.levels;
                    if (levels.simplified) {
                        this.setCaseData(id, "simplified", levels.simplified);
                    }
                    if (levels.expanded) {
                        this.setCaseData(id, "expanded", levels.expanded);
                    }
                } else if (directive.result && directive.result.data) {
                    this.setCaseData(id, "simplified", directive.result.data);
                } else if (directive.id) {
                    this.ensureCase(directive.id, "simplified", { force: true });
                }
            },

            applySummaryDirective(directive) {
                if (directive && directive.result && directive.result.data) {
                    this.summary = {
                        data: directive.result.data,
                        loading: false,
                        error: null,
                        ts: Date.now(),
                    };
                } else {
                    this.fetchSummary(true);
                }
            },

            applyCollectionDirective(directive) {
                if (!directive) return;
                const name = directive.name;
                if (name === "cases") {
                    if (this.shouldRefreshForParams(directive.params, directive.params_mode)) {
                        this.fetchList(true);
                    }
                } else if (name === "caseTimeline" && directive.params && directive.params.case_id) {
                    const caseId = Number(directive.params.case_id);
                    if (Number.isFinite(caseId)) {
                        if (caseId === Number(this.selectedId)) {
                            this.ensureTimeline(caseId, { force: true });
                        }
                        const entry = this.timelines.get(caseId);
                        if (entry && entry.data && entry.data.events) {
                            this.ensureTimeline(caseId, { force: true });
                        }
                    }
                }
            },

            async assignCase(id, assignedTo) {
                if (!id) return;
                await apiPost(`/api/case/${id}/assign`, { assigned_to: assignedTo || null });
                await Promise.all([
                    this.ensureCase(id, "simplified", { force: true }),
                    this.ensureCase(id, "expanded", { force: true }),
                    this.ensureTimeline(id, { force: true }),
                    this.fetchSummary(true).catch(() => {}),
                    this.fetchList(true).catch(() => {}),
                ]);
            },

            async transitionCase(id, nextStatus, note, extra = {}) {
                if (!id || !nextStatus) return;
                const payload = Object.assign({ next_status: nextStatus, note: note || null }, extra || {});
                await apiPost(`/api/case/${id}/transition`, payload);
                await Promise.all([
                    this.ensureCase(id, "simplified", { force: true }),
                    this.ensureCase(id, "expanded", { force: true }),
                    this.ensureTimeline(id, { force: true }),
                    this.fetchSummary(true).catch(() => {}),
                    this.fetchList(true).catch(() => {}),
                ]);
            },

            async addNote(id, payload) {
                if (!id) return;
                const notePayload = Object.assign({}, payload || {});
                await apiPost(`/api/case/${id}/notes`, notePayload);
                await Promise.all([
                    this.ensureCase(id, "simplified", { force: true }),
                    this.ensureCase(id, "expanded", { force: true }),
                    this.ensureTimeline(id, { force: true }),
                    this.fetchSummary(true).catch(() => {}),
                ]);
            },

            async updateWatchers(id, watcher, action = "toggle") {
                if (!id) return;
                const payload = { watcher, action };
                const response = await apiPost(`/api/case/${id}/watchers`, payload);
                if (response && Array.isArray(response.watchers)) {
                    const expanded = this.getCase(id, "expanded");
                    const next = Object.assign({}, expanded.data || {});
                    next.watchers = response.watchers;
                    this.setCaseData(id, "expanded", next);
                } else {
                    await this.ensureCase(id, "expanded", { force: true });
                }
                await Promise.all([
                    this.fetchSummary(true).catch(() => {}),
                    this.fetchList(true).catch(() => {}),
                ]);
            },

            async fetchRoster(force = false) {
                if (this.roster.loaded && !force && !this.roster.error) {
                    return this.roster.data;
                }
                if (this.roster.loading) {
                    return this.roster.promise;
                }
                this.roster.loading = true;
                this.roster.error = null;
                const request = (async () => {
                    try {
                        const payload = await apiGet("/api/reference/team");
                        const data = Array.isArray(payload.reviewers) ? payload.reviewers : [];
                        this.roster = {
                            data,
                            loading: false,
                            error: null,
                            loaded: true,
                        };
                        return data;
                    } catch (err) {
                        console.error("Failed to fetch roster", err);
                        this.roster.loading = false;
                        this.roster.error = err;
                        throw err;
                    }
                })();
                this.roster.promise = request;
                return request;
            },

            rosterMembers() {
                return Array.isArray(this.roster.data) ? this.roster.data : [];
            },

            select(id) {
                this.selectedId = id;
                if (id) {
                    this.ensureCase(id, "simplified");
                    this.ensureCase(id, "expanded");
                    this.ensureTimeline(id, { force: true });
                }
            },

            clear() {
                this.selectedId = null;
            },
        };
        const filingsStore = {
            data: null,
            loading: false,
            error: null,
            ts: null,
            _pending: null,
            async refresh(force = false) {
                if (!force && this.data && !this.error) {
                    return this.data;
                }
                if (this.loading && this._pending) {
                    return this._pending;
                }
                this.loading = true;
                this.error = null;
                const request = (async () => {
                    try {
                        const payload = await apiGet("/api/dashboard/filings");
                        this.data = payload || {};
                        this.loading = false;
                        this.ts = Date.now();
                        return this.data;
                    } catch (err) {
                        console.error("Failed to fetch filings", err);
                        this.loading = false;
                        this.error = err;
                        throw err;
                    } finally {
                        this._pending = null;
                    }
                })();
                this._pending = request;
                return request;
            },
            applyDirective(directive) {
                if (directive && directive.result && directive.result.data) {
                    this.data = directive.result.data;
                    this.loading = false;
                    this.error = null;
                    this.ts = Date.now();
                } else {
                    this.refresh(true);
                }
            },
        };

        const watchlistStore = {
            data: null,
            loading: false,
            error: null,
            ts: null,
            _pending: null,
            async refresh(force = false) {
                if (!force && this.data && !this.error) {
                    return this.data;
                }
                if (this.loading && this._pending) {
                    return this._pending;
                }
                this.loading = true;
                this.error = null;
                const request = (async () => {
                    try {
                        const payload = await apiGet("/api/dashboard/watchlist");
                        this.data = payload || {};
                        this.loading = false;
                        this.ts = Date.now();
                        return this.data;
                    } catch (err) {
                        console.error("Failed to fetch watchlist", err);
                        this.loading = false;
                        this.error = err;
                        throw err;
                    } finally {
                        this._pending = null;
                    }
                })();
                this._pending = request;
                return request;
            },
            applyDirective(directive) {
                if (directive && directive.result && directive.result.data) {
                    this.data = directive.result.data;
                    this.loading = false;
                    this.error = null;
                    this.ts = Date.now();
                } else {
                    this.refresh(true);
                }
            },
        };

        const analyticsStore = {
            data: null,
            loading: false,
            error: null,
            ts: null,
            _pending: null,
            async refresh(force = false) {
                if (!force && this.data && !this.error) {
                    return this.data;
                }
                if (this.loading && this._pending) {
                    return this._pending;
                }
                this.loading = true;
                this.error = null;
                const request = (async () => {
                    try {
                        const payload = await apiGet("/api/dashboard/insights");
                        this.data = payload || {};
                        this.loading = false;
                        this.ts = Date.now();
                        return this.data;
                    } catch (err) {
                        console.error("Failed to fetch analytics", err);
                        this.loading = false;
                        this.error = err;
                        throw err;
                    } finally {
                        this._pending = null;
                    }
                })();
                this._pending = request;
                return request;
            },
            applyDirective(directive) {
                if (directive && directive.result && directive.result.data) {
                    this.data = directive.result.data;
                    this.loading = false;
                    this.error = null;
                    this.ts = Date.now();
                } else {
                    this.refresh(true);
                }
            },
        };

        Alpine.store("cases", casesStore);
        Alpine.store("filings", filingsStore);
        Alpine.store("watchlist", watchlistStore);
        Alpine.store("analytics", analyticsStore);
        Alpine.data("dashboardOverview", () => ({
            init() {
                Alpine.store("cases").fetchSummary();
            },
            store() {
                return Alpine.store("cases");
            },
            refresh(force = false) {
                return this.store().fetchSummary(force);
            },
            data() {
                const summary = this.store().summary;
                return summary.data || {};
            },
            isLoading() {
                return !!this.store().summary.loading;
            },
            openCases() {
                return this.data().open_cases || 0;
            },
            totalCases() {
                return this.data().total || 0;
            },
            dueSoon() {
                return this.data().due_soon || 0;
            },
            overdue() {
                return this.data().overdue || 0;
            },
            unassigned() {
                return this.data().unassigned || 0;
            },
            activeWatchers() {
                return this.data().active_watchers || 0;
            },
            lastGenerated() {
                return formatDateDisplay(this.data().last_generated);
            },
            transitions24h() {
                return this.data().transitions_last_24h || 0;
            },
            notes24h() {
                return this.data().notes_last_24h || 0;
            },
            agingBacklog() {
                return this.data().aging_backlog || 0;
            },
            regionBreakdown() {
                const regions = this.data().region_breakdown;
                return Array.isArray(regions) ? regions : [];
            },
            topRegions() {
                return this.regionBreakdown().slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 3);
            },
        }));

        Alpine.store("casesState", {
            get selectedId() {
                return Alpine.store("cases").selectedId;
            },
            set selectedId(value) {
                Alpine.store("cases").select(value);
            },
            select(id) {
                Alpine.store("cases").select(id);
            },
            clear() {
                Alpine.store("cases").clear();
            },
        });

        Alpine.data("casesPanel", () => ({
            statusFilter: "all",
            regionFilter: "all",
            riskBand: "all",
            sortField: "updated_at",
            sortDir: "desc",
            search: "",
            _searchTimer: null,

            init() {
                this.$watch("statusFilter", () => this.refresh());
                this.$watch("regionFilter", () => this.refresh());
                this.$watch("riskBand", () => this.refresh());
                this.$watch("sortField", () => this.refresh());
                this.$watch("sortDir", () => this.refresh());
                this.$watch("search", () => {
                    if (this._searchTimer) clearTimeout(this._searchTimer);
                    this._searchTimer = setTimeout(() => this.refresh(), 250);
                });
                this.refresh();
            },

            store() {
                return Alpine.store("cases");
            },

            refresh(force = false) {
                this.store().updateFilters({
                    status: this.statusFilter,
                    region: this.regionFilter,
                    riskBand: this.riskBand,
                    sortField: this.sortField,
                    sortDir: this.sortDir,
                    search: this.search,
                });
                return this.store().fetchList(force);
            },

            reload() {
                this.refresh(true);
            },

            ids() {
                return this.store().ids || [];
            },

            row(id) {
                return this.store().getCase(id, "simplified");
            },

            isRowSkeleton(id) {
                const entry = this.row(id);
                return !entry.data && (entry.loading || this.store().loadingList);
            },

            isRowRefreshing(id) {
                const entry = this.row(id);
                return !!entry.data && entry.loading;
            },

            select(id) {
                Alpine.store("cases").select(id);
            },

            isSelected(id) {
                return Number(Alpine.store("cases").selectedId) === Number(id);
            },

            statusLabel(value) {
                return formatStatus(value);
            },

            regionLabel(value) {
                return REGION_LABELS[value] || value || "—";
            },

            riskBadge(score) {
                if (typeof score !== "number") return "—";
                if (score >= 80) return "High";
                if (score >= 60) return "Elevated";
                return "Moderate";
            },

            emptyState() {
                return !this.store().loadingList && this.ids().length === 0;
            },
        }));
        Alpine.data("caseDetail", () => ({
            transitionNote: "",
            assigning: false,
            transitioning: false,
            noteBody: "",
            noteCategory: "analyst_note",
            noteSubmitting: false,
            watcherUpdating: false,

            init() {
                const store = Alpine.store("cases");
                store.fetchRoster().catch(() => {});
                this.$watch(() => store.selectedId, (value) => {
                    if (!value) return;
                    store.ensureCase(value, "expanded", { force: true });
                    store.ensureTimeline(value, { force: true });
                });
            },

            store() {
                return Alpine.store("cases");
            },

            id() {
                return this.store().selectedId;
            },

            item(level = "expanded") {
                const id = this.id();
                if (!id) return { data: null, loading: false, error: null };
                return this.store().getCase(id, level);
            },

            timeline(opts = {}) {
                const id = this.id();
                if (!id) return { data: { events: [] }, loading: false };
                if (opts.force) {
                    this.store().ensureTimeline(id, { force: true });
                }
                return this.store().timeline(id);
            },

            timelineEvents() {
                const entry = this.timeline();
                const events = entry && entry.data && Array.isArray(entry.data.events) ? entry.data.events : [];
                return events;
            },

            timelineLoading() {
                const entry = this.timeline();
                return !!(entry && entry.loading);
            },

            refreshTimeline() {
                const id = this.id();
                if (id) {
                    this.store().ensureTimeline(id, { force: true });
                }
            },

            hasSelection() {
                return !!this.id();
            },

            clearSelection() {
                this.store().clear();
            },

            rosterMembers() {
                return this.store().rosterMembers();
            },

            rosterLoading() {
                return !!this.store().roster.loading;
            },

            watchers() {
                const data = this.item("expanded").data;
                const watchers = data && Array.isArray(data.watchers) ? data.watchers : [];
                return watchers;
            },

            isWatching() {
                return this.watchers().some((w) => w && (w.id === CURRENT_USER || w.email === CURRENT_USER || w.name === CURRENT_USER));
            },

            watchersCount() {
                return this.watchers().length;
            },

            rosterLabel(member) {
                if (!member) return "";
                return [member.name, member.title].filter(Boolean).join(" · ");
            },

            async submitAssignment(event) {
                event.preventDefault();
                const id = this.id();
                if (!id) return;
                const form = event.target;
                const formData = new FormData(form);
                const assignedTo = normalizeString(formData.get("assigned_to"));
                this.assigning = true;
                try {
                    await this.store().assignCase(id, assignedTo || null);
                } catch (err) {
                    console.error("Failed to assign case", err);
                } finally {
                    this.assigning = false;
                }
            },

            transitions() {
                const simplified = this.item("simplified").data;
                const current = simplified ? simplified.status : null;
                return transitionTargets(current);
            },

            async transitionTo(next) {
                const id = this.id();
                if (!id || !next) return;
                this.transitioning = true;
                try {
                    await this.store().transitionCase(id, next, this.transitionNote);
                    this.transitionNote = "";
                } catch (err) {
                    console.error("Failed to transition case", err);
                } finally {
                    this.transitioning = false;
                }
            },

            async submitNote() {
                const id = this.id();
                if (!id) return;
                const trimmed = normalizeString(this.noteBody);
                if (!trimmed) return;
                this.noteSubmitting = true;
                try {
                    await this.store().addNote(id, { body: trimmed, category: this.noteCategory });
                    this.noteBody = "";
                    this.noteCategory = "analyst_note";
                } catch (err) {
                    console.error("Failed to add note", err);
                } finally {
                    this.noteSubmitting = false;
                }
            },

            async toggleWatch() {
                const id = this.id();
                if (!id) return;
                this.watcherUpdating = true;
                try {
                    await this.store().updateWatchers(id, CURRENT_USER, "toggle");
                } catch (err) {
                    console.error("Failed to toggle watcher", err);
                } finally {
                    this.watcherUpdating = false;
                }
            },

            formatDate,
            formatDateDisplay,
            statusLabel: formatStatus,
            regionLabel(value) {
                return REGION_LABELS[value] || value || "—";
            },
            riskBadge(score) {
                if (typeof score !== "number") return "—";
                if (score >= 80) return "High";
                if (score >= 60) return "Elevated";
                return "Moderate";
            },
        }));
        Alpine.data("filingsAgenda", () => ({
            init() {
                Alpine.store("filings").refresh();
            },
            store() {
                return Alpine.store("filings");
            },
            refresh(force = false) {
                return this.store().refresh(force);
            },
            data() {
                return this.store().data || {};
            },
            summary() {
                return this.data().summary || {};
            },
            upcoming() {
                const list = this.data().upcoming;
                return Array.isArray(list) ? list : [];
            },
            calendar() {
                const list = this.data().calendar;
                return Array.isArray(list) ? list : [];
            },
            recentFilings() {
                const list = this.data().recent_filings;
                return Array.isArray(list) ? list : [];
            },
            dueBadge(item) {
                if (!item) return "bg-slate-100 text-slate-600";
                if (item.is_overdue) return "bg-red-100 text-red-700";
                if (item.due_today) return "bg-amber-100 text-amber-700";
                if (item.due_within_week) return "bg-amber-100 text-amber-700";
                return "bg-slate-100 text-slate-600";
            },
            dueLabel(item) {
                if (!item) return "Unknown";
                if (item.is_overdue) return "Overdue";
                if (item.due_today) return "Due today";
                if (item.due_within_week) return "Due soon";
                return "Scheduled";
            },
            assigneeLabel(item) {
                if (!item) return "—";
                return item.assigned_to || "Unassigned";
            },
            calendarWindow(bucket) {
                if (!bucket || !bucket.week_start) return "Week";
                const start = formatDate(bucket.week_start);
                if (!bucket.week_end) return start;
                const end = formatDate(bucket.week_end);
                return `${start} – ${end}`;
            },
            calendarStatuses(bucket) {
                if (!bucket || !Array.isArray(bucket.status_counts)) return [];
                return bucket.status_counts;
            },
            statusLabel: formatStatus,
            regionLabel(value) {
                return REGION_LABELS[value] || value || "—";
            },
            formatDateDisplay,
        }));

        Alpine.data("analyticsPage", () => ({
            init() {
                Alpine.store("analytics").refresh();
            },
            store() {
                return Alpine.store("analytics");
            },
            refresh(force = false) {
                return this.store().refresh(force);
            },
            data() {
                return this.store().data || {};
            },
            summary() {
                return this.data().summary || {};
            },
            totalCases() {
                return this.summary().total || 0;
            },
            riskBands() {
                const bands = this.data().risk_bands || {};
                return [
                    { key: "0_40", label: "0-40", count: bands["0_40"] || 0 },
                    { key: "41_70", label: "41-70", count: bands["41_70"] || 0 },
                    { key: "71_plus", label: "71+", count: bands["71_plus"] || 0 },
                ];
            },
            regionStatus() {
                const list = this.data().region_status;
                return Array.isArray(list) ? list : [];
            },
            transitionSeries() {
                const payload = this.data().transition_velocity || {};
                const series = Array.isArray(payload.series) ? payload.series : [];
                return series;
            },
            maxTransitionCount() {
                return this.transitionSeries().reduce((acc, entry) => Math.max(acc, entry.count || 0), 0);
            },
            noteActivity() {
                const counts = this.data().note_activity || {};
                const entries = Object.entries(counts);
                entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
                return entries.map(([category, count]) => ({ category, count, label: this.noteLabel(category) }));
            },
            noteLabel(category) {
                const map = {
                    analyst_note: "Analyst notes",
                    escalation: "Escalations",
                    qa: "QA feedback",
                    watcher_update: "Watcher updates",
                    system_event: "System events",
                    transition_note: "Transition notes",
                    assignment: "Assignments",
                };
                return map[category] || category;
            },
            agingBuckets() {
                const buckets = this.data().aging_buckets || {};
                const total = Object.values(buckets).reduce((acc, value) => acc + (Number(value) || 0), 0) || 1;
                return [
                    { key: "under_3", label: "<3 days", count: buckets["under_3"] || 0, share: (buckets["under_3"] || 0) / total },
                    { key: "three_to_seven", label: "3-7 days", count: buckets["three_to_seven"] || 0, share: (buckets["three_to_seven"] || 0) / total },
                    { key: "seven_to_fourteen", label: "7-14 days", count: buckets["seven_to_fourteen"] || 0, share: (buckets["seven_to_fourteen"] || 0) / total },
                    { key: "over_14", label: ">14 days", count: buckets["over_14"] || 0, share: (buckets["over_14"] || 0) / total },
                ];
            },
            assignmentLoad() {
                const list = this.data().assignment_load;
                return Array.isArray(list) ? list : [];
            },
            topRiskAccounts() {
                const list = this.data().top_risk_accounts;
                return Array.isArray(list) ? list : [];
            },
            regionPercent(entry) {
                const total = this.totalCases();
                if (!total) return "0%";
                const counts = entry && entry.status_counts ? Object.values(entry.status_counts) : [];
                const count = counts.reduce((acc, value) => acc + (Number(value) || 0), 0);
                return formatPercent(count / total, 1);
            },
            statusLabel: formatStatus,
            regionLabel(value) {
                return REGION_LABELS[value] || value || "—";
            },
            formatNumber,
            formatPercent,
        }));

        Alpine.data("watchlistOverviewPage", () => ({
            init() {
                Alpine.store("watchlist").refresh();
            },
            store() {
                return Alpine.store("watchlist");
            },
            refresh(force = false) {
                return this.store().refresh(force);
            },
            data() {
                return this.store().data || {};
            },
            coverage() {
                return this.data().coverage || {};
            },
            watchers() {
                const list = this.data().watchers;
                return Array.isArray(list) ? list : [];
            },
            recentLinks() {
                const list = this.data().recent_links;
                return Array.isArray(list) ? list : [];
            },
            unwatchedCases() {
                const list = this.data().unwatched;
                return Array.isArray(list) ? list : [];
            },
            percentCovered() {
                const coverage = this.coverage();
                return formatPercent(Number(coverage.percent_open_covered) || 0, 1);
            },
            averageWatchers() {
                const coverage = this.coverage();
                const avg = Number(coverage.average_watchers_per_case) || 0;
                return avg.toFixed(1);
            },
            watcherRegions(entry) {
                if (!entry || !Array.isArray(entry.regions)) return "—";
                if (!entry.regions.length) return "—";
                return entry.regions.join(", ");
            },
            watcherTopCases(entry) {
                if (!entry || !Array.isArray(entry.cases)) return [];
                return entry.cases.slice(0, 3);
            },
            watcherLastActivity(entry) {
                if (!entry || !entry.last_activity) return "—";
                return formatDateDisplay(entry.last_activity);
            },
            regionLabel(value) {
                return REGION_LABELS[value] || value || "—";
            },
            statusLabel: formatStatus,
        }));
        const handleDirective = (directive) => {
            if (!directive || !directive.name) return;
            switch (directive.name) {
                case "case":
                    casesStore.applyCaseDirective(directive);
                    break;
                case "cases":
                case "caseTimeline":
                    casesStore.applyCollectionDirective(directive);
                    break;
                case "dashboardSummary":
                    casesStore.applySummaryDirective(directive);
                    break;
                case "filingSchedule":
                    filingsStore.applyDirective(directive);
                    break;
                case "watchlistOverview":
                    watchlistStore.applyDirective(directive);
                    break;
                case "analyticsInsights":
                    analyticsStore.applyDirective(directive);
                    break;
                default:
                    break;
            }
        };

        const handlePayload = (payload) => {
            if (!payload) return;
            if (payload.type === "hello") {
                return;
            }
            if (payload.type === "directives") {
                const directives = Array.isArray(payload.directives) ? payload.directives : [];
                directives.forEach((directive) => handleDirective(directive));
            }
        };

        const stream = createEventStream(handlePayload);
        if (!stream) {
            const poll = () => {
                casesStore.fetchSummary(true).catch(() => {});
                filingsStore.refresh(true).catch(() => {});
                watchlistStore.refresh(true).catch(() => {});
                analyticsStore.refresh(true).catch(() => {});
            };
            setInterval(poll, 20000);
        }
    });

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

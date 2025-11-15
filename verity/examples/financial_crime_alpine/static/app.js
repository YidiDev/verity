;(function (global) {
"use strict";

const root = global || (typeof globalThis !== "undefined" ? globalThis : this);
const DL = root && root.DL;
if (!DL) {
    throw new Error("DL must be available before app.js");
}

const CURRENT_USER = (root.AppConfig && root.AppConfig.currentUser) || "jordan.lee";

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
});

const GLOBAL_SCOPE_ID = "global";
const DASHBOARD_SUMMARY_ID = GLOBAL_SCOPE_ID;

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

// ---- Register collection + type definitions ----
DL.createCollection("cases", {
    stalenessMs: 60_000,
    fetch: async (params = {}) => {
        const url = new URL("/api/cases", window.location.origin);
        if (params && typeof params === "object") {
            Object.entries(params).forEach(([key, value]) => {
                if (value === undefined || value === null || value === "") return;
                url.searchParams.set(key, value);
            });
        }
        const res = await fetch(url.toString(), { headers: DL.directiveHeaders() });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }
});

DL.createType("case", {
    stalenessMs: 300_000,
    fetch: async (id) => {
        const res = await fetch(`/api/case/${id}?level=simplified`, { headers: DL.directiveHeaders() });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    bulkFetch: async (ids, level = "default") => {
        if (!Array.isArray(ids) || !ids.length) return [];
        const unique = [];
        const seen = new Set();
        for (const raw of ids) {
            const num = Number(raw);
            if (!Number.isFinite(num)) continue;
            if (seen.has(num)) continue;
            seen.add(num);
            unique.push(num);
        }
        if (!unique.length) return [];
        const url = new URL("/api/cases/bulk", window.location.origin);
        const normalizedLevel = level && level !== "default" ? level : "simplified";
        url.searchParams.set("level", normalizedLevel);
        const res = await fetch(url.toString(), {
            method: "POST",
            headers: DL.directiveHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ ids: unique })
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
                const res = await fetch(`/api/case/${id}?level=simplified`, { headers: DL.directiveHeaders() });
                if (!res.ok) throw new Error(await res.text());
                return res.json();
            },
            checkIfExists: (obj) => !!(obj && typeof obj.status === "string" && typeof obj.account_number === "string"),
            levelConversionMap: {
                expanded: ["simplified"],
                default: ["simplified"],
            }
        },
        expanded: {
            fetch: async (id) => {
                const res = await fetch(`/api/case/${id}?level=expanded`, { headers: DL.directiveHeaders() });
                if (!res.ok) throw new Error(await res.text());
                return res.json();
            },
            checkIfExists: (obj) => !!(obj && typeof obj.summary === "string"),
        }
    }
});

DL.createType("dashboardSummary", {
    stalenessMs: 15_000,
    fetch: async () => {
        const res = await fetch("/api/dashboard/summary", { headers: DL.directiveHeaders() });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    checkIfExists: (obj) => !!(obj && typeof obj.total === "number"),
});

DL.createType("filingSchedule", {
    stalenessMs: 30_000,
    fetch: async () => {
        const res = await fetch("/api/dashboard/filings", { headers: DL.directiveHeaders() });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    checkIfExists: (obj) => Array.isArray(obj && obj.upcoming),
});

DL.createType("watchlistOverview", {
    stalenessMs: 45_000,
    fetch: async () => {
        const res = await fetch("/api/dashboard/watchlist", { headers: DL.directiveHeaders() });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    checkIfExists: (obj) => Array.isArray(obj && obj.watchers),
});

DL.createType("analyticsInsights", {
    stalenessMs: 60_000,
    fetch: async () => {
        const res = await fetch("/api/dashboard/insights", { headers: DL.directiveHeaders() });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    checkIfExists: (obj) => !!(obj && obj.summary && typeof obj.summary.total === "number"),
});

DL.createType("caseTimeline", {
    stalenessMs: 60_000,
    fetch: async (caseId) => {
        if (!caseId) return { events: [] };
        const res = await fetch(`/api/case/${caseId}/timeline`, { headers: DL.directiveHeaders() });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    checkIfExists: (obj) => Array.isArray(obj && obj.events),
});

DL.createType("teamRoster", {
    stalenessMs: 60 * 60 * 1000,
    fetch: async () => {
        const res = await fetch("/api/reference/team", { headers: DL.directiveHeaders() });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    checkIfExists: (obj) => Array.isArray(obj && obj.reviewers),
});

// ---- Alpine glue ----
document.addEventListener('alpine:init', () => {
    const Alpine = window.Alpine;

    Alpine.store('shell', {
        page: 'operations',
        set(page) {
            this.page = page;
        },
        is(page) {
            return this.page === page;
        },
    });

    Alpine.store('casesState', {
        selectedId: null,
        select(id) {
            this.selectedId = id;
        },
        clear() {
            this.selectedId = null;
        }
    });

    Alpine.data('dashboardOverview', () => ({
        summaryRef: null,

        init() {
            this.summaryRef = Alpine.store('lib').it('dashboardSummary', DASHBOARD_SUMMARY_ID, 'default');
        },

        ref(opts = {}) {
            const store = Alpine.store('lib');
            if (store) {
                void store._tick;
            }
            if (!this.summaryRef || opts.force) {
                this.summaryRef = Alpine.store('lib').it('dashboardSummary', DASHBOARD_SUMMARY_ID, 'default', opts);
            }
            return this.summaryRef;
        },

        refresh(force = false) {
            this.ref({ force });
        },

        data() {
            return this.ref().data || {};
        },

        isLoading() {
            const meta = this.ref().meta || {};
            return !!meta.isLoading;
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
            const ts = this.data().last_generated;
            if (!ts) return null;
            return formatDateDisplay(ts);
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
            if (!Array.isArray(regions)) return [];
            return regions;
        },

        topRegions() {
            const regions = this.regionBreakdown().slice();
            regions.sort((a, b) => (b.count || 0) - (a.count || 0));
            return regions.slice(0, 3);
        },
    }));

    Alpine.data('casesPanel', () => ({
        statusFilter: 'all',
        regionFilter: 'all',
        riskBand: 'all',
        sortField: 'updated_at',
        sortDir: 'desc',
        search: '',
        _searchTimer: null,

        init() {
            this.$watch('statusFilter', () => this.refresh());
            this.$watch('regionFilter', () => this.refresh());
            this.$watch('riskBand', () => this.refresh());
            this.$watch('sortField', () => this.refresh());
            this.$watch('sortDir', () => this.refresh());
            this.$watch('search', (value) => {
                if (this._searchTimer) clearTimeout(this._searchTimer);
                this._searchTimer = setTimeout(() => { this.refresh(); }, 250);
            });
            this.refresh();
        },

        params() {
            const params = { sort: this.sortField, direction: this.sortDir };
            if (this.statusFilter && this.statusFilter !== 'all') params.status = this.statusFilter;
            if (this.regionFilter && this.regionFilter !== 'all') params.region = this.regionFilter;
            const band = RISK_BANDS[this.riskBand];
            if (band) {
                if (typeof band.min === 'number') params.risk_min = band.min;
                if (typeof band.max === 'number') params.risk_max = band.max;
            }
            const trimmed = typeof this.search === 'string' ? this.search.trim() : '';
            if (trimmed) params.q = trimmed;
            return params;
        },

        col(opts = {}) {
            return Alpine.store('lib').col('cases', { params: this.params(), ...opts });
        },

        ids() {
            const c = this.col();
            return Array.isArray(c.data.ids) ? c.data.ids : [];
        },

        refresh(force = false) {
            return this.col({ force });
        },

        reload() {
            this.refresh(true);
        },

        row(id) {
            return Alpine.store('lib').it('case', id, 'simplified', { silent: true });
        },

        isRowSkeleton(id) {
            const r = this.row(id);
            return !r.data;
        },

        isRowRefreshing(id) {
            const r = this.row(id);
            return !!r.data && r.meta.isLoading;
        },

        select(id) {
            Alpine.store('casesState').select(id);
        },

        isSelected(id) {
            return Alpine.store('casesState').selectedId === id;
        },

        statusLabel(value) {
            return formatStatus(value);
        },

        regionLabel(value) {
            return REGION_LABELS[value] || value || '—';
        },

        riskBadge(score) {
            if (typeof score !== 'number') return '—';
            if (score >= 80) return 'High';
            if (score >= 60) return 'Elevated';
            return 'Moderate';
        },

        emptyState() {
            const c = this.col();
            return !c.meta.isLoading && (!c.data.ids || c.data.ids.length === 0);
        },
    }));

    Alpine.data('caseDetail', () => ({
        transitionNote: '',
        assigning: false,
        transitioning: false,
        noteBody: '',
        noteCategory: 'analyst_note',
        noteSubmitting: false,
        watcherUpdating: false,
        rosterRef: null,

        init() {
            this.rosterRef = Alpine.store('lib').it('teamRoster', 'global', 'default', { silent: true });
            this.$watch(() => this.id(), (value, oldValue) => {
                if (!value) return;
                Alpine.store('lib').it('case', value, 'expanded', { force: true });
                this.timeline({ force: true, silent: true });
            });
        },

        id() {
            return Alpine.store('casesState').selectedId;
        },

        item(level = 'expanded', opts = {}) {
            const id = this.id();
            if (!id) return { data: null, meta: { isLoading: false } };
            return Alpine.store('lib').it('case', id, level, opts);
        },

        timeline(opts = {}) {
            const id = this.id();
            if (!id) {
                return { data: { events: [] }, meta: { isLoading: false, activeLevelQueryIds: {} } };
            }
            const requestOpts = { silent: true, ...opts };
            return Alpine.store('lib').it('caseTimeline', id, 'default', requestOpts);
        },

        timelineEvents() {
            const ref = this.timeline();
            const events = ref?.data?.events;
            if (!Array.isArray(events)) return [];
            return events;
        },

        timelineLoading() {
            const ref = this.timeline();
            const meta = (ref && ref.meta) || {};
            if (meta.isLoading) return true;
            const activeLevels = meta.activeLevelQueryIds;
            if (activeLevels && typeof activeLevels === 'object') {
                return Object.values(activeLevels).some(Boolean);
            }
            return false;
        },

        refreshTimeline() {
            this.timeline({ force: true, silent: false });
        },

        hasSelection() {
            return !!this.id();
        },

        clearSelection() {
            Alpine.store('casesState').clear();
        },

        watchers() {
            const expanded = this.item('expanded').data;
            if (!expanded || !Array.isArray(expanded.watchers)) return [];
            return expanded.watchers;
        },

        isWatching() {
            return this.watchers().some((watcher) => watcher && watcher.id === CURRENT_USER);
        },

        toggleWatch() {
            const id = this.id();
            if (!id) return;
            this.watcherUpdating = true;
            const action = this.isWatching() ? 'remove' : 'add';
            fetch(`/api/case/${id}/watchers`, {
                method: 'POST',
                headers: DL.directiveHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ watcher: CURRENT_USER, action })
            })
                .then(res => res.json())
                .then(json => {
                    this.watcherUpdating = false;
                    if (json && Array.isArray(json.directives)) {
                        Alpine.store('lib').apply(json.directives);
                    }
                })
                .catch(() => { this.watcherUpdating = false; });
        },

        transitions() {
            const current = this.item('simplified').data;
            if (!current) return [];
            return CASE_TRANSITIONS[current.status] || [];
        },

        noteCategories() {
            return [
                { value: 'analyst_note', label: 'Analyst note' },
                { value: 'escalation', label: 'Escalation' },
                { value: 'qa', label: 'QA feedback' },
                { value: 'watcher_update', label: 'Watcher update' },
            ];
        },

        submitNote() {
            const id = this.id();
            if (!id) return;
            const body = (this.noteBody || '').trim();
            if (!body) return;
            const category = (this.noteCategory || 'analyst_note').trim();
            this.noteSubmitting = true;
            fetch(`/api/case/${id}/notes`, {
                method: 'POST',
                headers: DL.directiveHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ body, category })
            })
                .then(res => res.json())
                .then(json => {
                    this.noteSubmitting = false;
                    this.noteBody = '';
                    if (json && Array.isArray(json.directives)) {
                        Alpine.store('lib').apply(json.directives);
                    }
                })
                .catch(() => { this.noteSubmitting = false; });
        },

        roster() {
            if (!this.rosterRef) {
                this.rosterRef = Alpine.store('lib').it('teamRoster', 'global', 'default');
            }
            return this.rosterRef;
        },

        rosterMembers() {
            const data = this.roster()?.data;
            if (!data || !Array.isArray(data.reviewers)) return [];
            return data.reviewers;
        },

        statusLabel(value) {
            return formatStatus(value);
        },

        regionLabel(value) {
            return REGION_LABELS[value] || value || '—';
        },

        submitAssignment(event) {
            event.preventDefault();
            const id = this.id();
            if (!id) return;
            const form = event.target;
            const data = new FormData(form);
            const assigned_to = data.get('assigned_to');
            this.assigning = true;
            fetch(`/api/case/${id}/assign`, {
                method: 'POST',
                headers: DL.directiveHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ assigned_to })
            })
                .then(res => res.json())
                .then(json => {
                    this.assigning = false;
                    if (json && Array.isArray(json.directives)) {
                        Alpine.store('lib').apply(json.directives);
                    }
                })
                .catch(() => { this.assigning = false; });
        },

        transitionTo(next) {
            const id = this.id();
            if (!id) return;
            this.transitioning = true;
            fetch(`/api/case/${id}/transition`, {
                method: 'POST',
                headers: DL.directiveHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ next_status: next, note: this.transitionNote || undefined })
            })
                .then(res => res.json())
                .then(json => {
                    this.transitioning = false;
                    this.transitionNote = '';
                    if (json && Array.isArray(json.directives)) {
                        Alpine.store('lib').apply(json.directives);
                    }
                })
                .catch(() => { this.transitioning = false; });
        },

        formatDate(value) {
            return formatDateDisplay(value);
        },

        riskBadge(score) {
            if (typeof score !== 'number') return '—';
            if (score >= 80) return 'High';
            if (score >= 60) return 'Elevated';
            return 'Moderate';
        },

        timelineIcon(event) {
            if (!event || !event.type) return 'clock';
            if (event.type === 'transition') return 'arrows';
            if (event.type === 'note') return 'document';
            return 'clock';
        },

        timelineTitle(event) {
            if (!event) return '';
            if (event.type === 'transition') {
                return `Moved to ${formatStatus(event.to_status)}${event.from_status ? ' from ' + formatStatus(event.from_status) : ''}`;
            }
            if (event.type === 'note') {
                const entry = this.noteCategories().find((opt) => opt.value === event.category);
                const label = entry ? entry.label : 'Note';
                return label;
            }
            return 'Event';
        },

        timelineMeta(event) {
            if (!event) return '';
            const actor = event.actor || event.author;
            const name = actor && actor.name ? actor.name : (actor && actor.id ? actor.id : 'System');
            return `${name} • ${formatDateDisplay(event.created_at)}`;
        },

        timelineBody(event) {
            if (!event) return '';
            if (event.type === 'transition') {
                return event.note || 'Status change recorded by workflow engine.';
            }
            if (event.type === 'note') {
                return event.body || '';
            }
            return '';
        },
    }));

    Alpine.data('filingsAgenda', () => ({
        scheduleRef: null,

        init() {
            this.scheduleRef = Alpine.store('lib').it('filingSchedule', GLOBAL_SCOPE_ID, 'default');
        },

        ref(opts = {}) {
            const store = Alpine.store('lib');
            if (store) {
                void store._tick;
            }
            if (!this.scheduleRef || opts.force) {
                this.scheduleRef = Alpine.store('lib').it('filingSchedule', GLOBAL_SCOPE_ID, 'default', opts);
            }
            return this.scheduleRef;
        },

        refresh(force = false) {
            this.ref({ force });
        },

        data() {
            return this.ref().data || {};
        },

        isLoading() {
            const meta = this.ref().meta || {};
            return !!meta.isLoading;
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

        dueLabel(item) {
            if (!item) return '';
            if (item.is_overdue) {
                const days = Math.abs(item.due_in_days || 0);
                if (days === 0) return 'Past due';
                return `${days} day${days === 1 ? '' : 's'} overdue`;
            }
            if (item.due_in_days === 0) return 'Due today';
            if (item.due_in_days === 1) return 'Due tomorrow';
            return `Due in ${item.due_in_days} days`;
        },

        dueBadge(item) {
            if (!item) return 'bg-slate-100 text-slate-700 border border-slate-200';
            if (item.is_overdue) return 'bg-rose-50 text-rose-700 border border-rose-200';
            if (item.due_in_days <= 2) return 'bg-amber-50 text-amber-700 border border-amber-200';
            return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
        },

        statusLabel(value) {
            return formatStatus(value);
        },

        regionLabel(value) {
            return REGION_LABELS[value] || value || '—';
        },

        assigneeLabel(item) {
            if (!item || !item.assigned_to) return 'Unassigned';
            return item.assigned_to.name || item.assigned_to.id || 'Unassigned';
        },

        calendarWindow(bucket) {
            if (!bucket) return '';
            const start = bucket.week_start ? new Date(bucket.week_start) : null;
            const end = bucket.week_end ? new Date(bucket.week_end) : null;
            if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
            return `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`;
        },

        calendarStatuses(bucket) {
            if (!bucket || !bucket.status_counts) return [];
            const entries = Object.entries(bucket.status_counts).filter(([, count]) => count > 0);
            entries.sort((a, b) => b[1] - a[1]);
            return entries.map(([status, count]) => ({ status, count, label: formatStatus(status) }));
        },

        watchersLabel(item) {
            const count = Number(item && item.watchers) || 0;
            if (count === 0) return 'No watchers';
            if (count === 1) return '1 watcher';
            return `${count} watchers`;
        },
    }));

    Alpine.data('watchlistOverviewPage', () => ({
        watchlistRef: null,

        init() {
            this.watchlistRef = Alpine.store('lib').it('watchlistOverview', GLOBAL_SCOPE_ID, 'default');
        },

        ref(opts = {}) {
            const store = Alpine.store('lib');
            if (store) {
                void store._tick;
            }
            if (!this.watchlistRef || opts.force) {
                this.watchlistRef = Alpine.store('lib').it('watchlistOverview', GLOBAL_SCOPE_ID, 'default', opts);
            }
            return this.watchlistRef;
        },

        refresh(force = false) {
            this.ref({ force });
        },

        data() {
            return this.ref().data || {};
        },

        isLoading() {
            const meta = this.ref().meta || {};
            return !!meta.isLoading;
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
            if (!entry || !Array.isArray(entry.regions)) return '—';
            if (!entry.regions.length) return '—';
            return entry.regions.join(', ');
        },

        watcherTopCases(entry) {
            if (!entry || !Array.isArray(entry.cases)) return [];
            return entry.cases.slice(0, 3);
        },

        watcherLastActivity(entry) {
            if (!entry || !entry.last_activity) return '—';
            return formatDateDisplay(entry.last_activity);
        },

        regionLabel(value) {
            return REGION_LABELS[value] || value || '—';
        },

        statusLabel(value) {
            return formatStatus(value);
        },
    }));

    Alpine.data('analyticsPage', () => ({
        insightsRef: null,

        init() {
            this.insightsRef = Alpine.store('lib').it('analyticsInsights', GLOBAL_SCOPE_ID, 'default');
        },

        ref(opts = {}) {
            const store = Alpine.store('lib');
            if (store) {
                void store._tick;
            }
            if (!this.insightsRef || opts.force) {
                this.insightsRef = Alpine.store('lib').it('analyticsInsights', GLOBAL_SCOPE_ID, 'default', opts);
            }
            return this.insightsRef;
        },

        refresh(force = false) {
            this.ref({ force });
        },

        data() {
            return this.ref().data || {};
        },

        isLoading() {
            const meta = this.ref().meta || {};
            return !!meta.isLoading;
        },

        summary() {
            return this.data().summary || {};
        },

        totalCases() {
            const total = Number(this.summary().total) || 0;
            return total;
        },

        riskBands() {
            const bands = this.data().risk_bands || {};
            return [
                { key: '0_40', label: '0-40', count: bands['0_40'] || 0 },
                { key: '41_70', label: '41-70', count: bands['41_70'] || 0 },
                { key: '71_plus', label: '71+', count: bands['71_plus'] || 0 },
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
            entries.sort((a, b) => b[1] - a[1]);
            return entries.map(([category, count]) => ({ category, count, label: this.noteLabel(category) }));
        },

        noteLabel(category) {
            const map = {
                analyst_note: 'Analyst notes',
                escalation: 'Escalations',
                qa: 'QA feedback',
                watcher_update: 'Watcher updates',
                system_event: 'System events',
                transition_note: 'Transition notes',
                assignment: 'Assignments',
            };
            return map[category] || category;
        },

        agingBuckets() {
            const buckets = this.data().aging_buckets || {};
            const total = Object.values(buckets).reduce((acc, value) => acc + (Number(value) || 0), 0) || 1;
            return [
                { key: 'under_3', label: '<3 days', count: buckets['under_3'] || 0, share: (buckets['under_3'] || 0) / total },
                { key: 'three_to_seven', label: '3-7 days', count: buckets['three_to_seven'] || 0, share: (buckets['three_to_seven'] || 0) / total },
                { key: 'seven_to_fourteen', label: '7-14 days', count: buckets['seven_to_fourteen'] || 0, share: (buckets['seven_to_fourteen'] || 0) / total },
                { key: 'over_14', label: '>14 days', count: buckets['over_14'] || 0, share: (buckets['over_14'] || 0) / total },
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

        regionPercent(regionEntry) {
            const total = this.totalCases();
            if (!total) return '0%';
            const count = Object.values(regionEntry.status_counts || {}).reduce((acc, value) => acc + (Number(value) || 0), 0);
            return formatPercent(count / total, 1);
        },

        statusLabel(value) {
            return formatStatus(value);
        },

        regionLabel(value) {
            return REGION_LABELS[value] || value || '—';
        },

        formatNumber,
        formatPercent,
    }));
});

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

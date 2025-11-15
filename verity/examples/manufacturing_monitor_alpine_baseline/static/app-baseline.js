(function () {
  const READY_STATES = {
    CONNECTING: 'connecting',
    OPEN: 'open',
    CLOSED: 'closed',
  };

  function createPaginatedSection(section) {
    return {
      section,
      items: [],
      meta: {
        page: 1,
        page_size: null,
        total: 0,
        total_pages: 1,
      },
      assign(payload) {
        if (!payload || typeof payload !== 'object') {
          this.items = [];
          this.meta = { ...this.meta, page: 1, total: 0, total_pages: 1 };
          return;
        }
        this.items = Array.isArray(payload.items) ? payload.items : [];
        const pageSize = payload.page_size || this.meta.page_size || (this.items.length || 10);
        const total = payload.total ?? this.items.length;
        const totalPages = payload.total_pages || (pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1);
        this.meta = {
          page: payload.page || 1,
          page_size: pageSize,
          total,
          total_pages: totalPages,
        };
      },
      hasPrev() {
        return this.meta.page > 1;
      },
      hasNext() {
        return this.meta.page < (this.meta.total_pages || 1);
      },
      setPage(page) {
        const target = Number(page);
        if (!Number.isFinite(target)) return false;
        const clamped = Math.min(Math.max(1, target), this.meta.total_pages || 1);
        if (clamped === this.meta.page) return false;
        this.meta = { ...this.meta, page: clamped };
        return true;
      },
      change(delta) {
        const next = (this.meta.page || 1) + delta;
        return this.setPage(next);
      },
      paginationConfig() {
        return {
          [this.section]: {
            page: this.meta.page,
            page_size: this.meta.page_size,
          },
        };
      },
      windowLabel() {
        if (!this.items.length) {
          return 'No items';
        }
        const start = (this.meta.page - 1) * this.meta.page_size + 1;
        const end = start + this.items.length - 1;
        return `${start}–${end} of ${this.meta.total}`;
      },
    };
  }

  function mergePaginationConfigs(...configs) {
    return Object.assign({}, ...configs.map((entry) => entry || {}));
  }

  document.addEventListener('alpine:init', () => {
    const Alpine = window.Alpine;
    const directory = window.monitorUsers || { users: [], default: null };
    const availableUsers = Array.isArray(directory.users) ? directory.users : [];
    const defaultUser = directory.default || (availableUsers[0] ? availableUsers[0].id : null);

    Alpine.store('session', {
      userDirectory: availableUsers,
      selectedUserId: defaultUser,
      viewer: null,
      lineAccess: [],
      currentPage: 'overview',
      loading: false,
      error: null,
      toast: null,
      globalStatus: READY_STATES.CLOSED,
      lineStatus: READY_STATES.CLOSED,
      globalSource: null,
      lineSource: null,
      lineAudience: null,
      pages: [
        { id: 'overview', label: 'Overview', scope: 'overview' },
        { id: 'quality', label: 'Quality', scope: 'quality' },
        { id: 'maintenance', label: 'Maintenance', scope: 'maintenance' },
        { id: 'logistics', label: 'Logistics', scope: 'logistics' },
        { id: 'safety', label: 'Safety', scope: 'safety' },
        { id: 'handover', label: 'Handover', scope: 'handover' },
      ],
      viewerScopes() {
        return Array.isArray(this.viewer?.scopes) ? this.viewer.scopes : [];
      },
      canAccess(pageId) {
        const page = this.pages.find((entry) => entry.id === pageId);
        if (!page || !page.scope) return true;
        return this.viewerScopes().includes(page.scope);
      },
      canViewLine(lineId) {
        if (!lineId) return false;
        if (!this.lineAccess.length) return false;
        return this.lineAccess.includes(lineId);
      },
      setPage(pageId) {
        if (!this.canAccess(pageId)) {
          this.error = 'You do not have access to that dashboard.';
          return;
        }
        this.currentPage = pageId;
      },
      ensureAccessiblePage() {
        if (this.currentPage && this.canAccess(this.currentPage)) {
          return;
        }
        const fallback = this.pages.find((page) => this.canAccess(page.id));
        this.currentPage = fallback ? fallback.id : null;
      },
      async fetchSnapshot(pagination = {}) {
        const params = new URLSearchParams();
        if (this.selectedUserId) {
          params.append('user', this.selectedUserId);
        }
        Object.entries(pagination).forEach(([section, meta]) => {
          if (!meta) return;
          if (meta.page && meta.page > 1) {
            params.append(`page[${section}]`, meta.page);
          }
          if (meta.page_size) {
            params.append(`page_size[${section}]`, meta.page_size);
          }
        });
        const query = params.toString();
        const url = query ? `/api/dashboard?${query}` : '/api/dashboard';
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error('Failed to load dashboard');
        }
        const data = await res.json();
        if (data.viewer) {
          this.viewer = data.viewer;
          if (data.viewer.id) {
            this.selectedUserId = data.viewer.id;
          }
          this.lineAccess = Array.isArray(data.viewer.line_access) ? data.viewer.line_access : [];
        }
        this.ensureAccessiblePage();
        return data;
      },
      async bootstrap() {
        this.loading = true;
        this.error = null;
        try {
          const overview = Alpine.store('overview');
          const quality = Alpine.store('quality');
          const maintenance = Alpine.store('maintenance');
          const logistics = Alpine.store('logistics');
          const safety = Alpine.store('safety');
          const handover = Alpine.store('handover');

          await overview.refresh();
          await Promise.all([
            quality.refresh(),
            maintenance.refresh(),
            logistics.refresh(),
            safety.refresh(),
            handover.refresh(),
          ]);
          if (!overview.selectedLineId && overview.lines.length > 0) {
            overview.selectLine(overview.lines[0].id);
          }
          this.openGlobalStream();
          this.setLineAudience(overview.selectedLineId);
        } catch (err) {
          console.error(err);
          this.error = 'Failed to load dashboard data. Check the server logs.';
        } finally {
          this.loading = false;
        }
      },
      applyUserDefaults() {
        if (!this.selectedUserId && this.userDirectory.length) {
          this.selectedUserId = this.userDirectory[0].id;
        }
      },
      setUser(userId) {
        if (!userId || this.selectedUserId === userId) {
          return;
        }
        this.selectedUserId = userId;
        this.viewer = null;
        this.lineAccess = [];
        this.closeStreams();
        const overview = Alpine.store('overview');
        const quality = Alpine.store('quality');
        const maintenance = Alpine.store('maintenance');
        const logistics = Alpine.store('logistics');
        const safety = Alpine.store('safety');
        const handover = Alpine.store('handover');
        overview.clear();
        quality.clear();
        maintenance.clear();
        logistics.clear();
        safety.clear();
        handover.clear();
        this.bootstrap();
      },
      closeStreams() {
        if (this.globalSource) {
          this.globalSource.close();
        }
        if (this.lineSource) {
          this.lineSource.close();
        }
        this.globalSource = null;
        this.lineSource = null;
        this.globalStatus = READY_STATES.CLOSED;
        this.lineStatus = READY_STATES.CLOSED;
      },
      openGlobalStream() {
        if (!window.EventSource) {
          this.globalStatus = READY_STATES.CLOSED;
          return;
        }
        if (this.globalSource) {
          this.globalSource.close();
        }
        const params = new URLSearchParams();
        params.append('audience', 'global');
        if (this.selectedUserId) {
          params.append('user', this.selectedUserId);
        }
        const source = new EventSource(`/api/events?${params.toString()}`);
        this.globalSource = source;
        this.globalStatus = READY_STATES.CONNECTING;
        source.onopen = () => {
          this.globalStatus = READY_STATES.OPEN;
        };
        source.onerror = () => {
          this.globalStatus = READY_STATES.CONNECTING;
        };
        source.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.routeEvent(data);
          } catch (err) {
            console.error('Failed to parse SSE payload', err);
          }
        };
      },
      setLineAudience(lineId) {
        if (this.lineAudience === lineId) {
          return;
        }
        this.lineAudience = lineId || null;
        this.openLineStream();
      },
      openLineStream() {
        if (!window.EventSource) {
          this.lineStatus = READY_STATES.CLOSED;
          return;
        }
        if (this.lineSource) {
          this.lineSource.close();
        }
        if (!this.lineAudience) {
          this.lineStatus = READY_STATES.CLOSED;
          this.lineSource = null;
          return;
        }
        const params = new URLSearchParams();
        params.append('audience', this.lineAudience);
        if (this.selectedUserId) {
          params.append('user', this.selectedUserId);
        }
        const source = new EventSource(`/api/events?${params.toString()}`);
        this.lineSource = source;
        this.lineStatus = READY_STATES.CONNECTING;
        const overview = Alpine.store('overview');
        source.onopen = () => {
          this.lineStatus = READY_STATES.OPEN;
        };
        source.onerror = () => {
          this.lineStatus = READY_STATES.CONNECTING;
        };
        source.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            overview.handleLineFeed(data);
          } catch (err) {
            console.error('Failed to parse line feed payload', err);
          }
        };
      },
      routeEvent(update) {
        if (!update || typeof update !== 'object') {
          return;
        }
        const overview = Alpine.store('overview');
        const quality = Alpine.store('quality');
        const maintenance = Alpine.store('maintenance');
        const logistics = Alpine.store('logistics');
        const safety = Alpine.store('safety');
        const handover = Alpine.store('handover');
        overview.recordGlobalUpdate(update);
        const type = update.type;
        switch (type) {
          case 'line_plan_update':
          case 'sku_adjustment':
          case 'line_recovered':
            overview.applyLine(update.line);
            break;
          case 'downtime_event':
          case 'maintenance_dispatch':
            overview.applyLine(update.line);
            maintenance.handleEvent(update);
            break;
          case 'quality_alert':
          case 'quality_audit':
            overview.applyLine(update.line);
            quality.handleEvent(update);
            break;
          case 'shift_note':
            handover.handleEvent(update);
            break;
          case 'supply_run':
          case 'inventory_adjustment':
          case 'shipment_update':
            logistics.handleEvent(update);
            break;
          case 'safety_incident':
          case 'safety_walk':
            safety.handleEvent(update);
            break;
          default:
            break;
        }
      },
    });

    Alpine.store('overview', {
      lines: [],
      selectedLineId: null,
      selectedLine: null,
      lineUpdates: [],
      globalFeed: [],
      loading: false,
      async refresh() {
        this.loading = true;
        try {
          const session = Alpine.store('session');
          const data = await session.fetchSnapshot();
          this.lines = Array.isArray(data.lines) ? data.lines : [];
          if (this.selectedLineId && !this.lines.some((line) => line.id === this.selectedLineId)) {
            this.selectedLineId = null;
          }
          if (!this.selectedLineId && this.lines.length > 0) {
            this.selectedLineId = this.lines[0].id;
          }
          this.selectedLine = this.lines.find((line) => line.id === this.selectedLineId) || null;
          return data;
        } finally {
          this.loading = false;
        }
      },
      clear() {
        this.lines = [];
        this.selectedLineId = null;
        this.selectedLine = null;
        this.lineUpdates = [];
        this.globalFeed = [];
        this.loading = false;
      },
      selectLine(lineId) {
        if (!lineId) {
          this.selectedLineId = null;
          this.selectedLine = null;
          Alpine.store('session').setLineAudience(null);
          return;
        }
        this.selectedLineId = lineId;
        this.selectedLine = this.lines.find((line) => line.id === lineId) || null;
        this.lineUpdates = [];
        Alpine.store('session').setLineAudience(lineId);
      },
      applyLine(line) {
        if (!line || !line.id) {
          return;
        }
        const idx = this.lines.findIndex((entry) => entry.id === line.id);
        if (idx === -1) {
          this.lines = [...this.lines, line];
        } else {
          const next = [...this.lines];
          next[idx] = line;
          this.lines = next;
        }
        if (this.selectedLineId === line.id) {
          this.selectedLine = line;
        }
      },
      recordGlobalUpdate(update) {
        if (!update || !update.message) return;
        const entry = {
          id: update.id || Math.random().toString(36).slice(2),
          message: update.message,
          ts: update.ts || new Date().toISOString(),
        };
        this.globalFeed = [entry, ...this.globalFeed].slice(0, 10);
      },
      handleLineFeed(update) {
        if (!update || update.type === 'ready') {
          return;
        }
        if (update.line) {
          this.applyLine(update.line);
        }
        if (update.message) {
          const entry = {
            id: update.id || Math.random().toString(36).slice(2),
            message: update.message,
            ts: update.ts || new Date().toISOString(),
          };
          this.lineUpdates = [entry, ...this.lineUpdates].slice(0, 10);
        }
      },
      handleEvent(update) {
        if (update?.line) {
          this.applyLine(update.line);
        }
      },
    });

    Alpine.store('quality', {
      defects: createPaginatedSection('recent_defects'),
      audits: createPaginatedSection('quality_audits'),
      summary: null,
      loading: false,
      async refresh() {
        this.loading = true;
        try {
          const session = Alpine.store('session');
          const pagination = mergePaginationConfigs(
            this.defects.paginationConfig(),
            this.audits.paginationConfig(),
          );
          const data = await session.fetchSnapshot(pagination);
          this.summary = data.quality_summary || null;
          this.defects.assign(data.recent_defects);
          this.audits.assign(data.quality_audits);
        } finally {
          this.loading = false;
        }
      },
      clear() {
        this.defects.assign(null);
        this.audits.assign(null);
        this.summary = null;
        this.loading = false;
      },
      async changePage(section, delta) {
        const target = section === 'quality_audits' ? this.audits : this.defects;
        if (target.change(delta)) {
          await this.refresh();
        }
      },
      async gotoPage(section, page) {
        const target = section === 'quality_audits' ? this.audits : this.defects;
        if (target.setPage(page)) {
          await this.refresh();
        }
      },
      handleEvent() {
        this.refresh();
      },
    });

    Alpine.store('maintenance', {
      downtime: createPaginatedSection('downtime_events'),
      backlog: createPaginatedSection('maintenance_backlog'),
      selectedDowntimeId: null,
      currentDowntime: null,
      loading: false,
      async refresh() {
        this.loading = true;
        try {
          const session = Alpine.store('session');
          const pagination = mergePaginationConfigs(
            this.downtime.paginationConfig(),
            this.backlog.paginationConfig(),
          );
          const data = await session.fetchSnapshot(pagination);
          this.downtime.assign(data.downtime_events);
          this.backlog.assign(data.maintenance_backlog);
          this.ensureSelection();
        } finally {
          this.loading = false;
        }
      },
      ensureSelection() {
        if (this.downtime.items.length === 0) {
          this.selectedDowntimeId = null;
          this.currentDowntime = null;
          return;
        }
        if (!this.selectedDowntimeId || !this.downtime.items.some((item) => item.id === this.selectedDowntimeId)) {
          this.selectedDowntimeId = this.downtime.items[0].id;
        }
        this.currentDowntime = this.downtime.items.find((item) => item.id === this.selectedDowntimeId) || null;
      },
      selectDowntime(id) {
        this.selectedDowntimeId = id;
        this.currentDowntime = this.downtime.items.find((item) => item.id === id) || null;
      },
      clear() {
        this.downtime.assign(null);
        this.backlog.assign(null);
        this.selectedDowntimeId = null;
        this.currentDowntime = null;
        this.loading = false;
      },
      async changePage(section, delta) {
        const target = section === 'maintenance_backlog' ? this.backlog : this.downtime;
        if (target.change(delta)) {
          await this.refresh();
        }
      },
      async gotoPage(section, page) {
        const target = section === 'maintenance_backlog' ? this.backlog : this.downtime;
        if (target.setPage(page)) {
          await this.refresh();
        }
      },
      handleEvent() {
        this.refresh();
      },
    });

    Alpine.store('logistics', {
      supplyRuns: createPaginatedSection('supply_runs'),
      shipments: createPaginatedSection('outbound_shipments'),
      inventory: createPaginatedSection('inventory_positions'),
      catalog: [],
      loading: false,
      async refresh() {
        this.loading = true;
        try {
          const session = Alpine.store('session');
          const pagination = mergePaginationConfigs(
            this.supplyRuns.paginationConfig(),
            this.shipments.paginationConfig(),
            this.inventory.paginationConfig(),
          );
          const data = await session.fetchSnapshot(pagination);
          this.supplyRuns.assign(data.supply_runs);
          this.shipments.assign(data.outbound_shipments);
          this.inventory.assign(data.inventory_positions);
          this.catalog = Array.isArray(data.inventory_catalog) ? data.inventory_catalog : [];
        } finally {
          this.loading = false;
        }
      },
      clear() {
        this.supplyRuns.assign(null);
        this.shipments.assign(null);
        this.inventory.assign(null);
        this.catalog = [];
        this.loading = false;
      },
      async changePage(section, delta) {
        let target;
        if (section === 'outbound_shipments') target = this.shipments;
        else if (section === 'inventory_positions') target = this.inventory;
        else target = this.supplyRuns;
        if (target.change(delta)) {
          await this.refresh();
        }
      },
      async gotoPage(section, page) {
        let target;
        if (section === 'outbound_shipments') target = this.shipments;
        else if (section === 'inventory_positions') target = this.inventory;
        else target = this.supplyRuns;
        if (target.setPage(page)) {
          await this.refresh();
        }
      },
      handleEvent() {
        this.refresh();
      },
    });

    Alpine.store('safety', {
      incidents: createPaginatedSection('safety_incidents'),
      walks: createPaginatedSection('safety_walks'),
      training: null,
      loading: false,
      async refresh() {
        this.loading = true;
        try {
          const session = Alpine.store('session');
          const pagination = mergePaginationConfigs(
            this.incidents.paginationConfig(),
            this.walks.paginationConfig(),
          );
          const data = await session.fetchSnapshot(pagination);
          this.incidents.assign(data.safety_incidents);
          this.walks.assign(data.safety_walks);
          this.training = data.training_compliance || null;
        } finally {
          this.loading = false;
        }
      },
      clear() {
        this.incidents.assign(null);
        this.walks.assign(null);
        this.training = null;
        this.loading = false;
      },
      async changePage(section, delta) {
        const target = section === 'safety_walks' ? this.walks : this.incidents;
        if (target.change(delta)) {
          await this.refresh();
        }
      },
      async gotoPage(section, page) {
        const target = section === 'safety_walks' ? this.walks : this.incidents;
        if (target.setPage(page)) {
          await this.refresh();
        }
      },
      handleEvent() {
        this.refresh();
      },
    });

    Alpine.store('handover', {
      notes: createPaginatedSection('shift_notes'),
      loading: false,
      async refresh() {
        this.loading = true;
        try {
          const session = Alpine.store('session');
          const data = await session.fetchSnapshot(this.notes.paginationConfig());
          this.notes.assign(data.shift_notes);
        } finally {
          this.loading = false;
        }
      },
      clear() {
        this.notes.assign(null);
        this.loading = false;
      },
      async changePage(delta) {
        if (this.notes.change(delta)) {
          await this.refresh();
        }
      },
      async gotoPage(page) {
        if (this.notes.setPage(page)) {
          await this.refresh();
        }
      },
      handleEvent() {
        this.refresh();
      },
    });

    Alpine.data('monitorShell', () => ({
      init() {
        const session = Alpine.store('session');
        session.applyUserDefaults();
        session.bootstrap();
      },
      get session() {
        return Alpine.store('session');
      },
      get overview() {
        return Alpine.store('overview');
      },
      get quality() {
        return Alpine.store('quality');
      },
      get maintenance() {
        return Alpine.store('maintenance');
      },
      get logistics() {
        return Alpine.store('logistics');
      },
      get safety() {
        return Alpine.store('safety');
      },
      get handover() {
        return Alpine.store('handover');
      },
      formatPercent(value) {
        if (value === null || value === undefined || value === '') return '—';
        return `${Number(value).toFixed(1)}%`;
      },
      formatTime(value) {
        if (!value) return 'Just now';
        const dt = new Date(value);
        if (Number.isNaN(dt.getTime())) {
          return value;
        }
        return dt.toLocaleString();
      },
      formatNumber(value) {
        if (value === null || value === undefined) return '—';
        return Number(value).toLocaleString();
      },
      selectUser(event) {
        this.session.setUser(event.target.value);
      },
      selectPage(page) {
        this.session.setPage(page);
      },
      selectLine(lineId) {
        this.overview.selectLine(lineId);
      },
      maintenanceSelectDowntime(id) {
        this.maintenance.selectDowntime(id);
      },
      changePage(section, delta) {
        switch (section) {
          case 'recent_defects':
          case 'quality_audits':
            return this.quality.changePage(section, delta);
          case 'downtime_events':
          case 'maintenance_backlog':
            return this.maintenance.changePage(section, delta);
          case 'supply_runs':
          case 'outbound_shipments':
          case 'inventory_positions':
            return this.logistics.changePage(section, delta);
          case 'safety_incidents':
          case 'safety_walks':
            return this.safety.changePage(section, delta);
          case 'shift_notes':
            return this.handover.changePage(delta);
          default:
            return Promise.resolve();
        }
      },
    }));
  });
})();

const { createApp, inject, computed } = window.Vue;
const DASHBOARD_STORE_KEY = Symbol('manufacturing-monitor-baseline-store');

function bootstrap() {
    const directory = (window.monitorUsers && Array.isArray(window.monitorUsers.users))
      ? window.monitorUsers.users
      : [];
    const defaultUserId =
      (window.monitorUsers && (window.monitorUsers.default || directory[0]?.id)) || '';
    let requestedUserId = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const candidate = params.get('user');
      if (candidate && directory.some((entry) => entry.id === candidate)) {
        requestedUserId = candidate;
      }
    } catch (err) {
      console.warn('Unable to parse viewer from query string', err);
    }
    const initialUserId = requestedUserId || defaultUserId;

    function createInitialState() {
      return {
        loading: true,
        error: null,
      toast: null,
      toastTimer: null,
      userDirectory: directory,
      selectedUserId: initialUserId,
      viewerProfile: null,
      lineDirectorySize: (window.monitorUsers && Array.isArray(window.monitorUsers.users))
        ? window.monitorUsers.users.reduce(
            (max, entry) => Math.max(max, Array.isArray(entry.line_access) ? entry.line_access.length : 0),
            0,
          )
        : 0,
      pages: [
        { id: 'overview', label: 'Control room overview', scopes: ['overview'] },
        { id: 'quality', label: 'Quality room', scopes: ['quality'] },
        { id: 'maintenance', label: 'Maintenance dispatch', scopes: ['maintenance'] },
        { id: 'logistics', label: 'Materials & logistics', scopes: ['logistics'] },
        { id: 'safety', label: 'Safety center', scopes: ['safety'] },
        { id: 'handover', label: 'Shift handover', scopes: ['handover'] },
      ],
      currentPage: 'overview',
      lines: [],
      selectedLineId: null,
      selectedLine: null,
      recentDefects: [],
      downtimeEvents: [],
      qualitySummary: null,
      qualityAudits: [],
      maintenanceBacklog: [],
      supplyRuns: [],
      outboundShipments: [],
      inventoryPositions: [],
      inventoryCatalog: [],
      safetyIncidents: [],
      safetyWalks: [],
      trainingCompliance: null,
      shiftNotes: [],
      paginatedTargets: {
        recent_defects: 'recentDefects',
        downtime_events: 'downtimeEvents',
        quality_audits: 'qualityAudits',
        maintenance_backlog: 'maintenanceBacklog',
        shift_notes: 'shiftNotes',
        supply_runs: 'supplyRuns',
        outbound_shipments: 'outboundShipments',
        inventory_positions: 'inventoryPositions',
        safety_incidents: 'safetyIncidents',
        safety_walks: 'safetyWalks',
      },
      paginationState: {
        recent_defects: { page: 1, page_size: 12 },
        downtime_events: { page: 1, page_size: 10 },
        quality_audits: { page: 1, page_size: 12 },
        maintenance_backlog: { page: 1, page_size: 12 },
        shift_notes: { page: 1, page_size: 10 },
        supply_runs: { page: 1, page_size: 12 },
        outbound_shipments: { page: 1, page_size: 12 },
        inventory_positions: { page: 1, page_size: 15 },
        safety_incidents: { page: 1, page_size: 10 },
        safety_walks: { page: 1, page_size: 12 },
      },
      paginationMeta: {},
      globalUpdates: [],
      lineUpdates: [],
      globalSource: null,
      lineSource: null,
      globalConnected: false,
      lineConnected: false,
      actionLoading: false,
      auditLoading: false,
      maintenanceLoading: false,
      handoverLoading: false,
      logisticsLoading: false,
      shipmentLoading: false,
      safetyLoading: false,
      walkLoading: false,
      linePlanEditing: false,
      linePlanSaving: false,
      linePlanForm: {
        status: 'Running',
        crew_lead: '',
        line_goal_units: 0,
        oee: 0,
        active_sku: '',
        status_detail: '',
      },
      skuEditForm: {
        sku: '',
        shift_output: 0,
        quality_yield: 0,
        queued_orders: 0,
      },
      skuSaving: false,
      inventoryAdjustForm: {
        inventory_id: '',
        on_hand: 0,
        daily_usage: 0,
        target_days: 2.5,
      },
      inventoryAdjusting: false,
      shipmentStatusForm: {
        shipment_id: '',
        status: 'Staged',
        departure_minutes: 30,
      },
      shipmentStatusSaving: false,
      incidentUpdateForm: {
        incident_id: '',
        status: 'Open',
        corrective_action: '',
      },
      incidentUpdating: false,
      stoppageForm: {
        reason: 'Quality hold',
        expected_duration_minutes: 20,
        reported_by: 'Operator',
      },
      defectForm: {
        severity: 'major',
        description: 'Seal leak detected at test stand',
      },
      auditForm: {
        line_id: '',
        sku: '',
        performed_by: 'QA lead',
        status: 'Open',
        summary: 'Verification samples pulled',
      },
      dispatchForm: {
        technician: 'Tech lead',
        eta_minutes: 20,
        note: '',
      },
      handoverForm: {
        author: 'Supervisor',
        focus: 'Shift update',
        note: '',
      },
      deliveryForm: {
        line_id: '',
        dock: 'Dock 3',
        carrier: 'Midwest Freight',
        material: '',
        quantity: 960,
        uom: 'units',
        eta_minutes: 25,
        notes: '',
      },
      shipmentForm: {
        line_id: '',
        destination: 'Regional DC',
        dock: 'Dock 5',
        trailer: 'TR-4821',
        contents: 'Finished goods',
        departure_minutes: 45,
      },
      safetyIncidentForm: {
        line_id: '',
        area: '',
        severity: 'Near miss',
        description: 'Guard door open during cycle',
        corrective_action: 'Tagged machine and briefed crew',
      },
      safetyWalkForm: {
        observer: 'EHS lead',
        area: 'Assembly mezzanine',
        notes: '',
        follow_up: 'None',
      },
      selectedDowntimeId: null,
      currentDowntimeEvent: null,
    };
  }

    const app = createApp({
    data() {
      return createInitialState();
    },
    computed: {
      line() {
        return this.selectedLine;
      },
    },
    provide() {
      return { [DASHBOARD_STORE_KEY]: this };
    },
    methods: {
      init() {
        this.ensureSelectedUser();
        this.resetPaginationState();
        this.bootstrap();
      },
      async bootstrap() {
        try {
          await this.refreshDataAndStreams();
        } catch (err) {
          console.error(err);
          this.error = 'Failed to load dashboard. Check the Flask server logs.';
        } finally {
          this.loading = false;
        }
      },
      async refreshDataAndStreams() {
        await this.fetchDashboard();
        this.subscribeGlobal();
        this.openLineFeed();
      },
      async fetchDashboard() {
        const params = this.buildDashboardQuery();
        const queryString = params.toString();
        const url = queryString ? `/api/dashboard?${queryString}` : '/api/dashboard';
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error('Failed to fetch dashboard');
        }
        const data = await res.json();
        if (data.viewer && data.viewer.id) {
          this.selectedUserId = data.viewer.id;
        }
        this.viewerProfile = data.viewer || null;
        this.lines = data.lines || [];
        this.inventoryCatalog = (data.inventory_catalog || []).slice().sort((a, b) => a.localeCompare(b));
        this.assignPaginatedSection('recent_defects', data.recent_defects);
        this.assignPaginatedSection('downtime_events', data.downtime_events);
        this.qualitySummary = data.quality_summary || null;
        this.assignPaginatedSection('quality_audits', data.quality_audits);
        this.assignPaginatedSection('maintenance_backlog', data.maintenance_backlog);
        this.assignPaginatedSection('supply_runs', data.supply_runs);
        this.assignPaginatedSection('outbound_shipments', data.outbound_shipments);
        this.assignPaginatedSection('inventory_positions', data.inventory_positions);
        this.assignPaginatedSection('safety_incidents', data.safety_incidents);
        this.assignPaginatedSection('safety_walks', data.safety_walks);
        this.trainingCompliance = data.training_compliance || null;
        this.assignPaginatedSection('shift_notes', data.shift_notes);
        this.ensureSelectedLine();
        if (this.downtimeEvents.length > 0) {
          if (!this.selectedDowntimeId || !this.downtimeEvents.some((event) => event.id === this.selectedDowntimeId)) {
            this.selectedDowntimeId = this.downtimeEvents[0].id;
          }
        } else {
          this.selectedDowntimeId = null;
        }
        this.refreshSelectedLine();
        this.syncAuditDefaults();
        this.syncLogisticsDefaults();
        this.syncSafetyDefaults();
        this.syncLinePlanForm();
        this.syncSkuEditor();
        this.syncInventoryAdjustDefaults();
        this.syncShipmentStatusDefaults();
        this.syncIncidentUpdateDefaults();
        this.refreshCurrentDowntime();
        this.ensureAccessiblePage();
      },
      buildDashboardQuery() {
        const params = new URLSearchParams();
        if (this.selectedUserId) {
          params.append('user', this.selectedUserId);
        }
        Object.entries(this.paginationState).forEach(([section, state]) => {
          if (!state) return;
          if (state.page && state.page > 1) {
            params.append(`page[${section}]`, state.page);
          }
          if (state.page_size) {
            params.append(`page_size[${section}]`, state.page_size);
          }
        });
        return params;
      },
      assignPaginatedSection(section, payload) {
        const target = this.paginatedTargets[section];
        if (!target) return;
        const meta = this.extractMeta(section, payload);
        this.paginationMeta = { ...this.paginationMeta, [section]: meta };
        this[target] = (payload && Array.isArray(payload.items)) ? payload.items : [];
        const existing = this.paginationState[section] || { page: 1 };
        const nextState = { ...existing, page: meta.page };
        if (meta.page_size) {
          nextState.page_size = meta.page_size;
        }
        this.paginationState = { ...this.paginationState, [section]: nextState };
      },
      resetSubscriptions() {
        if (this.globalSource) {
          this.globalSource.close();
        }
        if (this.lineSource) {
          this.lineSource.close();
        }
        this.globalSource = null;
        this.lineSource = null;
        this.globalConnected = false;
        this.lineConnected = false;
      },
      lookupUser(id) {
        return this.userDirectory.find((entry) => entry.id === id) || null;
      },
      ensureSelectedUser() {
        if (!this.selectedUserId && this.userDirectory.length > 0) {
          this.selectedUserId = this.userDirectory[0].id;
        }
      },
      activeViewerEntry() {
        return this.lookupUser(this.selectedUserId) || (this.userDirectory[0] || null);
      },
      activeViewerName() {
        if (this.viewerProfile && this.viewerProfile.name) {
          return this.viewerProfile.name;
        }
        const entry = this.activeViewerEntry();
        return entry ? entry.name : 'Viewer';
      },
      activeViewerRole() {
        if (this.viewerProfile && this.viewerProfile.role) {
          return this.viewerProfile.role;
        }
        const entry = this.activeViewerEntry();
        return entry ? entry.role : '';
      },
      activeViewerDescription() {
        const entry = this.activeViewerEntry();
        return entry && entry.description ? entry.description : '';
      },
      effectiveScopes() {
        const serverScopes = this.viewerProfile && Array.isArray(this.viewerProfile.scopes)
          ? this.viewerProfile.scopes
          : null;
        if (serverScopes) {
          return serverScopes;
        }
        const entry = this.activeViewerEntry();
        return entry && Array.isArray(entry.scopes) ? entry.scopes : [];
      },
      viewerScopes() {
        return this.effectiveScopes();
      },
      scopeLabel(scope) {
        const map = {
          overview: 'Overview',
          quality: 'Quality',
          maintenance: 'Maintenance',
          logistics: 'Logistics',
          safety: 'Safety',
          handover: 'Handover',
        };
        return map[scope] || scope;
      },
      viewerLineAccess() {
        const serverLines = this.viewerProfile && Array.isArray(this.viewerProfile.line_access)
          ? this.viewerProfile.line_access
          : null;
        if (serverLines) {
          return serverLines;
        }
        const entry = this.activeViewerEntry();
        return entry && Array.isArray(entry.line_access) ? entry.line_access : [];
      },
      viewerLineAccessLabel() {
        const list = this.viewerLineAccess();
        if (!list || list.length === 0) {
          return 'Line feeds hidden';
        }
        const total = this.lineDirectorySize || list.length;
        if (total > 0 && list.length >= total) {
          return 'All production lines';
        }
        if (list.length <= 3) {
          return `Lines: ${list.join(', ')}`;
        }
        return `Lines: ${list.slice(0, 3).join(', ')}…`;
      },
      canViewScope(scope) {
        if (!scope) return true;
        return this.viewerScopes().includes(scope);
      },
      pageScopes(pageId) {
        const entry = this.pages.find((page) => page.id === pageId);
        return entry && Array.isArray(entry.scopes) ? entry.scopes : [];
      },
      canAccessPage(pageId) {
        if (!pageId) return false;
        const scopes = this.pageScopes(pageId);
        if (scopes.length === 0) {
          return true;
        }
        return scopes.every((scope) => this.canViewScope(scope));
      },
      pageButtonClasses(page) {
        const activeClass =
          'border-emerald-400/70 bg-emerald-500/10 text-emerald-100 shadow shadow-emerald-500/20';
        const inactiveClass =
          'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white';
        const base = this.currentPage === page.id ? activeClass : inactiveClass;
        if (!this.canAccessPage(page.id)) {
          return `${base} cursor-not-allowed opacity-40 hover:border-slate-700 hover:text-slate-300`;
        }
        return base;
      },
      viewerLineAccessList() {
        return this.viewerLineAccess();
      },
      canViewLine(lineId) {
        if (!lineId) return true;
        const list = this.viewerLineAccessList();
        if (!list || list.length === 0) {
          return false;
        }
        return list.includes(lineId);
      },
      ensureAccessiblePage() {
        if (this.currentPage && this.canAccessPage(this.currentPage)) {
          return;
        }
        const fallback = this.pages.find((page) => this.canAccessPage(page.id));
        this.currentPage = fallback ? fallback.id : null;
      },
      paginationDefaults() {
        return {
          recent_defects: { page: 1, page_size: 12 },
          downtime_events: { page: 1, page_size: 10 },
          quality_audits: { page: 1, page_size: 12 },
          maintenance_backlog: { page: 1, page_size: 12 },
          shift_notes: { page: 1, page_size: 10 },
          supply_runs: { page: 1, page_size: 12 },
          outbound_shipments: { page: 1, page_size: 12 },
          inventory_positions: { page: 1, page_size: 15 },
          safety_incidents: { page: 1, page_size: 10 },
          safety_walks: { page: 1, page_size: 12 },
        };
      },
      resetPaginationState() {
        this.paginationState = this.paginationDefaults();
        this.paginationMeta = {};
      },
      resetSelectionsForUser() {
        this.selectedLineId = null;
        this.selectedLine = null;
        this.selectedDowntimeId = null;
        this.currentDowntimeEvent = null;
      },
      changeUser(userId) {
        if (!userId) {
          this.ensureSelectedUser();
          return;
        }
        const nextUrl = `${window.location.pathname}?user=${encodeURIComponent(userId)}${
          window.location.hash || ''
        }`;
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash || ''}`;
        if (nextUrl === currentUrl) {
          window.location.reload();
          return;
        }
        window.location.assign(nextUrl);
      },
      extractMeta(section, payload) {
        const fallbackSize = this.paginationState[section]?.page_size || 10;
        if (!payload) {
          return { page: 1, page_size: fallbackSize, total: 0, total_pages: 1 };
        }
        return {
          page: payload.page ?? 1,
          page_size: payload.page_size ?? fallbackSize,
          total: payload.total ?? (Array.isArray(payload.items) ? payload.items.length : 0),
          total_pages: payload.total_pages ?? 1,
        };
      },
      paginatedTotal(section) {
        return this.paginationMeta[section]?.total ?? 0;
      },
      paginationWindowLabel(section) {
        const meta = this.paginationMeta[section];
        if (!meta || meta.total === 0) {
          return 'No records';
        }
        const start = (meta.page - 1) * meta.page_size + 1;
        const end = Math.min(meta.total, meta.page * meta.page_size);
        if (meta.total_pages <= 1) {
          return `${meta.total} records`;
        }
        return `${start}–${end} of ${meta.total}`;
      },
      hasPrev(section) {
        const meta = this.paginationMeta[section];
        return !!meta && meta.page > 1;
      },
      hasNext(section) {
        const meta = this.paginationMeta[section];
        return !!meta && meta.page < meta.total_pages;
      },
      async changePage(section, delta) {
        const meta = this.paginationMeta[section];
        if (!meta) return;
        const totalPages = Math.max(meta.total_pages || 1, 1);
        const targetPage = Math.min(Math.max(1, meta.page + delta), totalPages);
        if (targetPage === meta.page) return;
        const state = { ...(this.paginationState[section] || {}), page: targetPage };
        this.paginationState = { ...this.paginationState, [section]: state };
        try {
          await this.fetchDashboard();
        } catch (err) {
          console.error(err);
          this.error = 'Unable to load the requested page. Try again.';
        }
      },
      upsertPaginated(section, item, options = {}) {
        const target = this.paginatedTargets[section];
        if (!target || !item) return;
        const items = Array.isArray(this[target]) ? [...this[target]] : [];
        const meta = this.paginationMeta[section] || this.extractMeta(section, null);
        const updatedMeta = { ...meta };
        const idKey = options.idKey || 'id';
        const idx = items.findIndex((entry) => entry && entry[idKey] === item[idKey]);
        if (idx === -1) {
          updatedMeta.total = (updatedMeta.total || 0) + 1;
          updatedMeta.total_pages = Math.max(1, Math.ceil(updatedMeta.total / updatedMeta.page_size));
          if (updatedMeta.page === 1) {
            items.unshift(item);
            if (items.length > updatedMeta.page_size) {
              items.pop();
            }
          }
        } else {
          items.splice(idx, 1, item);
        }
        this[target] = items;
        this.paginationMeta = { ...this.paginationMeta, [section]: updatedMeta };
        this.paginationState = {
          ...this.paginationState,
          [section]: {
            ...(this.paginationState[section] || {}),
            page: updatedMeta.page,
            page_size: updatedMeta.page_size,
          },
        };
      },
      replacePaginatedItems(section, fullList) {
        const target = this.paginatedTargets[section];
        if (!target || !Array.isArray(fullList)) return;
        const meta = this.paginationMeta[section] || this.extractMeta(section, null);
        const pageSize = meta.page_size || this.paginationState[section]?.page_size || Math.max(fullList.length, 1);
        const total = fullList.length;
        const totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
        const currentPage = Math.min(meta.page, totalPages);
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        this[target] = fullList.slice(start, end);
        const nextMeta = {
          ...meta,
          page: currentPage,
          total,
          total_pages: totalPages,
          page_size: pageSize,
        };
        this.paginationMeta = { ...this.paginationMeta, [section]: nextMeta };
        this.paginationState = {
          ...this.paginationState,
          [section]: {
            ...(this.paginationState[section] || {}),
            page: currentPage,
            page_size: pageSize,
          },
        };
      },
      ensureInventoryInCatalog(material) {
        if (!material) return;
        if (!this.inventoryCatalog.includes(material)) {
          this.inventoryCatalog = [...this.inventoryCatalog, material].sort((a, b) => a.localeCompare(b));
        }
      },
      rebuildInventoryCatalog(list) {
        if (!Array.isArray(list)) return;
        const unique = Array.from(
          new Set(list.map((item) => (item && item.material ? String(item.material) : '')).filter(Boolean)),
        );
        this.inventoryCatalog = unique.sort((a, b) => a.localeCompare(b));
      },
      setPage(page) {
        const targetId = typeof page === 'string' ? page : page?.id;
        if (!targetId) return;
        if (!this.canAccessPage(targetId)) {
          this.error = 'You do not have access to that page.';
          return;
        }
        this.currentPage = targetId;
        if (targetId === 'maintenance' && !this.selectedDowntimeId && this.downtimeEvents.length > 0) {
          this.selectedDowntimeId = this.downtimeEvents[0].id;
          this.refreshCurrentDowntime();
        }
        if (targetId === 'logistics') {
          this.syncLogisticsDefaults();
        }
        if (targetId === 'safety') {
          this.syncSafetyDefaults();
        }
      },
      isPage(page) {
        return this.currentPage === page;
      },
      selectLine(lineId) {
        if (!lineId || !this.canViewLine(lineId)) {
          this.error = 'You do not have permission to view that line feed.';
          return;
        }
        if (this.selectedLineId === lineId) return;
        this.selectedLineId = lineId;
        this.refreshSelectedLine();
        this.lineUpdates = [];
        this.linePlanEditing = false;
        this.syncAuditDefaults();
        this.syncLogisticsDefaults();
        this.syncSafetyDefaults();
        this.syncLinePlanForm();
        this.syncSkuEditor();
        this.openLineFeed();
      },
      refreshSelectedLine() {
        this.selectedLine = this.lines.find((line) => line.id === this.selectedLineId) || null;
      },
      ensureSelectedLine() {
        const accessible = this.lines.filter((line) => this.canViewLine(line.id));
        if (!this.selectedLineId || !this.canViewLine(this.selectedLineId)) {
          this.selectedLineId = accessible.length > 0 ? accessible[0].id : null;
        }
        if (!this.selectedLineId) {
          this.selectedLine = null;
        }
      },
      refreshCurrentDowntime() {
        this.currentDowntimeEvent =
          this.downtimeEvents.find((event) => event.id === this.selectedDowntimeId) || null;
      },
      syncAuditDefaults() {
        if (this.selectedLine) {
          this.auditForm.line_id = this.selectedLine.id;
          const defaultSku = (this.selectedLine.skus && this.selectedLine.skus[0]?.sku) || this.selectedLine.active_sku || this.auditForm.sku;
          this.auditForm.sku = defaultSku || '';
        } else if (!this.auditForm.line_id) {
          this.auditForm.sku = this.auditForm.sku || (this.lines[0]?.active_sku || '');
        }
      },
      syncLogisticsDefaults() {
        if (this.selectedLine) {
          this.deliveryForm.line_id = this.selectedLine.id;
          this.shipmentForm.line_id = this.shipmentForm.line_id || this.selectedLine.id;
          if (!this.shipmentForm.contents) {
            this.shipmentForm.contents = `${this.selectedLine.active_sku || 'Finished goods'} pallets`;
          }
        } else if (!this.deliveryForm.line_id && this.lines.length > 0) {
          this.deliveryForm.line_id = this.deliveryForm.line_id || this.lines[0].id;
          this.shipmentForm.line_id = this.shipmentForm.line_id || this.lines[0].id;
        }
        if (!this.deliveryForm.material) {
          if (this.inventoryPositions.length > 0) {
            const first = this.inventoryPositions[0];
            this.deliveryForm.material = first.material;
            this.deliveryForm.uom = first.uom || this.deliveryForm.uom;
          } else if (this.inventoryCatalog.length > 0) {
            this.deliveryForm.material = this.inventoryCatalog[0];
          }
        }
        const match = this.inventoryPositions.find((item) => item.material === this.deliveryForm.material);
        if (match && match.uom) {
          this.deliveryForm.uom = match.uom;
        }
        this.syncInventoryAdjustDefaults();
        this.syncShipmentStatusDefaults();
      },
      syncSafetyDefaults() {
        if (this.selectedLine) {
          this.safetyIncidentForm.line_id = this.selectedLine.id;
          this.safetyIncidentForm.area = this.selectedLine.name;
          if (!this.safetyWalkForm.area) {
            this.safetyWalkForm.area = this.selectedLine.name;
          }
        } else if (this.lines.length > 0 && !this.safetyIncidentForm.area) {
          this.safetyIncidentForm.area = this.lines[0].name;
        }
        this.syncIncidentUpdateDefaults();
      },
      syncLinePlanForm() {
        if (this.selectedLine) {
          Object.assign(this.linePlanForm, {
            status: this.selectedLine.status || 'Running',
            crew_lead: this.selectedLine.crew_lead || '',
            line_goal_units: Number(this.selectedLine.line_goal_units || 0),
            oee: this.selectedLine.oee != null ? Number(this.selectedLine.oee) : 0,
            active_sku: this.selectedLine.active_sku || '',
            status_detail: this.selectedLine.status_detail || '',
          });
        } else {
          Object.assign(this.linePlanForm, {
            status: 'Running',
            crew_lead: '',
            line_goal_units: 0,
            oee: 0,
            active_sku: '',
            status_detail: '',
          });
        }
      },
      startLinePlanEdit() {
        if (!this.selectedLine) return;
        this.linePlanEditing = true;
        this.syncLinePlanForm();
      },
      cancelLinePlanEdit() {
        this.linePlanEditing = false;
        this.syncLinePlanForm();
      },
      async saveLinePlan() {
        if (!this.selectedLine) return;
        this.linePlanSaving = true;
        try {
          const payload = {
            line_id: this.selectedLine.id,
            status: this.linePlanForm.status,
            crew_lead: this.linePlanForm.crew_lead,
            line_goal_units: Number.isFinite(this.linePlanForm.line_goal_units)
              ? this.linePlanForm.line_goal_units
              : null,
            oee: Number.isFinite(this.linePlanForm.oee) ? this.linePlanForm.oee : null,
            active_sku: this.linePlanForm.active_sku,
            status_detail: this.linePlanForm.status_detail,
          };
          const res = await fetch('/api/update-line-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to update line plan');
          }
          this.setToast('Line plan updated and broadcast to the floor.');
          this.linePlanEditing = false;
        } catch (err) {
          console.error(err);
          this.error = 'Unable to update the line plan. Check the server logs.';
        } finally {
          this.linePlanSaving = false;
        }
      },
      syncSkuEditor() {
        if (!this.selectedLine || !Array.isArray(this.selectedLine.skus) || this.selectedLine.skus.length === 0) {
          Object.assign(this.skuEditForm, {
            sku: '',
            shift_output: 0,
            quality_yield: 0,
            queued_orders: 0,
          });
          return;
        }
        if (!this.selectedLine.skus.some((sku) => sku.sku === this.skuEditForm.sku)) {
          this.skuEditForm.sku = this.selectedLine.skus[0].sku;
        }
        this.loadSkuDefaults();
      },
      loadSkuDefaults() {
        if (!this.selectedLine) return;
        const target = (this.selectedLine.skus || []).find((sku) => sku.sku === this.skuEditForm.sku);
        if (!target) return;
        Object.assign(this.skuEditForm, {
          sku: target.sku,
          shift_output: Number(target.shift_output || 0),
          quality_yield: target.quality_yield != null ? Number(target.quality_yield) : 0,
          queued_orders: Number(target.queued_orders || 0),
        });
      },
      async saveSkuAdjustment() {
        if (!this.selectedLine || !this.skuEditForm.sku) return;
        this.skuSaving = true;
        try {
          const payload = {
            line_id: this.selectedLine.id,
            sku: this.skuEditForm.sku,
            shift_output: Number.isFinite(this.skuEditForm.shift_output)
              ? this.skuEditForm.shift_output
              : null,
            quality_yield: Number.isFinite(this.skuEditForm.quality_yield)
              ? this.skuEditForm.quality_yield
              : null,
            queued_orders: Number.isFinite(this.skuEditForm.queued_orders)
              ? this.skuEditForm.queued_orders
              : null,
          };
          const res = await fetch('/api/update-line-sku', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to adjust SKU targets');
          }
          this.setToast('SKU plan adjusted and synced to the crew tablets.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to adjust SKU targets. Check the server logs.';
        } finally {
          this.skuSaving = false;
        }
      },
      resetSkuEditor() {
        this.loadSkuDefaults();
      },
      syncInventoryAdjustDefaults() {
        if (!this.inventoryPositions || this.inventoryPositions.length === 0) {
          Object.assign(this.inventoryAdjustForm, {
            inventory_id: '',
            on_hand: 0,
            daily_usage: 0,
            target_days: 2.5,
          });
          return;
        }
        if (!this.inventoryPositions.some((item) => item.id === this.inventoryAdjustForm.inventory_id)) {
          this.inventoryAdjustForm.inventory_id = this.inventoryPositions[0].id;
        }
        this.loadInventoryAdjustDefaults();
      },
      loadInventoryAdjustDefaults() {
        const item = this.inventoryPositions.find((entry) => entry.id === this.inventoryAdjustForm.inventory_id);
        if (!item) return;
        Object.assign(this.inventoryAdjustForm, {
          inventory_id: item.id,
          on_hand: Number(item.on_hand || 0),
          daily_usage: item.daily_usage != null ? Number(item.daily_usage) : 0,
          target_days: item.target_days != null ? Number(item.target_days) : 2.5,
        });
      },
      async adjustInventory() {
        if (!this.inventoryAdjustForm.inventory_id) return;
        this.inventoryAdjusting = true;
        try {
          const payload = {
            inventory_id: this.inventoryAdjustForm.inventory_id,
            on_hand: Number.isFinite(this.inventoryAdjustForm.on_hand)
              ? this.inventoryAdjustForm.on_hand
              : null,
            daily_usage: Number.isFinite(this.inventoryAdjustForm.daily_usage)
              ? this.inventoryAdjustForm.daily_usage
              : null,
            target_days: Number.isFinite(this.inventoryAdjustForm.target_days)
              ? this.inventoryAdjustForm.target_days
              : null,
          };
          const res = await fetch('/api/adjust-inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to adjust inventory');
          }
          this.setToast('Inventory coverage updated for planners and dock leads.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to adjust inventory. Check the server logs.';
        } finally {
          this.inventoryAdjusting = false;
        }
      },
      syncShipmentStatusDefaults() {
        if (!this.outboundShipments || this.outboundShipments.length === 0) {
          Object.assign(this.shipmentStatusForm, {
            shipment_id: '',
            status: 'Staged',
            departure_minutes: 30,
          });
          return;
        }
        if (!this.outboundShipments.some((shipment) => shipment.id === this.shipmentStatusForm.shipment_id)) {
          this.shipmentStatusForm.shipment_id = this.outboundShipments[0].id;
        }
        const current = this.outboundShipments.find((shipment) => shipment.id === this.shipmentStatusForm.shipment_id) || this.outboundShipments[0];
        if (current) {
          this.shipmentStatusForm.status = current.status || this.shipmentStatusForm.status || 'Staged';
          if (current.departing_at) {
            const departAt = new Date(current.departing_at);
            if (!Number.isNaN(departAt.getTime())) {
              const diffMs = departAt.getTime() - Date.now();
              const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
              this.shipmentStatusForm.departure_minutes = diffMinutes;
            }
          }
        }
      },
      async updateShipmentStatus() {
        if (!this.shipmentStatusForm.shipment_id) return;
        this.shipmentStatusSaving = true;
        try {
          const payload = {
            shipment_id: this.shipmentStatusForm.shipment_id,
            status: this.shipmentStatusForm.status,
            departure_minutes: Number.isFinite(this.shipmentStatusForm.departure_minutes)
              ? this.shipmentStatusForm.departure_minutes
              : null,
          };
          const res = await fetch('/api/update-shipment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to update shipment');
          }
          this.setToast('Shipment status pushed to shipping, logistics, and line feeds.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to update shipment. Check the server logs.';
        } finally {
          this.shipmentStatusSaving = false;
        }
      },
      syncIncidentUpdateDefaults() {
        if (!this.safetyIncidents || this.safetyIncidents.length === 0) {
          Object.assign(this.incidentUpdateForm, {
            incident_id: '',
            status: 'Open',
            corrective_action: '',
          });
          return;
        }
        if (!this.safetyIncidents.some((incident) => incident.id === this.incidentUpdateForm.incident_id)) {
          this.incidentUpdateForm.incident_id = this.safetyIncidents[0].id;
        }
        this.loadIncidentDefaults();
      },
      loadIncidentDefaults() {
        const incident = this.safetyIncidents.find((entry) => entry.id === this.incidentUpdateForm.incident_id);
        if (!incident) return;
        Object.assign(this.incidentUpdateForm, {
          incident_id: incident.id,
          status: incident.status || 'Open',
          corrective_action: incident.corrective_action || '',
        });
      },
      async updateSafetyIncident() {
        if (!this.incidentUpdateForm.incident_id) return;
        this.incidentUpdating = true;
        try {
          const payload = {
            incident_id: this.incidentUpdateForm.incident_id,
            status: this.incidentUpdateForm.status,
            corrective_action: this.incidentUpdateForm.corrective_action,
          };
          const res = await fetch('/api/update-safety-incident', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to update safety incident');
          }
          this.setToast('Safety log updated across the plant dashboards.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to update the safety incident. Check the server logs.';
        } finally {
          this.incidentUpdating = false;
        }
      },
      subscribeGlobal() {
        if (this.globalSource) {
          this.globalSource.close();
        }
        const params = new URLSearchParams();
        if (this.selectedUserId) {
          params.append('user', this.selectedUserId);
        }
        const url = params.toString() ? `/events?${params.toString()}` : '/events';
        const source = new EventSource(url);
        source.onopen = () => {
          this.globalConnected = true;
        };
        source.onmessage = (event) => {
          if (!event.data) return;
          const payload = JSON.parse(event.data);
          if (payload.type === 'ready') {
            this.globalConnected = true;
            return;
          }
          this.handleUpdate(payload, 'global');
        };
        source.onerror = () => {
          this.globalConnected = false;
        };
        this.globalSource = source;
      },
      openLineFeed() {
        if (this.lineSource) {
          this.lineSource.close();
          this.lineSource = null;
        }
        this.lineConnected = false;
        if (!this.selectedLineId || !this.canViewLine(this.selectedLineId)) {
          return;
        }
        const params = new URLSearchParams();
        params.append('audience', this.selectedLineId);
        if (this.selectedUserId) {
          params.append('user', this.selectedUserId);
        }
        const source = new EventSource(`/events?${params.toString()}`);
        source.onopen = () => {
          this.lineConnected = true;
        };
        source.onmessage = (event) => {
          if (!event.data) return;
          const payload = JSON.parse(event.data);
          if (payload.type === 'ready') {
            this.lineConnected = true;
            return;
          }
          this.handleUpdate(payload, 'line');
        };
        source.onerror = () => {
          this.lineConnected = false;
        };
        this.lineSource = source;
      },
      handleUpdate(payload, scope) {
        if (!payload || !payload.type) return;
        const visibility = Array.isArray(payload.visibility) ? payload.visibility : [];
        if (visibility.length > 0 && !visibility.some((tag) => this.canViewScope(tag))) {
          return;
        }
        const payloadLineId = payload.line_id || (payload.line && payload.line.id) || null;
        if (payloadLineId && !this.canViewLine(payloadLineId)) {
          return;
        }
        if (payload.line && (!payload.line.id || this.canViewLine(payload.line.id))) {
          this.upsertLine(payload.line);
        }
        if (payload.type === 'line_plan_update') {
          this.linePlanEditing = false;
        }
        if (payload.type === 'downtime_event' && payload.event) {
          this.mergeDowntime(payload.event);
        }
        if (payload.type === 'maintenance_dispatch' && payload.event) {
          this.mergeDowntime(payload.event);
        }
        if (payload.type === 'quality_alert' && payload.defect) {
          this.mergeDefect(payload.defect);
        }
        if (payload.type === 'quality_audit' && payload.audit) {
          this.mergeAudit(payload.audit);
          if (payload.summary) {
            this.qualitySummary = payload.summary;
          }
        }
        if (payload.type === 'shift_note' && payload.note) {
          this.mergeShiftNote(payload.note);
        }
        if (payload.type === 'supply_run' && payload.delivery) {
          this.mergeSupplyRun(payload.delivery);
          if (payload.inventory) {
            this.replacePaginatedItems('inventory_positions', payload.inventory);
            this.rebuildInventoryCatalog(payload.inventory);
            this.syncLogisticsDefaults();
          }
        }
        if (payload.type === 'shipment_update' && payload.shipment) {
          this.mergeShipment(payload.shipment);
          this.syncShipmentStatusDefaults();
        }
        if (payload.type === 'safety_incident' && payload.incident) {
          this.mergeSafetyIncident(payload.incident);
        }
        if (payload.type === 'safety_walk' && payload.walk) {
          this.mergeSafetyWalk(payload.walk);
        }
        if (payload.type === 'inventory_adjustment') {
          if (payload.inventory) {
            this.replacePaginatedItems('inventory_positions', payload.inventory);
            this.rebuildInventoryCatalog(payload.inventory);
          } else if (payload.inventory_item) {
            this.mergeInventory(payload.inventory_item);
          }
          this.syncLogisticsDefaults();
        }
        if (payload.type === 'sku_adjustment' && payload.sku) {
          this.syncSkuEditor();
        }
        if ((payload.type === 'safety_incident' || payload.type === 'safety_walk') && payload.training) {
          this.trainingCompliance = payload.training;
        }
        if (scope === 'global') {
          this.globalUpdates.unshift(payload);
          this.globalUpdates = this.globalUpdates.slice(0, 20);
        }
        if (scope === 'line') {
          this.lineUpdates.unshift(payload);
          this.lineUpdates = this.lineUpdates.slice(0, 20);
        }
        this.refreshSelectedLine();
        this.syncAuditDefaults();
        this.syncLinePlanForm();
        this.syncSkuEditor();
        this.syncLogisticsDefaults();
        this.syncSafetyDefaults();
      },
      upsertLine(line) {
        const idx = this.lines.findIndex((item) => item.id === line.id);
        if (idx === -1) {
          this.lines.push(line);
        } else {
          this.lines.splice(idx, 1, line);
        }
      },
      mergeDowntime(event) {
        this.upsertPaginated('downtime_events', event);
        const isVisible = this.downtimeEvents.some((item) => item.id === event.id);
        if (!this.selectedDowntimeId || isVisible) {
          this.selectedDowntimeId = event.id;
        }
        this.refreshCurrentDowntime();
      },
      mergeDefect(defect) {
        this.upsertPaginated('recent_defects', defect);
      },
      mergeAudit(audit) {
        this.upsertPaginated('quality_audits', audit);
      },
      mergeShiftNote(note) {
        this.upsertPaginated('shift_notes', note);
      },
      mergeSupplyRun(delivery) {
        this.upsertPaginated('supply_runs', delivery);
      },
      mergeInventory(item) {
        this.upsertPaginated('inventory_positions', item);
        this.ensureInventoryInCatalog(item.material);
      },
      mergeShipment(shipment) {
        this.upsertPaginated('outbound_shipments', shipment);
        this.syncShipmentStatusDefaults();
      },
      mergeSafetyIncident(incident) {
        this.upsertPaginated('safety_incidents', incident);
        this.syncIncidentUpdateDefaults();
      },
      mergeSafetyWalk(walk) {
        this.upsertPaginated('safety_walks', walk);
      },
      async logStoppage() {
        if (!this.selectedLineId) return;
        this.actionLoading = true;
        try {
          const payload = {
            line_id: this.selectedLineId,
            reason: this.stoppageForm.reason,
            expected_duration_minutes: this.stoppageForm.expected_duration_minutes,
            reported_by: this.stoppageForm.reported_by,
          };
          const res = await fetch('/api/log-stoppage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to log stoppage');
          }
          this.setToast('Stoppage logged. Maintenance and line leads were notified.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to log stoppage. Check the server logs.';
        } finally {
          this.actionLoading = false;
        }
      },
      async resolveLine() {
        if (!this.selectedLineId) return;
        this.actionLoading = true;
        try {
          const res = await fetch('/api/resolve-line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: this.selectedLineId, note: 'Resumed after verification' }),
          });
          if (!res.ok) {
            throw new Error('Failed to resolve line');
          }
          this.setToast('Line resumed. The floor feed now shows it running.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to resolve the line. Check the server logs.';
        } finally {
          this.actionLoading = false;
        }
      },
      async recordQualityIssue() {
        if (!this.selectedLine) return;
        this.actionLoading = true;
        try {
          const sku = (this.selectedLine.skus && this.selectedLine.skus[0]?.sku) || this.selectedLine.active_sku || 'SKU';
          const res = await fetch('/api/record-defect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              line_id: this.selectedLine.id,
              sku,
              description: this.defectForm.description,
              severity: this.defectForm.severity,
            }),
          });
          if (!res.ok) {
            throw new Error('Failed to record defect');
          }
          this.defectForm.description = '';
          this.setToast('Defect recorded. Quality has been alerted.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to record defect. Check the server logs.';
        } finally {
          this.actionLoading = false;
        }
      },
      async recordQualityAudit() {
        if (!this.auditForm.sku) return;
        this.auditLoading = true;
        try {
          const res = await fetch('/api/record-audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              line_id: this.auditForm.line_id || null,
              sku: this.auditForm.sku,
              performed_by: this.auditForm.performed_by,
              status: this.auditForm.status,
              summary: this.auditForm.summary,
            }),
          });
          if (!res.ok) {
            throw new Error('Failed to record audit');
          }
          this.auditForm.summary = '';
          this.setToast('Audit documented and broadcast to the floor.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to record audit. Check the server logs.';
        } finally {
          this.auditLoading = false;
        }
      },
      async dispatchMaintenance() {
        const event = this.currentDowntime();
        if (!event) return;
        this.maintenanceLoading = true;
        try {
          const res = await fetch('/api/dispatch-maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_id: event.id,
              technician: this.dispatchForm.technician,
              eta_minutes: this.dispatchForm.eta_minutes,
              note: this.dispatchForm.note,
            }),
          });
          if (!res.ok) {
            throw new Error('Failed to dispatch maintenance');
          }
          this.setToast('Maintenance dispatched to the line.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to dispatch maintenance. Check the server logs.';
        } finally {
          this.maintenanceLoading = false;
        }
      },
      async logDelivery() {
        this.logisticsLoading = true;
        try {
          const payload = {
            line_id: this.deliveryForm.line_id || null,
            dock: this.deliveryForm.dock,
            carrier: this.deliveryForm.carrier,
            material: this.deliveryForm.material,
            quantity: Number(this.deliveryForm.quantity) || 0,
            uom: this.deliveryForm.uom,
            eta_minutes: Number(this.deliveryForm.eta_minutes) || 0,
            notes: this.deliveryForm.notes,
          };
          const res = await fetch('/api/log-delivery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to log delivery');
          }
          this.deliveryForm.notes = '';
          this.setToast('Inbound delivery logged and routed to the floor feeds.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to log delivery. Check the server logs.';
        } finally {
          this.logisticsLoading = false;
        }
      },
      async logShipment() {
        this.shipmentLoading = true;
        try {
          const payload = {
            line_id: this.shipmentForm.line_id || null,
            destination: this.shipmentForm.destination,
            dock: this.shipmentForm.dock,
            trailer: this.shipmentForm.trailer,
            contents: this.shipmentForm.contents,
            departure_minutes: Number(this.shipmentForm.departure_minutes) || 0,
          };
          const res = await fetch('/api/log-shipment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to schedule shipment');
          }
          this.setToast('Shipment staged and broadcast to shipping and line tablets.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to schedule shipment. Check the server logs.';
        } finally {
          this.shipmentLoading = false;
        }
      },
      async logSafetyIncident() {
        if (!this.safetyIncidentForm.description) return;
        this.safetyLoading = true;
        try {
          const payload = {
            line_id: this.safetyIncidentForm.line_id || null,
            area: this.safetyIncidentForm.area,
            severity: this.safetyIncidentForm.severity,
            description: this.safetyIncidentForm.description,
            corrective_action: this.safetyIncidentForm.corrective_action,
          };
          const res = await fetch('/api/log-safety-incident', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to log safety incident');
          }
          this.safetyIncidentForm.description = '';
          this.setToast('Safety alert logged and pushed to the control room.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to log safety incident. Check the server logs.';
        } finally {
          this.safetyLoading = false;
        }
      },
      async logSafetyWalk() {
        if (!this.safetyWalkForm.notes) return;
        this.walkLoading = true;
        try {
          const payload = {
            observer: this.safetyWalkForm.observer,
            area: this.safetyWalkForm.area,
            notes: this.safetyWalkForm.notes,
            follow_up: this.safetyWalkForm.follow_up,
          };
          const res = await fetch('/api/log-safety-walk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error('Failed to post safety walk');
          }
          this.safetyWalkForm.notes = '';
          this.safetyWalkForm.follow_up = 'None';
          this.setToast('Safety walk posted and compliance metrics refreshed.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to post safety walk. Check the server logs.';
        } finally {
          this.walkLoading = false;
        }
      },
      async submitShiftNote() {
        if (!this.handoverForm.note) return;
        this.handoverLoading = true;
        try {
          const res = await fetch('/api/shift-note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.handoverForm),
          });
          if (!res.ok) {
            throw new Error('Failed to post note');
          }
          this.handoverForm.note = '';
          this.setToast('Shift note posted to every display.');
        } catch (err) {
          console.error(err);
          this.error = 'Unable to post shift note. Check the server logs.';
        } finally {
          this.handoverLoading = false;
        }
      },
      selectDowntime(eventId) {
        this.selectedDowntimeId = eventId;
        this.refreshCurrentDowntime();
      },
      currentDowntime() {
        return this.currentDowntimeEvent;
      },
      setToast(message) {
        this.toast = message;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
          this.toast = null;
        }, 3500);
      },
      formatPercent(value) {
        if (value == null) return '—';
        return `${Number(value).toFixed(1)}%`;
      },
      formatNumber(value) {
        if (value == null) return '—';
        return new Intl.NumberFormat().format(value);
      },
      formatTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      },
      formatDays(value) {
        if (value == null) return '—';
        return `${Number(value).toFixed(1)} days`;
      },
      lastRefreshedLabel() {
        if (!this.selectedLine || !this.selectedLine.last_updated) return '';
        return `Updated ${this.formatTime(this.selectedLine.last_updated)}`;
      },
      lineName(lineId) {
        const line = this.lines.find((item) => item.id === lineId);
        return line ? line.name : lineId;
      },
      statusBadgeClasses(status) {
        const map = {
          Running: 'bg-emerald-500/10 text-emerald-200 border border-emerald-400/40',
          Stopped: 'bg-rose-500/10 text-rose-200 border border-rose-400/40',
          Changeover: 'bg-amber-500/10 text-amber-200 border border-amber-400/40',
        };
        return map[status] || 'bg-slate-800 text-slate-300 border border-slate-700';
      },
      deliveryStatusClasses(status) {
        const map = {
          'Checked In': 'bg-emerald-500/10 text-emerald-200 border border-emerald-400/40',
          'En Route': 'bg-amber-500/10 text-amber-200 border border-amber-400/40',
          'Unloaded': 'bg-sky-500/10 text-sky-200 border border-sky-400/40',
        };
        return map[status] || 'bg-slate-800 text-slate-300 border border-slate-700';
      },
      inventoryStatusClasses(status) {
        const map = {
          Healthy: 'text-emerald-200',
          Watch: 'text-amber-200',
          Critical: 'text-rose-200',
        };
        return map[status] || 'text-slate-300';
      },
      severityBadgeClasses(severity) {
        const map = {
          minor: 'text-sky-200',
          major: 'text-amber-200',
          critical: 'text-rose-200',
        };
        return map[severity] || 'text-slate-300';
      },
      safetySeverityClasses(severity) {
        const map = {
          'Near miss': 'text-amber-200',
          'First aid': 'text-sky-200',
          'Recordable': 'text-rose-200',
        };
        return map[severity] || 'text-slate-300';
      },

    },
    mounted() {
      this.init();
    },
  });

    app.component('error-banner', {
      name: 'ErrorBanner',
      setup() {
        const store = inject(DASHBOARD_STORE_KEY);
        const error = computed(() => (store && store.error) || null);
        return { error };
      },
      template: `
        <div v-if="error" class="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong class="font-semibold">Error:</strong>
          <span>{{ error }}</span>
        </div>
      `,
    });

    app.component('toast-banner', {
      name: 'ToastBanner',
      setup() {
        const store = inject(DASHBOARD_STORE_KEY);
        const toast = computed(() => (store && store.toast) || null);
        return { toast };
      },
      template: `
        <div
          v-if="toast"
          class="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex items-center gap-2"
        >
          <svg class="h-4 w-4 text-emerald-300" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clip-rule="evenodd"
            />
          </svg>
          <span>{{ toast }}</span>
        </div>
      `,
    });

    app.mount('#app');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

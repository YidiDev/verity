window.telehealthHub = function telehealthHub() {
        return {
          queues: [],
          providers: [],
          cases: {},
          activityLog: [],
          activityIndex: new Set(),
          sessionUser: null,
          sessionUserId: null,
          availableUsers: [],
          roleLabels: {},
          viewRoles: {
            dashboard: ['operations'],
            coverage: ['coverage'],
            briefing: ['briefing'],
            resources: ['library'],
          },
          featureRoles: {
            queue_manage: ['operations'],
            case_manage: ['operations'],
            provider_manage: ['operations', 'coverage'],
            coverage_manage: ['coverage'],
            brief_manage: ['operations', 'briefing'],
            library_manage: ['library'],
          },
          queuePagination: {
            page: 1,
            page_size: 18,
            total: 0,
            total_pages: 0,
            has_next: false,
            has_prev: false,
            start_index: 0,
            end_index: 0,
          },
          providerPagination: {
            page: 1,
            page_size: 18,
            total: 0,
            total_pages: 0,
            has_next: false,
            has_prev: false,
            start_index: 0,
            end_index: 0,
          },
          activityPagination: {
            page: 1,
            page_size: 25,
            total: 0,
            total_pages: 0,
            has_next: false,
            has_prev: false,
            start_index: 0,
            end_index: 0,
          },
          coveragePagination: {
            teams: {
              page: 1,
              page_size: 6,
              total: 0,
              total_pages: 0,
              has_next: false,
              has_prev: false,
              start_index: 0,
              end_index: 0,
            },
            contacts: {
              page: 1,
              page_size: 8,
              total: 0,
              total_pages: 0,
              has_next: false,
              has_prev: false,
              start_index: 0,
              end_index: 0,
            },
          },
          briefPagination: {
            watchlist: {
              page: 1,
              page_size: 6,
              total: 0,
              total_pages: 0,
              has_next: false,
              has_prev: false,
              start_index: 0,
              end_index: 0,
            },
            overnight: {
              page: 1,
              page_size: 6,
              total: 0,
              total_pages: 0,
              has_next: false,
              has_prev: false,
              start_index: 0,
              end_index: 0,
            },
            staffing: {
              page: 1,
              page_size: 6,
              total: 0,
              total_pages: 0,
              has_next: false,
              has_prev: false,
              start_index: 0,
              end_index: 0,
            },
          },
          playbookPagination: {
            page: 1,
            page_size: 12,
            total: 0,
            total_pages: 0,
            has_next: false,
            has_prev: false,
            start_index: 0,
            end_index: 0,
          },
          casePagination: {
            timeline: {
              page: 1,
              page_size: 8,
              total: 0,
              total_pages: 0,
              has_next: false,
              has_prev: false,
              start_index: 0,
              end_index: 0,
            },
            contacts: {
              page: 1,
              page_size: 8,
              total: 0,
              total_pages: 0,
              has_next: false,
              has_prev: false,
              start_index: 0,
              end_index: 0,
            },
          },
          selectedCaseId: null,
          selectedCase: null,
          coordinator: 'Jamie Lee, RN',
          currentView: 'dashboard',
          views: [
            { id: 'dashboard', label: 'Live queue' },
            { id: 'coverage', label: 'Coverage map' },
            { id: 'briefing', label: 'Daily brief' },
            { id: 'resources', label: 'Reference library' },
          ],
          viewDescriptions: {
            dashboard: 'Monitor the live queue, update vitals, and log outreach without breaking focus.',
            coverage: 'See which pods are on shift, their handoff channels, and current case load.',
            briefing: 'Start-of-shift briefing that highlights escalations, overnight actions, and staffing asks.',
            resources: 'Pinned protocols and playbooks the pod leans on during triage.',
          },
          hasRole(role) {
            if (!role || !this.sessionUser || !Array.isArray(this.sessionUser.roles)) return false;
            return this.sessionUser.roles.includes(role);
          },
          can(feature) {
            if (!feature) return true;
            const allowedRoles = this.featureRoles[feature];
            if (!allowedRoles || allowedRoles.length === 0) return true;
            return allowedRoles.some((role) => this.hasRole(role));
          },
          canAccessView(viewId) {
            const allowedRoles = this.viewRoles[viewId];
            if (!allowedRoles || allowedRoles.length === 0) return true;
            return allowedRoles.some((role) => this.hasRole(role));
          },
          visibleViews() {
            return this.views.filter((view) => this.canAccessView(view.id));
          },
          defaultViewForUser() {
            if (!this.sessionUser) return 'dashboard';
            const preferred = this.sessionUser.home_view || 'dashboard';
            if (this.canAccessView(preferred)) return preferred;
            const candidates = this.visibleViews();
            return candidates.length > 0 ? candidates[0].id : 'dashboard';
          },
          operationsMetrics: null,
          operationsBrief: null,
          coverageSummary: null,
          resourceLibrary: [],
          loadingQueues: false,
          loadingProviders: false,
          loadingCase: false,
          loadingMetrics: false,
          loadingBrief: false,
          loadingCoverage: false,
          loadingResources: false,
          lastQueueRefresh: null,
          lastProviderRefresh: null,
          lastMetricsRefresh: null,
          lastBriefRefresh: null,
          lastCoverageRefresh: null,
          lastResourcesRefresh: null,
          vitalsForm: { bp: '', hr: '', spo2: '', recorded_by: '' },
          handoff: { note: '', author: '' },
          assignmentForm: { provider_id: '', assigned_by: '' },
          statusForm: { status: '', updated_by: '' },
          contactForm: { method: 'Phone call', contact: 'Patient', summary: '', logged_by: '' },
          queueEditorOpen: false,
          queueEditorMode: 'create',
          queueEditorForm: {
            id: '',
            case_id: '',
            patient: '',
            chief_complaint: '',
            scheduled_for: '',
            priority: 'routine',
            escalation_flag: false,
            visit_status: 'awaiting_intake',
            assigned_provider_id: '',
            patient_dob: '',
            patient_mrn: '',
            triage_note: '',
            last_contacted_at: '',
          },
          providerEditorOpen: false,
          providerEditorMode: 'create',
          providerEditorForm: {
            id: '',
            name: '',
            specialty: '',
            availability: '',
            status: 'available',
            next_slot: '',
            coverage_notes: '',
          },
          coverageTeamEditorOpen: false,
          coverageTeamEditorMode: 'create',
          coverageTeamForm: {
            id: '',
            name: '',
            shift_window: '',
            handoff_channel: '',
            primary_lead: '',
            support_roles: '',
            provider_ids: '',
            coverage_notes: '',
          },
          supportContactEditorOpen: false,
          supportContactEditorMode: 'create',
          supportContactForm: {
            id: '',
            name: '',
            channel: '',
            hours: '',
            notes: '',
          },
          incidentEditorOpen: false,
          incidentEditorMode: 'create',
          incidentForm: {
            id: '',
            ts: '',
            summary: '',
            owner: '',
          },
          staffingEditorOpen: false,
          staffingEditorMode: 'create',
          staffingForm: {
            id: '',
            team: '',
            need: '',
            eta: '',
          },
          playbookEditorOpen: false,
          playbookEditorMode: 'create',
          playbookForm: {
            id: '',
            title: '',
            owner: '',
            updated_at: '',
            highlights_text: '',
            summary: '',
          },
          activePlaybook: null,
          visitStatusOptions: [
            { value: 'awaiting_intake', label: 'Awaiting intake' },
            { value: 'pre_visit_checks', label: 'Pre-visit checks' },
            { value: 'awaiting_consult', label: 'Awaiting consult' },
            { value: 'in_consult', label: 'In consult' },
            { value: 'wrap_up', label: 'Wrap up' },
          ],
          visitStatusLabels: {
            awaiting_intake: 'Awaiting intake',
            pre_visit_checks: 'Pre-visit checks',
            awaiting_consult: 'Awaiting consult',
            in_consult: 'In consult',
            wrap_up: 'Wrap up',
          },
          contactMethods: ['Phone call', 'Secure chat', 'SMS follow-up', 'Video check-in'],
          eventSource: null,
          transportMode: 'sse',
          pollIntervalMs: 10000,
          pollTimerId: null,
          pollingActive: false,
          transportConfig: {},
          queueCacheByCase: {},
          queueCacheById: {},

          async init() {
            this.bootstrapTransportConfig();
            this.initializeForms();
            await this.loadUsers();
            const initialUserId = this.sessionUserId || this.availableUsers?.[0]?.id;
            if (initialUserId) {
              await this.setSessionUser(initialUserId);
            }
            window.addEventListener('hashchange', () => this.syncRoute());
            window.addEventListener('beforeunload', () => this.cleanupTransport());
          },

          bootstrapTransportConfig() {
            const config = window.telehealthBaselineConfig || {};
            this.transportConfig = { ...config };
            let requestedMode = '';
            try {
              const currentUrl = new URL(window.location.href);
              requestedMode = (currentUrl.searchParams.get('transport') || '').toLowerCase();
              const pollParam = currentUrl.searchParams.get('poll_ms');
              if (pollParam) {
                const parsed = parseInt(pollParam, 10);
                if (!Number.isNaN(parsed) && parsed >= 1000) {
                  this.pollIntervalMs = parsed;
                }
              }
            } catch (err) {
              console.warn('Failed to read transport configuration from URL', err);
            }

            if (!requestedMode && typeof config.transportMode === 'string') {
              requestedMode = config.transportMode.toLowerCase();
            }

            this.transportMode = requestedMode === 'polling' ? 'polling' : 'sse';

            if (this.pollIntervalMs === 10000) {
              const fromConfig = config.pollIntervalMs;
              const parsed = parseInt(fromConfig, 10);
              if (!Number.isNaN(parsed) && parsed >= 1000) {
                this.pollIntervalMs = parsed;
              }
            }
          },

          initializeForms() {
            this.vitalsForm.recorded_by = this.coordinator;
            this.handoff.author = this.coordinator;
            this.assignmentForm.assigned_by = this.coordinator;
            this.statusForm.updated_by = this.coordinator;
            this.contactForm.logged_by = this.coordinator;
            this.contactForm.contact = this.contactForm.contact || 'Patient';
          },

          async loadUsers() {
            try {
              const response = await fetch('/api/users');
              if (!response.ok) throw new Error('Failed to load users');
              const data = await response.json();
              this.availableUsers = Array.isArray(data.users) ? data.users : [];
              if (data.role_labels) this.roleLabels = data.role_labels;
            } catch (err) {
              console.error(err);
              this.availableUsers = [];
            }
          },

          async setSessionUser(userId) {
            if (!userId) return;
            try {
              const url = this.buildUrl('/api/session', { user_id: userId });
              const response = await fetch(url);
              if (!response.ok) throw new Error('Failed to load session');
              const data = await response.json();
              this.sessionUser = data.user || null;
              this.sessionUserId = this.sessionUser?.id || null;
              if (data.role_labels) this.roleLabels = data.role_labels;
              const coordinatorName = this.sessionUser?.name || this.coordinator;
              this.coordinator = coordinatorName;
              this.initializeForms();
              await this.onSessionReady();
            } catch (err) {
              console.error(err);
            }
          },

          async onSessionReady() {
            if (!this.sessionUser) return;
            this.cleanupTransport();
            this.resetStateForUser();
            const desiredView = this.defaultViewForUser();
            if (!this.canAccessView(this.currentView)) {
              this.currentView = desiredView;
            }
            this.updateRouteHash();
            await this.reloadDataForUser();
            this.ensureViewData();
            this.configureTransport();
          },

          resetStateForUser() {
            this.queues = [];
            this.providers = [];
            this.cases = {};
            this.selectedCaseId = null;
            this.selectedCase = null;
            this.queueCacheByCase = {};
            this.queueCacheById = {};
            this.activityLog = [];
            this.activityIndex = new Set();
            this.operationsMetrics = null;
            this.operationsBrief = null;
            this.coverageSummary = null;
            this.resourceLibrary = [];
          },

          async reloadDataForUser() {
            const tasks = [];
            if (this.hasRole('operations')) {
              tasks.push(this.loadQueues());
              tasks.push(this.loadProviders());
              tasks.push(this.loadActivity());
            } else if (this.hasRole('coverage')) {
              tasks.push(this.loadProviders());
            }
            if (this.hasRole('operations') || this.hasRole('briefing')) {
              tasks.push(this.loadOperationsMetrics());
            } else {
              this.operationsMetrics = null;
            }
            if (this.hasRole('briefing')) {
              tasks.push(this.loadOperationsBrief());
            } else {
              this.operationsBrief = null;
            }
            if (this.hasRole('coverage')) {
              tasks.push(this.loadCoverageSummary());
            } else {
              this.coverageSummary = null;
            }
            if (this.hasRole('library') || this.hasRole('operations')) {
              tasks.push(this.loadResourceLibrary());
            } else {
              this.resourceLibrary = [];
            }
            await Promise.allSettled(tasks);
          },

          async switchUser(userId) {
            if (!userId || userId === this.sessionUserId) return;
            await this.setSessionUser(userId);
          },

          syncRoute() {
            if (!this.sessionUser) return;
            const hash = window.location.hash.replace('#', '');
            const allowedViews = this.visibleViews();
            if (allowedViews.some((view) => view.id === hash)) {
              this.currentView = hash;
            } else if (!allowedViews.some((view) => view.id === this.currentView)) {
              this.currentView = this.defaultViewForUser();
            }
            this.updateRouteHash();
            this.ensureViewData();
          },

          setView(viewId) {
            if (!this.canAccessView(viewId)) return;
            if (this.currentView === viewId) {
              this.ensureViewData();
              return;
            }
            this.currentView = viewId;
            this.updateRouteHash();
            this.ensureViewData();
          },

          updateRouteHash() {
            const targetHash = `#${this.currentView}`;
            if (window.location.hash !== targetHash) {
              window.location.hash = this.currentView;
            }
          },

          ensureViewData() {
            switch (this.currentView) {
              case 'dashboard':
                if (this.hasRole('operations') && !this.loadingMetrics && !this.operationsMetrics) {
                  this.loadOperationsMetrics();
                }
                if (this.hasRole('coverage') && !this.loadingCoverage && !this.coverageSummary) {
                  this.loadCoverageSummary();
                }
                if ((this.hasRole('library') || this.hasRole('operations')) && !this.loadingResources) {
                  if (this.resourceLibrary.length === 0) this.loadResourceLibrary();
                }
                break;
              case 'coverage':
                if (this.hasRole('coverage') && !this.loadingCoverage && !this.coverageSummary) {
                  this.loadCoverageSummary();
                }
                break;
              case 'briefing':
                if (this.hasRole('briefing') && !this.loadingBrief && !this.operationsBrief) {
                  this.loadOperationsBrief();
                }
                if ((this.hasRole('operations') || this.hasRole('briefing')) && !this.loadingMetrics && !this.operationsMetrics) {
                  this.loadOperationsMetrics();
                }
                break;
              case 'resources':
                if ((this.hasRole('library') || this.hasRole('operations')) && !this.loadingResources) {
                  if (this.resourceLibrary.length === 0) this.loadResourceLibrary();
                }
                break;
              default:
                break;
            }
          },

          authHeaders() {
            if (!this.sessionUserId) return {};
            return { 'X-User-Id': this.sessionUserId };
          },

          authorizedFetch(url, options = {}) {
            const config = { ...options };
            config.headers = { ...(options.headers || {}), ...this.authHeaders() };
            return fetch(url, config);
          },

          closeStream() {
            if (this.eventSource) {
              try {
                this.eventSource.close();
              } catch (err) {
                console.warn('Failed to close event stream', err);
              }
            }
            this.eventSource = null;
          },

          cleanupTransport() {
            this.stopPolling();
            this.closeStream();
          },

          configureTransport() {
            if (!this.sessionUser) return;
            if (this.transportMode === 'polling') {
              this.startPolling();
            } else {
              this.openStream();
            }
          },

          setTransportMode(mode) {
            const normalized = (mode || '').toLowerCase();
            const next = normalized === 'polling' ? 'polling' : 'sse';
            if (next === this.transportMode) {
              this.configureTransport();
              return;
            }
            this.transportMode = next;
            this.configureTransport();
          },

          startPolling() {
            this.stopPolling();
            if (this.transportMode !== 'polling') return;
            this.pollTick();
            this.pollTimerId = window.setInterval(() => this.pollTick(), this.pollIntervalMs);
          },

          stopPolling() {
            if (this.pollTimerId) {
              window.clearInterval(this.pollTimerId);
            }
            this.pollTimerId = null;
            this.pollingActive = false;
          },

          async pollTick() {
            if (!this.sessionUser || this.transportMode !== 'polling') return;
            if (this.pollingActive) return;
            this.pollingActive = true;
            try {
              await this.refreshAllForPolling();
            } catch (err) {
              console.error('Polling refresh failed', err);
            } finally {
              this.pollingActive = false;
            }
          },

          async refreshAllForPolling() {
            const tasks = [];
            if (this.hasRole('operations')) {
              tasks.push(this.loadQueues());
              tasks.push(this.loadActivity());
              tasks.push(this.loadOperationsMetrics());
            } else if (this.hasRole('briefing')) {
              tasks.push(this.loadOperationsMetrics());
            }
            if (this.hasRole('coverage')) {
              tasks.push(this.loadProviders());
              tasks.push(this.loadCoverageSummary());
            }
            if (this.hasRole('briefing')) {
              tasks.push(this.loadOperationsBrief());
            }
            if (this.hasRole('library') || this.hasRole('operations')) {
              tasks.push(this.loadResourceLibrary());
            }
            if (this.selectedCaseId) {
              tasks.push(this.refreshCase(this.selectedCaseId));
            }
            await Promise.allSettled(tasks);
          },

          buildUrl(path, params = {}) {
            const url = new URL(path, window.location.origin);
            Object.entries(params).forEach(([key, value]) => {
              if (value === undefined || value === null || value === '') return;
              url.searchParams.set(key, value);
            });
            return url.toString();
          },

          normalizePagination(meta, fallbackPage = 1, fallbackSize = 10) {
            const source = meta && typeof meta === 'object' ? meta : {};
            const page = typeof source.page === 'number' && source.page > 0 ? source.page : fallbackPage;
            const pageSize =
              typeof source.page_size === 'number' && source.page_size > 0 ? source.page_size : fallbackSize;
            const total = typeof source.total === 'number' && source.total >= 0 ? source.total : 0;
            const totalPages = typeof source.total_pages === 'number' && source.total_pages >= 0 ? source.total_pages : 0;
            const startIndex = typeof source.start_index === 'number' && source.start_index >= 0 ? source.start_index : 0;
            const endIndex = typeof source.end_index === 'number' && source.end_index >= 0 ? source.end_index : startIndex;
            return {
              page,
              page_size: pageSize,
              total,
              total_pages: totalPages,
              has_next: Boolean(source.has_next),
              has_prev: Boolean(source.has_prev),
              start_index: startIndex,
              end_index: endIndex,
            };
          },

          paginationSummary(meta) {
            if (!meta || typeof meta !== 'object') return '';
            const total = typeof meta.total === 'number' ? meta.total : 0;
            if (total === 0) return 'No records';
            const start = (typeof meta.start_index === 'number' ? meta.start_index : 0) + 1;
            const end = typeof meta.end_index === 'number' ? meta.end_index : start;
            return `Showing ${start}-${end} of ${total}`;
          },

          updateCoordinator(name) {
            const previous = this.coordinator;
            this.coordinator = name || '';
            this.vitalsForm.recorded_by = this.coordinator;
            if (!this.handoff.author || this.handoff.author === previous) {
              this.handoff.author = this.coordinator;
            }
            if (!this.assignmentForm.assigned_by || this.assignmentForm.assigned_by === previous) {
              this.assignmentForm.assigned_by = this.coordinator;
            }
            if (!this.statusForm.updated_by || this.statusForm.updated_by === previous) {
              this.statusForm.updated_by = this.coordinator;
            }
            if (!this.contactForm.logged_by || this.contactForm.logged_by === previous) {
              this.contactForm.logged_by = this.coordinator;
            }
          },

          resetQueueEditor() {
            this.queueEditorForm = {
              id: '',
              case_id: '',
              patient: '',
              chief_complaint: '',
              scheduled_for: '',
              priority: 'routine',
              escalation_flag: false,
              visit_status: 'awaiting_intake',
              assigned_provider_id: '',
              patient_dob: '',
              patient_mrn: '',
              triage_note: '',
              last_contacted_at: '',
            };
          },

          openQueueEditor(mode = 'create', item = null) {
            if (!this.can('queue_manage')) return;
            this.queueEditorMode = mode;
            if (mode === 'edit' && item) {
              const caseData = this.cases[item.case_id] || {};
              this.queueEditorForm = {
                id: item.id,
                case_id: item.case_id,
                patient: item.patient || caseData?.patient?.name || '',
                chief_complaint: item.chief_complaint || '',
                scheduled_for: item.scheduled_for || '',
                priority: item.priority || 'routine',
                escalation_flag: !!item.escalation_flag,
                visit_status: item.visit_status || 'awaiting_intake',
                assigned_provider_id: item.assigned_provider_id || '',
                patient_dob: caseData?.patient?.dob || '',
                patient_mrn: caseData?.patient?.mrn || '',
                triage_note: caseData?.summary?.triage || '',
                last_contacted_at: item.last_contacted_at || '',
              };
            } else {
              this.resetQueueEditor();
            }
            this.queueEditorOpen = true;
          },

          closeQueueEditor() {
            this.queueEditorOpen = false;
            this.resetQueueEditor();
          },

          async submitQueueEditor() {
            if (!this.can('queue_manage')) return;
            const form = this.queueEditorForm;
            const payload = {
              patient: form.patient,
              chief_complaint: form.chief_complaint,
              scheduled_for: form.scheduled_for || null,
              priority: form.priority || 'routine',
              escalation_flag: !!form.escalation_flag,
              visit_status: form.visit_status || 'awaiting_intake',
              assigned_provider_id: form.assigned_provider_id || null,
              case_id: form.case_id || undefined,
              case: {
                id: form.case_id || undefined,
                patient: {
                  name: form.patient,
                  dob: form.patient_dob || undefined,
                  mrn: form.patient_mrn || undefined,
                },
                summary: {
                  triage: form.triage_note || '',
                },
              },
            };
            if (form.last_contacted_at) {
              payload.last_contacted_at = form.last_contacted_at;
            }
            const method = this.queueEditorMode === 'edit' ? 'PATCH' : 'POST';
            const endpoint =
              this.queueEditorMode === 'edit'
                ? `/api/queues/${encodeURIComponent(form.id)}`
                : '/api/queues';
            payload[this.queueEditorMode === 'edit' ? 'updated_by' : 'created_by'] =
              this.coordinator || 'Coverage coordinator';

            try {
              const response = await this.authorizedFetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error('Failed to save queue entry');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
              this.closeQueueEditor();
            } catch (err) {
              console.error(err);
            }
          },

          async deleteQueueEntry(id) {
            if (!id || !this.can('queue_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/queues/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ removed_by: this.coordinator || 'Coverage coordinator' }),
              });
              if (!response.ok) throw new Error('Failed to remove queue entry');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          resetProviderEditor() {
            this.providerEditorForm = {
              id: '',
              name: '',
              specialty: '',
              availability: '',
              status: 'available',
              next_slot: '',
              coverage_notes: '',
            };
          },

          openProviderEditor(mode = 'create', provider = null) {
            if (!this.can('provider_manage')) return;
            this.providerEditorMode = mode;
            if (mode === 'edit' && provider) {
              this.providerEditorForm = {
                id: provider.id,
                name: provider.name || '',
                specialty: provider.specialty || '',
                availability: provider.availability || '',
                status: provider.status || 'available',
                next_slot: provider.next_slot || '',
                coverage_notes: provider.coverage_notes || '',
              };
            } else {
              this.resetProviderEditor();
            }
            this.providerEditorOpen = true;
          },

          closeProviderEditor() {
            this.providerEditorOpen = false;
            this.resetProviderEditor();
          },

          async submitProviderEditor() {
            if (!this.can('provider_manage')) return;
            const form = this.providerEditorForm;
            const payload = {
              name: form.name,
              specialty: form.specialty,
              availability: form.availability,
              status: form.status,
              next_slot: form.next_slot,
              coverage_notes: form.coverage_notes,
            };
            const method = this.providerEditorMode === 'edit' ? 'PATCH' : 'POST';
            const endpoint =
              this.providerEditorMode === 'edit'
                ? `/api/providers/${encodeURIComponent(form.id)}`
                : '/api/providers';
            payload[this.providerEditorMode === 'edit' ? 'updated_by' : 'created_by'] =
              this.coordinator || 'Coverage coordinator';

            try {
              const response = await this.authorizedFetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error('Failed to save provider');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
              this.closeProviderEditor();
            } catch (err) {
              console.error(err);
            }
          },

          async deleteProvider(id) {
            if (!id || !this.can('provider_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/providers/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ removed_by: this.coordinator || 'Coverage coordinator' }),
              });
              if (!response.ok) throw new Error('Failed to remove provider');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          resetCoverageTeamEditor() {
            this.coverageTeamForm = {
              id: '',
              name: '',
              shift_window: '',
              handoff_channel: '',
              primary_lead: '',
              support_roles: '',
              provider_ids: '',
              coverage_notes: '',
            };
          },

          openCoverageTeamEditor(mode = 'create', team = null) {
            if (!this.can('coverage_manage')) return;
            this.coverageTeamEditorMode = mode;
            if (mode === 'edit' && team) {
              this.coverageTeamForm = {
                id: team.id,
                name: team.name || '',
                shift_window: team.shift_window || '',
                handoff_channel: team.handoff_channel || '',
                primary_lead: team.primary_lead || '',
                support_roles: Array.isArray(team.support_roles)
                  ? team.support_roles.join('\n')
                  : '',
                provider_ids: Array.isArray(team.provider_ids)
                  ? team.provider_ids.join(', ')
                  : '',
                coverage_notes: team.coverage_notes || '',
              };
            } else {
              this.resetCoverageTeamEditor();
            }
            this.coverageTeamEditorOpen = true;
          },

          closeCoverageTeamEditor() {
            this.coverageTeamEditorOpen = false;
            this.resetCoverageTeamEditor();
          },

          async submitCoverageTeam() {
            if (!this.can('coverage_manage')) return;
            const form = this.coverageTeamForm;
            const payload = {
              name: form.name,
              shift_window: form.shift_window,
              handoff_channel: form.handoff_channel,
              primary_lead: form.primary_lead,
              support_roles: form.support_roles,
              provider_ids: form.provider_ids,
              coverage_notes: form.coverage_notes,
            };
            const method = this.coverageTeamEditorMode === 'edit' ? 'PATCH' : 'POST';
            const endpoint =
              this.coverageTeamEditorMode === 'edit'
                ? `/api/coverage/teams/${encodeURIComponent(form.id)}`
                : '/api/coverage/teams';
            payload[this.coverageTeamEditorMode === 'edit' ? 'updated_by' : 'created_by'] =
              this.coordinator || 'Coverage coordinator';

            try {
              const response = await this.authorizedFetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error('Failed to save coverage team');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
              this.closeCoverageTeamEditor();
            } catch (err) {
              console.error(err);
            }
          },

          async deleteCoverageTeam(id) {
            if (!id || !this.can('coverage_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/coverage/teams/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ removed_by: this.coordinator || 'Coverage coordinator' }),
              });
              if (!response.ok) throw new Error('Failed to remove coverage team');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          resetSupportContactEditor() {
            this.supportContactForm = {
              id: '',
              name: '',
              channel: '',
              hours: '',
              notes: '',
            };
          },

          openSupportContactEditor(mode = 'create', contact = null) {
            if (!this.can('coverage_manage')) return;
            this.supportContactEditorMode = mode;
            if (mode === 'edit' && contact) {
              this.supportContactForm = {
                id: contact.id,
                name: contact.name || '',
                channel: contact.channel || '',
                hours: contact.hours || '',
                notes: contact.notes || '',
              };
            } else {
              this.resetSupportContactEditor();
            }
            this.supportContactEditorOpen = true;
          },

          closeSupportContactEditor() {
            this.supportContactEditorOpen = false;
            this.resetSupportContactEditor();
          },

          async submitSupportContact() {
            if (!this.can('coverage_manage')) return;
            const form = this.supportContactForm;
            const payload = {
              name: form.name,
              channel: form.channel,
              hours: form.hours,
              notes: form.notes,
            };
            const method = this.supportContactEditorMode === 'edit' ? 'PATCH' : 'POST';
            const endpoint =
              this.supportContactEditorMode === 'edit'
                ? `/api/coverage/support-contacts/${encodeURIComponent(form.id)}`
                : '/api/coverage/support-contacts';
            payload[this.supportContactEditorMode === 'edit' ? 'updated_by' : 'created_by'] =
              this.coordinator || 'Coverage coordinator';

            try {
              const response = await this.authorizedFetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error('Failed to save support contact');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
              this.closeSupportContactEditor();
            } catch (err) {
              console.error(err);
            }
          },

          async deleteSupportContact(id) {
            if (!id || !this.can('coverage_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/coverage/support-contacts/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ removed_by: this.coordinator || 'Coverage coordinator' }),
              });
              if (!response.ok) throw new Error('Failed to remove support contact');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          resetIncidentEditor() {
            this.incidentForm = {
              id: '',
              ts: '',
              summary: '',
              owner: '',
            };
          },

          openIncidentEditor(mode = 'create', incident = null) {
            if (!this.can('brief_manage')) return;
            this.incidentEditorMode = mode;
            if (mode === 'edit' && incident) {
              this.incidentForm = {
                id: incident.id,
                ts: incident.ts || '',
                summary: incident.summary || '',
                owner: incident.owner || '',
              };
            } else {
              this.resetIncidentEditor();
            }
            this.incidentEditorOpen = true;
          },

          closeIncidentEditor() {
            this.incidentEditorOpen = false;
            this.resetIncidentEditor();
          },

          async submitIncident() {
            if (!this.can('brief_manage')) return;
            const form = this.incidentForm;
            const payload = {
              ts: form.ts,
              summary: form.summary,
              owner: form.owner,
            };
            const method = this.incidentEditorMode === 'edit' ? 'PATCH' : 'POST';
            const endpoint =
              this.incidentEditorMode === 'edit'
                ? `/api/operations/incidents/${encodeURIComponent(form.id)}`
                : '/api/operations/incidents';
            payload[this.incidentEditorMode === 'edit' ? 'updated_by' : 'created_by'] =
              this.coordinator || 'Coverage coordinator';

            try {
              const response = await this.authorizedFetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error('Failed to save incident');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
              this.closeIncidentEditor();
            } catch (err) {
              console.error(err);
            }
          },

          async deleteIncident(id) {
            if (!id || !this.can('brief_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/operations/incidents/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ removed_by: this.coordinator || 'Coverage coordinator' }),
              });
              if (!response.ok) throw new Error('Failed to remove incident');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          resetStaffingEditor() {
            this.staffingForm = {
              id: '',
              team: '',
              need: '',
              eta: '',
            };
          },

          openStaffingEditor(mode = 'create', staffing = null) {
            if (!this.can('brief_manage')) return;
            this.staffingEditorMode = mode;
            if (mode === 'edit' && staffing) {
              this.staffingForm = {
                id: staffing.id,
                team: staffing.team || '',
                need: staffing.need || '',
                eta: staffing.eta || '',
              };
            } else {
              this.resetStaffingEditor();
            }
            this.staffingEditorOpen = true;
          },

          closeStaffingEditor() {
            this.staffingEditorOpen = false;
            this.resetStaffingEditor();
          },

          async submitStaffing() {
            if (!this.can('brief_manage')) return;
            const form = this.staffingForm;
            const payload = {
              team: form.team,
              need: form.need,
              eta: form.eta,
            };
            const method = this.staffingEditorMode === 'edit' ? 'PATCH' : 'POST';
            const endpoint =
              this.staffingEditorMode === 'edit'
                ? `/api/operations/staffing/${encodeURIComponent(form.id)}`
                : '/api/operations/staffing';
            payload[this.staffingEditorMode === 'edit' ? 'updated_by' : 'created_by'] =
              this.coordinator || 'Coverage coordinator';

            try {
              const response = await this.authorizedFetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error('Failed to save staffing call');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
              this.closeStaffingEditor();
            } catch (err) {
              console.error(err);
            }
          },

          async deleteStaffing(id) {
            if (!id || !this.can('brief_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/operations/staffing/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ removed_by: this.coordinator || 'Coverage coordinator' }),
              });
              if (!response.ok) throw new Error('Failed to remove staffing call');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          resetPlaybookEditor() {
            this.playbookForm = {
              id: '',
              title: '',
              owner: this.coordinator || '',
              updated_at: '',
              highlights_text: '',
              summary: '',
            };
          },

          openPlaybookEditor(mode = 'create', playbook = null) {
            if (!this.can('library_manage')) return;
            this.playbookEditorMode = mode;
            if (mode === 'edit' && playbook) {
              this.playbookForm = {
                id: playbook.id,
                title: playbook.title || '',
                owner: playbook.owner || this.coordinator || '',
                updated_at: playbook.updated_at || '',
                highlights_text: Array.isArray(playbook.highlights)
                  ? playbook.highlights.join('\n')
                  : '',
                summary: '',
              };
              this.activePlaybook = this.clone(playbook);
            } else {
              this.resetPlaybookEditor();
              this.activePlaybook = null;
            }
            this.playbookEditorOpen = true;
          },

          openPlaybookWorkspace(playbook) {
            if (!playbook) return;
            this.activePlaybook = this.clone(playbook);
            this.playbookEditorOpen = false;
            this.resetPlaybookEditor();
            this.$nextTick(() => {
              const workspace = this.$refs?.playbookWorkspace;
              if (workspace && typeof workspace.scrollIntoView === 'function') {
                workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            });
          },

          closePlaybookEditor() {
            this.playbookEditorOpen = false;
            this.resetPlaybookEditor();
          },

          async submitPlaybook() {
            if (!this.can('library_manage')) return;
            const form = this.playbookForm;
            const payload = {
              title: form.title,
              owner: form.owner,
              updated_at: form.updated_at,
              highlights: form.highlights_text,
              summary: form.summary,
            };
            const method = this.playbookEditorMode === 'edit' ? 'PATCH' : 'POST';
            const endpoint =
              this.playbookEditorMode === 'edit'
                ? `/api/resources/playbooks/${encodeURIComponent(form.id)}`
                : '/api/resources/playbooks';
            payload[this.playbookEditorMode === 'edit' ? 'updated_by' : 'created_by'] =
              this.coordinator || 'Coverage coordinator';

            try {
              const response = await this.authorizedFetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error('Failed to save playbook');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
              this.closePlaybookEditor();
            } catch (err) {
              console.error(err);
            }
          },

          async deletePlaybook(id) {
            if (!id || !this.can('library_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/resources/playbooks/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ removed_by: this.coordinator || 'Coverage coordinator' }),
              });
              if (!response.ok) throw new Error('Failed to remove playbook');
              const data = await response.json();
              if (data.event) {
                this.applyEvent(data.event);
                this.logActivity(data.event);
              }
              this.applyDirectives(data.directives);
              if (this.activePlaybook && this.activePlaybook.id === id) {
                this.activePlaybook = null;
              }
            } catch (err) {
              console.error(err);
            }
          },

          get lastQueueRefreshLabel() {
            return this.lastQueueRefresh ? `Refreshed ${this.relativeTime(this.lastQueueRefresh)}` : '';
          },

          get lastProviderRefreshLabel() {
            return this.lastProviderRefresh ? `Refreshed ${this.relativeTime(this.lastProviderRefresh)}` : '';
          },

          get metricsRefreshedLabel() {
            return this.lastMetricsRefresh ? `Refreshed ${this.relativeTime(this.lastMetricsRefresh)}` : 'Awaiting metrics…';
          },

          get coverageRefreshedLabel() {
            return this.lastCoverageRefresh ? `Refreshed ${this.relativeTime(this.lastCoverageRefresh)}` : 'Awaiting coverage snapshot…';
          },

          get briefRefreshedLabel() {
            return this.lastBriefRefresh ? `Refreshed ${this.relativeTime(this.lastBriefRefresh)}` : 'Awaiting briefing…';
          },

          get resourcesRefreshedLabel() {
            return this.lastResourcesRefresh ? `Refreshed ${this.relativeTime(this.lastResourcesRefresh)}` : 'Awaiting library sync…';
          },

          get lastVitalsRefresh() {
            if (!this.selectedCase || !this.selectedCase.summary) return '—';
            const stamp = this.selectedCase.summary.last_updated;
            return stamp ? this.relativeTime(stamp) : '—';
          },

          get caseDemographics() {
            if (!this.selectedCase || !this.selectedCase.patient) return '';
            const { dob, mrn } = this.selectedCase.patient;
            return [`DOB ${dob}`, mrn ? `MRN ${mrn}` : null].filter(Boolean).join(' · ');
          },

          get currentEscalation() {
            const entry = this.selectedQueueEntry;
            return entry ? !!entry.escalation_flag : false;
          },

          get hasSelectedCase() {
            return !!this.selectedCaseId && !!this.selectedCase;
          },

          get selectedQueueEntry() {
            const pageEntry = this.queues.find((q) => q.case_id === this.selectedCaseId);
            if (pageEntry) return pageEntry;
            if (this.selectedCaseId && this.queueCacheByCase[this.selectedCaseId]) {
              return this.queueCacheByCase[this.selectedCaseId];
            }
            if (this.selectedCaseId) {
              const cache = Object.values(this.queueCacheById || {}).find(
                (entry) => entry.case_id === this.selectedCaseId,
              );
              if (cache) return cache;
            }
            return null;
          },

          get selectedQueueLastContact() {
            const entry = this.selectedQueueEntry;
            if (!entry || !entry.last_contacted_at) return 'No outreach logged yet';
            return `Last contact ${this.relativeTime(entry.last_contacted_at)}`;
          },

          get contactLogPreview() {
            const log = Array.isArray(this.selectedCase?.contact_log) ? this.selectedCase.contact_log : [];
            return log;
          },

          get queuePageSummary() {
            return this.paginationSummary(this.queuePagination);
          },

          get providerPageSummary() {
            return this.paginationSummary(this.providerPagination);
          },

          get activityPageSummary() {
            return this.paginationSummary(this.activityPagination);
          },

          get coverageTeamsSummary() {
            return this.paginationSummary(this.coveragePagination.teams);
          },

          get coverageContactsSummary() {
            return this.paginationSummary(this.coveragePagination.contacts);
          },

          get watchlistSummary() {
            return this.paginationSummary(this.briefPagination.watchlist);
          },

          get overnightSummary() {
            return this.paginationSummary(this.briefPagination.overnight);
          },

          get staffingSummary() {
            return this.paginationSummary(this.briefPagination.staffing);
          },

          get playbookSummary() {
            return this.paginationSummary(this.playbookPagination);
          },

          get caseTimelineSummary() {
            return this.paginationSummary(this.casePagination.timeline);
          },

          get caseContactSummary() {
            return this.paginationSummary(this.casePagination.contacts);
          },

          get coverageTeams() {
            const summary = this.coverageSummary;
            return summary && Array.isArray(summary.teams) ? summary.teams : [];
          },

          get coverageSupportContacts() {
            const summary = this.coverageSummary;
            return summary && Array.isArray(summary.support_contacts) ? summary.support_contacts : [];
          },

          get briefingWatchlist() {
            const brief = this.operationsBrief;
            return brief && Array.isArray(brief.watchlist) ? brief.watchlist : [];
          },

          get briefingOvernight() {
            const brief = this.operationsBrief;
            return brief && Array.isArray(brief.overnight) ? brief.overnight : [];
          },

          get briefingStaffingCalls() {
            const brief = this.operationsBrief;
            return brief && Array.isArray(brief.staffing_calls) ? brief.staffing_calls : [];
          },

          get operationsStatusBreakdown() {
            const breakdown = this.operationsMetrics?.queue?.status_breakdown;
            return Array.isArray(breakdown) ? breakdown : [];
          },

          get queueEscalatedCases() {
            const escalated = this.operationsMetrics?.queue?.escalated_cases;
            return Array.isArray(escalated) ? escalated : [];
          },

          get queueAwaitingAssignment() {
            const awaiting = this.operationsMetrics?.queue?.awaiting_assignment;
            return Array.isArray(awaiting) ? awaiting : [];
          },

          get queueTotal() {
            const queue = this.operationsMetrics && this.operationsMetrics.queue;
            if (!queue) return '—';
            const total = queue.total;
            return typeof total === 'number' ? total : total ?? '—';
          },

          get queueEscalatedCount() {
            return this.queueEscalatedCases.length;
          },

          get queueAwaitingAssignmentCount() {
            return this.queueAwaitingAssignment.length;
          },

          get touchpointsLast4h() {
            const touchpoints = this.operationsMetrics?.touchpoints;
            return touchpoints && typeof touchpoints.touchpoints_last_4h === 'number'
              ? touchpoints.touchpoints_last_4h
              : '—';
          },

          get caseTimeline() {
            const timeline = this.selectedCase?.timeline;
            return Array.isArray(timeline) ? timeline : [];
          },

          get caseTimelineCount() {
            return this.caseTimeline.length;
          },

          get playbookLibrary() {
            return Array.isArray(this.resourceLibrary) ? this.resourceLibrary : [];
          },

          get providerList() {
            return Array.isArray(this.providers) ? this.providers : [];
          },

          get sessionUserRoleSummary() {
            if (!this.sessionUser || !Array.isArray(this.sessionUser.roles)) return 'No persona selected';
            const labels = this.sessionUser.roles.map((role) => this.roleLabels[role] || role);
            return labels.length ? `Roles: ${labels.join(', ')}` : 'Roles: none';
          },

          get queueEntries() {
            return Array.isArray(this.queues) ? this.queues : [];
          },

          priorityDot(priority) {
            const map = {
              urgent: 'bg-rose-400 animate-pulse',
              high: 'bg-amber-300',
              routine: 'bg-emerald-400',
            };
            return map[priority] ?? 'bg-slate-500';
          },

          statusLabel(status) {
            const labels = {
              available: 'Available now',
              on_shift: 'On shift',
              in_consult: 'In consult',
            };
            return labels[status] ?? status;
          },

          visitStatusLabel(status) {
            if (!status) return 'Status unknown';
            return (
              this.visitStatusLabels[status] ||
              status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
            );
          },

          async loadQueues(page = null, pageSize = null) {
            if (!this.hasRole('operations')) {
              this.queues = [];
              this.queuePagination = this.normalizePagination({}, 1, this.queuePagination.page_size || 18);
              this.lastQueueRefresh = null;
              this.selectedCaseId = null;
              this.selectedCase = null;
              return;
            }
            this.loadingQueues = true;
            try {
              const targetPage = page ?? this.queuePagination.page ?? 1;
              const targetSize = pageSize ?? this.queuePagination.page_size ?? 18;
              const url = this.buildUrl('/api/queues', {
                queues_page: targetPage,
                queues_page_size: targetSize,
              });
              const response = await this.authorizedFetch(url);
              if (!response.ok) throw new Error('Failed to load queues');
              const data = await response.json();
              const queues = Array.isArray(data.queues) ? data.queues : [];
              const meta = this.normalizePagination(data.pagination, targetPage, targetSize);
              const clones = queues.map((item) => this.clone(item));
              this.queues = clones;
              this.queuePagination = meta;
              this.lastQueueRefresh = data.refreshed_at ?? null;
              const cacheByCase = { ...this.queueCacheByCase };
              const cacheById = { ...this.queueCacheById };
              clones.forEach((item) => {
                if (item && item.case_id) {
                  const snapshot = this.clone(item);
                  cacheByCase[item.case_id] = snapshot;
                  cacheById[item.id] = snapshot;
                }
              });
              this.queueCacheByCase = cacheByCase;
              this.queueCacheById = cacheById;
              if (!this.selectedCaseId && clones.length > 0) {
                await this.selectCase(clones[0].case_id);
              }
            } catch (err) {
              console.error(err);
            } finally {
              this.loadingQueues = false;
            }
          },

          async loadProviders(page = null, pageSize = null) {
            if (!this.hasRole('operations') && !this.hasRole('coverage')) {
              this.providers = [];
              this.providerPagination = this.normalizePagination({}, 1, this.providerPagination.page_size || 18);
              this.lastProviderRefresh = null;
              return;
            }
            this.loadingProviders = true;
            try {
              const targetPage = page ?? this.providerPagination.page ?? 1;
              const targetSize = pageSize ?? this.providerPagination.page_size ?? 18;
              const url = this.buildUrl('/api/providers', {
                providers_page: targetPage,
                providers_page_size: targetSize,
              });
              const response = await this.authorizedFetch(url);
              if (!response.ok) throw new Error('Failed to load providers');
              const data = await response.json();
              const meta = this.normalizePagination(data.pagination, targetPage, targetSize);
              this.providers = (data.providers ?? []).map((provider) => this.clone(provider));
              this.providerPagination = meta;
              this.lastProviderRefresh = data.refreshed_at ?? null;
            } catch (err) {
              console.error(err);
            } finally {
              this.loadingProviders = false;
            }
          },

          async loadActivity(page = null, pageSize = null) {
            if (!this.hasRole('operations')) {
              this.activityLog = [];
              this.activityIndex = new Set();
              this.activityPagination = this.normalizePagination({}, 1, this.activityPagination.page_size || 25);
              return;
            }
            try {
              const targetPage = page ?? this.activityPagination.page ?? 1;
              const targetSize = pageSize ?? this.activityPagination.page_size ?? 25;
              const url = this.buildUrl('/api/activity', {
                activity_page: targetPage,
                activity_page_size: targetSize,
              });
              const response = await this.authorizedFetch(url);
              if (!response.ok) throw new Error('Failed to load activity');
              const data = await response.json();
              const meta = this.normalizePagination(data.pagination, targetPage, targetSize);
              const events = Array.isArray(data.activity) ? data.activity : [];
              this.activityPagination = meta;
              this.activityLog = [];
              this.activityIndex = new Set();
              events
                .slice()
                .reverse()
                .forEach((event) => this.logActivity(event, meta.page_size));
            } catch (err) {
              console.error(err);
            }
          },

          async loadOperationsMetrics() {
            if (!this.hasRole('operations') && !this.hasRole('briefing')) {
              this.operationsMetrics = null;
              this.lastMetricsRefresh = null;
              return;
            }
            if (this.loadingMetrics) return;
            this.loadingMetrics = true;
            try {
              const response = await this.authorizedFetch('/api/operations/metrics');
              if (!response.ok) throw new Error('Failed to load operations metrics');
              const data = await response.json();
              this.operationsMetrics = data.metrics ? this.clone(data.metrics) : null;
              const refreshed = data.refreshed_at || data.metrics?.refreshed_at || null;
              this.lastMetricsRefresh = refreshed;
            } catch (err) {
              console.error(err);
            } finally {
              this.loadingMetrics = false;
            }
          },

          async loadOperationsBrief(options = {}) {
            if (!this.hasRole('briefing') && !this.hasRole('operations')) {
              this.operationsBrief = null;
              this.briefPagination = {
                watchlist: this.normalizePagination({}, 1, 6),
                overnight: this.normalizePagination({}, 1, 6),
                staffing: this.normalizePagination({}, 1, 6),
              };
              this.lastBriefRefresh = null;
              return;
            }
            if (this.loadingBrief) return;
            this.loadingBrief = true;
            try {
              const currentWatchlist = this.briefPagination.watchlist || {};
              const currentOvernight = this.briefPagination.overnight || {};
              const currentStaffing = this.briefPagination.staffing || {};
              const url = this.buildUrl('/api/operations/brief', {
                watchlist_page: options.watchlist_page ?? currentWatchlist.page ?? 1,
                watchlist_page_size: options.watchlist_page_size ?? currentWatchlist.page_size ?? 6,
                overnight_page: options.overnight_page ?? currentOvernight.page ?? 1,
                overnight_page_size: options.overnight_page_size ?? currentOvernight.page_size ?? 6,
                staffing_page: options.staffing_page ?? currentStaffing.page ?? 1,
                staffing_page_size: options.staffing_page_size ?? currentStaffing.page_size ?? 6,
              });
              const response = await this.authorizedFetch(url);
              if (!response.ok) throw new Error('Failed to load operations brief');
              const data = await response.json();
              this.operationsBrief = data.brief ? this.clone(data.brief) : null;
              const pagination = data.pagination || {};
              this.briefPagination = {
                watchlist: this.normalizePagination(
                  pagination.watchlist,
                  options.watchlist_page ?? currentWatchlist.page ?? 1,
                  options.watchlist_page_size ?? currentWatchlist.page_size ?? 6,
                ),
                overnight: this.normalizePagination(
                  pagination.overnight,
                  options.overnight_page ?? currentOvernight.page ?? 1,
                  options.overnight_page_size ?? currentOvernight.page_size ?? 6,
                ),
                staffing: this.normalizePagination(
                  pagination.staffing_calls,
                  options.staffing_page ?? currentStaffing.page ?? 1,
                  options.staffing_page_size ?? currentStaffing.page_size ?? 6,
                ),
              };
              const refreshed = data.refreshed_at || data.brief?.refreshed_at || null;
              this.lastBriefRefresh = refreshed;
            } catch (err) {
              console.error(err);
            } finally {
              this.loadingBrief = false;
            }
          },

          async loadCoverageSummary(options = {}) {
            if (!this.hasRole('coverage') && !this.hasRole('operations')) {
              this.coverageSummary = null;
              this.coveragePagination = {
                teams: this.normalizePagination({}, 1, 6),
                contacts: this.normalizePagination({}, 1, 8),
              };
              this.lastCoverageRefresh = null;
              return;
            }
            if (this.loadingCoverage) return;
            this.loadingCoverage = true;
            try {
              const teamsMeta = this.coveragePagination.teams || {};
              const contactsMeta = this.coveragePagination.contacts || {};
              const url = this.buildUrl('/api/coverage/teams', {
                teams_page: options.teams_page ?? teamsMeta.page ?? 1,
                teams_page_size: options.teams_page_size ?? teamsMeta.page_size ?? 6,
                contacts_page: options.contacts_page ?? contactsMeta.page ?? 1,
                contacts_page_size: options.contacts_page_size ?? contactsMeta.page_size ?? 8,
              });
              const response = await this.authorizedFetch(url);
              if (!response.ok) throw new Error('Failed to load coverage teams');
              const data = await response.json();
              this.coverageSummary = data.coverage ? this.clone(data.coverage) : null;
              const pagination = data.pagination || {};
              this.coveragePagination = {
                teams: this.normalizePagination(
                  pagination.teams,
                  options.teams_page ?? teamsMeta.page ?? 1,
                  options.teams_page_size ?? teamsMeta.page_size ?? 6,
                ),
                contacts: this.normalizePagination(
                  pagination.support_contacts,
                  options.contacts_page ?? contactsMeta.page ?? 1,
                  options.contacts_page_size ?? contactsMeta.page_size ?? 8,
                ),
              };
              const refreshed = data.refreshed_at || data.coverage?.refreshed_at || null;
              this.lastCoverageRefresh = refreshed;
            } catch (err) {
              console.error(err);
            } finally {
              this.loadingCoverage = false;
            }
          },

          async loadResourceLibrary(page = null, pageSize = null) {
            if (!this.hasRole('library') && !this.hasRole('operations')) {
              this.resourceLibrary = [];
              this.playbookPagination = this.normalizePagination({}, 1, this.playbookPagination.page_size || 12);
              this.lastResourcesRefresh = null;
              return;
            }
            if (this.loadingResources) return;
            this.loadingResources = true;
            try {
              const targetPage = page ?? this.playbookPagination.page ?? 1;
              const targetSize = pageSize ?? this.playbookPagination.page_size ?? 12;
              const url = this.buildUrl('/api/resources/playbooks', {
                playbooks_page: targetPage,
                playbooks_page_size: targetSize,
              });
              const response = await this.authorizedFetch(url);
              if (!response.ok) throw new Error('Failed to load playbooks');
              const data = await response.json();
              this.resourceLibrary = (data.playbooks ?? []).map((item) => this.clone(item));
              this.playbookPagination = this.normalizePagination(data.pagination, targetPage, targetSize);
              this.lastResourcesRefresh = data.refreshed_at ?? null;
            } catch (err) {
              console.error(err);
            } finally {
              this.loadingResources = false;
            }
          },

          async goToQueuePage(delta) {
            const meta = this.queuePagination || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.loadQueues(next, meta.page_size ?? 18);
          },

          async goToProviderPage(delta) {
            const meta = this.providerPagination || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.loadProviders(next, meta.page_size ?? 18);
          },

          async goToActivityPage(delta) {
            const meta = this.activityPagination || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.loadActivity(next, meta.page_size ?? 25);
          },

          async goToCoverageTeamsPage(delta) {
            const meta = this.coveragePagination.teams || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.loadCoverageSummary({ teams_page: next });
          },

          async goToCoverageContactsPage(delta) {
            const meta = this.coveragePagination.contacts || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.loadCoverageSummary({ contacts_page: next });
          },

          async goToWatchlistPage(delta) {
            const meta = this.briefPagination.watchlist || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.loadOperationsBrief({ watchlist_page: next });
          },

          async goToOvernightPage(delta) {
            const meta = this.briefPagination.overnight || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.loadOperationsBrief({ overnight_page: next });
          },

          async goToStaffingPage(delta) {
            const meta = this.briefPagination.staffing || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.loadOperationsBrief({ staffing_page: next });
          },

          async goToPlaybookPage(delta) {
            const meta = this.playbookPagination || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.loadResourceLibrary(next, meta.page_size ?? 12);
          },

          async goToTimelinePage(delta) {
            if (!this.selectedCaseId) return;
            const meta = this.casePagination.timeline || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.selectCase(this.selectedCaseId, { timeline_page: next });
          },

          async goToContactPage(delta) {
            if (!this.selectedCaseId) return;
            const meta = this.casePagination.contacts || {};
            const next = (meta.page ?? 1) + delta;
            if (next < 1) return;
            if (meta.total_pages && meta.total_pages > 0 && next > meta.total_pages) return;
            await this.selectCase(this.selectedCaseId, { contacts_page: next });
          },

          async selectCase(caseId, options = {}) {
            if (!caseId || !this.hasRole('operations')) return;
            const previousCaseId = this.selectedCaseId;
            const switchingCase = previousCaseId !== caseId;
            const timelineMeta = switchingCase
              ? { page: 1, page_size: this.casePagination.timeline?.page_size ?? 8 }
              : this.casePagination.timeline || {};
            const contactsMeta = switchingCase
              ? { page: 1, page_size: this.casePagination.contacts?.page_size ?? 8 }
              : this.casePagination.contacts || {};
            const timelinePage = options.timeline_page ?? timelineMeta.page ?? 1;
            const timelineSize = options.timeline_page_size ?? timelineMeta.page_size ?? 8;
            const contactsPage = options.contacts_page ?? contactsMeta.page ?? 1;
            const contactsSize = options.contacts_page_size ?? contactsMeta.page_size ?? 8;
            this.selectedCaseId = caseId;
            this.loadingCase = true;
            try {
              const url = this.buildUrl(`/api/cases/${caseId}`, {
                timeline_page: timelinePage,
                timeline_page_size: timelineSize,
                contacts_page: contactsPage,
                contacts_page_size: contactsSize,
              });
              const response = await this.authorizedFetch(url);
              if (!response.ok) throw new Error('Failed to load case');
              const data = await response.json();
              const pagination = data.pagination || {};
              this.casePagination = {
                timeline: this.normalizePagination(pagination.timeline, timelinePage, timelineSize),
                contacts: this.normalizePagination(pagination.contacts, contactsPage, contactsSize),
              };
              this.cases[caseId] = this.clone(data.case);
              this.selectedCase = this.clone(data.case);
              this.resetForms();
            } catch (err) {
              console.error(err);
            } finally {
              this.loadingCase = false;
            }
          },

          async refreshCase(caseId) {
            if (!caseId || !this.hasRole('operations')) return;
            const timelineMeta = this.casePagination.timeline || {};
            const contactsMeta = this.casePagination.contacts || {};
            try {
              const url = this.buildUrl(`/api/cases/${caseId}`, {
                timeline_page: timelineMeta.page ?? 1,
                timeline_page_size: timelineMeta.page_size ?? 8,
                contacts_page: contactsMeta.page ?? 1,
                contacts_page_size: contactsMeta.page_size ?? 8,
              });
              const response = await this.authorizedFetch(url);
              if (!response.ok) throw new Error('Failed to refresh case');
              const data = await response.json();
              const pagination = data.pagination || {};
              this.casePagination = {
                timeline: this.normalizePagination(pagination.timeline, timelineMeta.page ?? 1, timelineMeta.page_size ?? 8),
                contacts: this.normalizePagination(pagination.contacts, contactsMeta.page ?? 1, contactsMeta.page_size ?? 8),
              };
              this.cases[caseId] = this.clone(data.case);
              if (this.selectedCaseId === caseId) {
                this.selectedCase = this.clone(data.case);
                this.resetForms();
              }
            } catch (err) {
              console.error(err);
            }
          },

          async submitVitals() {
            if (!this.selectedCaseId || !this.can('case_manage')) return;
            const vitalsPayload = {};
            if (this.vitalsForm.bp) vitalsPayload.bp = this.vitalsForm.bp;
            if (this.vitalsForm.hr) vitalsPayload.hr = this.vitalsForm.hr;
            if (this.vitalsForm.spo2) vitalsPayload.spo2 = this.vitalsForm.spo2;
            if (Object.keys(vitalsPayload).length === 0) {
              return;
            }
            try {
              const response = await this.authorizedFetch(`/api/cases/${this.selectedCaseId}/vitals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  vitals: vitalsPayload,
                  recorded_by: this.vitalsForm.recorded_by || this.coordinator,
                }),
              });
              if (!response.ok) throw new Error('Failed to push vitals');
              const data = await response.json();
              this.applyEvent(data.event);
              this.logActivity(data.event);
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          async submitHandoff() {
            if (!this.selectedCaseId || !this.handoff.note || !this.can('case_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/cases/${this.selectedCaseId}/handoff`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  note: this.handoff.note,
                  author: this.handoff.author || this.coordinator,
                }),
              });
              if (!response.ok) throw new Error('Failed to push handoff');
              const data = await response.json();
              this.applyEvent(data.event);
              this.logActivity(data.event);
              this.applyDirectives(data.directives);
              this.handoff.note = '';
            } catch (err) {
              console.error(err);
            }
          },

          async setEscalation(flag) {
            if (!this.selectedCaseId || !this.can('case_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/cases/${this.selectedCaseId}/escalate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  escalation_flag: !!flag,
                  actor: this.coordinator,
                }),
              });
              if (!response.ok) throw new Error('Failed to update escalation');
              const data = await response.json();
              this.applyEvent(data.event);
              this.logActivity(data.event);
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          async assignProvider() {
            if (!this.selectedCaseId || !this.can('case_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/cases/${this.selectedCaseId}/assign-provider`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  provider_id: this.assignmentForm.provider_id || null,
                  assigned_by: this.assignmentForm.assigned_by || this.coordinator,
                }),
              });
              if (!response.ok) throw new Error('Failed to update assignment');
              const data = await response.json();
              this.applyEvent(data.event);
              this.logActivity(data.event);
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          clearAssignment() {
            if (!this.selectedCaseId || !this.can('case_manage')) return;
            this.assignmentForm.provider_id = '';
            this.assignProvider();
          },

          async updateVisitStatus() {
            if (!this.selectedCaseId || !this.statusForm.status || !this.can('case_manage')) return;
            try {
              const response = await this.authorizedFetch(`/api/cases/${this.selectedCaseId}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  status: this.statusForm.status,
                  updated_by: this.statusForm.updated_by || this.coordinator,
                }),
              });
              if (!response.ok) throw new Error('Failed to update status');
              const data = await response.json();
              this.applyEvent(data.event);
              this.logActivity(data.event);
              this.applyDirectives(data.directives);
            } catch (err) {
              console.error(err);
            }
          },

          async submitContactLog() {
            if (!this.selectedCaseId || !this.can('case_manage')) return;
            const summary = (this.contactForm.summary || '').trim();
            if (!summary) return;
            try {
              const response = await this.authorizedFetch(`/api/cases/${this.selectedCaseId}/contacts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  method: this.contactForm.method || this.contactMethods[0],
                  contact: this.contactForm.contact || 'Patient',
                  summary,
                  logged_by: this.contactForm.logged_by || this.coordinator,
                }),
              });
              if (!response.ok) throw new Error('Failed to log outreach');
              const data = await response.json();
              this.applyEvent(data.event);
              this.logActivity(data.event);
              this.applyDirectives(data.directives);
              this.contactForm.summary = '';
            } catch (err) {
              console.error(err);
            }
          },

          openStream() {
            if (this.transportMode !== 'sse') {
              this.closeStream();
              return;
            }
            if (!this.sessionUserId) return;
            this.closeStream();
            const source = new EventSource(`/stream?user_id=${encodeURIComponent(this.sessionUserId)}`);
            source.onmessage = (event) => {
              try {
                const payload = JSON.parse(event.data);
                if (payload?.type === 'directives') {
                  this.applyDirectives(payload.directives);
                  return;
                }
                this.applyEvent(payload);
                this.logActivity(payload);
                if (Array.isArray(payload?.directives)) {
                  this.applyDirectives(payload.directives);
                }
              } catch (err) {
                console.error('Failed to parse event', err);
              }
            };
            source.onerror = () => {
              this.closeStream();
              if (this.transportMode === 'sse') {
                setTimeout(() => this.openStream(), 5000);
              }
            };
            this.eventSource = source;
          },

          applyDirectives(directives) {
            if (!Array.isArray(directives) || directives.length === 0) return;
            const tasks = directives
              .map((directive) => this.handleDirective(directive))
              .filter((task) => task && typeof task.then === 'function');
            if (tasks.length === 0) {
              tasks.push(this.refreshAllForPolling());
            }
            Promise.allSettled(tasks).catch((err) => console.error('Directive handling failed', err));
          },

          handleDirective(directive) {
            if (!directive || typeof directive !== 'object') return null;
            switch (directive.op) {
              case 'refresh_collection': {
                if (directive.name === 'queues') return this.loadQueues();
                if (directive.name === 'providers') return this.loadProviders();
                if (directive.name === 'activity') return this.loadActivity();
                if (directive.name === 'operations_metrics') return this.loadOperationsMetrics();
                if (directive.name === 'operations_brief') return this.loadOperationsBrief();
                if (directive.name === 'coverage_teams') return this.loadCoverageSummary();
                if (directive.name === 'resource_library') return this.loadResourceLibrary();
                return null;
              }
              case 'refresh_item': {
                if (directive.name === 'case' && directive.id) {
                  return this.refreshCase(directive.id);
                }
                return null;
              }
              default:
                return null;
            }
          },

          applyEvent(event) {
            if (!event) return;
            const payload = event.payload ?? {};
            const caseId = event.case_id;

            if (payload.queue_entry) {
              this.upsertQueueEntry(payload.queue_entry);
            }
            if (payload.queue_id && !payload.queue_entry) {
              this.removeQueueEntry(payload.queue_id);
            }

            if (payload.playbook) {
              if (event.type === 'resources.playbook_removed') {
                this.removePlaybook(payload.playbook.id);
              } else {
                this.upsertPlaybook(payload.playbook);
              }
            }

            const queueUpdates = payload.queue ? this.clone(payload.queue) : {};
            if (Object.prototype.hasOwnProperty.call(payload, 'escalation_flag')) {
              queueUpdates.escalation_flag = payload.escalation_flag;
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'assigned_provider_id')) {
              queueUpdates.assigned_provider_id = payload.assigned_provider_id;
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'assigned_provider_name')) {
              queueUpdates.assigned_provider_name = payload.assigned_provider_name;
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'visit_status')) {
              queueUpdates.visit_status = payload.visit_status;
            }
            if (payload.queue && payload.queue.last_contacted_at) {
              queueUpdates.last_contacted_at = payload.queue.last_contacted_at;
            }

            if (caseId && Object.keys(queueUpdates).length > 0) {
              this.queues = this.queues.map((entry) => {
                if (entry.case_id !== caseId) return entry;
                return { ...entry, ...queueUpdates };
              });
            }

            if (payload.provider_snapshot) {
              this.replaceProvider(payload.provider_snapshot);
            }
            if (payload.previous_provider_snapshot) {
              this.replaceProvider(payload.previous_provider_snapshot);
            }
            if (event.type === 'provider.removed' && payload.provider_id) {
              this.removeProvider(payload.provider_id);
              this.queues = this.queues.map((entry) => {
                if (entry.assigned_provider_id !== payload.provider_id) return entry;
                return {
                  ...entry,
                  assigned_provider_id: null,
                  assigned_provider_name: null,
                };
              });
            }

            if (!caseId) return;

            const patch = {};
            if (payload.summary) patch.summary = payload.summary;
            if (payload.chart_preview) patch.chart_preview = payload.chart_preview;
            if (payload.care_team !== undefined) patch.care_team = payload.care_team;
            if (Array.isArray(payload.timeline)) patch.timeline = payload.timeline;
            if (Array.isArray(payload.contact_log)) patch.contact_log = payload.contact_log;
            if (payload.case) Object.assign(patch, payload.case);
            if (payload.visit_status && !patch.visit_status) patch.visit_status = payload.visit_status;

            if (Object.keys(patch).length > 0) {
              const existing = this.cases[caseId] ? this.clone(this.cases[caseId]) : { id: caseId };
              const merged = this.deepMerge(existing, patch);
              this.cases[caseId] = merged;
              if (this.selectedCaseId === caseId) {
                this.selectedCase = this.clone(merged);
                this.resetForms();
              }
            }

            if (Array.isArray(event.directives)) {
              this.applyDirectives(event.directives);
            }
          },

          replaceProvider(snapshot) {
            if (!snapshot || !snapshot.id) return;
            let updated = false;
            this.providers = this.providers.map((provider) => {
              if (provider.id !== snapshot.id) return provider;
              updated = true;
              return this.clone(snapshot);
            });
            if (!updated) {
              this.providers = [...this.providers, this.clone(snapshot)];
            }
          },

          removeProvider(providerId) {
            if (!providerId) return;
            this.providers = this.providers.filter((provider) => provider.id !== providerId);
          },

          upsertQueueEntry(entry) {
            if (!entry || !entry.id) return;
            if (entry.case_id) {
              const snapshot = this.clone(entry);
              this.queueCacheByCase = { ...this.queueCacheByCase, [entry.case_id]: snapshot };
              this.queueCacheById = { ...this.queueCacheById, [entry.id]: snapshot };
            }
            let updated = false;
            this.queues = this.queues.map((existing) => {
              if (existing.id !== entry.id) return existing;
              updated = true;
              return this.clone(entry);
            });
            if (!updated) {
              const meta = this.queuePagination || {};
              if ((meta.page ?? 1) === 1) {
                const limit = meta.page_size ?? this.queues.length + 1;
                this.queues = [this.clone(entry), ...this.queues].slice(0, limit);
              }
            }
          },

          removeQueueEntry(queueId) {
            if (!queueId) return;
            let removedEntry = this.queues.find((entry) => entry.id === queueId);
            this.queues = this.queues.filter((entry) => entry.id !== queueId);
            const cacheByCase = { ...this.queueCacheByCase };
            const cacheById = { ...this.queueCacheById };
            if (!removedEntry) {
              const cached = cacheById[queueId];
              if (cached) {
                removedEntry = cached;
              }
            }
            if (removedEntry && removedEntry.case_id) {
              delete cacheByCase[removedEntry.case_id];
            }
            delete cacheById[queueId];
            this.queueCacheByCase = cacheByCase;
            this.queueCacheById = cacheById;
            if (removedEntry && removedEntry.case_id === this.selectedCaseId) {
              this.selectedCaseId = null;
              this.selectedCase = null;
              if (this.queues.length > 0) {
                this.selectCase(this.queues[0].case_id);
              }
            }
          },

          upsertPlaybook(playbook) {
            if (!playbook || !playbook.id) return;
            let updated = false;
            this.resourceLibrary = this.resourceLibrary.map((existing) => {
              if (existing.id !== playbook.id) return existing;
              updated = true;
              return this.clone(playbook);
            });
            if (!updated) {
              this.resourceLibrary = [this.clone(playbook), ...this.resourceLibrary];
            }
            if (this.activePlaybook && this.activePlaybook.id === playbook.id) {
              this.activePlaybook = this.clone(playbook);
            }
          },

          removePlaybook(playbookId) {
            if (!playbookId) return;
            this.resourceLibrary = this.resourceLibrary.filter((item) => item.id !== playbookId);
            if (this.activePlaybook && this.activePlaybook.id === playbookId) {
              this.activePlaybook = null;
            }
          },

          logActivity(event, limit = null) {
            if (!event) return;
            const ts = event.ts ?? new Date().toISOString();
            const key = `${event.type ?? 'event'}-${ts}-${event.activity ?? ''}-${event.actor ?? ''}`;
            if (this.activityIndex.has(key)) return;
            this.activityIndex.add(key);
            const entry = {
              id: key,
              type: event.type,
              ts,
              actor: event.actor,
              message: event.activity || this.describeEvent(event),
            };
            const fallback = this.activityLog.length || 30;
            const maxEntries =
              typeof limit === 'number' && limit > 0
                ? limit
                : this.activityPagination?.page_size ?? fallback;
            this.activityLog = [entry, ...this.activityLog].slice(0, maxEntries);
          },

          displayEventType(type) {
            if (!type) return 'Update';
            return type
              .split('.')
              .map((segment) => segment.replace(/_/g, ' '))
              .join(' · ')
              .replace(/\b\w/g, (char) => char.toUpperCase());
          },

          describeEvent(event) {
            const name = this.caseName(event.case_id);
            const payload = event.payload ?? {};
            switch (event.type) {
              case 'case.vitals_updated': {
                const vitals = payload.summary?.last_vitals ?? {};
                const parts = [];
                if (vitals.bp) parts.push(`BP ${vitals.bp}`);
                if (vitals.hr) parts.push(`HR ${vitals.hr}`);
                if (vitals.spo2) parts.push(`SpO₂ ${vitals.spo2}`);
                const detail = parts.length ? ` (${parts.join(' · ')})` : '';
                return `${name}: vitals refreshed${detail}`;
              }
              case 'case.handoff_added':
                return `${name}: handoff note posted`;
              case 'case.contact_logged':
                return `${name}: outreach logged`;
              case 'queue.escalation_changed':
                return `${name}: escalation ${payload.escalation_flag ? 'raised' : 'cleared'}`;
              case 'queue.provider_assigned':
                return `${name}: routed to ${payload.assigned_provider_name || 'unassigned'}`;
              case 'queue.status_changed':
                return `${name}: status → ${this.visitStatusLabel(payload.visit_status)}`;
              default:
                return `${name || 'Case'} updated`;
            }
          },

          caseName(caseId) {
            if (!caseId) return '';
            if (this.selectedCase && this.selectedCase.id === caseId) {
              return this.selectedCase.patient?.name ?? caseId;
            }
            const stored = this.cases[caseId];
            if (stored) {
              return stored.patient?.name ?? caseId;
            }
            const queueEntry = this.queues.find((q) => q.case_id === caseId);
            if (queueEntry) return queueEntry.patient ?? caseId;
            const cached = this.queueCacheByCase[caseId];
            if (cached) return cached.patient ?? caseId;
            return caseId;
          },

          resetForms() {
            if (!this.selectedCase) return;
            const vitals = this.selectedCase?.summary?.last_vitals ?? {};
            const previousAssignedBy = this.assignmentForm.assigned_by || this.coordinator;
            const previousStatusBy = this.statusForm.updated_by || this.coordinator;
            const previousContactBy = this.contactForm.logged_by || this.coordinator;
            const previousMethod = this.contactForm.method || this.contactMethods[0];
            const previousContact = this.contactForm.contact || this.selectedCase?.patient?.name || 'Patient';

            this.vitalsForm = {
              bp: vitals.bp ?? '',
              hr: vitals.hr ?? '',
              spo2: vitals.spo2 ?? '',
              recorded_by: this.coordinator,
            };

            if (!this.handoff.author) {
              this.handoff.author = this.coordinator;
            }

            this.assignmentForm = {
              provider_id: this.selectedCase?.care_team?.assigned_provider?.id ?? '',
              assigned_by: previousAssignedBy,
            };

            this.statusForm = {
              status: this.selectedCase?.visit_status ?? this.visitStatusOptions[0]?.value ?? '',
              updated_by: previousStatusBy,
            };

            this.contactForm = {
              method: previousMethod,
              contact: previousContact,
              summary: '',
              logged_by: previousContactBy,
            };
          },

          formatTimelineType(type) {
            if (!type) return 'Update';
            const labels = {
              vitals: 'Vitals',
              handoff: 'Handoff note',
              escalation: 'Escalation',
              assignment: 'Routing',
              status: 'Status',
              contact: 'Outreach',
              intake: 'Intake',
              med_review: 'Medication review',
              awaiting_intake: 'Awaiting intake',
            };
            return labels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
          },

          formatVitals(vitals) {
            if (!vitals) return '';
            const parts = [];
            if (vitals.bp) parts.push(`BP ${vitals.bp}`);
            if (vitals.hr) parts.push(`HR ${vitals.hr}`);
            if (vitals.spo2) parts.push(`SpO₂ ${vitals.spo2}`);
            return parts.join(' · ');
          },

          deepMerge(target, source) {
            const output = Array.isArray(target) ? [...target] : { ...target };
            Object.entries(source).forEach(([key, value]) => {
              if (Array.isArray(value)) {
                output[key] = value.map((item) => (typeof item === 'object' ? this.clone(item) : item));
              } else if (value && typeof value === 'object') {
                const base = output[key] && typeof output[key] === 'object' ? output[key] : {};
                output[key] = this.deepMerge(base, value);
              } else {
                output[key] = value;
              }
            });
            return output;
          },

          clone(value) {
            if (Array.isArray(value)) {
              return value.map((item) => this.clone(item));
            }
            if (value && typeof value === 'object') {
              return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.clone(v)]));
            }
            return value;
          },

          relativeTime(isoString) {
            if (!isoString) return '';
            const then = new Date(isoString);
            const diff = Date.now() - then.getTime();
            const minutes = Math.floor(diff / 60000);
            if (minutes <= 0) return 'just now';
            if (minutes === 1) return '1 minute ago';
            if (minutes < 60) return `${minutes} minutes ago`;
            const hours = Math.floor(minutes / 60);
            if (hours === 1) return '1 hour ago';
            if (hours < 24) return `${hours} hours ago`;
            const days = Math.floor(hours / 24);
            return days === 1 ? '1 day ago' : `${days} days ago`;
          },
        };
      };

(function () {
    if (window.__VERITY_DL_DEVTOOLS__) {
        try { window.__VERITY_DL_DEVTOOLS__.show(); } catch { }
        return;
    }

    const resolveAdapter = () => {
        const globalAdapter = window.DL;
        if (globalAdapter && (typeof globalAdapter === "object" || typeof globalAdapter === "function")) {
            return globalAdapter;
        }
        const adapters = window.DLAdapters;
        if (adapters && typeof adapters === "object") {
            const defaultKey = adapters.default;
            if (typeof defaultKey === "string" && adapters[defaultKey]) {
                return adapters[defaultKey];
            }
            const keys = Object.keys(adapters);
            for (const key of keys) {
                if (key === "default") continue;
                const candidate = adapters[key];
                if (candidate && (typeof candidate === "object" || typeof candidate === "function")) {
                    return candidate;
                }
            }
        }
        return null;
    };

    const init = () => {
        const adapter = resolveAdapter();
        if (!adapter || typeof adapter.devtools !== "function") {
            console.warn("VerityDL devtools: DL.devtools() is unavailable.");
            return;
        }

        const resolveAssetUrl = (assetName) => {
            if (!assetName) return null;
            const scriptEl = document.currentScript || (function () {
                try {
                    const scripts = Array.from(document.querySelectorAll("script[src]"));
                    return scripts.find((el) => el.src.includes("devtools/devtools.js")) || null;
                } catch {
                    return null;
                }
            })();
            if (scriptEl && scriptEl.src) {
                try {
                    return new URL(assetName, scriptEl.src).toString();
                } catch {
                    /* fall through to default */
                }
            }
            return "/static/devtools/" + assetName;
        };

        const head = document.head || document.getElementsByTagName("head")[0];
        if (head) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = resolveAssetUrl("devtools.css");
            head.appendChild(link);
        }

        const store = {
            snapshot: null,
            fetchEvents: [],
            directiveEvents: [],
            memoryEvents: [],
            sseEvents: [],
            sseState: {
                connected: false,
                lastOpen: null,
                lastError: null,
                lastMessage: null,
                lastRetryInMs: null,
                audience: null,
            },
            activePanel: "truth",
            renderPending: false,
            snapshotRefreshPending: false,
        };

        const layout = {
            hidden: false,
            minimized: false,
            detached: false,
            manualPosition: false,
            position: null,
            miniPosition: null,
            size: null,
        };

        const LAYOUT_STORAGE_KEY = "veritydl.devtools.layout";
        const getStorage = () => {
            try {
                return window.localStorage || null;
            } catch {
                return null;
            }
        };
        const sanitizeNumber = (value, fallback) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : fallback;
        };
        const clampSize = (size) => {
            if (!size) return null;
            const width = Math.max(RESIZE_LIMITS.minWidth, sanitizeNumber(size.width, RESIZE_LIMITS.minWidth));
            const height = Math.max(RESIZE_LIMITS.minHeight, sanitizeNumber(size.height, RESIZE_LIMITS.minHeight));
            return { width, height };
        };
        const readStoredLayout = () => {
            const storage = getStorage();
            if (!storage) return null;
            try {
                const raw = storage.getItem(LAYOUT_STORAGE_KEY);
                if (!raw) return null;
                const data = JSON.parse(raw);
                return data && typeof data === "object" ? data : null;
            } catch {
                return null;
            }
        };
        const applyStoredLayout = (data) => {
            if (!data || typeof data !== "object") return;
            const size = clampSize(data.size);
            layout.size = size;
            if (data.manualPosition && data.position) {
                const left = sanitizeNumber(data.position.left, RESIZE_LIMITS.margin);
                const top = sanitizeNumber(data.position.top, RESIZE_LIMITS.margin);
                layout.position = { left, top };
                layout.manualPosition = true;
            } else {
                layout.position = null;
                layout.manualPosition = false;
            }
            if (data.miniPosition) {
                const left = sanitizeNumber(data.miniPosition.left, RESIZE_LIMITS.margin);
                const top = sanitizeNumber(data.miniPosition.top, RESIZE_LIMITS.margin);
                layout.miniPosition = { left, top };
            }
            layout.minimized = !!data.minimized;
        };
        const serializeLayout = () => {
            const size = layout.size ? { width: Math.round(layout.size.width), height: Math.round(layout.size.height) } : null;
            const position = layout.manualPosition && layout.position
                ? { left: Math.round(layout.position.left), top: Math.round(layout.position.top) }
                : null;
            const miniPosition = layout.miniPosition
                ? { left: Math.round(layout.miniPosition.left), top: Math.round(layout.miniPosition.top) }
                : null;
            return {
                manualPosition: !!layout.manualPosition && !!position,
                position,
                size,
                miniPosition,
                minimized: !!layout.minimized,
            };
        };
        const storagePersist = () => {
            const storage = getStorage();
            if (!storage || layout.detached) return;
            try {
                storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(serializeLayout()));
            } catch {
                /* ignore */
            }
        };
        const RESIZE_LIMITS = {
            minWidth: 320,
            minHeight: 240,
            margin: 16,
        };

        const initialLayout = readStoredLayout();
        if (initialLayout) {
            applyStoredLayout(initialLayout);
        }

        const MAX_EVENTS = 120;

        const clone = (value) => {
            if (value == null) return value;
            if (typeof structuredClone === "function") {
                try { return structuredClone(value); }
                catch { /* ignore */ }
            }
            try { return JSON.parse(JSON.stringify(value)); }
            catch { return value; }
        };

        const escapeHtml = (value) => {
            if (value == null) return "";
            return String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        };

        const EVENT_KIND_META = {
            fetch: {
                icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path><path d="M5 3.5h4.5a2 2 0 0 1 1.58.79l2.17 2.89a2 2 0 0 1 0 2.44l-2.17 2.89a2 2 0 0 1-1.58.79H5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`
            },
            sse: {
                icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 11.5c1.4-1.9 3.4-3 5.02-3s3.62 1.1 4.98 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path><path d="M4.5 7c1.2-1.6 2.8-2.5 3.52-2.5S10.8 5.4 12 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path><circle cx="8" cy="12.25" r="0.9" fill="currentColor"></circle></svg>`
            },
            directive: {
                icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.75 9.7 6h4.05l-3.28 2.38 1.25 4.12L8 10.9l-3.72 1.6L5.5 8.38 2.25 6H6.3Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path></svg>`
            },
            memory: {
                icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3.5" width="10" height="9" rx="1.6" ry="1.6" fill="none" stroke="currentColor" stroke-width="1.2"></rect><path d="M5.5 6.5h5M5.5 9.5h2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></path></svg>`
            },
            system: {
                icon: `<svg class="vdl-event-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2.25 9.4 5.7l3.8.28-2.9 2.36.92 3.72L8 10.72l-3.22 1.34.92-3.72L2.8 6l3.8-.28Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path></svg>`
            }
        };

        const classifyEventKind = (eventName) => {
            if (!eventName || typeof eventName !== "string") return "system";
            if (
                eventName.startsWith("collection:") ||
                eventName.startsWith("item:") ||
                eventName.startsWith("bulk:")
            ) {
                return "fetch";
            }
            if (eventName.startsWith("sse:")) {
                return "sse";
            }
            if (eventName.startsWith("directive:")) {
                return "directive";
            }
            if (eventName.startsWith("memory:")) {
                return "memory";
            }
            return "system";
        };

        const describeEvent = (eventName) => {
            const kind = classifyEventKind(eventName);
            const meta = EVENT_KIND_META[kind] || EVENT_KIND_META.system;
            return { kind, icon: meta.icon };
        };

        const renderEventBadge = (eventName, meta) => {
            const info = meta || describeEvent(eventName);
            return `<span class="vdl-event-badge vdl-log-event" data-event-kind="${info.kind}">${info.icon}<span class="vdl-event-label">${escapeHtml(eventName)}</span></span>`;
        };

        const pushEvent = (list, entry) => {
            list.unshift(entry);
            if (list.length > MAX_EVENTS) list.length = MAX_EVENTS;
        };

        const scheduleRender = () => {
            if (store.renderPending) return;
            store.renderPending = true;
            const exec = () => {
                store.renderPending = false;
                renderActivePanel();
            };
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(exec);
            } else {
                setTimeout(exec, 16);
            }
        };

        const queueSnapshotRefresh = () => {
            if (store.snapshotRefreshPending) return;
            store.snapshotRefreshPending = true;
            const exec = () => {
                store.snapshotRefreshPending = false;
                updateSnapshot();
            };
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(exec);
            } else {
                setTimeout(exec, 16);
            }
        };

        const container = document.createElement("div");
        container.className = "vdl-devtools";

        const header = document.createElement("div");
        header.className = "vdl-header";
        header.innerHTML = `
            <div class="vdl-title">VerityDL Devtools</div>
            <div class="vdl-header-actions">
                <button type="button" class="vdl-btn" data-action="detach">Pop out</button>
                <button type="button" class="vdl-btn" data-action="minimize">Mini view</button>
                <button type="button" class="vdl-btn" data-action="toggle">Hide</button>
            </div>
        `;
        container.appendChild(header);

        const nav = document.createElement("div");
        nav.className = "vdl-tabs";
        const panels = [
            { id: "truth", label: "Truth" },
            { id: "fetches", label: "Fetches" },
            { id: "sse", label: "SSE" },
            { id: "directives", label: "Directives" },
            { id: "memory", label: "Memory" },
            { id: "levels", label: "Levels" },
        ];
        nav.innerHTML = panels.map(p => `<button type="button" class="vdl-tab" data-panel="${p.id}">${p.label}</button>`).join("");
        container.appendChild(nav);

        const content = document.createElement("div");
        content.className = "vdl-content";
        container.appendChild(content);

        const resizeHandle = document.createElement("div");
        resizeHandle.className = "vdl-resize-handle";
        resizeHandle.setAttribute("aria-hidden", "true");
        resizeHandle.setAttribute("role", "presentation");
        resizeHandle.title = "Drag to resize";
        container.appendChild(resizeHandle);

        const mini = document.createElement("button");
        mini.type = "button";
        mini.className = "vdl-mini";
        mini.setAttribute("aria-label", "Open VerityDL devtools");
        mini.innerHTML = `
            <div class="vdl-mini-header">
                <span class="vdl-mini-title">VerityDL</span>
                <span class="vdl-mini-stat vdl-mini-sse" data-mini="sse">
                    <span class="vdl-mini-dot" aria-hidden="true"></span>
                    <span class="vdl-mini-sse-label">Offline</span>
                </span>
            </div>
            <div class="vdl-mini-stats">
                <span class="vdl-mini-stat">
                    <span class="vdl-mini-label">Collections</span>
                    <span class="vdl-mini-value" data-mini="collections">0</span>
                </span>
                <span class="vdl-mini-stat">
                    <span class="vdl-mini-label">Types</span>
                    <span class="vdl-mini-value" data-mini="types">0</span>
                </span>
                <span class="vdl-mini-stat">
                    <span class="vdl-mini-label">In-flight</span>
                    <span class="vdl-mini-value" data-mini="inflight">0</span>
                </span>
                <span class="vdl-mini-stat">
                    <span class="vdl-mini-label">Bulk queued</span>
                    <span class="vdl-mini-value" data-mini="queues">0</span>
                </span>
            </div>
            <div class="vdl-mini-footer">
                <span class="vdl-mini-label">Last event</span>
                <span class="vdl-mini-activity" data-mini="activity">No activity yet</span>
            </div>
        `;

        const panelNodes = new Map();
        for (const panel of panels) {
            const node = document.createElement("div");
            node.className = "vdl-panel";
            node.dataset.panel = panel.id;
            content.appendChild(node);
            panelNodes.set(panel.id, node);
        }

        const detachBtn = header.querySelector('[data-action="detach"]');
        const minimizeBtn = header.querySelector('[data-action="minimize"]');
        const toggleBtn = header.querySelector('[data-action="toggle"]');

        let detachedWindow = null;
        let detachCleanup = null;

        const clampWithinViewport = (left, top, element, margin = 12) => {
            if (!element) return { left, top };
            const rect = element.getBoundingClientRect();
            const width = rect.width || element.offsetWidth || 0;
            const height = rect.height || element.offsetHeight || 0;
            const maxLeft = window.innerWidth - width - margin;
            const maxTop = window.innerHeight - height - margin;
            const clampedLeft = maxLeft < margin ? margin : Math.min(Math.max(margin, left), maxLeft);
            const clampedTop = maxTop < margin ? margin : Math.min(Math.max(margin, top), maxTop);
            return { left: clampedLeft, top: clampedTop };
        };

        const updateButtonLabels = () => {
            if (detachBtn) {
                detachBtn.textContent = layout.detached ? "Dock" : "Pop out";
            }
            if (toggleBtn) {
                toggleBtn.textContent = layout.hidden ? "Show" : "Hide";
                toggleBtn.setAttribute(
                    "title",
                    layout.hidden ? "Show the devtools" : "Hide the devtools"
                );
            }
        };

        const applyLayout = () => {
            const hideContainer = layout.hidden || layout.minimized;
            container.classList.toggle("is-hidden", hideContainer);
            container.classList.toggle("is-detached", layout.detached);

            if (minimizeBtn) {
                const disableMini = layout.detached;
                minimizeBtn.disabled = disableMini;
                minimizeBtn.setAttribute(
                    "title",
                    disableMini
                        ? "Mini view is unavailable while the devtools are popped out. Dock to enable it again."
                        : "Switch to the floating mini devtools view."
                );
            }

            if (layout.detached) {
                container.style.position = "relative";
                container.style.left = "";
                container.style.top = "";
                container.style.right = "";
                container.style.bottom = "";
                container.style.width = "";
                container.style.height = "";
            } else {
                container.style.position = "fixed";
                if (layout.manualPosition && layout.position) {
                    const { left, top } = clampWithinViewport(layout.position.left, layout.position.top, container);
                    container.style.left = `${left}px`;
                    container.style.top = `${top}px`;
                    container.style.right = "auto";
                    container.style.bottom = "auto";
                } else {
                    container.style.left = "";
                    container.style.top = "";
                    container.style.right = "";
                    container.style.bottom = "";
                }
                if (layout.size) {
                    container.style.width = `${layout.size.width}px`;
                    container.style.height = `${layout.size.height}px`;
                } else {
                    container.style.width = "";
                    container.style.height = "";
                }
            }

            if (mini) {
                const visibleMini = !layout.hidden && layout.minimized && !layout.detached;
                mini.classList.toggle("is-visible", visibleMini);
                if (visibleMini) {
                    if (layout.miniPosition) {
                        mini.style.left = `${layout.miniPosition.left}px`;
                        mini.style.top = `${layout.miniPosition.top}px`;
                        mini.style.right = "auto";
                        mini.style.bottom = "auto";
                    } else {
                        mini.style.left = "";
                        mini.style.top = "";
                        mini.style.right = "";
                        mini.style.bottom = "";
                    }
                } else {
                    mini.style.left = "";
                    mini.style.top = "";
                    mini.style.right = "";
                    mini.style.bottom = "";
                }
            }

            updateButtonLabels();
        };

        const setMinimized = (value) => {
            const next = !!value;
            if (next && layout.detached) return;
            layout.minimized = next;
            if (next) layout.hidden = false;
            applyLayout();
            if (next && mini) {
                try { mini.focus({ preventScroll: true }); } catch { }
            }
            storagePersist();
        };

        const setHidden = (value) => {
            layout.hidden = !!value;
            if (layout.hidden) layout.minimized = false;
            applyLayout();
            storagePersist();
        };

        const dock = (closeWindow = true) => {
            if (!layout.detached) return;
            layout.detached = false;
            if (detachCleanup) {
                try { detachCleanup(); } catch { }
                detachCleanup = null;
            }
            document.body.appendChild(container);
            const restored = readStoredLayout();
            if (restored) {
                applyStoredLayout(restored);
            }
            if (closeWindow && detachedWindow && !detachedWindow.closed) {
                try { detachedWindow.close(); } catch { }
            }
            detachedWindow = null;
            applyLayout();
            storagePersist();
        };

        const detach = () => {
            if (layout.detached) return;
            storagePersist();
            const win = window.open("", "", "width=720,height=640");
            if (!win || win.closed) {
                console.warn("VerityDL devtools: Unable to open a separate window. The popup may have been blocked.");
                return;
            }
            win.document.write(`<!DOCTYPE html><html><head><title>VerityDL Devtools</title></head><body></body></html>`);
            win.document.close();
            const doc = win.document;
            doc.body.style.margin = "0";
            doc.body.style.background = "rgba(15, 23, 42, 0.98)";
            const link = doc.createElement("link");
            link.rel = "stylesheet";
            link.href = resolveAssetUrl("devtools.css");
            doc.head.appendChild(link);
            doc.body.appendChild(container);
            const handleUnload = () => { dock(false); };
            win.addEventListener("beforeunload", handleUnload);
            detachCleanup = () => {
                try { win.removeEventListener("beforeunload", handleUnload); } catch { }
            };
            detachedWindow = win;
            layout.detached = true;
            layout.hidden = false;
            layout.minimized = false;
            layout.manualPosition = false;
            layout.position = null;
            layout.size = null;
            applyLayout();
            try { win.focus(); } catch { }
        };

        let headerDragState = null;
        header.addEventListener("pointerdown", (event) => {
            if (layout.detached) return;
            if (event.button !== 0) return;
            if (event.target && event.target.closest && event.target.closest(".vdl-header-actions")) return;
            const rect = container.getBoundingClientRect();
            headerDragState = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
            };
            try { header.setPointerCapture(event.pointerId); } catch { }
            header.classList.add("is-dragging");
            container.classList.add("is-dragging");
            event.preventDefault();
        });
        const finishHeaderDrag = (event) => {
            if (!headerDragState || (event.pointerId != null && event.pointerId !== headerDragState.pointerId)) return;
            try { header.releasePointerCapture(headerDragState.pointerId); } catch { }
            headerDragState = null;
            header.classList.remove("is-dragging");
            container.classList.remove("is-dragging");
            storagePersist();
        };
        header.addEventListener("pointermove", (event) => {
            if (!headerDragState || event.pointerId !== headerDragState.pointerId) return;
            const next = clampWithinViewport(event.clientX - headerDragState.offsetX, event.clientY - headerDragState.offsetY, container);
            layout.position = next;
            layout.manualPosition = true;
            container.style.left = `${next.left}px`;
            container.style.top = `${next.top}px`;
            container.style.right = "auto";
            container.style.bottom = "auto";
        });
        header.addEventListener("pointerup", finishHeaderDrag);
        header.addEventListener("pointercancel", finishHeaderDrag);

        let miniDragState = null;
        let miniWasDragged = false;
        if (mini) {
            mini.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) return;
                miniWasDragged = false;
                const rect = mini.getBoundingClientRect();
                miniDragState = {
                    pointerId: event.pointerId,
                    offsetX: event.clientX - rect.left,
                    offsetY: event.clientY - rect.top,
                };
                try { mini.setPointerCapture(event.pointerId); } catch { }
                mini.classList.add("is-dragging");
                event.preventDefault();
            });
            const finishMiniDrag = (event) => {
                if (!miniDragState || (event.pointerId != null && event.pointerId !== miniDragState.pointerId)) return;
                try { mini.releasePointerCapture(miniDragState.pointerId); } catch { }
                mini.classList.remove("is-dragging");
                miniDragState = null;
                storagePersist();
            };
            mini.addEventListener("pointermove", (event) => {
                if (!miniDragState || event.pointerId !== miniDragState.pointerId) return;
                miniWasDragged = true;
                const next = clampWithinViewport(event.clientX - miniDragState.offsetX, event.clientY - miniDragState.offsetY, mini, 8);
                layout.miniPosition = next;
                mini.style.left = `${next.left}px`;
                mini.style.top = `${next.top}px`;
                mini.style.right = "auto";
                mini.style.bottom = "auto";
            });
            mini.addEventListener("pointerup", finishMiniDrag);
            mini.addEventListener("pointercancel", finishMiniDrag);
            mini.addEventListener("click", (event) => {
                if (miniWasDragged) {
                    event.preventDefault();
                    event.stopPropagation();
                    miniWasDragged = false;
                    return;
                }
                setMinimized(false);
            });
        }

        const handleResize = () => {
            if (!layout.detached && layout.manualPosition && layout.position) {
                const prev = layout.position;
                const next = clampWithinViewport(layout.position.left, layout.position.top, container);
                layout.position = next;
                container.style.left = `${next.left}px`;
                container.style.top = `${next.top}px`;
                container.style.right = "auto";
                container.style.bottom = "auto";
                if (!prev || next.left !== prev.left || next.top !== prev.top) {
                    storagePersist();
                }
            }
            if (!layout.detached && layout.size) {
                const rect = container.getBoundingClientRect();
                const margin = RESIZE_LIMITS.margin;
                const maxWidth = Math.max(RESIZE_LIMITS.minWidth, window.innerWidth - rect.left - margin);
                const maxHeight = Math.max(RESIZE_LIMITS.minHeight, window.innerHeight - rect.top - margin);
                const width = Math.min(layout.size.width, maxWidth);
                const height = Math.min(layout.size.height, maxHeight);
                if (width !== layout.size.width || height !== layout.size.height) {
                    layout.size = { width, height };
                    storagePersist();
                }
                container.style.width = `${layout.size.width}px`;
                container.style.height = `${layout.size.height}px`;
            }
            if (!layout.detached && layout.miniPosition && !layout.hidden && layout.minimized) {
                const nextMini = clampWithinViewport(layout.miniPosition.left, layout.miniPosition.top, mini, 8);
                const prevMini = layout.miniPosition;
                layout.miniPosition = nextMini;
                mini.style.left = `${nextMini.left}px`;
                mini.style.top = `${nextMini.top}px`;
                mini.style.right = "auto";
                mini.style.bottom = "auto";
                if (!prevMini || prevMini.left !== nextMini.left || prevMini.top !== nextMini.top) {
                    storagePersist();
                }
            }
        };
        window.addEventListener("resize", handleResize);

        let resizeState = null;
        if (resizeHandle) {
            resizeHandle.addEventListener("pointerdown", (event) => {
                if (layout.detached || layout.minimized || layout.hidden) return;
                if (event.button !== 0) return;
                const rect = container.getBoundingClientRect();
                resizeState = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    startWidth: rect.width,
                    startHeight: rect.height,
                    originLeft: rect.left,
                    originTop: rect.top,
                };
                container.classList.add("is-resizing");
                resizeHandle.classList.add("is-active");
                try { resizeHandle.setPointerCapture(event.pointerId); } catch { }
                event.preventDefault();
            });

            const finishResize = (event) => {
                if (!resizeState || (event.pointerId != null && event.pointerId !== resizeState.pointerId)) return;
                try { resizeHandle.releasePointerCapture(resizeState.pointerId); } catch { }
                resizeState = null;
                container.classList.remove("is-resizing");
                resizeHandle.classList.remove("is-active");
                applyLayout();
                storagePersist();
            };

            resizeHandle.addEventListener("pointermove", (event) => {
                if (!resizeState || event.pointerId !== resizeState.pointerId) return;
                const margin = RESIZE_LIMITS.margin;
                const deltaX = event.clientX - resizeState.startX;
                const deltaY = event.clientY - resizeState.startY;
                const maxWidth = Math.max(RESIZE_LIMITS.minWidth, window.innerWidth - resizeState.originLeft - margin);
                const maxHeight = Math.max(RESIZE_LIMITS.minHeight, window.innerHeight - resizeState.originTop - margin);
                const width = Math.min(Math.max(RESIZE_LIMITS.minWidth, resizeState.startWidth + deltaX), maxWidth);
                const height = Math.min(Math.max(RESIZE_LIMITS.minHeight, resizeState.startHeight + deltaY), maxHeight);
                layout.size = { width, height };
                container.style.width = `${width}px`;
                container.style.height = `${height}px`;
            });

            resizeHandle.addEventListener("pointerup", finishResize);
            resizeHandle.addEventListener("pointercancel", finishResize);
        }

        const fmtTime = (ts) => {
            if (!ts) return "";
            try {
                const d = new Date(ts);
                if (Number.isNaN(d.getTime())) return String(ts);
                return d.toLocaleTimeString([], { hour12: false });
            } catch {
                return String(ts);
            }
        };

        const isPlainObject = (value) => Object.prototype.toString.call(value) === "[object Object]";
        const isTreeExpandable = (value) => Array.isArray(value) || isPlainObject(value);
        const isTreeEmpty = (value) => {
            if (Array.isArray(value)) return value.length === 0;
            if (isPlainObject(value)) return Object.keys(value || {}).length === 0;
            return false;
        };
        const getTreeEntries = (value) => {
            if (Array.isArray(value)) {
                return value.map((item, index) => [index, item]);
            }
            return Object.entries(value || {});
        };
        const formatPrimitive = (value) => {
            if (typeof value === "string") return `"${value}"`;
            if (typeof value === "number" && !Number.isFinite(value)) return String(value);
            if (typeof value === "number") return value.toString();
            if (typeof value === "boolean") return value ? "true" : "false";
            if (value === null) return "null";
            if (value === undefined) return "undefined";
            if (typeof value === "bigint") return value.toString() + "n";
            if (typeof value === "symbol") return value.toString();
            return String(value);
        };
        const toJsonString = (value) => {
            if (value === undefined) return "undefined";
            if (typeof value === "bigint") return value.toString() + "n";
            try {
                if (typeof value === "string") {
                    return JSON.stringify(value);
                }
                return JSON.stringify(value, null, 2);
            } catch {
                try {
                    return String(value);
                } catch {
                    return "";
                }
            }
        };
        const copyTextToClipboard = async (text) => {
            if (typeof text !== "string") text = String(text);
            if (!text) return false;
            try {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                    await navigator.clipboard.writeText(text);
                    return true;
                }
            } catch {
                // ignore and fall back
            }
            const area = document.createElement("textarea");
            area.value = text;
            area.setAttribute("readonly", "");
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            let copied = false;
            try {
                area.select();
                copied = document.execCommand("copy");
            } catch {
                copied = false;
            }
            area.remove();
            return copied;
        };
        const createObjectTree = (value, { collapseDepth = 1, rootLabel = null } = {}) => {
            const tree = document.createElement("div");
            tree.className = "vdl-tree";

            const buildNode = (key, nodeValue, depth) => {
                const node = document.createElement("div");
                node.className = "vdl-tree-node";

                const row = document.createElement("div");
                row.className = "vdl-tree-row";
                row.style.paddingLeft = `${depth * 14}px`;
                node.appendChild(row);

                const isCollection = isTreeExpandable(nodeValue);
                const entries = isCollection ? getTreeEntries(nodeValue) : [];
                const hasChildren = entries.length > 0;
                let toggleButton = null;
                if (hasChildren) {
                    row.classList.add("is-expandable");
                    row.tabIndex = 0;
                    toggleButton = document.createElement("button");
                    toggleButton.type = "button";
                    toggleButton.className = "vdl-tree-toggle";
                    row.appendChild(toggleButton);
                } else {
                    const spacer = document.createElement("span");
                    spacer.className = "vdl-tree-toggle is-placeholder";
                    row.appendChild(spacer);
                }

                if (key != null) {
                    const keySpan = document.createElement("span");
                    keySpan.className = "vdl-tree-key";
                    keySpan.textContent = String(key) + ":";
                    row.appendChild(keySpan);
                }

                if (isCollection) {
                    const summary = document.createElement("span");
                    summary.className = "vdl-tree-summary";
                    if (Array.isArray(nodeValue)) {
                        summary.textContent = `Array(${nodeValue.length})`;
                    } else {
                        summary.textContent = `Object(${Object.keys(nodeValue || {}).length})`;
                    }
                    row.appendChild(summary);
                } else {
                    const valueSpan = document.createElement("span");
                    valueSpan.className = "vdl-tree-value";
                    valueSpan.textContent = formatPrimitive(nodeValue);
                    row.appendChild(valueSpan);
                }

                if (hasChildren) {
                    const children = document.createElement("div");
                    children.className = "vdl-tree-children";
                    entries.forEach(([childKey, childValue]) => {
                        children.appendChild(buildNode(childKey, childValue, depth + 1));
                    });
                    node.appendChild(children);

                    let collapsed = depth >= collapseDepth;

                    const applyState = (next) => {
                        collapsed = next;
                        children.hidden = collapsed;
                        if (toggleButton) toggleButton.textContent = collapsed ? "▸" : "▾";
                        node.classList.toggle("is-collapsed", collapsed);
                    };

                    applyState(collapsed);

                    const toggleState = (event) => {
                        if (event) event.stopPropagation();
                        applyState(!collapsed);
                    };

                    if (toggleButton) {
                        toggleButton.addEventListener("click", toggleState);
                    }
                    row.addEventListener("click", (event) => {
                        if (toggleButton && (event.target === toggleButton || toggleButton.contains(event.target))) {
                            return;
                        }
                        toggleState(event);
                    });
                    row.addEventListener("keydown", (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleState(event);
                        }
                    });
                }

                return node;
            };

            const appendNodes = (entries, depth) => {
                if (!entries.length) {
                    tree.appendChild(buildNode(rootLabel, value, depth));
                    return;
                }
                entries.forEach(([childKey, childValue]) => {
                    tree.appendChild(buildNode(childKey, childValue, depth));
                });
            };

            if (!isTreeExpandable(value) || rootLabel != null) {
                tree.appendChild(buildNode(rootLabel, value, 0));
            } else {
                appendNodes(getTreeEntries(value), 0);
            }

            return tree;
        };
        const renderTreeInto = (target, value, options = {}) => {
            if (!target) return;
            target.innerHTML = "";
            const emptyLabel = options.emptyLabel || "No data available.";
            if (value == null) {
                const empty = document.createElement("p");
                empty.className = "vdl-empty";
                empty.textContent = emptyLabel;
                target.appendChild(empty);
                return;
            }
            if (isTreeExpandable(value) && isTreeEmpty(value)) {
                const empty = document.createElement("p");
                empty.className = "vdl-empty";
                empty.textContent = emptyLabel;
                target.appendChild(empty);
                return;
            }

            const viewContainer = document.createElement("div");
            viewContainer.className = "vdl-inspector";
            const toolbar = document.createElement("div");
            toolbar.className = "vdl-inspector-toolbar";
            const actions = document.createElement("div");
            actions.className = "vdl-inspector-actions";

            let viewMode = target.dataset.viewMode === "json" ? "json" : "tree";
            target.dataset.viewMode = viewMode;

            const toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.className = "vdl-btn vdl-btn-ghost";
            toggleBtn.title = "Toggle between tree and JSON views";
            const updateToggleLabel = () => {
                const isJson = viewMode === "json";
                toggleBtn.textContent = isJson ? "View tree" : "View JSON";
                toggleBtn.setAttribute("aria-pressed", isJson ? "true" : "false");
            };
            updateToggleLabel();

            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "vdl-btn";
            copyBtn.textContent = "Copy";
            copyBtn.title = "Copy JSON to clipboard";

            const content = document.createElement("div");
            content.className = "vdl-inspector-view";

            const renderView = () => {
                content.innerHTML = "";
                if (viewMode === "json") {
                    const pre = document.createElement("pre");
                    pre.className = "vdl-json-view";
                    pre.textContent = toJsonString(value);
                    content.appendChild(pre);
                } else if (isTreeExpandable(value)) {
                    const treeOptions = { ...options };
                    delete treeOptions.emptyLabel;
                    content.appendChild(createObjectTree(value, treeOptions));
                } else {
                    const primitive = document.createElement("div");
                    primitive.className = "vdl-tree-primitive";
                    primitive.textContent = formatPrimitive(value);
                    content.appendChild(primitive);
                }
            };

            toggleBtn.addEventListener("click", () => {
                viewMode = viewMode === "json" ? "tree" : "json";
                target.dataset.viewMode = viewMode;
                updateToggleLabel();
                renderView();
            });

            copyBtn.addEventListener("click", async () => {
                const payload = toJsonString(value);
                const success = await copyTextToClipboard(payload);
                if (success) {
                    const original = copyBtn.textContent;
                    copyBtn.textContent = "Copied";
                    setTimeout(() => { copyBtn.textContent = original; }, 1500);
                }
            });

            actions.appendChild(toggleBtn);
            actions.appendChild(copyBtn);
            toolbar.appendChild(actions);
            viewContainer.appendChild(toolbar);
            viewContainer.appendChild(content);

            target.appendChild(viewContainer);
            renderView();
        };

        const fmtRelative = (ts) => {
            if (!ts) return "";
            let value = ts;
            if (typeof value !== "number") {
                const parsed = new Date(ts).getTime();
                value = Number.isFinite(parsed) ? parsed : Number(ts);
            }
            if (!Number.isFinite(value)) return "";
            const delta = Date.now() - value;
            if (!Number.isFinite(delta) || delta < 0) return "";
            if (delta < 1000) return "<1s ago";
            if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
            if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
            if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
            return `${Math.round(delta / 86_400_000)}d ago`;
        };

        const fmtAbsolute = (ts) => {
            if (!ts) return "";
            try {
                const d = new Date(ts);
                if (!Number.isNaN(d.getTime())) return d.toLocaleString();
            } catch { /* ignore */ }
            return String(ts);
        };

        const renderMiniSummary = () => {
            if (!mini) return;
            const snap = store.snapshot;
            const collections = snap && snap.collections ? Object.keys(snap.collections).length : 0;
            const typeCount = snap && snap.types ? Object.keys(snap.types).length : 0;
            const inflightCollections = snap && Array.isArray(snap.inFlight && snap.inFlight.collections)
                ? snap.inFlight.collections.length
                : 0;
            const inflightItems = snap && Array.isArray(snap.inFlight && snap.inFlight.items)
                ? snap.inFlight.items.length
                : 0;
            const inflightTotal = inflightCollections + inflightItems;
            const queues = snap && snap.bulk && snap.bulk.queues && typeof snap.bulk.queues === "object"
                ? snap.bulk.queues
                : {};
            let queueCount = 0;
            let queueSize = 0;
            if (queues && typeof queues === "object") {
                for (const info of Object.values(queues)) {
                    queueCount += 1;
                    if (info && typeof info.size === "number" && Number.isFinite(info.size)) {
                        queueSize += info.size;
                    }
                }
            }

            const setMiniValue = (name, value, options = {}) => {
                const node = mini.querySelector(`[data-mini="${name}"]`);
                if (!node) return;
                node.textContent = value;
                if (options.title != null) {
                    if (options.title) {
                        node.setAttribute("title", options.title);
                    } else {
                        node.removeAttribute("title");
                    }
                }
                if (typeof options.hot === "boolean") {
                    node.classList.toggle("is-hot", options.hot);
                }
            };

            setMiniValue("collections", collections.toLocaleString());
            setMiniValue("types", typeCount.toLocaleString());
            setMiniValue(
                "inflight",
                inflightTotal.toLocaleString(),
                {
                    title: `Collections ${inflightCollections} • Items ${inflightItems}`,
                    hot: inflightTotal > 0,
                }
            );
            setMiniValue(
                "queues",
                queueSize.toLocaleString(),
                {
                    title: queueCount
                        ? `${queueCount} ${queueCount === 1 ? "queue" : "queues"} • ${queueSize} pending`
                        : "No bulk work queued",
                    hot: queueSize > 0,
                }
            );

            const sseNode = mini.querySelector('[data-mini="sse"]');
            if (sseNode) {
                const label = sseNode.querySelector('.vdl-mini-sse-label');
                const dot = sseNode.querySelector('.vdl-mini-dot');
                const state = store.sseState;
                const connected = !!state.connected;
                if (label) label.textContent = connected ? 'Online' : 'Offline';
                if (dot) dot.classList.toggle('is-online', connected);
                const tooltip = [];
                if (state.audience) tooltip.push(`Audience ${state.audience}`);
                if (state.lastOpen) tooltip.push(`Opened ${fmtAbsolute(state.lastOpen)}`);
                if (state.lastMessage) tooltip.push(`Last message ${fmtAbsolute(state.lastMessage)}`);
                if (state.lastError) tooltip.push(`Last error ${fmtAbsolute(state.lastError)}`);
                if (state.lastRetryInMs != null) tooltip.push(`Retry ${state.lastRetryInMs}ms`);
                if (tooltip.length) {
                    sseNode.setAttribute('title', tooltip.join(' • '));
                } else {
                    sseNode.removeAttribute('title');
                }
            }

            const activityNode = mini.querySelector('[data-mini="activity"]');
            if (activityNode) {
                const latest = [
                    store.fetchEvents[0],
                    store.directiveEvents[0],
                    store.sseEvents[0],
                    store.memoryEvents[0],
                ].filter(Boolean).reduce((acc, entry) => {
                    const currentTime = entry && entry.timestamp ? new Date(entry.timestamp).getTime() : NaN;
                    if (!Number.isFinite(currentTime)) return acc;
                    if (!acc || currentTime > acc.time) {
                        return { time: currentTime, event: entry.event, raw: entry.timestamp };
                    }
                    return acc;
                }, null);
                if (latest) {
                    const relative = fmtRelative(latest.time);
                    activityNode.textContent = `${latest.event}${relative ? ` • ${relative}` : ""}`;
                    activityNode.setAttribute("title", fmtAbsolute(latest.raw));
                } else {
                    activityNode.textContent = "No activity yet";
                    activityNode.removeAttribute("title");
                }
            }
        };

        const renderTruthPanel = () => {
            const node = panelNodes.get("truth");
            if (!node) return;
            const snap = store.snapshot;
            node.innerHTML = "";
            if (!snap) {
                node.innerHTML = `<p class="vdl-empty">Snapshot unavailable.</p>`;
                return;
            }
            const collectionsSection = document.createElement("section");
            const collectionsHeader = document.createElement("h3");
            collectionsHeader.textContent = "Collections";
            collectionsSection.appendChild(collectionsHeader);

            const colEntries = Object.entries(snap.collections || {});
            if (!colEntries.length) {
                const empty = document.createElement("p");
                empty.className = "vdl-empty";
                empty.textContent = "No collections registered.";
                collectionsSection.appendChild(empty);
            } else {
                colEntries.forEach(([name, cfg]) => {
                    const details = document.createElement("details");
                    details.open = true;
                    const summary = document.createElement("summary");
                    const refCount = Object.keys(cfg.refs || {}).length;
                    summary.textContent = `${name} — ${refCount} refs (staleness ${cfg.stalenessMs ?? "∞"}ms)`;
                    details.appendChild(summary);

                    const treeHost = document.createElement("div");
                    treeHost.className = "vdl-tree-host";
                    if (refCount === 0) {
                        const empty = document.createElement("p");
                        empty.className = "vdl-empty";
                        empty.textContent = "No references tracked.";
                        details.appendChild(empty);
                    } else {
                        details.appendChild(treeHost);
                        renderTreeInto(treeHost, cfg.refs || {}, { collapseDepth: 2 });
                    }
                    collectionsSection.appendChild(details);
                });
            }

            const typesSection = document.createElement("section");
            const typesHeader = document.createElement("h3");
            typesHeader.textContent = "Types";
            typesSection.appendChild(typesHeader);

            const typeEntries = Object.entries(snap.types || {});
            if (!typeEntries.length) {
                const empty = document.createElement("p");
                empty.className = "vdl-empty";
                empty.textContent = "No types registered.";
                typesSection.appendChild(empty);
            } else {
                typeEntries.forEach(([name, cfg]) => {
                    const details = document.createElement("details");
                    const summary = document.createElement("summary");
                    const itemCount = Object.keys(cfg.items || {}).length;
                    summary.textContent = `${name} — ${itemCount} items${cfg.hasBulkFetch ? " • bulk" : ""}`;
                    details.appendChild(summary);

                    const meta = document.createElement("div");
                    meta.className = "vdl-type-meta";
                    meta.innerHTML = `<div>Levels: ${Object.keys(cfg.levels || {}).join(", ") || "default"}</div>`;
                    details.appendChild(meta);

                    if (!itemCount) {
                        const empty = document.createElement("p");
                        empty.className = "vdl-empty";
                        empty.textContent = "No items cached.";
                        details.appendChild(empty);
                    } else {
                        const treeHost = document.createElement("div");
                        treeHost.className = "vdl-tree-host";
                        details.appendChild(treeHost);
                        renderTreeInto(treeHost, cfg.items || {}, { collapseDepth: 2 });
                    }

                    typesSection.appendChild(details);
                });
            }

            node.appendChild(collectionsSection);
            node.appendChild(typesSection);
        };

        const renderFetchPanel = () => {
            const node = panelNodes.get("fetches");
            if (!node) return;
            const snap = store.snapshot;
            const inflightCols = snap && snap.inFlight ? snap.inFlight.collections : [];
            const inflightItems = snap && snap.inFlight ? snap.inFlight.items : [];
            const queues = snap && snap.bulk ? snap.bulk.queues : {};
            const lifecycleEvents = store.fetchEvents.slice(0, 40);
            node.innerHTML = `
                <section>
                    <h3>In-flight collections (${inflightCols ? inflightCols.length : 0})</h3>
                    <ul class="vdl-list">
                        ${(inflightCols || []).map(entry => `<li><code>${entry.key}</code> — pending: ${entry.pending}</li>`).join("") || '<li class="vdl-empty">None</li>'}
                    </ul>
                </section>
                <section>
                    <h3>In-flight items (${inflightItems ? inflightItems.length : 0})</h3>
                    <ul class="vdl-list">
                        ${(inflightItems || []).map(entry => `<li><code>${entry.key}</code> — pending: ${entry.pending} ${entry.loud ? "• loud" : ""}</li>`).join("") || '<li class="vdl-empty">None</li>'}
                    </ul>
                </section>
                <section>
                    <h3>Bulk queues</h3>
                    <ul class="vdl-list">
                        ${Object.entries(queues || {}).map(([key, info]) => `<li><code>${key}</code> — size: ${info.size}, timer: ${info.timerActive ? "waiting" : "idle"}</li>`).join("") || '<li class="vdl-empty">No bulk queues</li>'}
                    </ul>
                </section>
                <section>
                    <h3>Recent lifecycle events</h3>
                    <ul class="vdl-log">
                        ${lifecycleEvents.map((evt, index) => {
                            const meta = describeEvent(evt.event);
                            return `
                                <li class="vdl-log-entry" data-event-kind="${meta.kind}">
                                    <div class="vdl-log-entry-head">
                                        <span class="vdl-log-time">${fmtTime(evt.timestamp)}</span>
                                        ${renderEventBadge(evt.event, meta)}
                                    </div>
                                    <div class="vdl-tree-host" data-tree="fetch-event" data-index="${index}"></div>
                                </li>
                            `;
                        }).join("") || '<li class="vdl-empty">No events observed.</li>'}
                    </ul>
                </section>
            `;
            node.querySelectorAll('[data-tree="fetch-event"]').forEach((target, index) => {
                const entry = lifecycleEvents[index];
                renderTreeInto(target, entry ? entry.detail : null, { collapseDepth: 2, emptyLabel: "No detail payload." });
            });
        };

        const renderSsePanel = () => {
            const node = panelNodes.get("sse");
            if (!node) return;
            const snap = store.snapshot;
            const seq = snap && snap.sse ? snap.sse.seqByAudience : {};
            const state = store.sseState;
            const sseEvents = store.sseEvents.slice(0, 50);
            node.innerHTML = `
                <section>
                    <h3>Connection</h3>
                    <dl class="vdl-definition">
                        <div><dt>Connected</dt><dd>${state.connected}</dd></div>
                        <div><dt>Audience</dt><dd>${state.audience ?? (snap && snap.sse ? snap.sse.audience : "")}</dd></div>
                        <div><dt>Last open</dt><dd>${state.lastOpen ? fmtTime(state.lastOpen) : "—"}</dd></div>
                        <div><dt>Last message</dt><dd>${state.lastMessage ? fmtTime(state.lastMessage) : "—"}</dd></div>
                        <div><dt>Last error</dt><dd>${state.lastError ? fmtTime(state.lastError) : "—"}</dd></div>
                        <div><dt>Retry</dt><dd>${state.lastRetryInMs != null ? state.lastRetryInMs + ' ms' : '—'}</dd></div>
                    </dl>
                </section>
                <section>
                    <h3>Sequences</h3>
                    <div class="vdl-tree-host" data-tree="sse-seq"></div>
                </section>
                <section>
                    <h3>Event log</h3>
                    <ul class="vdl-log">
                        ${sseEvents.map((evt, index) => {
                            const meta = describeEvent(evt.event);
                            return `
                                <li class="vdl-log-entry" data-event-kind="${meta.kind}">
                                    <div class="vdl-log-entry-head">
                                        <span class="vdl-log-time">${fmtTime(evt.timestamp)}</span>
                                        ${renderEventBadge(evt.event, meta)}
                                    </div>
                                    <div class="vdl-tree-host" data-tree="sse-event" data-index="${index}"></div>
                                </li>
                            `;
                        }).join("") || '<li class="vdl-empty">No SSE events observed.</li>'}
                    </ul>
                </section>
            `;
            renderTreeInto(node.querySelector('[data-tree="sse-seq"]'), seq || {}, { collapseDepth: 1, emptyLabel: "No sequences recorded." });
            node.querySelectorAll('[data-tree="sse-event"]').forEach((target, index) => {
                const entry = sseEvents[index];
                renderTreeInto(target, entry ? entry.detail : null, { collapseDepth: 2, emptyLabel: "No detail payload." });
            });
        };

        const renderDirectivePanel = () => {
            const node = panelNodes.get("directives");
            if (!node) return;
            const directiveEvents = store.directiveEvents.slice(0, 60);
            node.innerHTML = `
                <section>
                    <h3>Directive stream</h3>
                    <ul class="vdl-log vdl-directive-log">
                        ${directiveEvents.map((evt, index) => {
                            const action = evt.event === "directive:processed" ? `<button type="button" class="vdl-btn vdl-btn-secondary" data-replay="${index}">Replay</button>` : "";
                            const meta = describeEvent(evt.event);
                            return `
                                <li class="vdl-log-entry" data-event-kind="${meta.kind}">
                                    <div class="vdl-log-entry-head vdl-directive-head">
                                        <div class="vdl-log-meta">
                                            <span class="vdl-log-time">${fmtTime(evt.timestamp)}</span>
                                            ${renderEventBadge(evt.event, meta)}
                                        </div>
                                        ${action ? `<div class="vdl-log-actions">${action}</div>` : ""}
                                     </div>
                                    <div class="vdl-tree-host" data-tree="directive" data-index="${index}"></div>
                                </li>
                            `;
                        }).join("") || '<li class="vdl-empty">No directives yet.</li>'}
                    </ul>
                </section>
            `;
            node.querySelectorAll('[data-tree="directive"]').forEach((target, index) => {
                const entry = directiveEvents[index];
                renderTreeInto(target, entry ? entry.detail : null, { collapseDepth: 2, emptyLabel: "No detail payload." });
            });
        };

        const renderMemoryPanel = () => {
            const node = panelNodes.get("memory");
            if (!node) return;
            const snap = store.snapshot;
            const memoryEvents = store.memoryEvents.slice(0, 40);
            node.innerHTML = `
                <section>
                    <h3>Configuration</h3>
                    <div class="vdl-tree-host" data-tree="memory-config"></div>
                </section>
                <section>
                    <h3>Lifecycle</h3>
                    <ul class="vdl-log">
                        ${memoryEvents.map((evt, index) => {
                            const meta = describeEvent(evt.event);
                            return `
                                <li class="vdl-log-entry" data-event-kind="${meta.kind}">
                                    <div class="vdl-log-entry-head">
                                        <span class="vdl-log-time">${fmtTime(evt.timestamp)}</span>
                                        ${renderEventBadge(evt.event, meta)}
                                    </div>
                                    <div class="vdl-tree-host" data-tree="memory-event" data-index="${index}"></div>
                                </li>
                            `;
                        }).join("") || '<li class="vdl-empty">No memory sweeps recorded.</li>'}
                    </ul>
                </section>
            `;
            renderTreeInto(node.querySelector('[data-tree="memory-config"]'), snap ? snap.memory : {}, { collapseDepth: 1, emptyLabel: "No memory configuration." });
            node.querySelectorAll('[data-tree="memory-event"]').forEach((target, index) => {
                const entry = memoryEvents[index];
                renderTreeInto(target, entry ? entry.detail : null, { collapseDepth: 2, emptyLabel: "No detail payload." });
            });
        };

        const renderLevelsPanel = () => {
            const node = panelNodes.get("levels");
            if (!node) return;
            const snap = store.snapshot;
            if (!snap) {
                node.innerHTML = `<p class="vdl-empty">Snapshot unavailable.</p>`;
                return;
            }
            const typeEntries = Object.entries(snap.types || {});
            node.innerHTML = `
                <section>
                    <h3>Level conversions</h3>
                    ${typeEntries.length ? "" : '<p class="vdl-empty">No types registered.</p>'}
                    ${typeEntries.map(([name]) => {
                        return `
                            <details>
                                <summary>${name}</summary>
                                <div class="vdl-graph">
                                    <div>
                                        <h4>convertFrom</h4>
                                        <div class="vdl-tree-host" data-tree="level-convert"></div>
                                    </div>
                                    <div>
                                        <h4>levelAccepts</h4>
                                        <div class="vdl-tree-host" data-tree="level-accepts"></div>
                                    </div>
                                </div>
                            </details>
                        `;
                    }).join("")}
                </section>
            `;
            node.querySelectorAll('[data-tree="level-convert"]').forEach((target, index) => {
                const entry = typeEntries[index];
                if (!entry) return;
                renderTreeInto(target, entry[1].convertFrom || {}, { collapseDepth: 1, emptyLabel: "No conversions registered." });
            });
            node.querySelectorAll('[data-tree="level-accepts"]').forEach((target, index) => {
                const entry = typeEntries[index];
                if (!entry) return;
                renderTreeInto(target, entry[1].levelAccepts || {}, { collapseDepth: 1, emptyLabel: "No acceptance rules." });
            });
        };

        const renderActivePanel = () => {
            for (const [id, node] of panelNodes.entries()) {
                node.classList.toggle("is-active", id === store.activePanel);
            }
            switch (store.activePanel) {
                case "truth":
                    renderTruthPanel();
                    break;
                case "fetches":
                    renderFetchPanel();
                    break;
                case "sse":
                    renderSsePanel();
                    break;
                case "directives":
                    renderDirectivePanel();
                    break;
                case "memory":
                    renderMemoryPanel();
                    break;
                case "levels":
                    renderLevelsPanel();
                    break;
                default:
                    break;
            }
            renderMiniSummary();
        };

        const updateSnapshot = () => {
            let snapshot;
            try {
                snapshot = adapter.devtools();
                store.snapshot = snapshot;
            } catch (err) {
                console.warn("Failed to collect diagnostics", err);
            }
            if (snapshot && snapshot.sse && typeof snapshot.sse === "object") {
                const sse = snapshot.sse;
                const state = store.sseState;
                const applyIfPresent = (key, transform) => {
                    if (Object.prototype.hasOwnProperty.call(sse, key)) {
                        state[key] = transform ? transform(sse[key]) : sse[key];
                    }
                };
                applyIfPresent("connected", (value) => !!value);
                applyIfPresent("audience");
                applyIfPresent("lastOpen");
                applyIfPresent("lastMessage");
                applyIfPresent("lastError");
                applyIfPresent("lastRetryInMs");
            }
            scheduleRender();
        };

        const handleLifecycle = (payload) => {
            if (!payload || !payload.event) return;
            const entry = { event: payload.event, detail: clone(payload.detail || {}), timestamp: payload.timestamp };
            const e = payload.event;
            if (e.startsWith("collection:fetch") || e.startsWith("item:fetch") || e.startsWith("bulk:")) {
                pushEvent(store.fetchEvents, entry);
            }
            if (e.startsWith("memory:")) {
                pushEvent(store.memoryEvents, entry);
            }
            if (e.startsWith("sse:")) {
                pushEvent(store.sseEvents, entry);
                if (e === "sse:open") {
                    store.sseState.connected = true;
                    store.sseState.lastOpen = payload.timestamp;
                    store.sseState.audience = payload.detail ? payload.detail.audience : store.sseState.audience;
                } else if (e === "sse:disconnect") {
                    store.sseState.connected = false;
                } else if (e === "sse:error") {
                    store.sseState.lastError = payload.timestamp;
                    store.sseState.lastRetryInMs = payload.detail ? payload.detail.retryInMs : null;
                } else if (e === "sse:message") {
                    store.sseState.lastMessage = payload.timestamp;
                }
            }
            if (e.startsWith("directive:")) {
                pushEvent(store.directiveEvents, entry);
            }
            if (
                e.startsWith("directive:") ||
                e.startsWith("collection:fetch") ||
                e.startsWith("item:fetch") ||
                e.startsWith("bulk:")
            ) {
                queueSnapshotRefresh();
            } else {
                scheduleRender();
            }
        };

        const replayDirective = (index) => {
            const evt = store.directiveEvents[index];
            if (!evt || evt.event !== "directive:processed") return;
            const detail = evt.detail || {};
            const directive = detail.directive;
            if (!directive) return;
            const payload = Array.isArray(directive) ? directive : [directive];
            try {
                const safePayload = clone(payload);
                if (Array.isArray(safePayload)) {
                    adapter.applyDirectives(safePayload, { disableIdempotencyGuard: true });
                }
            } catch (err) {
                console.warn("Failed to replay directive", err);
            }
        };

        header.addEventListener("click", (event) => {
            const target = event.target instanceof HTMLElement
                ? event.target.closest("[data-action]")
                : null;
            if (!(target instanceof HTMLElement)) return;
            const action = target.getAttribute("data-action");
            if (!action) return;
            if (action === "detach") {
                event.preventDefault();
                if (layout.detached) {
                    dock();
                } else {
                    detach();
                }
            } else if (action === "minimize") {
                event.preventDefault();
                setMinimized(true);
            } else if (action === "toggle") {
                event.preventDefault();
                setHidden(!layout.hidden);
            }
        });

        nav.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const panel = target.getAttribute("data-panel");
            if (!panel) return;
            store.activePanel = panel;
            renderActivePanel();
            for (const btn of nav.querySelectorAll(".vdl-tab")) {
                btn.classList.toggle("is-active", btn.getAttribute("data-panel") === panel);
            }
        });

        content.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const replayIndex = target.getAttribute("data-replay");
            if (replayIndex != null) {
                replayDirective(Number(replayIndex));
            }
        });

        document.body.appendChild(container);
        document.body.appendChild(mini);
        applyLayout();

        const lifecycleUnsubscribe = adapter.onLifecycle ? adapter.onLifecycle("*", handleLifecycle) : () => {};
        const changeUnsubscribe = adapter.onChange ? adapter.onChange(updateSnapshot) : () => {};
        updateSnapshot();

        panels.forEach(panel => {
            const btn = nav.querySelector(`.vdl-tab[data-panel="${panel.id}"]`);
            if (btn) {
                btn.classList.toggle("is-active", panel.id === store.activePanel);
            }
        });
        renderActivePanel();

        window.__VERITY_DL_DEVTOOLS__ = {
            show() {
                setHidden(false);
                setMinimized(false);
                applyLayout();
                if (layout.detached && detachedWindow && !detachedWindow.closed) {
                    try { detachedWindow.focus(); } catch { }
                }
            },
            hide() {
                setHidden(true);
            },
            destroy() {
                try { lifecycleUnsubscribe(); } catch { }
                try { changeUnsubscribe(); } catch { }
                window.removeEventListener("resize", handleResize);
                if (layout.detached) {
                    dock();
                }
                if (mini) {
                    mini.remove();
                }
                container.remove();
                delete window.__VERITY_DL_DEVTOOLS__;
            },
        };
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();

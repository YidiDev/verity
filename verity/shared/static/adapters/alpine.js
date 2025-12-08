;(function (global) {
"use strict";

const root = global || (typeof globalThis !== "undefined" ? globalThis : this);

// Try to get DLCore from ES module exports first, then fall back to global
let DLCore;
if (typeof module !== "undefined" && typeof require !== "undefined") {
    try {
        // Try to require core if in CommonJS/Node environment
        DLCore = require("../lib/core.js");
    } catch (e) {
        // Fall back to global
        DLCore = root && root.DLCore;
    }
} else {
    DLCore = root && root.DLCore;
}

if (!DLCore) {
    throw new Error("DLCore must be loaded before the Alpine adapter");
}

const {
    init: coreInit,
    onChange: coreOnChange,
    fetchCollection,
    fetchItem,
    applyDirectives,
    state: coreState,
} = DLCore;

const DEFAULT_STORE_NAME = "lib";
let storeName = DEFAULT_STORE_NAME;
let alpineReady = false;

function resolveWindow() {
    if (typeof window === "undefined") return undefined;
    return window;
}

function ensureAlpineStore(name = storeName) {
    const nextName = typeof name === "string" && name.trim() ? name.trim() : storeName;
    if (nextName !== storeName) {
        storeName = nextName;
        alpineReady = false;
    }

    const win = resolveWindow();
    if (!win || !win.Alpine) return null;
    const Alpine = win.Alpine;
    if (!alpineReady) {
        Alpine.store(storeName, {
            _tick: 0,
            col(collectionName, opts = {}) {
                void this._tick;
                return fetchCollection(collectionName, opts);
            },
            it(typeName, id, level = null, opts = {}) {
                void this._tick;
                return fetchItem(typeName, id, level, opts);
            },
            apply(directives) {
                return applyDirectives(directives);
            },
            state() {
                return coreState();
            },
        });
        alpineReady = true;
    }
    return Alpine.store(storeName);
}

coreOnChange(() => {
    const win = resolveWindow();
    if (!win || !win.Alpine) return;
    const store = ensureAlpineStore();
    if (store && typeof store._tick === "number") {
        store._tick = (store._tick + 1) % 1e9;
    }
});

if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("alpine:init", () => { ensureAlpineStore(); });
}

function init(options = {}) {
    const { alpineStoreName, ...rest } = options || {};
    if (typeof alpineStoreName === "string" && alpineStoreName.trim()) {
        storeName = alpineStoreName.trim();
        alpineReady = false;
    }
    if (resolveWindow()?.Alpine) {
        ensureAlpineStore();
    }
    return coreInit(rest);
}

const AlpineAdapter = {
    ...DLCore,
    init,
    ensureAlpineStore,
};

// ES MODULE EXPORTS (for modern bundlers and ES imports)
if (typeof exports !== "undefined") {
    // Export all DLCore functions
    Object.keys(DLCore).forEach(key => {
        if (key !== 'init') {
            exports[key] = DLCore[key];
        }
    });
    // Export adapter-specific functions
    exports.init = init;
    exports.ensureAlpineStore = ensureAlpineStore;
}

// UMD/Browser compatibility (for script tag loading)
if (root) {
    root.DLAdapters = root.DLAdapters || {};
    const adapters = root.DLAdapters;
    adapters.alpine = AlpineAdapter;
    if (typeof adapters.default === "undefined") {
        adapters.default = "alpine";
    }
    if (!root.DL) {
        root.DL = AlpineAdapter;
    }
}

// CommonJS default export (for backward compatibility)
if (typeof module !== "undefined" && module.exports) {
    module.exports = AlpineAdapter;
}

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

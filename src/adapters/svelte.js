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
    throw new Error("DLCore must be loaded before the Svelte adapter");
}

const {
    init: coreInit,
    onChange: coreOnChange,
    fetchCollection,
    fetchItem,
    applyDirectives,
    state: coreState,
} = DLCore;

const noop = () => {};

function createStore(initialValue, start) {
    let value = initialValue;
    let stop = noop;
    const subscribers = new Set();
    let started = false;

    function set(nextValue) {
        value = nextValue;
        if (!subscribers.size) return;
        const runs = [];
        for (const subscriber of subscribers) {
            const invalidate = subscriber[1];
            if (typeof invalidate === "function") {
                try { invalidate(); }
                catch { /* ignore subscriber errors */ }
            }
            runs.push(subscriber[0]);
        }
        for (const run of runs) {
            try { run(value); }
            catch { /* ignore subscriber errors */ }
        }
    }

    function cleanup() {
        if (typeof stop === "function" && stop !== noop) {
            try { stop(); }
            catch { /* ignore cleanup errors */ }
        }
        stop = noop;
        started = false;
    }

    return {
        subscribe(run, invalidate = noop) {
            if (typeof run !== "function") return noop;
            const subscriber = [run, invalidate];
            subscribers.add(subscriber);
            if (!started) {
                started = true;
                try {
                    const teardown = typeof start === "function" ? start(set) : null;
                    stop = typeof teardown === "function" ? teardown : noop;
                } catch (err) {
                    subscribers.delete(subscriber);
                    started = false;
                    stop = noop;
                    throw err;
                }
            }
            if (value !== undefined) {
                try { run(value); }
                catch { /* ignore subscriber errors */ }
            }
            return () => {
                subscribers.delete(subscriber);
                if (!subscribers.size) {
                    cleanup();
                }
            };
        },
    };
}

function collectionStore(name, opts = {}) {
    if (!name) throw new Error("collectionStore requires a collection name");
    let ref;
    return createStore(undefined, (set) => {
        ref = fetchCollection(name, opts);
        set(ref);
        const unsubscribe = coreOnChange(() => {
            set(ref);
        });
        return () => {
            if (typeof unsubscribe === "function") {
                unsubscribe();
            }
        };
    });
}

function itemStore(typeName, id, level = null, opts = {}) {
    if (!typeName) throw new Error("itemStore requires a type name");
    if (id === undefined || id === null) throw new Error("itemStore requires an id");
    let ref;
    return createStore(undefined, (set) => {
        ref = fetchItem(typeName, id, level, opts);
        set(ref);
        const unsubscribe = coreOnChange(() => {
            set(ref);
        });
        return () => {
            if (typeof unsubscribe === "function") {
                unsubscribe();
            }
        };
    });
}

function stateStore(selector = null) {
    const select = typeof selector === "function"
        ? (snapshot) => selector(snapshot) : (snapshot) => snapshot;
    return createStore(undefined, (set) => {
        const emit = () => {
            const snapshot = coreState();
            set(select(snapshot));
        };
        emit();
        const unsubscribe = coreOnChange(emit);
        return () => {
            if (typeof unsubscribe === "function") {
                unsubscribe();
            }
        };
    });
}

function manualStore(readValue) {
    if (typeof readValue !== "function") {
        throw new Error("manualStore requires a function that returns the next value");
    }
    return createStore(undefined, (set) => {
        const emit = () => {
            set(readValue());
        };
        emit();
        const unsubscribe = coreOnChange(emit);
        return () => {
            if (typeof unsubscribe === "function") {
                unsubscribe();
            }
        };
    });
}

function init(options = {}) {
    return coreInit(options || {});
}

const SvelteAdapter = {
    ...DLCore,
    init,
    collectionStore,
    itemStore,
    stateStore,
    manualStore,
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
    exports.collectionStore = collectionStore;
    exports.itemStore = itemStore;
    exports.stateStore = stateStore;
    exports.manualStore = manualStore;
}

// UMD/Browser compatibility (for script tag loading)
if (root) {
    root.DLAdapters = root.DLAdapters || {};
    const adapters = root.DLAdapters;
    adapters.svelte = SvelteAdapter;
    if (typeof adapters.default === "undefined") {
        adapters.default = "svelte";
    }
    if (!root.DL) {
        root.DL = SvelteAdapter;
    }
}

// CommonJS default export (for backward compatibility)
if (typeof module !== "undefined" && module.exports) {
    module.exports = SvelteAdapter;
}

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

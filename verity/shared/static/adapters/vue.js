;(function (global) {
"use strict";

const root = global || (typeof globalThis !== "undefined" ? globalThis : this);
const DLCore = root && root.DLCore;
if (!DLCore) {
    throw new Error("DLCore must be loaded before the Vue adapter");
}

const {
    init: coreInit,
    onChange: coreOnChange,
    fetchCollection,
    fetchItem,
    applyDirectives,
    state: coreState,
} = DLCore;

const DEFAULT_STORE_KEY = "dl";
const DEFAULT_INJECT_KEY = "dl";
const DEFAULT_GLOBAL_PROPERTY = "$dl";

let defaultStoreKey = DEFAULT_STORE_KEY;
let defaultInjectKey = DEFAULT_INJECT_KEY;
let defaultGlobalProperty = DEFAULT_GLOBAL_PROPERTY;

const stores = new Map();

function resolveVue() {
    if (typeof window !== "undefined" && window.Vue) {
        return window.Vue;
    }
    if (root && root.Vue) {
        return root.Vue;
    }
    return null;
}

function normalizeStoreKey(key, fallback) {
    if (typeof key === "string" && key.trim()) {
        return key.trim();
    }
    return fallback;
}

function normalizeInjectKey(key, fallback) {
    if (typeof key === "symbol") {
        return key;
    }
    if (typeof key === "string" && key.trim()) {
        return key.trim();
    }
    return fallback;
}

function normalizeGlobalProperty(value, fallback) {
    if (value === null) {
        return null;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
            return trimmed;
        }
        return fallback;
    }
    return fallback;
}

function createVueStore(Vue) {
    if (!Vue || typeof Vue.reactive !== "function") {
        return null;
    }

    const store = Vue.reactive({
        _tick: 0,
        _state: coreState(),
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
            void this._tick;
            return this._state;
        },
    });

    return store;
}

function ensureVueStore(name = defaultStoreKey) {
    const key = normalizeStoreKey(name, defaultStoreKey);
    if (stores.has(key)) {
        return stores.get(key);
    }
    const Vue = resolveVue();
    const store = createVueStore(Vue);
    if (!store) {
        return null;
    }
    stores.set(key, store);
    return store;
}

coreOnChange(() => {
    if (!stores.size) return;
    const nextState = coreState();
    for (const store of stores.values()) {
        if (!store || typeof store !== "object") continue;
        if (typeof store._tick === "number") {
            store._tick = (store._tick + 1) % 1e9;
        } else {
            store._tick = 1;
        }
        store._state = nextState;
    }
});

function init(options = {}) {
    const {
        vueStoreKey,
        vueProvideKey,
        vueGlobalProperty,
        ...rest
    } = options || {};

    if (typeof vueStoreKey !== "undefined") {
        defaultStoreKey = normalizeStoreKey(vueStoreKey, defaultStoreKey);
    }
    if (typeof vueProvideKey !== "undefined") {
        defaultInjectKey = normalizeInjectKey(vueProvideKey, defaultInjectKey);
    }
    if (typeof vueGlobalProperty !== "undefined") {
        defaultGlobalProperty = normalizeGlobalProperty(vueGlobalProperty, defaultGlobalProperty);
    }

    if (resolveVue()) {
        ensureVueStore(defaultStoreKey);
    }

    return coreInit(rest);
}

function install(app, options = {}) {
    if (!app || typeof app !== "object") {
        throw new Error("A Vue app instance is required to install the DL Vue adapter");
    }
    const {
        storeKey,
        provideKey,
        globalProperty,
    } = options || {};

    const normalizedStoreKey = normalizeStoreKey(storeKey, defaultStoreKey);
    const injectionKey = typeof provideKey !== "undefined"
        ? normalizeInjectKey(provideKey, defaultInjectKey)
        : defaultInjectKey;
    const globalKey = typeof globalProperty !== "undefined"
        ? normalizeGlobalProperty(globalProperty, defaultGlobalProperty)
        : defaultGlobalProperty;

    const store = ensureVueStore(normalizedStoreKey);
    if (!store) {
        throw new Error("Vue must be available before installing the DL Vue adapter");
    }

    if (typeof app.provide === "function") {
        app.provide(injectionKey, store);
    }

    if (globalKey && app.config && app.config.globalProperties) {
        app.config.globalProperties[globalKey] = store;
    }

    return store;
}

function useDL(options = {}) {
    const opts = options || {};
    const storeKey = normalizeStoreKey(opts.storeKey, defaultStoreKey);
    const injectionKey = typeof opts.injectKey !== "undefined"
        ? normalizeInjectKey(opts.injectKey, defaultInjectKey)
        : defaultInjectKey;

    const Vue = resolveVue();
    const fallbackStore = ensureVueStore(storeKey);
    if (!Vue) {
        return fallbackStore;
    }

    const { inject } = Vue;
    if (typeof inject === "function") {
        return inject(injectionKey, fallbackStore);
    }

    return fallbackStore;
}

const VueAdapter = {
    ...DLCore,
    init,
    ensureVueStore,
    install,
    useDL,
};

if (root) {
    root.DLAdapters = root.DLAdapters || {};
    const adapters = root.DLAdapters;
    adapters.vue = VueAdapter;
    if (typeof adapters.default === "undefined") {
        adapters.default = "vue";
    }
    if (!root.DL) {
        root.DL = VueAdapter;
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = VueAdapter;
}

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

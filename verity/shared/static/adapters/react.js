;(function (global) {
"use strict";

const root = global || (typeof globalThis !== "undefined" ? globalThis : this);
const DLCore = root && root.DLCore;
if (!DLCore) {
    throw new Error("DLCore must be loaded before the React adapter");
}

const {
    init: coreInit,
    onChange: coreOnChange,
    fetchCollection,
    fetchItem,
    state: coreState,
    ...restCore
} = DLCore;

const PARAM_DEFAULT_KEY = "__default__";

function resolveReact() {
    if (root && root.React) return root.React;
    if (typeof globalThis !== "undefined" && globalThis.React) return globalThis.React;
    try {
        if (typeof require === "function") {
            const React = require("react");
            if (React) return React;
        }
    } catch { /* ignore inability to require React in the browser */ }
    return null;
}

function ensureReact() {
    const React = resolveReact();
    if (!React) {
        throw new Error("React must be available before using the VerityDL React adapter");
    }
    if (typeof React.useSyncExternalStore !== "function") {
        throw new Error("React 18+ with useSyncExternalStore is required for the VerityDL React adapter");
    }
    return React;
}

function isPlainObject(value) {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function normalizeForKey(value) {
    if (value === null) return null;
    if (Array.isArray(value)) return value.map(normalizeForKey);
    if (isPlainObject(value)) {
        const normalized = {};
        for (const key of Object.keys(value).sort()) {
            normalized[key] = normalizeForKey(value[key]);
        }
        return normalized;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
        return String(value);
    }
    return value;
}

function paramsKey(params) {
    if (params === undefined || params === null) return PARAM_DEFAULT_KEY;
    if (isPlainObject(params) && Object.keys(params).length === 0) return PARAM_DEFAULT_KEY;
    try {
        return JSON.stringify(normalizeForKey(params));
    } catch {
        return PARAM_DEFAULT_KEY;
    }
}

function normalizeCollectionOptions(options) {
    if (!options || typeof options !== "object") return {};
    const normalized = {};
    if (Object.prototype.hasOwnProperty.call(options, "params")) {
        normalized.params = options.params;
    }
    if (Object.prototype.hasOwnProperty.call(options, "force")) {
        normalized.force = !!options.force;
    }
    return normalized;
}

function normalizeItemOptions(options) {
    if (!options || typeof options !== "object") return {};
    const normalized = {};
    if (Object.prototype.hasOwnProperty.call(options, "silent")) {
        normalized.silent = !!options.silent;
    }
    if (Object.prototype.hasOwnProperty.call(options, "force")) {
        normalized.force = !!options.force;
    }
    return normalized;
}

function buildCollectionSignature(name, options) {
    const opts = options && typeof options === "object" ? options : {};
    const params = paramsKey(opts.params);
    const force = opts.force ? "1" : "0";
    return `${String(name)}|${params}|force:${force}`;
}

function buildItemSignature(typeName, id, level, options) {
    const opts = options && typeof options === "object" ? options : {};
    const force = opts.force ? "1" : "0";
    const silent = opts.silent ? "1" : "0";
    const levelLabel = level == null ? "default" : String(level);
    return `${String(typeName)}|${String(id)}|${levelLabel}|force:${force}|silent:${silent}`;
}

function subscribe(listener) {
    return coreOnChange(listener);
}

function init(options = {}) {
    return coreInit(options);
}

function useCollection(name, options = {}) {
    const React = ensureReact();
    const { useRef, useEffect, useMemo, useSyncExternalStore } = React;

    const signature = buildCollectionSignature(name, options);
    const normalizedOptions = useMemo(() => normalizeCollectionOptions(options), [signature]);
    const holderRef = useRef({ key: null, ref: null });

    const getSnapshot = useMemo(() => {
        return () => {
            if (!holderRef.current.ref || holderRef.current.key !== signature) {
                holderRef.current = {
                    key: signature,
                    ref: fetchCollection(name, normalizedOptions),
                };
            }
            return holderRef.current.ref;
        };
    }, [signature, name, normalizedOptions]);

    useEffect(() => {
        const current = holderRef.current;
        if (!current.ref || current.key !== signature) {
            holderRef.current = {
                key: signature,
                ref: fetchCollection(name, normalizedOptions),
            };
        }
    }, [signature, name, normalizedOptions]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useItem(typeName, id, level = null, options = {}) {
    const React = ensureReact();
    const { useRef, useEffect, useMemo, useSyncExternalStore } = React;

    const signature = buildItemSignature(typeName, id, level, options);
    const normalizedOptions = useMemo(() => normalizeItemOptions(options), [signature]);
    const holderRef = useRef({ key: null, ref: null });
    const levelArg = level == null ? null : level;

    const getSnapshot = useMemo(() => {
        return () => {
            if (!holderRef.current.ref || holderRef.current.key !== signature) {
                holderRef.current = {
                    key: signature,
                    ref: fetchItem(typeName, id, levelArg, normalizedOptions),
                };
            }
            return holderRef.current.ref;
        };
    }, [signature, typeName, id, levelArg, normalizedOptions]);

    useEffect(() => {
        const current = holderRef.current;
        if (!current.ref || current.key !== signature) {
            holderRef.current = {
                key: signature,
                ref: fetchItem(typeName, id, levelArg, normalizedOptions),
            };
        }
    }, [signature, typeName, id, levelArg, normalizedOptions]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useDLState(selector) {
    const React = ensureReact();
    const { useCallback, useSyncExternalStore } = React;

    const getSnapshot = useCallback(() => {
        const snapshot = coreState();
        return typeof selector === "function" ? selector(snapshot) : snapshot;
    }, [selector]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const ReactAdapter = {
    ...restCore,
    state: coreState,
    init,
    subscribe,
    useCollection,
    useItem,
    useDLState,
};

if (root) {
    root.DLAdapters = root.DLAdapters || {};
    const adapters = root.DLAdapters;
    adapters.react = ReactAdapter;
    if (typeof adapters.default === "undefined") {
        adapters.default = "react";
    }
    if (!root.DL) {
        root.DL = ReactAdapter;
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = ReactAdapter;
}

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

// ---------------------------------------------------------------------------
// verity-dl devtools – Adapter resolution and asset URL helpers
// ---------------------------------------------------------------------------

import type { DLAdapter } from "./types.js";

/**
 * Resolves the DL adapter from `window.DL` or `window.DLAdapters`.
 * Returns `null` when no adapter is available.
 */
export function resolveAdapter(): DLAdapter | null {
  const globalAdapter: unknown = window.DL;
  if (
    globalAdapter &&
    (typeof globalAdapter === "object" || typeof globalAdapter === "function")
  ) {
    return globalAdapter as DLAdapter;
  }

  const adapters: unknown = window.DLAdapters;
  if (adapters && typeof adapters === "object") {
    const map = adapters as Record<string, unknown>;
    const defaultKey = map["default"];
    if (typeof defaultKey === "string" && map[defaultKey]) {
      return map[defaultKey] as DLAdapter;
    }
    const keys = Object.keys(map);
    for (const key of keys) {
      if (key === "default") continue;
      const candidate = map[key];
      if (
        candidate &&
        (typeof candidate === "object" || typeof candidate === "function")
      ) {
        return candidate as DLAdapter;
      }
    }
  }

  return null;
}

/**
 * Resolves a relative asset filename to a full URL based on the current
 * `<script>` tag's `src`, falling back to `/static/devtools/<name>`.
 */
export function resolveAssetUrl(assetName: string): string {
  if (!assetName) return "";

  const scriptEl: HTMLScriptElement | null =
    (document.currentScript as HTMLScriptElement | null) ??
    (() => {
      try {
        const scripts = Array.from(
          document.querySelectorAll<HTMLScriptElement>("script[src]"),
        );
        return (
          scripts.find((el) => el.src.includes("devtools/devtools")) ?? null
        );
      } catch {
        return null;
      }
    })();

  if (scriptEl?.src) {
    try {
      return new URL(assetName, scriptEl.src).toString();
    } catch {
      /* fall through */
    }
  }

  return "/static/devtools/" + assetName;
}

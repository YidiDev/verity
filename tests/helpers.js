/**
 * Test helpers for loading a fresh DLCore instance per test.
 *
 * Because core.js is an IIFE that mutates global state, we need to
 * re-execute it for each test to get a clean slate.  We do this by
 * reading the file as text and eval-ing it in a controlled scope.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { vi } from "vitest";

const CORE_PATH = resolve(__dirname, "../verity/shared/static/lib/core.js");
const coreSource = readFileSync(CORE_PATH, "utf-8");

/**
 * Returns a fresh DLCore instance with isolated global state.
 * Also stubs EventSource, URL, and window.location so SSE-related
 * code doesn't throw in Node/jsdom.
 */
export function freshCore() {
  // Use the real jsdom window so that window.location.origin etc. work.
  // We need a thin wrapper that isolates DLCore's global assignment but
  // still delegates property lookups (like location) to the real window.
  const realWindow = typeof window !== "undefined" ? window : globalThis;

  // Provide a minimal EventSource stub (disabled by default)
  // This prevents connectSse from actually creating an EventSource.
  const savedES = realWindow.EventSource;
  realWindow.EventSource = undefined;

  // Execute core.js via new Function so each call gets its own closure
  // (fresh G object, fresh CLIENT_ID, etc.)
  const fn = new Function(
    "module",
    "exports",
    coreSource + "\n return module.exports;"
  );

  const fakeModule = { exports: {} };
  const DLCore = fn(fakeModule, fakeModule.exports);

  // Restore EventSource on the real window
  realWindow.EventSource = savedES;

  return DLCore;
}

/**
 * Advances all pending timers and microtasks.
 * Useful for testing bulk fetch queue flushing.
 */
export async function flushTimersAndMicrotasks(ms = 100) {
  await vi.advanceTimersByTimeAsync(ms);
  // Let any resolved promises run
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * Creates a mock fetch function that resolves with the given data.
 */
export function mockFetch(data) {
  return vi.fn().mockResolvedValue(data);
}

/**
 * Creates a mock fetch function that rejects with the given error.
 */
export function mockFetchError(msg = "fetch failed") {
  return vi.fn().mockRejectedValue(new Error(msg));
}

/**
 * Waits for a short async tick (microtask flush).
 */
export function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

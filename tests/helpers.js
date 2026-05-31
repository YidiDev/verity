/**
 * Test helpers for loading a fresh DLCore instance per test.
 *
 * The UMD build wraps all state in a closure, so re-executing it via
 * `new Function` gives us a fully isolated DLCore per call -- fresh
 * global state, fresh CLIENT_ID, no cross-test contamination.
 *
 * IMPORTANT: `yarn build` must run before `yarn test` so that
 * dist/core.umd.js exists.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { vi } from "vitest";

const CORE_PATH = resolve(__dirname, "../dist/core.umd.js");
const coreSource = readFileSync(CORE_PATH, "utf-8");

/**
 * Returns a fresh DLCore instance with isolated global state.
 * Temporarily disables EventSource to prevent SSE connections in tests.
 */
export function freshCore() {
  const realWindow = typeof window !== "undefined" ? window : globalThis;

  // Disable EventSource so connectSse() is a no-op in tests.
  const savedES = realWindow.EventSource;
  realWindow.EventSource = undefined;

  // Execute the UMD bundle via new Function so each call gets its own
  // closure (fresh G object, fresh CLIENT_ID, etc.)
  const fn = new Function(
    "module",
    "exports",
    coreSource + "\n return module.exports;"
  );

  const fakeModule = { exports: {} };
  const DLCore = fn(fakeModule, fakeModule.exports);

  // Restore EventSource
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

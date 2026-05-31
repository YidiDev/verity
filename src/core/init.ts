// ---------------------------------------------------------------------------
// verity-dl  –  Initialization entry point
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import { configureDirectiveSource, connectDirectiveSource } from "./directive-source.js";
import { configureSse, connectSse, disconnectSse } from "./sse.js";
import { configureMemory, scheduleMemorySweep } from "./memory.js";
import type { InitOptions } from "./types.js";

/**
 * Initialises the data layer.
 *
 * Configures the directive source (SSE by default), memory management,
 * and optionally auto-connects the directive source.
 */
export function init(options: InitOptions = {}): void {
  if (
    options &&
    Object.prototype.hasOwnProperty.call(options, "directiveSource")
  ) {
    configureDirectiveSource(options.directiveSource);
  } else if (options && typeof options.sse === "object") {
    configureSse(options.sse);
  }

  if (options && typeof options.memory === "object") {
    configureMemory(options.memory);
  }

  scheduleMemorySweep({ immediate: true });

  const src = G.directiveSource;
  if (src && src.enabled !== false && src.connectOnInit !== false) {
    connectDirectiveSource();
  }
}

// Bootstrap the default directive source.
// This mirrors the original IIFE's inline setup at lines 84-90 of core.js.
G.directiveSource = {
  kind: "sse",
  enabled: true,
  connectOnInit: true,
  connect: (opts = {}) => connectSse(opts as { force?: boolean }),
  disconnect: () => disconnectSse(),
};

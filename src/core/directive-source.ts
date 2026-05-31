// ---------------------------------------------------------------------------
// verity-dl  –  Directive source abstraction
// ---------------------------------------------------------------------------

import { G } from "./state.js";
import { CLIENT_ID } from "./constants.js";
import { emitLifecycle } from "./lifecycle.js";
import { applyDirectives } from "./directives.js";
import {
  hasProcessedDirective,
  rememberDirectiveKey,
} from "./directive-idempotency.js";
import {
  connectSse,
  disconnectSse,
  configureSse,
  scheduleResync,
  handleSequenceGap,
} from "./sse.js";
import type {
  DirectiveSourceInput,
  DirectiveSourceHelpers,
  DirectiveEnvelope,
  CustomDirectiveSourceInput,
  DirectiveSourceDescriptor,
} from "./types.js";

// ---- Helpers bag for custom sources ---------------------------------------

function directiveSourceHelpers(): DirectiveSourceHelpers {
  return {
    clientId: CLIENT_ID,
    applyDirectives,
    ingest: ingestDirectiveEnvelope,
    hasProcessedDirective,
    rememberDirectiveKey,
    scheduleResync,
    state: () => ({
      types: G.types,
      collections: G.collections,
    }),
  };
}

// ---- Configure ------------------------------------------------------------

export function configureDirectiveSource(
  source: DirectiveSourceInput | null | false | undefined,
): void {
  if (source === undefined) return;

  const prev = G.directiveSource;
  if (prev) {
    disconnectDirectiveSource(prev);
  }

  if (source === null || source === false) {
    G.directiveSource = null;
    G.sse.enabled = false;
    disconnectSse();
    return;
  }

  if (source === "sse") {
    G.directiveSource = {
      kind: "sse",
      enabled: true,
      connectOnInit: G.sse.connectOnInit !== false,
      connect: (opts = {}) => connectSse(opts as { force?: boolean }),
      disconnect: () => disconnectSse(),
    };
    G.sse.enabled = true;
    return;
  }

  if (!source || typeof source !== "object") {
    G.directiveSource = {
      kind: "sse",
      enabled: G.sse.enabled,
      connectOnInit: G.sse.connectOnInit !== false,
      connect: (opts = {}) => connectSse(opts as { force?: boolean }),
      disconnect: () => disconnectSse(),
    };
    return;
  }

  // Custom source with connect function
  if (
    typeof (source as CustomDirectiveSourceInput).connect === "function"
  ) {
    const custom = source as CustomDirectiveSourceInput;
    const normalized = {
      kind: custom.name
        ? String(custom.name)
        : String(custom.type || "custom"),
      enabled: custom.enabled !== false,
      connectOnInit: custom.connectOnInit !== false,
      connect: (opts: Record<string, unknown> = {}): unknown => {
        if (normalized.enabled === false) return;
        try {
          return custom.connect({
            ...directiveSourceHelpers(),
            options: { ...opts },
          });
        } catch {
          return undefined;
        }
      },
      disconnect: (): void => {
        if (typeof custom.disconnect === "function") {
          try {
            custom.disconnect(directiveSourceHelpers());
          } catch {
            /* ignore disconnect errors */
          }
        }
      },
    } as {
      kind: string;
      enabled: boolean;
      connectOnInit: boolean;
      connect: (opts?: Record<string, unknown>) => unknown;
      disconnect: () => void;
      configure?: (
        cfg: unknown,
        helpers: DirectiveSourceHelpers,
      ) => unknown;
    };

    if (typeof custom.configure === "function") {
      normalized.configure = (cfg: unknown): unknown => {
        try {
          return custom.configure!(cfg, directiveSourceHelpers());
        } catch {
          return undefined;
        }
      };
    }

    G.directiveSource = normalized;
    return;
  }

  // SSE-type descriptor
  const desc = source as DirectiveSourceDescriptor;
  if (!desc.type || desc.type === "sse") {
    const enabled =
      typeof desc.enabled === "boolean" ? desc.enabled : G.sse.enabled;
    const connectOnInit =
      typeof desc.connectOnInit === "boolean"
        ? desc.connectOnInit
        : G.sse.connectOnInit !== false;

    G.sse.enabled = enabled;
    G.sse.connectOnInit = connectOnInit;

    const placeholder = {
      kind: "sse" as const,
      enabled,
      connectOnInit,
      connect: (opts: Record<string, unknown> = {}) =>
        connectSse(opts as { force?: boolean }),
      disconnect: () => disconnectSse(),
    };

    G.directiveSource = placeholder;

    if (typeof desc.options === "object" && desc.options) {
      configureSse(desc.options);
    } else if (typeof desc.sse === "object" && desc.sse) {
      configureSse(desc.sse);
    }

    placeholder.enabled = G.sse.enabled;
    placeholder.connectOnInit = G.sse.connectOnInit !== false;
    return;
  }

  // Fallback: default SSE source
  G.directiveSource = {
    kind: "sse",
    enabled: G.sse.enabled,
    connectOnInit: G.sse.connectOnInit !== false,
    connect: (opts = {}) => connectSse(opts as { force?: boolean }),
    disconnect: () => disconnectSse(),
  };
}

// ---- Connect / Disconnect -------------------------------------------------

export function connectDirectiveSource(
  options: Record<string, unknown> = {},
): unknown {
  const src = G.directiveSource;
  if (!src || src.enabled === false) return;

  if (typeof src.connect === "function") {
    try {
      return src.connect({ ...options });
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function disconnectDirectiveSource(
  source?: {
    kind: string;
    disconnect?: () => void;
  } | null,
): void {
  const src = source || G.directiveSource;
  if (!src) return;

  if (src.kind === "sse") {
    disconnectSse();
    return;
  }

  if (typeof src.disconnect === "function") {
    try {
      src.disconnect();
    } catch {
      /* ignore disconnect errors */
    }
  }
}

// ---- Ingest envelope ------------------------------------------------------

export function ingestDirectiveEnvelope(
  payload: DirectiveEnvelope | Record<string, unknown> | unknown,
): void {
  if (!payload || typeof payload !== "object") return;

  const obj = payload as DirectiveEnvelope;

  if (obj.type === "hello") {
    const audienceKey = obj.audience
      ? String(obj.audience)
      : "global";

    if (typeof obj.last_seq === "number") {
      const prev = G.sse.seqByAudience.get(audienceKey);
      if (
        Number.isFinite(prev) &&
        obj.last_seq > (prev as number)
      ) {
        handleSequenceGap(
          audienceKey,
          prev as number,
          obj.last_seq,
        );
      }
      G.sse.seqByAudience.set(audienceKey, obj.last_seq);
    }

    emitLifecycle("sse:hello", {
      audience: audienceKey,
      lastSeq: obj.last_seq,
    });
    return;
  }

  if (
    obj.type === "directives" &&
    Array.isArray(obj.directives)
  ) {
    if (obj.source && String(obj.source) === CLIENT_ID) return;

    const audienceKey = obj.audience
      ? String(obj.audience)
      : "global";

    if (typeof obj.seq === "number") {
      const prev = G.sse.seqByAudience.get(audienceKey);
      if (
        Number.isFinite(prev) &&
        obj.seq > (prev as number) + 1
      ) {
        handleSequenceGap(
          audienceKey,
          prev as number,
          obj.seq,
        );
      }
      const next =
        !Number.isFinite(prev) || obj.seq > (prev as number)
          ? obj.seq
          : (prev as number);
      G.sse.seqByAudience.set(audienceKey, next);
    }

    emitLifecycle("directive:received", {
      audience: audienceKey,
      count: obj.directives.length,
      seq: obj.seq,
      source: obj.source || null,
    });

    applyDirectives(obj.directives);
  }
}

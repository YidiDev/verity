// ---------------------------------------------------------------------------
// verity-dl  –  Cloning, freezing, and deep comparison utilities
// ---------------------------------------------------------------------------

// ---- Cloning --------------------------------------------------------------

/**
 * Deep-clones a params value. Uses structuredClone when available,
 * falls back to JSON round-trip.
 */
export function cloneParams<T>(value: T): T {
  if (value === undefined) return undefined as T;
  if (value === null) return null as T;

  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* ignore */
    }
  }

  if (typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * Deep-clones a value for diagnostic / devtools snapshots.
 * Same strategy as cloneParams.
 */
export function cloneForDiagnostics<T>(value: T): T {
  if (value === undefined) return undefined as T;
  if (value === null) return null as T;

  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* ignore */
    }
  }

  if (typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }

  return value;
}

// ---- Deep freeze ----------------------------------------------------------

/**
 * Recursively freezes an object and all nested objects/arrays.
 */
export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;

  Object.freeze(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
  } else {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }

  return value;
}

// ---- Deep comparison ------------------------------------------------------

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep equality check for params values.
 * Handles NaN, arrays, and plain objects.
 */
export function deepEqualParams(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (
    typeof a === "number" &&
    typeof b === "number" &&
    Number.isNaN(a) &&
    Number.isNaN(b)
  ) {
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualParams(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqualParams(a[key], b[key])) return false;
    }

    return true;
  }

  return false;
}

/**
 * Checks whether `haystack` contains all key-value pairs from `subset`.
 */
export function paramsContainsSubset(
  haystack: unknown,
  subset: unknown,
): boolean {
  if (!isPlainObject(subset) || !Object.keys(subset).length) {
    return deepEqualParams(haystack, subset);
  }

  if (!isPlainObject(haystack)) return false;

  for (const key of Object.keys(subset)) {
    if (!Object.prototype.hasOwnProperty.call(haystack, key)) return false;
    if (!deepEqualParams(haystack[key], subset[key])) return false;
  }

  return true;
}

/**
 * Tests whether a stored params snapshot matches a desired target.
 * With mode "contains", uses subset matching.
 */
export function matchesParamsSnapshot(
  snapshot: unknown,
  target: unknown,
  mode?: string,
): boolean {
  const actualSnapshot = snapshot ?? {};
  const desired = target ?? {};

  if (mode === "contains") {
    return paramsContainsSubset(actualSnapshot, desired);
  }

  return deepEqualParams(actualSnapshot, desired);
}

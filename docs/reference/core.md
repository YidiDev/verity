# Reference: Core Registry

The Verity core lives at `/shared/lib/core.js`. It exposes factories and helpers for managing the
registry.

## `createRegistry(options)`

Creates a registry instance.

### Options

- `bulk.delayMs` — throttle window (ms) before batch refetches run. Defaults to `50`.
- `memory.enabled` — enable in-memory caching. Default `true`.
- `memory.maxItemsPerType` — cap per-type cache size. Default `512`.
- `sse.url` — SSE endpoint. Default `/api/events`.
- `sse.audience` — default audience token. Default `"global"`.

Returns `{ registerType, registerCollection, collection, item, emit, onChange }`.

## `registerType(name, config)`

Registers a single-record cache.

- `fetch` (required) — `(params) => Promise<any>`.
- `check` — `(payload) => boolean` for gating directive application.
- `stalenessMs` — TTL override for items.

## `registerCollection(name, config)`

Registers a parameterised collection cache.

- `fetch` (required) — `(params) => Promise<{ items, meta }>`.
- `key` — `(params) => string`. Defaults to JSON.stringify.
- `stalenessMs` — TTL override for collections.
- `check` — gate directives.

## `collection(name, params?)`

Returns a reactive handle with shape `{ state, refresh, remove, setParams }`.

- `state.loading` — `true` while fetching.
- `state.error` — last error, if any.
- `state.items` — array of records.
- `refresh()` — manual refetch.
- `setParams(next)` — update parameters and refetch when they change.

## `item(name, params)`

Returns a reactive handle for a single record. Similar API to `collection` but with
`state.value` instead of `state.items`.

## `emit(event, detail)`

Pushes lifecycle events to listeners, including devtools.

## `onChange(cb)`

Subscribe to registry updates. Returns an unsubscribe function.

## Directive Helpers

- `applyDirective(directive)` — apply a single directive to the cache.
- `applyDirectives(directives)` — batch helper.
- `resync()` — trigger refetch for items touched recently (used for SSE recovery).

For full source code, inspect `verity/shared/static/lib/core.js`.

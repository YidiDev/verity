# Core Concepts: State Model

Verity tracks data through three main constructs: **types**, **collections**, and **directives**.

## Types

Types represent individual records (e.g., `invoice`, `user`). Each type declares a `fetch`
function and optional `stalenessMs` override.

```javascript
registry.registerType('invoice', {
  fetch: ({ id }) => fetch(`/api/invoices/${id}`).then((r) => r.json()),
  stalenessMs: 5 * 60 * 1000,
})
```

Types cache individual records keyed by ID. When directives reference a type, the cache invalidates
or refetches just that record.

## Collections

Collections aggregate many records. They are parameterised by an optional argument, allowing Verity
to cache multiple slices of the same dataset.

```javascript
registry.registerCollection('invoices', {
  fetch: ({ status = 'open' }) =>
    fetch(`/api/invoices?status=${status}`).then((r) => r.json()),
  key: ({ status }) => status,
  stalenessMs: 30 * 1000,
})
```

Collections store metadata about loading, errors, and last update times. Components consume the
observable state via framework adapters.

## Directives

Directives are authoritative instructions from the server. The most common action is `refetch`, but
Verity also supports `merge`, `remove`, and `replace` operations for fine-grained updates.

```json
{
  "collection": "invoices",
  "params": { "status": "open" },
  "action": "refetch",
  "idempotency_key": "inv-1234",
  "audience": "global"
}
```

Clients deduplicate directives using the idempotency key. If a gap is detected, Verity triggers a
controlled resynchronisation of the affected cache entries.

## Memory Management

The registry periodically prunes cached entries using configurable TTLs. You can override defaults
for the global memory pool or per type/collection. See [reference/core](../reference/core.md) for
all options.

## Devtools

Enable the devtools bundle to inspect cache entries and lifecycle events:

```html
<script type="module" src="/shared/devtools/devtools.js"></script>
```

The overlay reveals pending fetches, directive history, and SSE connection state.

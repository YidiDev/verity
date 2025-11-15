# Reference: Framework Adapters

Verity ships adapters that integrate the core registry with popular frameworks. All adapters live
under `/shared/adapters/`.

## Alpine (`alpine.js`)

- `installAlpine(Alpine, options)` — registers `$verity` and `$directive` magic properties.
- `directive(name, handler)` — declare custom DOM directives for directive-triggered behaviours.
- Usage: include `<script type="module" src="/shared/adapters/alpine.js"></script>` after Alpine.

## Vue (`vue.js`)

- Provides a plugin: `createVerityVuePlugin(registry, options)`.
- Exposes Composition API helpers: `useVerityCollection`, `useVerityItem`, `useVerityDirective`.
- Works with Vue 3 (Composition API). Register with `app.use(plugin)`.

## React (`react.js`)

- Exposes hooks: `useVerityCollection`, `useVerityItem`, `useDirective`.
- Includes a context provider: `<VerityProvider registry={registry}>`.
- Designed for React 18+ with modern Suspense-style patterns.

## Svelte (`svelte.js`)

- Provides stores: `collectionStore(name, params)` and `itemStore(name, params)`.
- Integrates with `$store` syntax for reactivity.

## Devtools (`devtools.js` + `devtools.css`)

- Inject `<script type="module" src="/shared/devtools/devtools.js"></script>` and the CSS to enable
the overlay.
- Includes lifecycle event timeline, directive inspector, and SSE heartbeat monitor.

## Common Options

All adapters accept an optional `registry` argument. If omitted, they create a default registry
using `createRegistry()` from the core bundle.

Refer to the example apps for detailed integration snippets:

- `verity/examples/invoices_alpine/static/app.js`
- `verity/examples/manufacturing_monitor/static/js/app.jsx`
- `verity/examples/manufacturing_monitor_vue/static/main.js`

# Getting Started

This guide shows how to wire Verity into a Flask + Alpine application. The same concepts apply
when using React, Vue, or Svelte adapters.

## 1. Install Dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2. Serve the Shared Assets

Register the shared blueprint to expose the JavaScript core, adapters, and devtools:

```python
from flask import Flask
from verity import create_shared_static_blueprint

app = Flask(__name__)
app.register_blueprint(create_shared_static_blueprint())
```

The blueprint mounts static files under `/shared` by default. Update the prefix if you need a
different URL.

## 3. Register Collections and Types

Each example ships with framework-specific setup logic. For Alpine, you typically register types in
`static/app.js`:

```javascript
import { createRegistry } from '/shared/lib/core.js'
import { installAlpine } from '/shared/adapters/alpine.js'

const registry = createRegistry({
  memory: { itemEntryTtlMs: 10 * 60 * 1000 },
})

registry.registerType('invoice', {
  fetch: ({ id }) => fetch(`/api/invoices/${id}`).then((r) => r.json()),
})

registry.registerCollection('invoices', {
  fetch: () => fetch('/api/invoices').then((r) => r.json()),
})

installAlpine(window.Alpine, { registry })
```

## 4. Consume State from the UI

```html
<div x-data="verity.collection('invoices')">
  <template x-if="state.loading">
    <p>Loading invoices…</p>
  </template>
  <template x-for="invoice in state.items" :key="invoice.id">
    <article>
      <header>
        <h2 x-text="invoice.title"></h2>
        <span x-text="invoice.status"></span>
      </header>
    </article>
  </template>
</div>
```

The UI reacts to `state.loading`, `state.error`, and the final `state.items`. Verity ensures the
collection revalidates when directives arrive.

## 5. Emit Directives After Mutations

```python
from verity.examples.invoices_alpine.app import emit_directives

@app.post('/api/invoices/<int:invoice_id>/pay')
def mark_paid(invoice_id: int):
    # update the database...
    emit_directives(
        [
            {
                'collection': 'invoices',
                'action': 'refetch',
            }
        ],
        source='invoice-payments',
    )
    return {"status": "ok"}
```

Clients receive the directive, refetch the invoices collection, and update the UI without manual
event wiring.

## Next Steps

- Explore the [state model](state-model.md) for deeper cache behaviour.
- Review the [API reference](../reference/core.md) when extending the registry.
- Spin up more demos from `verity/examples/` to see Verity in different settings.

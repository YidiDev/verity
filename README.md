# Verity

Verity is a data-first UI toolkit that keeps the server as the single source of truth.
Instead of guessing about state, Verity waits for authoritative answers from the backend
and reflects them across every connected client through server-sent directives.

Verity provides a data-first UI toolkit with the following structure:

- **`verity/`** — the core Flask helpers, JavaScript data layer, and multi-framework adapters.
- **`verity/examples/`** — production-scale demos for Alpine.js, React, and Vue along with
  "baseline" builds that intentionally skip Verity so you can compare behaviors.
- **`docs/`** — MkDocs-ready documentation that explains Verity's mental model, API surface,
  and example walkthroughs.
- **`.github/workflows/docs.yml`** — a GitHub Action that deploys the MkDocs site to GitHub Pages.
- **`LICENSE`**, **`CONTRIBUTING.md`**, and **`README.md`** — resources to help collaborators get started.

## Core Ideas

Verity is built on four promises:

1. **Server truth:** the backend is the only authority. Verity does not perform optimistic
   writes or display speculative UI states.
2. **Directive-driven updates:** the server emits directives via Server-Sent Events (SSE).
   Clients apply those directives to keep caches current without refetch storms.
3. **Deterministic caching:** collections and items are registered with explicit staleness
   windows and fetch functions so data remains fresh without guesswork.
4. **Framework-agnostic adapters:** Alpine, Vue, React, and Svelte bindings all consume the
   same core library and share identical semantics.

If a value is unknown, Verity renders honest loading affordances (skeletons, spinners,
progress bars) instead of faking certainty. This focus on truth builds user trust and
sharpens the separation between state management and rendering.

## Quick Start

1. **Install dependencies**
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
2. **Run an example**
   ```bash
   export FLASK_DEBUG=1
   python verity/examples/invoices_alpine/app.py
   # or try the manufacturing control room
   python verity/examples/manufacturing_monitor/app.py
   ```
3. **Visit the docs**
   ```bash
   mkdocs serve
   ```
   Then open <http://127.0.0.1:8000> to explore the guides and API reference.

## Philosophy Snapshot

- **No optimism:** Verity refuses to predict the future. Buttons show a busy state, and
  tables use skeleton rows until confirmed data arrives.
- **Explicit lifetimes:** data is cached with explicit TTLs and revalidation triggers.
- **Directive logs:** every directive is idempotent and carries metadata for replay,
  debugging, and resynchronisation.
- **Shared devtools:** a lightweight diagnostics panel surfaces cache contents, events,
  and lifecycle hooks regardless of the UI framework you choose.

For a deeper exploration, read [`docs/philosophy.md`](docs/philosophy.md) and the MkDocs
site that accompanies this release.

## Repository Layout

```text
verity/
├─ shared/            # Static assets (core library, adapters, devtools)
└─ examples/          # Full-stack reference applications
docs/                 # MkDocs content (guides, reference, examples)
mkdocs.yml            # MkDocs configuration
CONTRIBUTING.md       # Contribution guide
LICENSE               # MIT License
requirements.txt      # Runtime dependencies for examples and docs
```

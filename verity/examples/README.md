# Verity Examples

This directory collects runnable demos that highlight Verity's data layer in realistic domains.

## Highlights

- **Invoices Alpine** — CRUD-style workflow with SSE directives and baseline comparison.
- **Financial Crime** — Case management dashboard with directed queues.
- **Manufacturing Monitor** — Multi-surface control room for Alpine, React, and Vue.
- **Telehealth Triage Hub** — Real-time operations board with role-scoped directives.

Each application mounts the shared static blueprint from `verity.shared` and focuses on
framework-specific wiring.

### Running an Example

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r ../../requirements.txt
python invoices_alpine/app.py
```

Refer to individual subdirectories for example-specific environment variables and instructions.

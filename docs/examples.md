# Examples

The `verity/examples/` directory contains full-stack demos designed to stress-test the data layer.

## Invoices (Alpine)

- Endpoint: `python verity/examples/invoices_alpine/app.py`
- Demonstrates: CRUD workflows, optimistic-free toasts, SSE-driven updates, and skeleton tables.
- Baseline: `verity/examples/invoices_alpine_baseline` removes Verity for comparison.

## Financial Crime Case Management (Alpine)

- Endpoint: `python verity/examples/financial_crime_alpine/app.py`
- Demonstrates: Parameterised collections, desk assignments, and compliance workflows.

## Manufacturing Monitor (Alpine + React + Vue)

- Alpine: `python verity/examples/manufacturing_monitor/app.py`
- React SPA: `python verity/examples/manufacturing_monitor_react/app.py`
- Vue SPA: `python verity/examples/manufacturing_monitor_vue/app.py`
- Baselines: `manufacturing_monitor_react_baseline` and `manufacturing_monitor_vue_baseline` use manual stores.

## Telehealth Triage Hub

- Endpoint: `python verity/examples/telehealth_triage_hub/app.py`
- Features: Multi-queue triage board, SSE fan-out, role-specific directives.

Each example shares the same backend helpers and blueprint. Swap frameworks to see how adapters keep
behaviour consistent.

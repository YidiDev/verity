# Verity

Verity is a data layer for real-time, server-authoritative applications. It keeps rendering
logic lightweight by handling caching, fan-out, and directive processing for you.

> _If a piece of data cannot be proven, Verity keeps it in a loading state. Truth beats speed._

## Why Verity?

- **Deterministic cache**: Collections and items define their own fetchers and staleness windows.
- **Server-Sent Directives**: The backend broadcasts exact changes over SSE so every client
  converges without race conditions.
- **Framework adapters**: Use Alpine, React, Vue, or Svelte with the same semantics.
- **Diagnostics**: Devtools ship with lifecycle tracing, directive logs, and cache inspection.

## What's in This Release?

- A Flask blueprint that exposes the shared static assets.
- A framework-agnostic JavaScript core that enforces Verity's invariants.
- Multiple adapters that bridge the core to different frontend ecosystems.
- Realistic examples spanning finance, manufacturing, and telehealth domains.

## Next Steps

1. Read [Getting Started](guides/getting-started.md) to wire Verity into a new project.
2. Explore the [core concepts](guides/state-model.md) that keep data honest.
3. Dive into the [API reference](reference/core.md) when you're ready to customise behaviour.
4. Clone the [examples](examples.md) and adapt them for your domain.
